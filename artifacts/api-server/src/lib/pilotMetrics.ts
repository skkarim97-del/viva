// ----------------------------------------------------------------------
// pilotMetrics -- composite "Pilot Metrics" layer for Viva Analytics.
//
// Aggregates existing data (patients, patient_checkins, intervention_
// events, care_events) into the three KPI groups the pilot readout
// cares about: Earlier Risk Visibility, Intervention Performance,
// Provider Leverage.
//
// Design notes (so the next person doesn't have to re-derive the rules):
//
//   * Cohort = all activated patients (patients.activated_at IS NOT NULL).
//     The internal dashboard is operator-key-gated and pilot-wide, so we
//     don't scope by doctor here. A future cohort_start/cohort_end window
//     can be layered on top by adding a date filter to the activated_at
//     check.
//
//   * Window = last 30 days. All "events in window" counts use this.
//     The cohort itself is not narrowed by window -- a patient activated
//     6 months ago still counts. Window only narrows the *event volume*
//     so the metrics reflect recent pilot activity.
//
//   * Risk band is computed on read via lib/risk.computeRisk -- not
//     materialized. Outcome snapshots are patient-written and never
//     carry risk; persisting it would mean either NULL columns or a
//     net-new server writer. Computation cost: one query for the last
//     30 days of check-ins across all cohort patients, grouped in
//     memory. Mirrors the needsFollowup block in routes/internal.ts.
//
//   * Auto-resolve window = 48h. An intervention is "auto-resolved" if
//     no escalation_requested by the same patient occurs within 48h
//     after the intervention. Escalated within 48h is the inverse.
//
//   * Engagement = loose join. We count an intervention_event as engaged
//     if the same patient logged ANY intervention_feedback care_event
//     within 48h after. Type-matching would require a shared vocabulary
//     between intervention_events.interventionType (enum) and
//     intervention_feedback.metadata.intervention_id (free string,
//     symptom-tip names like "nausea"); they don't share one today.
//     Documented as a known imprecision -- pilot decision was to ship
//     loose now, tighten the schema later if needed.
//
//   * Escalation dedupe = 24h per patient. If a patient taps escalate
//     multiple times in a 24h window we count it as one. Without this
//     a frustrated patient can trivially inflate the # escalations.
//
//   * "Acted on" = follow_up_completed linked to the escalation via
//     trigger_event_id. doctor_reviewed alone does NOT count -- per
//     pilot decision, a passive acknowledgment is "reviewed", not
//     "acted on".
//
//   * "Reviewed" = any doctor_reviewed care_event for the same patient
//     occurring after the escalation and before the NEXT escalation by
//     that patient (or now). doctor_reviewed does not currently carry
//     trigger_event_id, so we use the next-escalation-boundary window
//     as the cleanest proxy. If a doctor reviews escalation #2, that
//     doesn't retroactively flag escalation #1 as reviewed.
// ----------------------------------------------------------------------

import { and, eq, gte, isNotNull, sql, desc } from "drizzle-orm";
import {
  db,
  patientsTable,
  patientCheckinsTable,
  interventionEventsTable,
  careEventsTable,
} from "@workspace/db";
import { computeRisk } from "./risk";
import type { RiskBand } from "./risk";

// ---- Wire types ------------------------------------------------------

export interface PilotRiskCategory {
  code: string;
  label: string;
  patients: number;
  pct: number; // 0..1, share of cohort
}

export interface PilotRiskBlock {
  flaggedPatients: number; // current band != 'low'
  pctFlagged: number; // 0..1
  avgSignalsPerPatient: number;
  topCategories: PilotRiskCategory[];
  bandDistribution: Record<RiskBand, number>;
}

export interface PilotInterventionsBlock {
  triggered: number;
  perPatient: number; // triggered / cohortSize
  engaged: number;
  pctEngaged: number;
  autoResolved: number;
  pctAutoResolved: number;
  escalated: number;
  pctEscalated: number;
}

export interface PilotProviderBlock {
  patientsEscalated: number; // distinct patients (deduped escalations)
  escalationsRaw: number; // before dedupe
  escalationsDeduped: number;
  avgTimeToFollowUpHours: number | null;
  timeToFollowUpDenom: number; // # deduped escalations that have a linked follow-up
  pctReviewed: number;
  pctActedOn: number;
}

export interface PilotMetricsBlock {
  windowDays: 30;
  cohort: { activated: number };
  risk: PilotRiskBlock;
  interventions: PilotInterventionsBlock;
  provider: PilotProviderBlock;
  rules: {
    autoResolveWindowHours: 48;
    engagementWindowHours: 48;
    escalationDedupeHours: 24;
    riskBandSource: "computed_on_read";
    engagementJoin: "loose_patient_only_within_48h";
    actedOnDefinition: "follow_up_completed_linked_via_trigger";
    reviewedDefinition: "doctor_reviewed_after_escalation_before_next";
  };
}

// ---- Computation -----------------------------------------------------

/**
 * Build the pilot-metrics block. Single composed read; safe to call
 * inside the existing summary endpoint. All counts are dedupe-safe per
 * the rules above.
 */
export async function computePilotMetrics(): Promise<PilotMetricsBlock> {
  const WINDOW_DAYS = 30 as const;
  const AUTO_RESOLVE_HOURS = 48 as const;
  const ENGAGEMENT_HOURS = 48 as const;
  const DEDUPE_HOURS = 24 as const;

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // -------- Cohort: all activated patients --------------------------
  const cohortRows = await db
    .select({ id: patientsTable.userId })
    .from(patientsTable)
    .where(isNotNull(patientsTable.activatedAt));
  const cohortIds = cohortRows.map((r) => r.id);
  const cohortSize = cohortIds.length;

  // Empty cohort short-circuit. All KPIs zero, no work to do.
  if (cohortSize === 0) {
    return emptyBlock(WINDOW_DAYS, {
      autoResolveWindowHours: AUTO_RESOLVE_HOURS,
      engagementWindowHours: ENGAGEMENT_HOURS,
      escalationDedupeHours: DEDUPE_HOURS,
    });
  }

  // -------- Risk: pull last 30d of check-ins for cohort, group in
  // memory, run computeRisk per patient. Mirrors the needsFollowup
  // block in routes/internal.ts so the cost is well-understood.
  const checkinsCutoff = ymdDaysAgo(WINDOW_DAYS - 1);
  const checkins = await db
    .select()
    .from(patientCheckinsTable)
    .where(gte(patientCheckinsTable.date, checkinsCutoff))
    .orderBy(desc(patientCheckinsTable.date));
  const checkinsByPatient = new Map<number, typeof checkins>();
  for (const c of checkins) {
    const arr = checkinsByPatient.get(c.patientUserId) ?? [];
    arr.push(c);
    checkinsByPatient.set(c.patientUserId, arr);
  }

  let flagged = 0;
  let totalSignals = 0;
  const bandDistribution: Record<RiskBand, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };
  const ruleHits = new Map<string, { label: string; patients: number }>();
  for (const id of cohortIds) {
    const list = checkinsByPatient.get(id) ?? [];
    const r = computeRisk(list);
    bandDistribution[r.band] += 1;
    totalSignals += r.rules.length;
    if (r.band !== "low") flagged += 1;
    for (const rule of r.rules) {
      const cur = ruleHits.get(rule.code) ?? {
        label: rule.label,
        patients: 0,
      };
      cur.patients += 1;
      ruleHits.set(rule.code, cur);
    }
  }
  const topCategories: PilotRiskCategory[] = [...ruleHits.entries()]
    .map(([code, v]) => ({
      code,
      label: v.label,
      patients: v.patients,
      pct: v.patients / cohortSize,
    }))
    .sort((a, b) => b.patients - a.patients)
    .slice(0, 5);

  // -------- Interventions: triggered, engaged, auto-resolved,
  // escalated. Single SQL pass per metric; all gated to cohort and
  // window.
  // Drizzle doesn't expose interval arithmetic ergonomically across
  // dialects, so we use raw SQL for the EXISTS subqueries -- mirrors
  // the existing pattern in routes/internal.ts.
  const triggeredRows = await db.execute(sql`
    select cast(count(*) as int) as n
    from intervention_events
    where patient_user_id = any(${sql.raw(toIntArrayLiteral(cohortIds))})
      and occurred_at >= ${windowStart}
  `);
  const triggered = numFromRow(triggeredRows.rows?.[0], "n");

  // Window boundary contract: INCLUSIVE on both ends (>= ie.occurred_at
  // and <= ie.occurred_at + N hours). "Within 48h" matches conventional
  // human interpretation; the boundary only differs at exactly +N:00:00
  // which is statistically unlikely but worth pinning down. Both the
  // engagement and escalation queries use the same convention.
  const engagedRows = await db.execute(sql`
    select cast(count(*) as int) as n
    from intervention_events ie
    where ie.patient_user_id = any(${sql.raw(toIntArrayLiteral(cohortIds))})
      and ie.occurred_at >= ${windowStart}
      and exists (
        select 1 from care_events ce
        where ce.patient_user_id = ie.patient_user_id
          and ce.type = 'intervention_feedback'
          and ce.occurred_at >= ie.occurred_at
          and ce.occurred_at <= ie.occurred_at + interval '${sql.raw(String(ENGAGEMENT_HOURS))} hours'
      )
  `);
  const engaged = numFromRow(engagedRows.rows?.[0], "n");

  const escalatedWithinRows = await db.execute(sql`
    select cast(count(*) as int) as n
    from intervention_events ie
    where ie.patient_user_id = any(${sql.raw(toIntArrayLiteral(cohortIds))})
      and ie.occurred_at >= ${windowStart}
      and exists (
        select 1 from care_events ce
        where ce.patient_user_id = ie.patient_user_id
          and ce.type = 'escalation_requested'
          and ce.occurred_at >= ie.occurred_at
          and ce.occurred_at <= ie.occurred_at + interval '${sql.raw(String(AUTO_RESOLVE_HOURS))} hours'
      )
  `);
  const escalatedWithin = numFromRow(escalatedWithinRows.rows?.[0], "n");
  const autoResolved = Math.max(0, triggered - escalatedWithin);

  // -------- Escalations (Provider Leverage). Pull raw escalations,
  // dedupe per patient per 24h in app code (one pass, sorted), then
  // join to follow_up_completed via trigger_event_id and to
  // doctor_reviewed via the next-escalation boundary window.
  const rawEscalations = await db
    .select({
      id: careEventsTable.id,
      patientUserId: careEventsTable.patientUserId,
      occurredAt: careEventsTable.occurredAt,
    })
    .from(careEventsTable)
    .where(
      and(
        eq(careEventsTable.type, "escalation_requested"),
        gte(careEventsTable.occurredAt, windowStart),
      ),
    )
    .orderBy(careEventsTable.patientUserId, careEventsTable.occurredAt);

  const cohortIdSet = new Set(cohortIds);
  const inCohort = rawEscalations.filter((e) =>
    cohortIdSet.has(e.patientUserId),
  );
  const escalationsRaw = inCohort.length;

  // Dedupe: walk patient-grouped, keep an event only if it's >= 24h
  // after the previously kept event for that patient.
  const dedupedEscalations: typeof inCohort = [];
  let lastByPatient = new Map<number, Date>();
  for (const e of inCohort) {
    const prev = lastByPatient.get(e.patientUserId);
    const dt = new Date(e.occurredAt);
    if (
      !prev ||
      dt.getTime() - prev.getTime() >= DEDUPE_HOURS * 60 * 60 * 1000
    ) {
      dedupedEscalations.push(e);
      lastByPatient.set(e.patientUserId, dt);
    }
  }
  const escalationsDeduped = dedupedEscalations.length;
  const patientsEscalated = new Set(
    dedupedEscalations.map((e) => e.patientUserId),
  ).size;

  // Linked follow-ups (acted on) -- one query for all deduped escalations.
  let followUps: Array<{
    triggerEventId: number | null;
    occurredAt: Date;
  }> = [];
  if (escalationsDeduped > 0) {
    const ids = dedupedEscalations.map((e) => e.id);
    const fuRows = await db.execute(sql`
      select trigger_event_id, occurred_at
      from care_events
      where type = 'follow_up_completed'
        and trigger_event_id = any(${sql.raw(toIntArrayLiteral(ids))})
    `);
    followUps = (fuRows.rows ?? []).map((r) => {
      const row = r as { trigger_event_id: number | null; occurred_at: Date };
      return {
        triggerEventId: row.trigger_event_id,
        occurredAt: new Date(row.occurred_at),
      };
    });
  }
  // Build escId -> escalation time map first so we can guard backdated follow-ups.
  const escTimeById = new Map<number, number>();
  for (const e of dedupedEscalations) {
    escTimeById.set(e.id, new Date(e.occurredAt).getTime());
  }
  const followUpByEsc = new Map<number, Date>();
  for (const fu of followUps) {
    if (fu.triggerEventId == null) continue;
    const escMs = escTimeById.get(fu.triggerEventId);
    if (escMs == null) continue;
    // Guard: ignore linked follow-ups whose occurred_at predates the
    // escalation. These are data anomalies (clock skew, manual backfill);
    // counting them would skew acted-on rate and produce negative
    // time-to-follow-up.
    if (fu.occurredAt.getTime() < escMs) continue;
    // If multiple valid follow-ups linked, keep the earliest -- that's the
    // first time the doctor actually followed up.
    const prev = followUpByEsc.get(fu.triggerEventId);
    if (!prev || fu.occurredAt < prev) {
      followUpByEsc.set(fu.triggerEventId, fu.occurredAt);
    }
  }
  let actedOn = 0;
  let timeSumMs = 0;
  let timeDenom = 0;
  for (const e of dedupedEscalations) {
    const fu = followUpByEsc.get(e.id);
    if (fu) {
      actedOn += 1;
      timeSumMs += fu.getTime() - new Date(e.occurredAt).getTime();
      timeDenom += 1;
    }
  }
  const avgTimeToFollowUpHours =
    timeDenom > 0 ? timeSumMs / timeDenom / (60 * 60 * 1000) : null;

  // Reviewed -- doctor_reviewed by same patient between this escalation
  // and the next escalation by that patient. The next-escalation boundary
  // must be derived from the RAW escalation stream (not the deduped one):
  // if a second escalation occurs within DEDUPE_HOURS it gets suppressed
  // from the denominator, but it is still a real new clinical signal that
  // closes the review window for the prior escalation. Using deduped here
  // would extend the window and over-count reviews.
  let reviewed = 0;
  if (escalationsDeduped > 0) {
    const reviewRows = await db
      .select({
        patientUserId: careEventsTable.patientUserId,
        occurredAt: careEventsTable.occurredAt,
      })
      .from(careEventsTable)
      .where(
        and(
          eq(careEventsTable.type, "doctor_reviewed"),
          gte(careEventsTable.occurredAt, windowStart),
        ),
      );
    const reviewsByPatient = new Map<number, Date[]>();
    for (const r of reviewRows) {
      const arr = reviewsByPatient.get(r.patientUserId) ?? [];
      arr.push(new Date(r.occurredAt));
      reviewsByPatient.set(r.patientUserId, arr);
    }
    // Raw escalation timestamps per patient, ascending. inCohort is
    // already sorted by (patient_user_id, occurred_at) from the query.
    const rawTimesByPatient = new Map<number, number[]>();
    for (const e of inCohort) {
      const arr = rawTimesByPatient.get(e.patientUserId) ?? [];
      arr.push(new Date(e.occurredAt).getTime());
      rawTimesByPatient.set(e.patientUserId, arr);
    }
    for (const e of dedupedEscalations) {
      const reviews = reviewsByPatient.get(e.patientUserId) ?? [];
      const start = new Date(e.occurredAt).getTime();
      const rawTimes = rawTimesByPatient.get(e.patientUserId) ?? [];
      // First raw escalation strictly after `start` closes the window.
      let end = Number.POSITIVE_INFINITY;
      for (const t of rawTimes) {
        if (t > start) {
          end = t;
          break;
        }
      }
      const hit = reviews.some((r) => {
        const t = r.getTime();
        return t >= start && t < end;
      });
      if (hit) reviewed += 1;
    }
  }

  return {
    windowDays: WINDOW_DAYS,
    cohort: { activated: cohortSize },
    risk: {
      flaggedPatients: flagged,
      pctFlagged: cohortSize > 0 ? flagged / cohortSize : 0,
      avgSignalsPerPatient: cohortSize > 0 ? totalSignals / cohortSize : 0,
      topCategories,
      bandDistribution,
    },
    interventions: {
      triggered,
      perPatient: cohortSize > 0 ? triggered / cohortSize : 0,
      engaged,
      pctEngaged: triggered > 0 ? engaged / triggered : 0,
      autoResolved,
      pctAutoResolved: triggered > 0 ? autoResolved / triggered : 0,
      escalated: escalatedWithin,
      pctEscalated: triggered > 0 ? escalatedWithin / triggered : 0,
    },
    provider: {
      patientsEscalated,
      escalationsRaw,
      escalationsDeduped,
      avgTimeToFollowUpHours,
      timeToFollowUpDenom: timeDenom,
      pctReviewed: escalationsDeduped > 0 ? reviewed / escalationsDeduped : 0,
      pctActedOn: escalationsDeduped > 0 ? actedOn / escalationsDeduped : 0,
    },
    rules: {
      autoResolveWindowHours: AUTO_RESOLVE_HOURS,
      engagementWindowHours: ENGAGEMENT_HOURS,
      escalationDedupeHours: DEDUPE_HOURS,
      riskBandSource: "computed_on_read",
      engagementJoin: "loose_patient_only_within_48h",
      actedOnDefinition: "follow_up_completed_linked_via_trigger",
      reviewedDefinition: "doctor_reviewed_after_escalation_before_next",
    },
  };
}

// ---- Helpers ---------------------------------------------------------

function emptyBlock(
  windowDays: 30,
  windows: {
    autoResolveWindowHours: 48;
    engagementWindowHours: 48;
    escalationDedupeHours: 24;
  },
): PilotMetricsBlock {
  return {
    windowDays,
    cohort: { activated: 0 },
    risk: {
      flaggedPatients: 0,
      pctFlagged: 0,
      avgSignalsPerPatient: 0,
      topCategories: [],
      bandDistribution: { low: 0, medium: 0, high: 0 },
    },
    interventions: {
      triggered: 0,
      perPatient: 0,
      engaged: 0,
      pctEngaged: 0,
      autoResolved: 0,
      pctAutoResolved: 0,
      escalated: 0,
      pctEscalated: 0,
    },
    provider: {
      patientsEscalated: 0,
      escalationsRaw: 0,
      escalationsDeduped: 0,
      avgTimeToFollowUpHours: null,
      timeToFollowUpDenom: 0,
      pctReviewed: 0,
      pctActedOn: 0,
    },
    rules: {
      ...windows,
      riskBandSource: "computed_on_read",
      engagementJoin: "loose_patient_only_within_48h",
      actedOnDefinition: "follow_up_completed_linked_via_trigger",
      reviewedDefinition: "doctor_reviewed_after_escalation_before_next",
    },
  };
}

// Build a Postgres int[] literal from a JS array of integers. We use
// this with sql.raw inside `= any(...)` because Drizzle's parameterised
// `inArray` doesn't compose cleanly inside an EXISTS subquery in raw
// SQL. Inputs are integers we just selected from the DB, so there's no
// injection surface, but we still cast each value through Number() and
// reject non-finite values defensively.
function toIntArrayLiteral(ids: number[]): string {
  const safe = ids
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n));
  if (safe.length === 0) return "ARRAY[]::int[]";
  return `ARRAY[${safe.join(",")}]::int[]`;
}

function numFromRow(
  row: Record<string, unknown> | undefined,
  key: string,
): number {
  const v = row?.[key];
  return typeof v === "number" ? v : Number(v ?? 0);
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
