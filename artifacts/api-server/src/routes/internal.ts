import { Router, type Request, type Response, type NextFunction } from "express";
import { and, eq, gte, lte, isNotNull, notInArray, sql, desc } from "drizzle-orm";
import { excludeDemoCol, demoUserIdsSelect, DEMO_EMAIL_LIKE, DEMO_VIVAAI_LIKE } from "../lib/demoFilter";
import { z } from "zod";
import {
  db,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  doctorNotesTable,
  interventionEventsTable,
  careEventsTable,
  outcomeSnapshotsTable,
  analyticsEventsTable,
  pilotSnapshotsTable,
  telehealthPlatformsTable,
  deriveStopTiming,
} from "@workspace/db";
import { computeRisk, deriveAction } from "../lib/risk";
import { logger } from "../lib/logger";
import { linkInterventionsToOutcomes } from "./interventions";
import { recomputeRecentOutcomesForAllPatients } from "./outcomes";
import {
  computePilotMetrics,
  PILOT_METRIC_DEFINITION_VERSION,
  type PilotMetricsBlock,
} from "../lib/pilotMetrics";
import { operatorIpAllowlist } from "../middlewares/ipAllowlist";
import { mediumApiLimiter } from "../middlewares/rateLimit";
import { phiAudit } from "../middlewares/phiAudit";

const router: Router = Router();

// Order matters: rate limit first (cheap, no DB), then IP allowlist
// (cheap, no DB), then the bearer-key check inside requireInternalKey.
// Mounting them at the router level applies them to every operator
// endpoint without having to remember per-route.
router.use(mediumApiLimiter);
router.use(operatorIpAllowlist);
// HIPAA audit log for operator activity. Operator requests have no
// user row today (deferred per pilot decision), so we override the
// actor role to 'operator' and let actor_user_id be NULL. We do not
// resolve a patient id here -- internal endpoints serve platform-
// scoped aggregates, not patient PHI -- but routes that DO surface
// per-patient data (e.g. needs-review lists) call phiAudit at their
// own scope or wrap the data fetch in the existing PHI route group.
router.use(
  phiAudit({
    actor: { actorRole: "operator" },
    getPlatformId: (req) => {
      const raw = req.query?.platformId ?? req.params?.platformId;
      if (typeof raw !== "string") return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
  }),
);

// Internal-only endpoint. NOT mounted under /api on purpose -- this
// lives at /api/internal but is gated by a separate bearer token, not
// the doctor session, so a logged-in doctor can't accidentally pull
// product analytics through the same browser session.
//
// Activation:
//   * The operator code defaults to OPERATOR_CODE below -- single
//     source of truth for the whole platform (Viva Clinic /internal*
//     and the Viva Analytics product both gate against this).
//   * To rotate the code in production without a redeploy, set the
//     INTERNAL_API_KEY environment secret -- if present it overrides
//     the constant below.
//   * The gate page prompts the operator for the code and stores it
//     in localStorage; the page sends it as Authorization: Bearer <code>.

const OPERATOR_CODE = "Viva2026!";

function expectedKey(): string | null {
  const override = (process.env.INTERNAL_API_KEY || "").trim();
  return override || OPERATOR_CODE;
}

function requireInternalKey(req: Request, res: Response, next: NextFunction) {
  const expected = expectedKey();
  if (!expected) {
    res.status(503).json({
      error: "internal_metrics_disabled",
      detail:
        "Set the INTERNAL_API_KEY deployment secret to enable internal metrics.",
    });
    return;
  }
  // Bearer header ONLY. We deliberately do not accept the key via a
  // query string -- secrets in URLs leak through browser history,
  // upstream proxy access logs, the Referer header on outbound links,
  // and our own request logger.
  const auth = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const provided = (m?.[1] ?? "").trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "invalid_internal_key" });
    return;
  }
  next();
}

// YYYY-MM-DD in the SERVER's local timezone, matching how
// patientCheckinsTable.date is stored (a `date` column with no tz).
// Using toISOString() here would shift counts around 00:00 UTC for any
// server outside UTC, which is how the previous version silently
// undercounted the last day in PT-deployed environments.
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymdLocal(d);
}

// GET /api/internal/metrics -- single roll-up call powering the whole
// internal dashboard. Each metric below names exactly which row count
// it comes from so the page can show a "How calculated" line under
// each stat.
router.get("/metrics", requireInternalKey, async (_req, res: Response) => {
  try {
    // ---- Invites & activation ---------------------------------------
    // Every patient row corresponds to exactly one invite the doctor
    // sent (patientsTable is created in /patients/invite).
    // Pre-pilot demo filter applied to every count below: see
    // ../lib/demoFilter.ts. Real numbers only -- the seeded demo
    // doctor and any demo-invited patients (matched by email pattern
    // `demo%@itsviva.com`) are excluded so the operator dashboard
    // never shows demo activity as pilot signal.
    const [{ count: invitesSent }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientsTable)
      .where(notInArray(patientsTable.userId, demoUserIdsSelect()));

    const [{ count: activated }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientsTable)
      .where(
        and(
          isNotNull(patientsTable.activatedAt),
          notInArray(patientsTable.userId, demoUserIdsSelect()),
        ),
      );

    // ---- Check-in coverage ------------------------------------------
    const [{ count: completedFirstCheckin }] = await db
      .select({
        count: sql<number>`cast(count(distinct ${patientCheckinsTable.patientUserId}) as int)`,
      })
      .from(patientCheckinsTable)
      .where(notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()));

    const sevenDaysAgo = ymdDaysAgo(6); // inclusive 7-day window
    const [{ count: checkedInLast7 }] = await db
      .select({
        count: sql<number>`cast(count(distinct ${patientCheckinsTable.patientUserId}) as int)`,
      })
      .from(patientCheckinsTable)
      .where(
        and(
          gte(patientCheckinsTable.date, sevenDaysAgo),
          notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()),
        ),
      );

    const [{ count: checkinsLast7Total }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientCheckinsTable)
      .where(
        and(
          gte(patientCheckinsTable.date, sevenDaysAgo),
          notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()),
        ),
      );

    // No-check-in-after-invite:
    //   any patient row whose userId never appears in patientCheckinsTable.
    // Computed in SQL with NOT EXISTS so we don't pull every row.
    const noCheckinAfterInviteRows = await db.execute(sql`
      select cast(count(*) as int) as count
      from ${patientsTable} p
      where not exists (
        select 1 from ${patientCheckinsTable} c
        where c.patient_user_id = p.user_id
      )
        and ${excludeDemoCol("p.user_id")}
    `);
    const noCheckinAfterInvite =
      Number(
        (noCheckinAfterInviteRows.rows?.[0] as { count?: number } | undefined)
          ?.count ?? 0,
      );

    // ---- Drop-off buckets -------------------------------------------
    // A patient is in the "N+ days silent" bucket if their MOST RECENT
    // check-in is N or more days ago. We compute max(date) per patient
    // and then count buckets in JS rather than three separate queries.
    // Patients who never checked in are counted separately above
    // (noCheckinAfterInvite) and intentionally NOT included here, so
    // the buckets answer "of patients who used the app, who has gone
    // quiet recently".
    const lastDateRows = await db
      .select({
        patientUserId: patientCheckinsTable.patientUserId,
        last: sql<string>`max(${patientCheckinsTable.date})`,
      })
      .from(patientCheckinsTable)
      .where(notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()))
      .groupBy(patientCheckinsTable.patientUserId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let dropoff3 = 0;
    let dropoff5 = 0;
    let dropoff7 = 0;
    for (const r of lastDateRows) {
      if (!r.last) continue;
      const last = new Date(r.last + "T00:00:00");
      const days = Math.floor(
        (today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days >= 7) dropoff7 += 1;
      if (days >= 5) dropoff5 += 1;
      if (days >= 3) dropoff3 += 1;
    }

    // ---- Needs follow-up (live risk) --------------------------------
    // We re-run the same risk computation the doctor dashboard uses,
    // across every activated patient, and count those whose action is
    // "needs_followup". Done in app code (not SQL) so a single source
    // of truth -- lib/risk -- governs the count.
    const activatedPatients = await db
      .select({ id: patientsTable.userId })
      .from(patientsTable)
      .where(
        and(
          isNotNull(patientsTable.activatedAt),
          notInArray(patientsTable.userId, demoUserIdsSelect()),
        ),
      );

    let needsFollowup = 0;
    if (activatedPatients.length > 0) {
      // Pull last 14 days of check-ins for all activated patients in one
      // query, then group in memory -- mirrors what /patients does.
      const cutoff = ymdDaysAgo(13);
      const cks = await db
        .select()
        .from(patientCheckinsTable)
        .where(
          and(
            gte(patientCheckinsTable.date, cutoff),
            notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()),
          ),
        )
        .orderBy(desc(patientCheckinsTable.date));
      const byPatient = new Map<number, typeof cks>();
      for (const c of cks) {
        const arr = byPatient.get(c.patientUserId) ?? [];
        arr.push(c);
        byPatient.set(c.patientUserId, arr);
      }
      for (const p of activatedPatients) {
        const list = byPatient.get(p.id) ?? [];
        const risk = computeRisk(list);
        const lastCheckin = list[0]?.date ?? null;
        const action = deriveAction(risk.score, risk.rules, lastCheckin);
        if (action === "needs_followup") needsFollowup += 1;
      }
    }

    // ---- Derived ratios --------------------------------------------
    const activationRate =
      invitesSent > 0 ? activated / invitesSent : 0;
    const avgCheckinsPerActive =
      checkedInLast7 > 0 ? checkinsLast7Total / checkedInLast7 : 0;

    res.json({
      generatedAt: new Date().toISOString(),
      invitesSent,
      activated,
      activationRate,
      completedFirstCheckin,
      checkedInLast7,
      noCheckinAfterInvite,
      dropoff: {
        threeDaysPlus: dropoff3,
        fiveDaysPlus: dropoff5,
        sevenDaysPlus: dropoff7,
      },
      avgCheckinsPerActive,
      needsFollowup,
    });
  } catch (err) {
    logger.error({ err }, "internal_metrics_failed");
    res.status(500).json({ error: "metrics_failed" });
  }
});

// Cheap health check so the dashboard page can verify the operator's
// stored key without rendering a full page first.
router.get("/ping", requireInternalKey, (_req, res: Response) => {
  res.json({ ok: true });
});

// ----- /internal/analytics/summary --------------------------------
// Single roll-up powering the internal analytics page. Aggregates
// intervention -> outcome attribution across the full population,
// sliced by intervention type, treatment state, communication mode,
// and signal-confidence band. Server-side recomputes outcome
// snapshots first so older mobile clients (that don't yet POST
// /outcomes/snapshot) still produce meaningful rows.
router.get(
  "/analytics/summary",
  requireInternalKey,
  async (req, res: Response) => {
    try {
      // Recompute the recent window so the join below has fresh
      // outcome rows even for clients that haven't migrated yet.
      // 14 days is enough headroom for the 7-day window we attribute
      // outcomes over while keeping the recompute cheap.
      await recomputeRecentOutcomesForAllPatients(14);

      // Cross-population, last-7-days outcome window per intervention.
      const links = await linkInterventionsToOutcomes(null, 7);

      // Helper to bucket counts.
      type Bucket = {
        total: number;
        adherenceImproved: number;
        symptomImproved: number;
        symptomWorsened: number;
        nextDayCheckin: number;
        reengagedAfterLow: number;
      };
      const empty = (): Bucket => ({
        total: 0,
        adherenceImproved: 0,
        symptomImproved: 0,
        symptomWorsened: 0,
        nextDayCheckin: 0,
        reengagedAfterLow: 0,
      });
      const inc = (b: Bucket, l: (typeof links)[number]) => {
        b.total += 1;
        if (l.adherenceImproved) b.adherenceImproved += 1;
        if (l.symptomImproved) b.symptomImproved += 1;
        if (l.symptomWorsened) b.symptomWorsened += 1;
        if (l.nextDayCheckin) b.nextDayCheckin += 1;
        if (l.reengagedAfterLow) b.reengagedAfterLow += 1;
      };

      const byInterventionType: Record<string, Bucket> = {};
      const byCommunicationMode: Record<string, Bucket> = {};
      const byPrimaryFocus: Record<string, Bucket> = {};
      const byConfidenceBand: Record<string, Bucket> = {};

      for (const l of links) {
        (byInterventionType[l.interventionType] ??= empty());
        inc(byInterventionType[l.interventionType]!, l);

        (byCommunicationMode[l.communicationMode] ??= empty());
        inc(byCommunicationMode[l.communicationMode]!, l);

        (byPrimaryFocus[l.primaryFocus] ??= empty());
        inc(byPrimaryFocus[l.primaryFocus]!, l);

        (byConfidenceBand[l.confidenceBand] ??= empty());
        inc(byConfidenceBand[l.confidenceBand]!, l);
      }

      // Top pathway-to-escalation: count interventions whose own
      // (or a follow-up) intervention escalated to clinician.
      const escalationPathwaysRows = await db.execute(sql`
        select
          ie.intervention_type as intervention_type,
          cast(count(*) as int) as count
        from intervention_events ie
        where exists (
          select 1
          from intervention_events ie2
          where ie2.patient_user_id = ie.patient_user_id
            and ie2.occurred_on >= ie.occurred_on
            and ie2.occurred_on <= (ie.occurred_on::date + interval '7 days')
            and ie2.intervention_type = 'clinician_escalation'
        )
          and ${excludeDemoCol("ie.patient_user_id")}
        group by ie.intervention_type
        order by count desc
        limit 10
      `);

      const reengagementAfterCoachRows = await db.execute(sql`
        select
          cast(count(*) filter (where os.reengaged_after_low_adherence) as int) as reengaged,
          cast(count(*) as int) as total
        from intervention_events ie
        left join lateral (
          select * from outcome_snapshots os
          where os.patient_user_id = ie.patient_user_id
            and os.snapshot_date >= ie.occurred_on
            and os.snapshot_date <= (ie.occurred_on::date + interval '7 days')
          order by os.snapshot_date asc
          limit 1
        ) os on true
        where ie.surface = 'Coach'
          and ${excludeDemoCol("ie.patient_user_id")}
      `);
      const reEnrich = (
        (reengagementAfterCoachRows.rows?.[0] as
          | { reengaged?: number; total?: number }
          | undefined) ?? { reengaged: 0, total: 0 }
      );

      // ----- "Is this actually working?" simple health KPIs (14d) -----
      // Four raw signals, no segmentation. Window is 14 days because
      // a 7-day window collapses to noise with our current cohort
      // size; 14d gives a more honest read while still being recent.
      const healthWindowDays = 14;
      const sinceYmd = ymdDaysAgo(healthWindowDays - 1);

      // KPI 1: % of users who logged a check-in on the day AFTER any
      // intervention event. Numerator = distinct patients with at
      // least one (intervention day, day+1 checkin) pair in the
      // window. Denominator = distinct patients with any intervention
      // in the window.
      const nextDayRows = await db.execute(sql`
        with recent as (
          select distinct ie.patient_user_id, ie.occurred_on
          from intervention_events ie
          where ie.occurred_on >= ${sinceYmd}
            and ${excludeDemoCol("ie.patient_user_id")}
        ),
        with_followup as (
          select distinct r.patient_user_id
          from recent r
          where exists (
            select 1 from patient_checkins c
            where c.patient_user_id = r.patient_user_id
              and c.date = (r.occurred_on::date + interval '1 day')::date
          )
        ),
        any_intervention as (
          select distinct patient_user_id from recent
        )
        select
          (select cast(count(*) as int) from with_followup) as with_followup,
          (select cast(count(*) as int) from any_intervention) as denom
      `);
      const nextDayRow =
        (nextDayRows.rows?.[0] as
          | { with_followup?: number; denom?: number }
          | undefined) ?? { with_followup: 0, denom: 0 };
      const nextDayCheckinUsers = Number(nextDayRow.with_followup ?? 0);
      const nextDayCheckinDenom = Number(nextDayRow.denom ?? 0);

      // KPI 2: % of users improving engagement over 3 days.
      // Numerator = distinct patients with at least one
      // outcome_snapshots row in the window where
      // adherence_improved_3d=true. Denominator = distinct patients
      // with any outcome snapshot in the window.
      const engagementRows = await db.execute(sql`
        with recent as (
          select patient_user_id, adherence_improved_3d
          from outcome_snapshots
          where snapshot_date >= ${sinceYmd}
            and ${excludeDemoCol("patient_user_id")}
        )
        select
          (select cast(count(distinct patient_user_id) as int)
             from recent where adherence_improved_3d) as improved,
          (select cast(count(distinct patient_user_id) as int)
             from recent) as denom
      `);
      const engagementRow =
        (engagementRows.rows?.[0] as
          | { improved?: number; denom?: number }
          | undefined) ?? { improved: 0, denom: 0 };
      const engagementImprovedUsers = Number(engagementRow.improved ?? 0);
      const engagementDenom = Number(engagementRow.denom ?? 0);

      // KPI 3: top 3 intervention types by raw usage in the window.
      const topInterventionRows = await db.execute(sql`
        select
          intervention_type as type,
          cast(count(*) as int) as count
        from intervention_events
        where occurred_on >= ${sinceYmd}
          and ${excludeDemoCol("patient_user_id")}
        group by intervention_type
        order by count desc
        limit 3
      `);
      const topInterventions = (
        topInterventionRows.rows as Array<{ type: string; count: number }>
      ).map((r) => ({ type: r.type, count: Number(r.count) }));

      // KPI 4: symptom trend direction across all patients (window).
      // Counts outcome snapshots tagged improved vs worsened. We pick
      // the direction with the larger count and report a magnitude
      // ratio so the dashboard can show "improving 2:1" style copy.
      const symptomTrendRows = await db.execute(sql`
        select
          cast(count(*) filter (where symptom_trend_3d = 'improved') as int) as improved,
          cast(count(*) filter (where symptom_trend_3d = 'worsened') as int) as worsened,
          cast(count(*) filter (where symptom_trend_3d = 'stable') as int) as stable
        from outcome_snapshots
        where snapshot_date >= ${sinceYmd}
          and ${excludeDemoCol("patient_user_id")}
      `);
      const symptomTrendRow =
        (symptomTrendRows.rows?.[0] as
          | { improved?: number; worsened?: number; stable?: number }
          | undefined) ?? { improved: 0, worsened: 0, stable: 0 };
      const symImproved = Number(symptomTrendRow.improved ?? 0);
      const symWorsened = Number(symptomTrendRow.worsened ?? 0);
      const symStable = Number(symptomTrendRow.stable ?? 0);
      let symptomDirection: "improving" | "worsening" | "flat" | "no_data" =
        "no_data";
      if (symImproved + symWorsened + symStable > 0) {
        if (symImproved > symWorsened) symptomDirection = "improving";
        else if (symWorsened > symImproved) symptomDirection = "worsening";
        else symptomDirection = "flat";
      }

      // ----- Treatment status retention block ---------------------------
      // Counts every patient row (whether activated or not) by current
      // treatment_status. Top stop reasons aggregated from the same
      // table. % still on treatment uses (active / (active + stopped))
      // so unknowns don't artificially deflate the rate -- pilots
      // routinely have unconfirmed cohorts and we don't want to call
      // those churned.
      const statusRows = await db.execute(sql`
        select
          treatment_status as status,
          cast(count(*) as int) as count
        from patients
        where ${excludeDemoCol("user_id")}
        group by treatment_status
      `);
      const statusCounts = { active: 0, stopped: 0, unknown: 0 };
      for (const r of statusRows.rows as Array<{
        status: keyof typeof statusCounts;
        count: number;
      }>) {
        if (r.status in statusCounts) {
          statusCounts[r.status] = Number(r.count);
        }
      }
      const totalPatients =
        statusCounts.active + statusCounts.stopped + statusCounts.unknown;
      const onTreatmentDenom = statusCounts.active + statusCounts.stopped;
      const pctStillOnTreatment =
        onTreatmentDenom > 0 ? statusCounts.active / onTreatmentDenom : 0;

      // ----- Disengagement (inactive 12+ days) --------------------------
      // Derived flag, not a stored field. A patient counts as "inactive
      // 12+ days" when:
      //   - their treatment_status is still active or unknown (we
      //     deliberately exclude 'stopped' so this metric never overlaps
      //     with confirmed churn);
      //   - they have actually activated their app account (activatedAt
      //     set) and were activated at least 12 days ago, otherwise
      //     "inactive" isn't meaningful yet;
      //   - their most recent patient_checkins.date is >=12 days old, or
      //     they have never checked in at all.
      // This is a soft signal for outreach -- it does NOT change anyone's
      // treatment_status and does NOT enter the % still on treatment math.
      const disengagementRows = await db.execute(sql`
        select
          cast(count(*) filter (
            where p.treatment_status in ('active', 'unknown')
              and p.activated_at is not null
              and p.activated_at <= now() - interval '12 days'
              and (la.last_date is null or la.last_date <= (current_date - 12))
          ) as int) as inactive,
          cast(count(*) filter (
            where p.treatment_status in ('active', 'unknown')
              and p.activated_at is not null
              and p.activated_at <= now() - interval '12 days'
          ) as int) as considered
        from patients p
        left join (
          select patient_user_id, max(date) as last_date
          from patient_checkins
          group by patient_user_id
        ) la on la.patient_user_id = p.user_id
        where ${excludeDemoCol("p.user_id")}
      `);
      const disengagementRow = (disengagementRows.rows?.[0] ?? {}) as {
        inactive?: number;
        considered?: number;
      };
      const disengagement = {
        thresholdDays: 12,
        inactive12d: Number(disengagementRow.inactive ?? 0),
        considered: Number(disengagementRow.considered ?? 0),
      };

      // Pull every stopped patient's reason + dates so we can derive
      // both the stop-reason rollup and the timing rollup in one pass.
      // We deliberately do this in JS instead of SQL because the
      // 30/90-day thresholds live in @workspace/db (deriveStopTiming)
      // and we want a single source of truth.
      const stoppedRows = await db.execute(sql`
        select
          stop_reason,
          started_on,
          treatment_status_updated_at
        from patients
        where treatment_status = 'stopped'
          and ${excludeDemoCol("user_id")}
      `);
      type StoppedRow = {
        stop_reason: string | null;
        started_on: string | Date | null;
        treatment_status_updated_at: string | Date | null;
      };
      const stoppedList = stoppedRows.rows as StoppedRow[];

      const reasonCounts: Record<string, number> = {};
      const timingCounts: Record<
        "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown",
        number
      > = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, unknown: 0 };
      const reasonByTiming: Record<string, Record<string, number>> = {};
      for (const r of stoppedList) {
        const reason = r.stop_reason ?? "unknown";
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
        const { bucket } = deriveStopTiming(
          r.started_on,
          r.treatment_status_updated_at,
        );
        timingCounts[bucket] += 1;
        reasonByTiming[reason] ??= {
          d0_30: 0,
          d31_60: 0,
          d61_90: 0,
          d90_plus: 0,
          unknown: 0,
        };
        reasonByTiming[reason][bucket] =
          (reasonByTiming[reason][bucket] ?? 0) + 1;
      }
      const stoppedTotal = stoppedList.length;
      const topStopReasons = Object.entries(reasonCounts)
        .map(([reason, count]) => ({
          reason,
          count,
          // Share of all stopped patients. Helps the pilot question
          // "is churn mostly side-effect driven?" answer in one glance.
          pct: stoppedTotal > 0 ? count / stoppedTotal : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      const stopTiming = {
        d0_30: timingCounts.d0_30,
        d31_60: timingCounts.d31_60,
        d61_90: timingCounts.d61_90,
        d90_plus: timingCounts.d90_plus,
        unknown: timingCounts.unknown,
        // Pct relative to stopped patients with known timing -- otherwise
        // missing startedOn data drags every bucket down equally.
        knownDenom:
          timingCounts.d0_30 +
          timingCounts.d31_60 +
          timingCounts.d61_90 +
          timingCounts.d90_plus,
      };
      // Always emit the canonical reason set so the "Stop reasons by
      // cohort" table on Retention has a stable row order regardless of
      // which reasons happen to have non-zero counts this week.
      const CANONICAL_STOP_REASONS = [
        "side_effects",
        "cost_or_insurance",
        "lack_of_efficacy",
        "patient_choice_or_motivation",
        "other",
      ] as const;
      const seenReasons = new Set(Object.keys(reasonByTiming));
      const stopReasonByTiming = [
        ...CANONICAL_STOP_REASONS,
        ...Object.keys(reasonByTiming).filter(
          (r) => !CANONICAL_STOP_REASONS.includes(r as never),
        ),
      ].map((reason) => {
        const buckets = reasonByTiming[reason] ?? {};
        return {
          reason,
          d0_30: buckets.d0_30 ?? 0,
          d31_60: buckets.d31_60 ?? 0,
          d61_90: buckets.d61_90 ?? 0,
          d90_plus: buckets.d90_plus ?? 0,
          unknown: buckets.unknown ?? 0,
        };
      });
      void seenReasons;

      // ----- Churn by cohort (time on treatment) ------------------------
      // Bucket EVERY patient (active + stopped + unknown) by how long
      // they have been on treatment. For active/unknown patients that's
      // (today - started_on); for stopped patients it's the existing
      // stop-timing derivation. Patients with no started_on land in the
      // "unknown" cohort. % still active is computed front-end side from
      // active / (active + stopped) so unknowns don't deflate the rate.
      const cohortRows = await db.execute(sql`
        select
          treatment_status,
          started_on,
          treatment_status_updated_at
        from patients
        where ${excludeDemoCol("user_id")}
      `);
      type CohortRow = {
        treatment_status: "active" | "stopped" | "unknown";
        started_on: string | Date | null;
        treatment_status_updated_at: string | Date | null;
      };
      const cohortBuckets: Record<
        "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown",
        { total: number; active: number; stopped: number; unknown: number }
      > = {
        d0_30: { total: 0, active: 0, stopped: 0, unknown: 0 },
        d31_60: { total: 0, active: 0, stopped: 0, unknown: 0 },
        d61_90: { total: 0, active: 0, stopped: 0, unknown: 0 },
        d90_plus: { total: 0, active: 0, stopped: 0, unknown: 0 },
        unknown: { total: 0, active: 0, stopped: 0, unknown: 0 },
      };
      const nowMs = Date.now();
      for (const r of (cohortRows.rows ?? []) as CohortRow[]) {
        let bucket: "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown";
        if (!r.started_on) {
          bucket = "unknown";
        } else if (r.treatment_status === "stopped") {
          bucket = deriveStopTiming(
            r.started_on,
            r.treatment_status_updated_at,
          ).bucket;
        } else {
          // Active / unknown status: project to "today" so we can still
          // see a cohort even though they haven't stopped yet.
          const start = new Date(r.started_on as string | Date).getTime();
          const days = Math.floor((nowMs - start) / 86_400_000);
          bucket =
            days <= 30
              ? "d0_30"
              : days <= 60
              ? "d31_60"
              : days <= 90
              ? "d61_90"
              : "d90_plus";
        }
        cohortBuckets[bucket].total += 1;
        cohortBuckets[bucket][r.treatment_status] += 1;
      }
      const cohortRetention = {
        buckets: (
          ["d0_30", "d31_60", "d61_90", "d90_plus", "unknown"] as const
        ).map((b) => ({
          bucket: b,
          total: cohortBuckets[b].total,
          active: cohortBuckets[b].active,
          stopped: cohortBuckets[b].stopped,
          unknown: cohortBuckets[b].unknown,
        })),
      };

      // ----- Operating metrics (viva care + viva clinic) ----------------
      // Activity is derived from existing tables; we don't track an
      // auth-level "last_login" column, so the honest definition of
      // "active" is "did something the system can observe".
      //   patient activity = patient_checkins.date OR
      //                      intervention_events.occurred_on
      //   doctor activity  = doctor_notes.created_at OR
      //                      patients.treatment_status_updated_at
      //                      (when source = 'doctor')
      const today = ymdLocal(new Date());
      const ymd7 = ymdDaysAgo(6);
      const ymd30 = ymdDaysAgo(29);

      // Patient activity windows. UNION over check-ins + interventions
      // so we don't undercount patients who used the app today but
      // skipped the check-in card.
      const patientActivityRows = await db.execute(sql`
        with activity as (
          select patient_user_id as uid, date::date as d
          from patient_checkins
          where date >= ${ymd30}
            and ${excludeDemoCol("patient_user_id")}
          union
          select patient_user_id as uid, occurred_on::date as d
          from intervention_events
          where occurred_on >= ${ymd30}
            and ${excludeDemoCol("patient_user_id")}
        )
        select
          (select cast(count(distinct uid) as int) from activity where d = ${today}) as dau,
          (select cast(count(distinct uid) as int) from activity where d >= ${ymd7}) as wau,
          (select cast(count(distinct uid) as int) from activity) as mau
      `);
      const pAct =
        (patientActivityRows.rows?.[0] as
          | { dau?: number; wau?: number; mau?: number }
          | undefined) ?? {};
      const patientDau = Number(pAct.dau ?? 0);
      const patientWau = Number(pAct.wau ?? 0);
      const patientMau = Number(pAct.mau ?? 0);

      const [{ count: totalDoctors }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "doctor"),
            notInArray(usersTable.id, demoUserIdsSelect()),
          ),
        );

      // Doctor activity windows.
      const doctorActivityRows = await db.execute(sql`
        with activity as (
          select doctor_user_id as uid, created_at::date as d
          from doctor_notes
          where created_at >= ${ymd30}::date
            and ${excludeDemoCol("doctor_user_id")}
            and ${excludeDemoCol("patient_user_id")}
          union
          select treatment_status_updated_by as uid,
                 treatment_status_updated_at::date as d
          from patients
          where treatment_status_source = 'doctor'
            and treatment_status_updated_at >= ${ymd30}::date
            and treatment_status_updated_by is not null
            and ${excludeDemoCol("user_id")}
            and ${excludeDemoCol("treatment_status_updated_by")}
        )
        select
          (select cast(count(distinct uid) as int) from activity where d = ${today}::date) as dau,
          (select cast(count(distinct uid) as int) from activity where d >= ${ymd7}::date) as wau,
          (select cast(count(distinct uid) as int) from activity) as mau
      `);
      const dAct =
        (doctorActivityRows.rows?.[0] as
          | { dau?: number; wau?: number; mau?: number }
          | undefined) ?? {};
      const doctorDau = Number(dAct.dau ?? 0);
      const doctorWau = Number(dAct.wau ?? 0);
      const doctorMau = Number(dAct.mau ?? 0);

      // Apple Health connected % uses intervention dataTier as the
      // honest proxy: a patient is counted as "connected" if any of
      // their interventions in the last 30 days carried a wearable
      // data-tier snapshot. Denominator = activated patients (we
      // don't ding pre-activation invites for not connecting yet).
      const ahRows = await db.execute(sql`
        select cast(count(distinct patient_user_id) as int) as connected
        from intervention_events
        where occurred_on >= ${ymd30}
          and treatment_state_snapshot->>'dataTier' = 'wearable'
          and ${excludeDemoCol("patient_user_id")}
      `);
      const appleHealthConnected = Number(
        (ahRows.rows?.[0] as { connected?: number } | undefined)?.connected ?? 0,
      );
      const [{ count: activatedCount }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(patientsTable)
        .where(
          and(
            isNotNull(patientsTable.activatedAt),
            notInArray(patientsTable.userId, demoUserIdsSelect()),
          ),
        );
      const pctAppleHealthConnected =
        activatedCount > 0 ? appleHealthConnected / activatedCount : 0;

      // % completing check-ins = activated patients with a check-in in
      // the last 7 days. Mirrors what the doctor would call "active
      // logging" without inventing a new threshold.
      const checkin7Rows = await db.execute(sql`
        select cast(count(distinct patient_user_id) as int) as n
        from patient_checkins
        where date >= ${ymd7}
          and ${excludeDemoCol("patient_user_id")}
      `);
      const completingCheckins = Number(
        (checkin7Rows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
      );
      const pctCompletingCheckins =
        activatedCount > 0 ? completingCheckins / activatedCount : 0;

      // Coach engagement = activated patients with a Coach surface
      // intervention in the last 30 days. Honest "did they use it?"
      // signal, not a quality measure.
      const coachRows = await db.execute(sql`
        select cast(count(distinct patient_user_id) as int) as n
        from intervention_events
        where occurred_on >= ${ymd30}
          and surface = 'Coach'
          and ${excludeDemoCol("patient_user_id")}
      `);
      const coachEngaged = Number(
        (coachRows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
      );
      const pctEngagingCoaching =
        activatedCount > 0 ? coachEngaged / activatedCount : 0;

      // Doctor productivity (rolling 30d window).
      const [{ count: notesWritten30d }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(doctorNotesTable)
        .where(
          and(
            gte(doctorNotesTable.createdAt, sql`${ymd30}::date`),
            notInArray(doctorNotesTable.doctorUserId, demoUserIdsSelect()),
            notInArray(doctorNotesTable.patientUserId, demoUserIdsSelect()),
          ),
        );

      const reviewedRows = await db.execute(sql`
        select cast(count(distinct patient_user_id) as int) as n
        from doctor_notes
        where created_at >= ${ymd30}::date
          and ${excludeDemoCol("doctor_user_id")}
          and ${excludeDemoCol("patient_user_id")}
      `);
      const patientsReviewed = Number(
        (reviewedRows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
      );

      const tsuRows = await db.execute(sql`
        select cast(count(*) as int) as n
        from patients
        where treatment_status_updated_at >= ${ymd30}::date
          and ${excludeDemoCol("user_id")}
      `);
      const treatmentStatusesUpdated30d = Number(
        (tsuRows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
      );

      // Avg patients reviewed per doctor over the same 30d window.
      // Denominator = doctors with at least one patient assigned, so
      // doctors who haven't been seeded with a panel don't drag the
      // average down to look like neglect.
      const docsWithPanelRows = await db.execute(sql`
        select cast(count(distinct doctor_id) as int) as n from patients
        where ${excludeDemoCol("user_id")}
          and ${excludeDemoCol("doctor_id")}
      `);
      const doctorsWithPanel = Number(
        (docsWithPanelRows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
      );
      const avgPatientsReviewedPerDoctor =
        doctorsWithPanel > 0 ? patientsReviewed / doctorsWithPanel : 0;

      // ----- Drill-down: patient list (full panel) ----------------------
      const patientRows = await db.execute(sql`
        select
          p.user_id as id,
          u.name as name,
          u.email as email,
          d.name as doctor_name,
          p.doctor_id as doctor_id,
          p.treatment_status as treatment_status,
          p.stop_reason as stop_reason,
          p.started_on as started_on,
          p.treatment_status_updated_at as treatment_status_updated_at,
          (
            select max(date) from patient_checkins c
            where c.patient_user_id = p.user_id
          ) as last_checkin,
          exists (
            select 1 from intervention_events ie
            where ie.patient_user_id = p.user_id
              and ie.occurred_on >= ${ymd30}
              and ie.treatment_state_snapshot->>'dataTier' = 'wearable'
          ) as apple_health_connected
        from patients p
        join users u on u.id = p.user_id
        join users d on d.id = p.doctor_id
        where u.email not like ${DEMO_EMAIL_LIKE}
          and u.email not like ${DEMO_VIVAAI_LIKE}
          and d.email not like ${DEMO_EMAIL_LIKE}
          and d.email not like ${DEMO_VIVAAI_LIKE}
        order by u.name asc
      `);
      type PatientDrillRow = {
        id: number;
        name: string;
        email: string;
        doctor_name: string;
        doctor_id: number;
        treatment_status: "active" | "stopped" | "unknown";
        stop_reason: string | null;
        started_on: string | Date | null;
        treatment_status_updated_at: string | Date | null;
        last_checkin: string | null;
        apple_health_connected: boolean;
      };
      const patientDrilldown = (patientRows.rows as PatientDrillRow[]).map(
        (r) => {
          const { bucket, daysOnTreatment } =
            r.treatment_status === "stopped"
              ? deriveStopTiming(r.started_on, r.treatment_status_updated_at)
              : { bucket: "unknown" as const, daysOnTreatment: null };
          return {
            id: Number(r.id),
            name: r.name,
            email: r.email,
            doctorName: r.doctor_name,
            doctorId: Number(r.doctor_id),
            treatmentStatus: r.treatment_status,
            stopReason: r.stop_reason,
            stopTimingBucket: bucket,
            daysOnTreatment,
            lastCheckin: r.last_checkin,
            appleHealthConnected: !!r.apple_health_connected,
          };
        },
      );

      // ----- Drill-down: doctor list ------------------------------------
      // Each correlated sub-query also excludes demo patients --
      // protects against the case where a demo patient is attached to
      // a real doctor (panel mistakes, manual fixups), which would
      // otherwise inflate the real doctor's drilldown counts.
      const doctorRows = await db.execute(sql`
        select
          u.id as id,
          u.name as name,
          u.email as email,
          (select cast(count(*) as int) from patients p
             where p.doctor_id = u.id
               and ${excludeDemoCol("p.user_id")}) as patient_count,
          (select cast(count(*) as int) from patients p
             where p.doctor_id = u.id and p.treatment_status = 'active'
               and ${excludeDemoCol("p.user_id")}) as active_patients,
          (select cast(count(*) as int) from patients p
             where p.doctor_id = u.id and p.treatment_status = 'stopped'
               and ${excludeDemoCol("p.user_id")}) as stopped_patients,
          (select cast(count(*) as int) from doctor_notes n
             where n.doctor_user_id = u.id and n.created_at >= ${ymd30}::date
               and ${excludeDemoCol("n.patient_user_id")}) as notes_written,
          (select cast(count(*) as int) from patients p
             where p.treatment_status_updated_by = u.id
               and p.treatment_status_updated_at >= ${ymd30}::date
               and ${excludeDemoCol("p.user_id")}) as statuses_updated,
          greatest(
            (select max(created_at) from doctor_notes n
               where n.doctor_user_id = u.id
                 and ${excludeDemoCol("n.patient_user_id")}),
            (select max(treatment_status_updated_at) from patients p
               where p.treatment_status_updated_by = u.id
                 and ${excludeDemoCol("p.user_id")})
          ) as last_active_at
        from users u
        where u.role = 'doctor'
          and u.email not like ${DEMO_EMAIL_LIKE}
          and u.email not like ${DEMO_VIVAAI_LIKE}
        order by u.name asc
      `);
      type DoctorDrillRow = {
        id: number;
        name: string;
        email: string;
        patient_count: number;
        active_patients: number;
        stopped_patients: number;
        notes_written: number;
        statuses_updated: number;
        last_active_at: string | Date | null;
      };
      const doctorDrilldown = (doctorRows.rows as DoctorDrillRow[]).map((r) => ({
        id: Number(r.id),
        name: r.name,
        email: r.email,
        patientCount: Number(r.patient_count),
        activePatients: Number(r.active_patients),
        stoppedPatients: Number(r.stopped_patients),
        notesWritten: Number(r.notes_written),
        statusesUpdated: Number(r.statuses_updated),
        lastActiveAt:
          r.last_active_at instanceof Date
            ? r.last_active_at.toISOString()
            : r.last_active_at,
      }));

      // ----- Data sanity ------------------------------------------------
      // Cheap reconciliation: catch the day a metric quietly diverges
      // from the source rows.
      const stoppedReasonSum = Object.values(reasonCounts).reduce(
        (a, b) => a + b,
        0,
      );
      const stoppedTimingSum =
        timingCounts.d0_30 +
        timingCounts.d31_60 +
        timingCounts.d61_90 +
        timingCounts.d90_plus +
        timingCounts.unknown;
      const dataSanity = {
        totalPatientsRow: totalPatients,
        sumByStatus:
          statusCounts.active + statusCounts.stopped + statusCounts.unknown,
        stoppedRow: stoppedTotal,
        stoppedSumByReason: stoppedReasonSum,
        stoppedSumByTiming: stoppedTimingSum,
        ok:
          totalPatients ===
            statusCounts.active + statusCounts.stopped + statusCounts.unknown &&
          stoppedTotal === stoppedReasonSum &&
          stoppedTotal === stoppedTimingSum,
      };

      // ----- Pilot metrics block ---------------------------------------
      // Composite KPIs for the internal Pilot Metrics page. Wrapped so a
      // failure here cannot break the rest of the summary -- the pilot
      // page handles a missing block by rendering an empty state.
      //
      // Optional ?platformId= / ?doctorId= query params narrow the cohort
      // to one Viva customer (telehealth platform) and/or one provider
      // within it. Anything non-numeric or absent means whole-cohort,
      // matching the previous behaviour. Validation is permissive on
      // purpose: bad values just fall through to whole-cohort rather
      // than 400ing the entire summary endpoint.
      const parsePositiveInt = (v: unknown): number | undefined => {
        if (typeof v !== "string") return undefined;
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : undefined;
      };
      const pilotPlatformId = parsePositiveInt(req.query.platformId);
      const pilotDoctorId = parsePositiveInt(req.query.doctorId);
      let pilot: PilotMetricsBlock | undefined;
      try {
        pilot = await computePilotMetrics({
          platformId: pilotPlatformId,
          doctorId: pilotDoctorId,
        });
      } catch (err) {
        logger.warn({ err }, "pilot_metrics_compute_failed");
        pilot = undefined;
      }

      // ----- Plan adherence block -------------------------------------
      // Pilot KPI: of the personalized plan items shown to patients,
      // what fraction got actioned? Reads ONLY from analytics_events
      // (no schema joins) so a stale clinical write cannot corrupt the
      // number. Returns null when zero plan_item_* events exist so the
      // analytics page can render an honest empty state instead of a
      // misleading 0%.
      let planAdherence:
        | {
            windowDays: number;
            totalPatientsWithPlanItems: number;
            itemsCompleted: number;
            itemsSkipped: number;
            itemsViewedNotActioned: number;
            byCategory: Array<{
              category: string;
              completed: number;
              skipped: number;
              viewedOnly: number;
              completionRate: number;
            }>;
          }
        | null = null;
      try {
        const adherenceRows = await db.execute(sql`
          WITH ev AS (
            SELECT
              user_id,
              event_name,
              COALESCE(payload->>'category', 'uncategorized') AS category
            FROM ${analyticsEventsTable}
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND user_type = 'patient'
              AND event_name IN ('plan_item_completed','plan_item_skipped','plan_item_viewed')
              AND ${excludeDemoCol("user_id")}
          )
          SELECT
            category,
            SUM(CASE WHEN event_name = 'plan_item_completed' THEN 1 ELSE 0 END)::int AS completed,
            SUM(CASE WHEN event_name = 'plan_item_skipped'   THEN 1 ELSE 0 END)::int AS skipped,
            SUM(CASE WHEN event_name = 'plan_item_viewed'    THEN 1 ELSE 0 END)::int AS viewed,
            COUNT(DISTINCT user_id)::int AS distinct_users
          FROM ev
          GROUP BY category
          ORDER BY completed DESC NULLS LAST, skipped DESC NULLS LAST
        `);
        type AdherenceRow = {
          category: string;
          completed: number;
          skipped: number;
          viewed: number;
          distinct_users: number;
        };
        const rows = adherenceRows.rows as AdherenceRow[];
        const totalAny = rows.reduce(
          (a, r) => a + r.completed + r.skipped + r.viewed,
          0,
        );
        if (totalAny > 0) {
          // Distinct users across categories. Recompute via a separate
          // aggregate to avoid double-counting users active in 2+
          // categories.
          const distinctUsersRow = await db.execute(sql`
            SELECT COUNT(DISTINCT user_id)::int AS n
            FROM ${analyticsEventsTable}
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND user_type = 'patient'
              AND event_name IN ('plan_item_completed','plan_item_skipped','plan_item_viewed')
              AND ${excludeDemoCol("user_id")}
          `);
          const totalPatients =
            (distinctUsersRow.rows[0] as { n: number } | undefined)?.n ?? 0;
          const totalCompleted = rows.reduce((a, r) => a + r.completed, 0);
          const totalSkipped = rows.reduce((a, r) => a + r.skipped, 0);
          const totalViewedOnly = Math.max(
            rows.reduce((a, r) => a + r.viewed, 0) -
              totalCompleted -
              totalSkipped,
            0,
          );
          planAdherence = {
            windowDays: 30,
            totalPatientsWithPlanItems: totalPatients,
            itemsCompleted: totalCompleted,
            itemsSkipped: totalSkipped,
            itemsViewedNotActioned: totalViewedOnly,
            byCategory: rows.map((r) => {
              const denom = r.completed + r.skipped;
              const viewedOnly = Math.max(r.viewed - r.completed - r.skipped, 0);
              return {
                category: r.category,
                completed: r.completed,
                skipped: r.skipped,
                viewedOnly,
                completionRate: denom > 0 ? r.completed / denom : 0,
              };
            }),
          };
        }
      } catch (err) {
        logger.warn({ err }, "plan_adherence_compute_failed");
        planAdherence = null;
      }

      // ----- Open escalations block -----------------------------------
      // Single denormalized number for the analytics overview, derived
      // from care_events directly (NOT a join to patients). An open
      // escalation is one whose latest 'escalation_requested' is newer
      // than the latest 'doctor_reviewed' for the same patient.
      let openEscalations:
        | { open: number; reviewedLast7d: number; followUpPendingLast7d: number }
        | undefined;
      try {
        const escRows = await db.execute(sql`
          WITH latest AS (
            SELECT
              patient_user_id,
              MAX(occurred_at) FILTER (WHERE type = 'escalation_requested') AS last_esc,
              MAX(occurred_at) FILTER (WHERE type = 'doctor_reviewed')      AS last_rev,
              MAX(occurred_at) FILTER (WHERE type = 'follow_up_completed')  AS last_fup
            FROM ${careEventsTable}
            WHERE ${excludeDemoCol("patient_user_id")}
            GROUP BY patient_user_id
          )
          SELECT
            COUNT(*) FILTER (
              WHERE last_esc IS NOT NULL
                AND (last_rev IS NULL OR last_esc > last_rev)
            )::int AS open,
            COUNT(*) FILTER (
              WHERE last_rev IS NOT NULL AND last_rev >= NOW() - INTERVAL '7 days'
            )::int AS reviewed_last_7d,
            COUNT(*) FILTER (
              WHERE last_esc IS NOT NULL
                AND last_esc >= NOW() - INTERVAL '7 days'
                AND (last_fup IS NULL OR last_esc > last_fup)
            )::int AS follow_up_pending_last_7d
          FROM latest
        `);
        const r = escRows.rows[0] as
          | { open: number; reviewed_last_7d: number; follow_up_pending_last_7d: number }
          | undefined;
        openEscalations = {
          open: r?.open ?? 0,
          reviewedLast7d: r?.reviewed_last_7d ?? 0,
          followUpPendingLast7d: r?.follow_up_pending_last_7d ?? 0,
        };
      } catch (err) {
        logger.warn({ err }, "open_escalations_compute_failed");
        openEscalations = undefined;
      }

      res.json({
        generatedAt: new Date().toISOString(),
        windowDays: 7,
        pilot,
        planAdherence,
        openEscalations,
        health: {
          windowDays: healthWindowDays,
          nextDayCheckinAfterIntervention: {
            users: nextDayCheckinUsers,
            denom: nextDayCheckinDenom,
            pct:
              nextDayCheckinDenom > 0
                ? nextDayCheckinUsers / nextDayCheckinDenom
                : 0,
          },
          engagementImproved3d: {
            users: engagementImprovedUsers,
            denom: engagementDenom,
            pct:
              engagementDenom > 0
                ? engagementImprovedUsers / engagementDenom
                : 0,
          },
          topInterventions,
          symptomTrend: {
            direction: symptomDirection,
            improved: symImproved,
            worsened: symWorsened,
            stable: symStable,
          },
        },
        treatmentStatus: {
          totalPatients,
          active: statusCounts.active,
          stopped: statusCounts.stopped,
          unknown: statusCounts.unknown,
          pctStillOnTreatment,
          topStopReasons,
          stopTiming,
          stopReasonByTiming,
          cohortRetention,
          disengagement,
        },
        operating: {
          windowDays: 30,
          patients: {
            total: totalPatients,
            activated: activatedCount,
            activeToday: patientDau,
            dau: patientDau,
            wau: patientWau,
            mau: patientMau,
            appleHealthConnected,
            pctAppleHealthConnected,
            completingCheckins,
            pctCompletingCheckins,
            coachEngaged,
            pctEngagingCoaching,
          },
          doctors: {
            total: totalDoctors,
            withPanel: doctorsWithPanel,
            dau: doctorDau,
            wau: doctorWau,
            mau: doctorMau,
            patientsReviewed,
            treatmentStatusesUpdated: treatmentStatusesUpdated30d,
            notesWritten: notesWritten30d,
            avgPatientsReviewedPerDoctor,
          },
        },
        drilldown: {
          patients: patientDrilldown,
          doctors: doctorDrilldown,
        },
        dataSanity,
        totals: {
          interventionEvents: links.length,
        },
        byInterventionType,
        byCommunicationMode,
        byPrimaryFocus,
        byConfidenceBand,
        topPathwaysToEscalation: (
          escalationPathwaysRows.rows as Array<{
            intervention_type: string;
            count: number;
          }>
        ).map((r) => ({
          interventionType: r.intervention_type,
          count: Number(r.count),
        })),
        reengagementAfterCoach: {
          reengaged: Number(reEnrich.reengaged ?? 0),
          coachInterventions: Number(reEnrich.total ?? 0),
        },
      });
    } catch (err) {
      logger.error({ err }, "internal_analytics_summary_failed");
      res.status(500).json({ error: "analytics_failed" });
    }
  },
);

// ----------------------------------------------------------------------
// GET /internal/care-loop/summary?days=30
//
// Dual-layer intervention funnel: Viva → Escalation → Doctor → Outcome.
// Reads from the `care_events` stream (escalations, doctor reviews,
// doctor notes, treatment status updates) and joins to outcome_snapshots
// for follow-through proxies. Each percentage in the response is paired
// with the raw counts so the operator can sanity-check it.
// ----------------------------------------------------------------------

router.get(
  "/care-loop/summary",
  requireInternalKey,
  async (req: Request, res: Response) => {
    const days = Math.max(
      1,
      Math.min(180, Number(req.query.days ?? 30) || 30),
    );
    const since = new Date();
    since.setDate(since.getDate() - days);

    try {
      // ---- Viva layer ------------------------------------------------
      // Total events of source=viva and the distinct patient count.
      const vivaAgg = await db
        .select({
          total: sql<number>`count(*)::int`,
          distinctPatients: sql<number>`count(distinct ${careEventsTable.patientUserId})::int`,
        })
        .from(careEventsTable)
        .where(
          and(
            eq(careEventsTable.source, "viva"),
            gte(careEventsTable.occurredAt, since),
            notInArray(careEventsTable.patientUserId, demoUserIdsSelect()),
          ),
        );
      const vivaRow = vivaAgg[0] ?? { total: 0, distinctPatients: 0 };

      // % of touched-by-Viva patients who had a next-day check-in
      // (the cleanest follow-through signal for the Viva layer).
      const vivaFollowupRows = await db.execute(sql`
        with viva_first_per_patient as (
          select patient_user_id, min(occurred_at) as first_at
          from care_events
          where source = 'viva' and occurred_at >= ${since.toISOString()}
            and ${excludeDemoCol("patient_user_id")}
          group by patient_user_id
        )
        select
          count(*)::int as total_patients,
          count(case when os.next_day_checkin_completed then 1 end)::int as engaged
        from viva_first_per_patient v
        left join lateral (
          select next_day_checkin_completed
          from outcome_snapshots
          where patient_user_id = v.patient_user_id
            and snapshot_date >= v.first_at::date
            and snapshot_date <= (v.first_at::date + interval '1 day')
          order by snapshot_date asc
          limit 1
        ) os on true
      `);
      const vivaFollowup = (vivaFollowupRows.rows[0] ?? {}) as {
        total_patients?: number;
        engaged?: number;
      };

      // Patients who had a Viva event AND escalated within 7 days.
      // Used as the "escalated" outcome numerator (denominator = touched).
      const escalatedFromVivaRows = await db.execute(sql`
        with viva_first_per_patient as (
          select patient_user_id, min(occurred_at) as first_at
          from care_events
          where source = 'viva' and occurred_at >= ${since.toISOString()}
            and ${excludeDemoCol("patient_user_id")}
          group by patient_user_id
        )
        select count(distinct v.patient_user_id)::int as escalated_patients
        from viva_first_per_patient v
        join care_events ce
          on ce.patient_user_id = v.patient_user_id
         and ce.type = 'escalation_requested'
         and ce.occurred_at >= v.first_at
         and ce.occurred_at <= v.first_at + interval '7 days'
      `);
      const escalatedFromViva = (escalatedFromVivaRows.rows[0] ?? {}) as {
        escalated_patients?: number;
      };

      // ---- Escalation layer -----------------------------------------
      const escAgg = await db
        .select({
          total: sql<number>`count(*)::int`,
          distinctPatients: sql<number>`count(distinct ${careEventsTable.patientUserId})::int`,
        })
        .from(careEventsTable)
        .where(
          and(
            eq(careEventsTable.type, "escalation_requested"),
            gte(careEventsTable.occurredAt, since),
            notInArray(careEventsTable.patientUserId, demoUserIdsSelect()),
          ),
        );
      const escRow = escAgg[0] ?? { total: 0, distinctPatients: 0 };

      // Group by metadata->>'source' (the surface the patient tapped:
      // coach / today / settings). The legacy `from` key written by
      // earlier builds is folded in via coalesce so historical rows
      // still bucket meaningfully. Rows with neither (e.g. doctor-
      // initiated escalations) bucket under 'other'.
      const escBySourceRows = await db.execute(sql`
        with raw as (
          select coalesce(
            metadata->>'source',
            metadata->>'from',
            'other'
          ) as src
          from care_events
          where type = 'escalation_requested'
            and occurred_at >= ${since.toISOString()}
            and ${excludeDemoCol("patient_user_id")}
        )
        select
          case
            -- Normalize legacy surface labels written by earlier
            -- builds so coach/today/settings buckets stay clean
            -- across the full window even after the rename.
            when src = 'coach_tab' then 'coach'
            when src in ('coach', 'today', 'settings') then src
            else 'other'
          end as source,
          count(*)::int as count
        from raw
        group by 1
      `);
      const escBySource = (escBySourceRows.rows as Array<Record<string, unknown>>).map(
        (r) => ({ source: String(r.source ?? "other"), count: Number(r.count ?? 0) }),
      );

      const totalActivePatientsRow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientsTable)
        .where(notInArray(patientsTable.userId, demoUserIdsSelect()));
      const totalActivePatients =
        Number(totalActivePatientsRow[0]?.count ?? 0) || 0;

      // ---- Doctor layer ---------------------------------------------
      // For every escalation_requested event, find the next doctor
      // event of any kind (reviewed / note / status_updated) within
      // the window. Aggregated in one SQL pass for sanity.
      const doctorJoinRows = await db.execute(sql`
        with esc as (
          select
            ce.id        as esc_id,
            ce.patient_user_id,
            ce.occurred_at as esc_at
          from care_events ce
          where ce.type = 'escalation_requested'
            and ce.occurred_at >= ${since.toISOString()}
            and ${excludeDemoCol("ce.patient_user_id")}
        ),
        first_review as (
          select e.esc_id, min(d.occurred_at) as ts
          from esc e
          join care_events d
            on d.patient_user_id = e.patient_user_id
           and d.type = 'doctor_reviewed'
           and d.occurred_at >= e.esc_at
          group by e.esc_id
        ),
        first_note as (
          select e.esc_id, min(d.occurred_at) as ts
          from esc e
          join care_events d
            on d.patient_user_id = e.patient_user_id
           and d.type = 'doctor_note'
           and d.occurred_at >= e.esc_at
          group by e.esc_id
        ),
        first_status as (
          select e.esc_id, min(d.occurred_at) as ts
          from esc e
          join care_events d
            on d.patient_user_id = e.patient_user_id
           and d.type = 'treatment_status_updated'
           and d.occurred_at >= e.esc_at
          group by e.esc_id
        ),
        -- Follow-up uses the explicit trigger_event_id linkage written
        -- by the POST /care-events/:patientId/follow-up-completed
        -- route. We deliberately don't fall back to "any follow-up
        -- after escalation date" because that would conflate generic
        -- follow-ups with this specific escalation cycle.
        first_followup as (
          select e.esc_id, min(d.occurred_at) as ts
          from esc e
          join care_events d
            on d.trigger_event_id = e.esc_id
           and d.type = 'follow_up_completed'
          group by e.esc_id
        )
        select
          (select count(*)::int from esc) as total_escalations,
          (select count(*)::int from first_review) as reviewed_count,
          (select count(*)::int from first_note) as noted_count,
          (select count(*)::int from first_status) as status_updated_count,
          (select count(*)::int from first_followup) as follow_up_count,
          (
            select avg(extract(epoch from (fr.ts - e.esc_at)) / 60)::float
            from esc e join first_review fr on fr.esc_id = e.esc_id
          ) as avg_minutes_to_review,
          (
            select avg(extract(epoch from (ff.ts - e.esc_at)) / 60)::float
            from esc e join first_followup ff on ff.esc_id = e.esc_id
          ) as avg_minutes_to_follow_up,
          (
            select count(*)::int
            from esc e join first_followup ff on ff.esc_id = e.esc_id
            where ff.ts <= e.esc_at + interval '24 hours'
          ) as follow_up_within_24h_count,
          (
            select count(*)::int
            from care_events
            where type = 'follow_up_completed'
              and occurred_at >= ${since.toISOString()}
              and ${excludeDemoCol("patient_user_id")}
          ) as total_follow_up_events
      `);
      const doctorRow = (doctorJoinRows.rows[0] ?? {}) as {
        total_escalations?: number;
        reviewed_count?: number;
        noted_count?: number;
        status_updated_count?: number;
        follow_up_count?: number;
        avg_minutes_to_review?: number | null;
        avg_minutes_to_follow_up?: number | null;
        follow_up_within_24h_count?: number;
        total_follow_up_events?: number;
      };

      // ---- Outcomes -------------------------------------------------
      // % resolved by Viva alone:
      //   patients who had a Viva event AND no escalation_requested in
      //   the next 7d AND a positive next-day check-in or
      //   symptomImproved3d follow-through.
      const resolvedByVivaRows = await db.execute(sql`
        with viva_first_per_patient as (
          select patient_user_id, min(occurred_at) as first_at
          from care_events
          where source = 'viva' and occurred_at >= ${since.toISOString()}
            and ${excludeDemoCol("patient_user_id")}
          group by patient_user_id
        ),
        no_escalation as (
          select v.patient_user_id, v.first_at
          from viva_first_per_patient v
          left join care_events ce
            on ce.patient_user_id = v.patient_user_id
           and ce.type = 'escalation_requested'
           and ce.occurred_at >= v.first_at
           and ce.occurred_at <= v.first_at + interval '7 days'
          where ce.id is null
        ),
        with_outcome as (
          select n.patient_user_id, n.first_at,
                 os.next_day_checkin_completed, os.symptom_improved_3d
          from no_escalation n
          left join lateral (
            select next_day_checkin_completed, symptom_improved_3d
            from outcome_snapshots
            where patient_user_id = n.patient_user_id
              and snapshot_date >= n.first_at::date
              and snapshot_date <= n.first_at::date + interval '7 days'
            order by snapshot_date asc
            limit 1
          ) os on true
        )
        select
          count(*)::int as candidate_patients,
          count(case when next_day_checkin_completed or symptom_improved_3d then 1 end)::int as resolved
        from with_outcome
      `);
      const resolvedRow = (resolvedByVivaRows.rows[0] ?? {}) as {
        candidate_patients?: number;
        resolved?: number;
      };

      // % improved after doctor intervention:
      //   patients who escalated, then a doctor took an action
      //   (reviewed / note / status updated), then a positive
      //   follow-through (next-day check-in or symptomImproved3d)
      //   within 7d of the doctor action.
      const improvedAfterDoctorRows = await db.execute(sql`
        with esc as (
          select patient_user_id, min(occurred_at) as esc_at
          from care_events
          where type = 'escalation_requested'
            and occurred_at >= ${since.toISOString()}
            and ${excludeDemoCol("patient_user_id")}
          group by patient_user_id
        ),
        doc_action as (
          select e.patient_user_id, e.esc_at, min(d.occurred_at) as doc_at
          from esc e
          join care_events d
            on d.patient_user_id = e.patient_user_id
           and d.source = 'doctor'
           and d.occurred_at >= e.esc_at
          group by e.patient_user_id, e.esc_at
        ),
        with_outcome as (
          select da.patient_user_id, da.doc_at,
                 os.next_day_checkin_completed, os.symptom_improved_3d
          from doc_action da
          left join lateral (
            select next_day_checkin_completed, symptom_improved_3d
            from outcome_snapshots
            where patient_user_id = da.patient_user_id
              and snapshot_date >= da.doc_at::date
              and snapshot_date <= da.doc_at::date + interval '7 days'
            order by snapshot_date asc
            limit 1
          ) os on true
        )
        select
          count(*)::int as candidate_patients,
          count(case when next_day_checkin_completed or symptom_improved_3d then 1 end)::int as improved
        from with_outcome
      `);
      const improvedRow = (improvedAfterDoctorRows.rows[0] ?? {}) as {
        candidate_patients?: number;
        improved?: number;
      };

      // Fractions 0..1 — the analytics frontend (`pctStr`) renders these
      // by multiplying ×100. Never pre-multiply here.
      const frac = (n: number, d: number) => (d > 0 ? n / d : 0);

      const vivaTotal = Number(vivaRow.total ?? 0);
      const vivaDistinct = Number(vivaRow.distinctPatients ?? 0);
      const nextDayNum = Number(vivaFollowup.engaged ?? 0);
      const nextDayDen = Number(vivaFollowup.total_patients ?? 0);
      const totalEsc = Number(escRow.total ?? 0);
      const escDistinct = Number(escRow.distinctPatients ?? 0);
      const docTotalEsc = Number(doctorRow.total_escalations ?? 0);
      const docReviewed = Number(doctorRow.reviewed_count ?? 0);
      const docNoted = Number(doctorRow.noted_count ?? 0);
      const docStatus = Number(doctorRow.status_updated_count ?? 0);
      const resolvedNum = Number(resolvedRow.resolved ?? 0);
      const resolvedDen = Number(resolvedRow.candidate_patients ?? 0);
      const escFromVivaNum = Number(
        escalatedFromViva.escalated_patients ?? 0,
      );
      const improvedNum = Number(improvedRow.improved ?? 0);
      const improvedDen = Number(improvedRow.candidate_patients ?? 0);

      // bySource as an object keyed by source string — matches the
      // frontend `Record<string, number>` shape exactly.
      const bySource: Record<string, number> = {};
      for (const r of escBySource) {
        bySource[String(r.source)] = Number(r.count);
      }

      res.json({
        windowDays: days,
        generatedAt: new Date().toISOString(),
        viva: {
          totalEvents: vivaTotal,
          distinctPatients: vivaDistinct,
          nextDayCheckinPctOfTouchedPatients: frac(nextDayNum, nextDayDen),
          nextDayCheckinNumerator: nextDayNum,
          nextDayCheckinDenominator: nextDayDen,
        },
        escalation: {
          totalEscalations: totalEsc,
          distinctPatients: escDistinct,
          // % of the total panel that has sent at least one escalation
          // in the window. Pilot-grade adoption signal for the patient
          // -> doctor request path.
          pctOfPatients: frac(escDistinct, totalActivePatients),
          pctOfPatientsNumerator: escDistinct,
          pctOfPatientsDenominator: totalActivePatients,
          bySource,
        },
        doctor: {
          reviewedPct: frac(docReviewed, docTotalEsc),
          reviewedNumerator: docReviewed,
          reviewedDenominator: docTotalEsc,
          avgMinutesEscalationToReview:
            doctorRow.avg_minutes_to_review == null
              ? null
              : Number(doctorRow.avg_minutes_to_review),
          withDoctorNotePct: frac(docNoted, docTotalEsc),
          withTreatmentStatusUpdatedPct: frac(docStatus, docTotalEsc),
          // Follow-up loop: explicit doctor "I followed up" signal,
          // linked to escalation_requested via trigger_event_id.
          followUpCompletedPct: frac(
            Number(doctorRow.follow_up_count ?? 0),
            docTotalEsc,
          ),
          followUpCompletedNumerator: Number(doctorRow.follow_up_count ?? 0),
          followUpCompletedDenominator: docTotalEsc,
          totalFollowUpEvents: Number(doctorRow.total_follow_up_events ?? 0),
          avgMinutesEscalationToFollowUp:
            doctorRow.avg_minutes_to_follow_up == null
              ? null
              : Number(doctorRow.avg_minutes_to_follow_up),
          followUpWithin24hPct: frac(
            Number(doctorRow.follow_up_within_24h_count ?? 0),
            Number(doctorRow.follow_up_count ?? 0),
          ),
          followUpWithin24hNumerator: Number(
            doctorRow.follow_up_within_24h_count ?? 0,
          ),
          followUpWithin24hDenominator: Number(doctorRow.follow_up_count ?? 0),
        },
        outcomes: {
          resolvedByVivaAlonePct: frac(resolvedNum, resolvedDen),
          resolvedByVivaAloneNumerator: resolvedNum,
          resolvedByVivaAloneDenominator: resolvedDen,
          escalatedPct: frac(escFromVivaNum, vivaDistinct),
          escalatedNumerator: escFromVivaNum,
          escalatedDenominator: vivaDistinct,
          improvedAfterDoctorPct: frac(improvedNum, improvedDen),
          improvedAfterDoctorNumerator: improvedNum,
          improvedAfterDoctorDenominator: improvedDen,
        },
        notes: {
          nextDayCheckin:
            "Of patients with a Viva event in the window, the share whose next outcome_snapshots row (within 1 day) marks next_day_checkin_completed.",
          escalated:
            "Of patients touched by a Viva event, the share who then sent escalation_requested within 7 days.",
          resolvedByVivaAlone:
            "Of patients who had a Viva event AND no escalation_requested in the next 7 days, the share with a positive follow-through (next_day_checkin_completed OR symptom_improved_3d) within 7 days.",
          improvedAfterDoctor:
            "Of patients who escalated and then had a doctor action (reviewed / note / status update), the share with a positive follow-through within 7 days of that action.",
          doctorDenominators:
            "Doctor reviewed/note/status percentages all use total escalation_requested events in the window as the denominator (one escalation = one row).",
          dataCaveat:
            "Outcome columns are populated by /outcomes/snapshot and a server recompute job; sparse data pulls the outcomes section down until backfill catches up.",
        },
      });
    } catch (err) {
      logger.error({ err }, "internal_care_loop_summary_failed");
      res.status(500).json({ error: "care_loop_failed" });
    }
  },
);

// ----------------------------------------------------------------------
// GET /internal/care-loop/trend?days=30
//
// Daily time-series of the escalation -> follow-up loop. Three series
// per day (UTC bucket):
//   - escalations:    count of escalation_requested events that day
//   - followUps:      count of follow_up_completed events that day
//   - within24hPct:   for escalations on that day, fraction that were
//                     followed up within 24h. Null when no escalations
//                     happened that day so the chart can render gaps
//                     instead of misleading 0%.
//
// All buckets are emitted, even empty ones, so the frontend can plot a
// continuous axis without zip-filling on the client.
// ----------------------------------------------------------------------

router.get(
  "/care-loop/trend",
  requireInternalKey,
  async (req: Request, res: Response) => {
    const days = Math.max(
      1,
      Math.min(180, Number(req.query.days ?? 30) || 30),
    );
    try {
      const rows = await db.execute(sql`
        with days as (
          select generate_series(
            (current_date - (${days - 1})::int),
            current_date,
            interval '1 day'
          )::date as day
        ),
        esc_by_day as (
          select occurred_at::date as day,
                 count(*)::int as n_escalations
          from care_events
          where type = 'escalation_requested'
            and occurred_at >= current_date - (${days - 1})::int
            and ${excludeDemoCol("patient_user_id")}
          group by occurred_at::date
        ),
        fu_by_day as (
          select occurred_at::date as day,
                 count(*)::int as n_follow_ups
          from care_events
          where type = 'follow_up_completed'
            and occurred_at >= current_date - (${days - 1})::int
            and ${excludeDemoCol("patient_user_id")}
          group by occurred_at::date
        ),
        -- For each escalation in the window, did its linked follow-up
        -- (joined via trigger_event_id) happen within 24h? Bucket by
        -- the escalation's day so the chart shows "speed of response"
        -- on the day the patient asked for help.
        esc_within_24h as (
          select e.occurred_at::date as day,
                 count(*)::int as n_escalations,
                 count(case
                   when ff.first_fu_at is not null
                    and ff.first_fu_at <= e.occurred_at + interval '24 hours'
                   then 1
                 end)::int as n_within_24h
          from care_events e
          left join lateral (
            select min(d.occurred_at) as first_fu_at
            from care_events d
            where d.type = 'follow_up_completed'
              and d.trigger_event_id = e.id
          ) ff on true
          where e.type = 'escalation_requested'
            and e.occurred_at >= current_date - (${days - 1})::int
            and ${excludeDemoCol("e.patient_user_id")}
          group by e.occurred_at::date
        )
        select
          d.day::text as day,
          coalesce(eb.n_escalations, 0) as escalations,
          coalesce(fb.n_follow_ups, 0) as follow_ups,
          coalesce(ew.n_within_24h, 0) as within_24h_num,
          coalesce(ew.n_escalations, 0) as within_24h_den
        from days d
        left join esc_by_day eb on eb.day = d.day
        left join fu_by_day fb on fb.day = d.day
        left join esc_within_24h ew on ew.day = d.day
        order by d.day asc
      `);

      const points = rows.rows.map((r: Record<string, unknown>) => {
        const num = Number(r["within_24h_num"] ?? 0);
        const den = Number(r["within_24h_den"] ?? 0);
        return {
          day: String(r["day"]),
          escalations: Number(r["escalations"] ?? 0),
          followUps: Number(r["follow_ups"] ?? 0),
          // Null when no escalations happened that day -- the chart
          // renders that as a gap, which is the truthful thing to do.
          within24hPct: den > 0 ? num / den : null,
          within24hNumerator: num,
          within24hDenominator: den,
        };
      });

      res.json({
        windowDays: days,
        generatedAt: new Date().toISOString(),
        points,
      });
    } catch (err) {
      logger.error({ err }, "internal_care_loop_trend_failed");
      res.status(500).json({ error: "care_loop_trend_failed" });
    }
  },
);

// ----------------------------------------------------------------------
// GET /internal/analytics/usage?days=7
//
// Pilot product-usage summary. Reads only the analytics_events stream
// -- nothing here joins back to the clinical tables, so an analytics
// outage cannot affect any product number on the rest of the page.
//
// Returns four blocks:
//   patientsByHour / doctorsByHour : 24-bucket hour-of-day histogram
//     of distinct sessions, useful for "when do patients actually
//     open the app".
//   topUsers : the busiest user_ids (per role) by session count, so
//     ops can spot heavy users without exposing raw event tables.
//   sessionLengthByRole : avg / p50 / p95 session length in seconds
//     for patients vs doctors.
//   eventCounts : raw count per event_name, lets us sanity-check that
//     all expected event types are flowing.
// ----------------------------------------------------------------------
router.get(
  "/analytics/usage",
  requireInternalKey,
  async (req: Request, res: Response) => {
    const days = Math.min(
      Math.max(Number.parseInt(String(req.query.days ?? "7"), 10) || 7, 1),
      90,
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      // One unified per-session CTE. Every metric on this endpoint
      // builds on the same shape so the numbers stay internally
      // consistent (e.g. the meaningful-action % and the session
      // length stats can never disagree about what counts as a
      // session). Null session_id events fall back to a synthetic
      // 1-event session keyed by row id.
      //
      // "Meaningful" = a session that completed an action with real
      // product value. Per the pilot definition:
      //   patient → 'checkin_completed'
      //   doctor  → 'patient_viewed'
      // A 10s patient session that lands a check-in counts as
      // meaningful even though its duration is tiny.
      //
      // representative_tz = MAX(timezone) chosen as a stable picker
      // when a session has multiple non-null tz values (rare; only
      // happens if the patient travels mid-session). MAX is stable
      // and deterministic, which is what we want for charts.
      const sessionRows = await db.execute(sql`
        WITH per_session AS (
          SELECT
            user_type,
            user_id,
            COALESCE(session_id, 'evt-' || id::text) AS sid,
            MIN(created_at) AS started_at,
            EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))::float AS secs,
            COUNT(*)::int AS event_count,
            SUM(CASE
              WHEN (user_type = 'patient' AND event_name = 'checkin_completed')
                OR (user_type = 'doctor'  AND event_name = 'patient_viewed')
              THEN 1 ELSE 0 END)::int AS meaningful_event_count,
            MAX(timezone) AS representative_tz
          FROM ${analyticsEventsTable}
          WHERE created_at >= ${since}
            AND ${excludeDemoCol("user_id")}
          GROUP BY user_type, user_id, COALESCE(session_id, 'evt-' || id::text)
        )
        SELECT
          user_type,
          user_id,
          sid,
          started_at,
          secs,
          event_count,
          meaningful_event_count,
          (meaningful_event_count > 0) AS has_meaningful_action,
          representative_tz
        FROM per_session
      `);
      type SessionRow = {
        user_type: string;
        user_id: number;
        sid: string;
        started_at: string;
        secs: number;
        event_count: number;
        meaningful_event_count: number;
        has_meaningful_action: boolean;
        representative_tz: string | null;
      };
      const sessions = sessionRows.rows as SessionRow[];

      // Hour-of-day histogram, bucketed by the session START in the
      // user's local timezone when we have one. AT TIME ZONE on a
      // timestamptz returns a wall-clock timestamp in the named zone,
      // so EXTRACT(HOUR ...) gives the right local hour. Sessions
      // missing a tz fall back to UTC and are tallied separately so
      // the UI can warn the operator about coverage.
      const patientsByHour: number[] = Array(24).fill(0);
      const doctorsByHour: number[] = Array(24).fill(0);
      let sessionsWithTz = 0;
      let sessionsWithoutTz = 0;
      for (const s of sessions) {
        const tz = s.representative_tz || "UTC";
        if (s.representative_tz) sessionsWithTz += 1;
        else sessionsWithoutTz += 1;
        const hour = localHour(s.started_at, tz);
        if (hour == null) continue;
        if (s.user_type === "patient") patientsByHour[hour] += 1;
        else if (s.user_type === "doctor") doctorsByHour[hour] += 1;
      }

      // Per-user session counts → top 10 per role.
      const userCounts = new Map<string, { sessions: number; lastSeen: string }>();
      for (const s of sessions) {
        const k = `${s.user_type}:${s.user_id}`;
        const cur = userCounts.get(k);
        if (cur) {
          cur.sessions += 1;
          if (s.started_at > cur.lastSeen) cur.lastSeen = s.started_at;
        } else {
          userCounts.set(k, { sessions: 1, lastSeen: s.started_at });
        }
      }
      const allTop = Array.from(userCounts.entries())
        .map(([k, v]) => {
          const [userType, idStr] = k.split(":");
          return {
            userType: userType!,
            userId: Number(idStr),
            sessions: v.sessions,
            lastSeenAt: v.lastSeen,
          };
        })
        .sort((a, b) => b.sessions - a.sessions);
      const topUsers = {
        patients: allTop.filter((r) => r.userType === "patient").slice(0, 10),
        doctors: allTop.filter((r) => r.userType === "doctor").slice(0, 10),
      };

      // Per-role session length + meaningful-action stats. Includes a
      // separate average computed only over meaningful sessions so the
      // operator can see "do successful sessions tend to be longer or
      // shorter than the overall pool?" without being misled.
      const sessionLengthByRole = {
        patient: emptyLen(),
        doctor: emptyLen(),
      } as Record<"patient" | "doctor", SessionStats>;
      for (const role of ["patient", "doctor"] as const) {
        const roleSessions = sessions.filter((s) => s.user_type === role);
        sessionLengthByRole[role] = computeSessionStats(roleSessions);
      }

      // Raw counts per event_name. Comes straight off the events
      // table, not the per-session CTE, so an event firing without a
      // session_id still shows up here.
      const eventRows = await db.execute(sql`
        SELECT event_name, user_type, COUNT(*)::int AS n
        FROM ${analyticsEventsTable}
        WHERE created_at >= ${since}
          AND ${excludeDemoCol("user_id")}
        GROUP BY event_name, user_type
        ORDER BY n DESC
      `);
      const eventCounts = (eventRows.rows as Array<{
        event_name: string;
        user_type: string;
        n: number;
      }>).map((r) => ({
        eventName: r.event_name,
        userType: r.user_type,
        count: r.n,
      }));

      const tzCoverage =
        sessionsWithTz + sessionsWithoutTz === 0
          ? null
          : sessionsWithTz / (sessionsWithTz + sessionsWithoutTz);

      res.json({
        windowDays: days,
        generatedAt: new Date().toISOString(),
        patientsByHour,
        doctorsByHour,
        topUsers,
        sessionLengthByRole,
        eventCounts,
        timezoneCoverage: {
          sessionsWithTz,
          sessionsWithoutTz,
          coveragePct: tzCoverage,
        },
        notes: {
          meaningfulAction:
            "Patient = checkin_completed. Doctor = patient_viewed. A short session that lands a meaningful action still counts as successful.",
          sessionLength:
            "Session length is approximate. Short sessions can still be successful if a key action was completed; treat avg/median as descriptive, not a success metric.",
          patientsByHour:
            "Patient sessions bucketed by START hour. Local time used when the client reported a timezone; otherwise UTC.",
          doctorsByHour:
            "Doctor sessions bucketed by START hour. Local time used when the client reported a timezone; otherwise UTC.",
          topUsers:
            "Top 10 users per role by session count. user_id only; join client-side if a name is needed.",
          eventCounts:
            "Raw event volumes per event_name + user_type. Use this to verify clients are firing.",
          timezoneCoverage:
            "Share of sessions in the window that reported a client timezone. New builds capture it; older rows are bucketed in UTC.",
        },
      });
    } catch (err) {
      logger.error({ err }, "internal_analytics_usage_failed");
      res.status(500).json({ error: "analytics_usage_failed" });
    }
  },
);

interface SessionStats {
  sessions: number;
  avgSecs: number;
  medianSecs: number;
  p50Secs: number;
  p95Secs: number;
  meaningfulSessions: number;
  meaningfulPct: number;
  avgSecsMeaningful: number;
}

function emptyLen(): SessionStats {
  return {
    sessions: 0,
    avgSecs: 0,
    medianSecs: 0,
    p50Secs: 0,
    p95Secs: 0,
    meaningfulSessions: 0,
    meaningfulPct: 0,
    avgSecsMeaningful: 0,
  };
}

// Aggregate one role's session rows into the descriptive stats the UI
// needs. Done in JS rather than another SQL pass because we already
// have the rows in memory and a single pass keeps the endpoint fast.
function computeSessionStats(
  rows: Array<{ secs: number; has_meaningful_action: boolean }>,
): SessionStats {
  if (rows.length === 0) return emptyLen();
  const lengths = rows.map((r) => r.secs).sort((a, b) => a - b);
  const meaningful = rows.filter((r) => r.has_meaningful_action);
  const median = percentile(lengths, 0.5);
  return {
    sessions: rows.length,
    avgSecs: Math.round(avg(lengths)),
    medianSecs: Math.round(median),
    p50Secs: Math.round(median),
    p95Secs: Math.round(percentile(lengths, 0.95)),
    meaningfulSessions: meaningful.length,
    meaningfulPct: meaningful.length / rows.length,
    avgSecsMeaningful:
      meaningful.length === 0
        ? 0
        : Math.round(avg(meaningful.map((r) => r.secs))),
  };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

// Linear-interpolation percentile over a SORTED array. Matches the
// PERCENTILE_CONT semantics we used in the previous SQL version so
// numbers stay comparable session-to-session.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

// Convert a postgres timestamptz string into the local hour-of-day in
// the given IANA timezone. Returns null on any parse failure (which
// would only happen if the row is corrupt or the tz string is bogus).
function localHour(timestamptz: string, tz: string): number | null {
  try {
    const d = new Date(timestamptz);
    if (Number.isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return null;
    const h = Number.parseInt(hourPart.value, 10);
    if (Number.isNaN(h)) return null;
    // Intl returns 24 for midnight in some locales; normalize to 0.
    return h === 24 ? 0 : h;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// Pilot Metrics Snapshots (internal only)
//
// A snapshot is a frozen, immutable readout of the pilot KPIs for a
// specific cohort window. Two intended modes:
//   * Day-15 / Day-30 presets, computed against the rolling window
//     ending "now".
//   * Explicit cohortStartDate/cohortEndDate for custom retrospective
//     readouts.
//
// Persistence rules:
//   * Snapshots are append-only. There is intentionally no PUT/PATCH/
//     DELETE -- if a snapshot is wrong, take a new one with notes
//     explaining why and ignore the old one in the UI.
//   * `metricDefinitionVersion` is captured per-row so a future
//     definition change (e.g. flipping a dedupe boundary) cannot
//     silently re-interpret old snapshots. Comparing across versions
//     is a UI/operator decision.
//
// External sharing is still NOT exposed. When HIPAA prerequisites
// (BAA covering hosting, audit_log table, AI-vendor coverage,
// de-identification / minimum-necessary review of the readout shape)
// are in place, the external readout will be a separate route that
// reads from `pilot_snapshots` -- it will never recompute live numbers
// for an external caller. That ordering keeps "what we showed the
// partner" auditable forever.
// ----------------------------------------------------------------------

// Hand-written zod request schemas. We deliberately don't use
// drizzle-zod's createInsertSchema for pilot_snapshots because the
// repo's current zod version disagrees with drizzle-zod's emitted
// ZodObject typing in several other tables; introducing another use
// would compound the problem. The inputs we care about for create are
// narrow enough that a hand-written schema is clearer anyway.
// Scope inputs are shared between preset and range. Both null = pilot
// is whole-cohort (today's default). doctorId without platformId is
// allowed -- the resolver will derive the doctor's platform implicitly
// via their patients -- but in practice the UI always sends both.
const scopeShape = {
  platformId: z.number().int().positive().nullable().optional(),
  doctorId: z.number().int().positive().nullable().optional(),
};

const snapshotPresetSchema = z.object({
  preset: z.enum(["day15", "day30"]),
  notes: z.string().max(2000).optional(),
  generatedByLabel: z.string().min(1).max(120).optional(),
  ...scopeShape,
});

const snapshotRangeSchema = z.object({
  // YYYY-MM-DD; we re-validate by parsing into a Date below.
  cohortStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  cohortEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  notes: z.string().max(2000).optional(),
  generatedByLabel: z.string().min(1).max(120).optional(),
  ...scopeShape,
});

const snapshotCreateSchema = z.union([snapshotPresetSchema, snapshotRangeSchema]);

// Resolve the request body into a concrete inclusive [start, end] window.
// Presets compute backwards from "now" so a Day-15 readout taken today
// covers exactly N CALENDAR DAYS ending at end-of-today: windowStart
// is start-of-day for `today - (N - 1)`, windowEnd is end-of-day today.
// This keeps date-bound checkin queries (`>= startYmd AND <= endYmd`)
// and instant-bound event queries (`>= windowStart AND <= windowEnd`)
// covering the same N calendar days, instead of the off-by-one that
// `windowEnd - N*24h` would produce (which would yield N+1 dates).
//
// Explicit ranges parse the YMD strings in the SERVER's local
// timezone and verify the constructed Date round-trips to the same
// Y/M/D -- that's how we reject impossible dates like "2026-02-31"
// which JS would otherwise silently roll forward to March 3.
function resolveWindow(
  body: z.infer<typeof snapshotCreateSchema>,
): { windowStart: Date; windowEnd: Date } | { error: string } {
  if ("preset" in body) {
    const days = body.preset === "day15" ? 15 : 30;
    const now = new Date();
    const windowEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );
    const windowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (days - 1),
      0,
      0,
      0,
      0,
    );
    return { windowStart, windowEnd };
  }
  // Explicit range. Build local-midnight bounds and verify round-trip
  // to reject calendar-invalid inputs.
  const [sy, sm, sd] = body.cohortStartDate.split("-").map(Number);
  const [ey, em, ed] = body.cohortEndDate.split("-").map(Number);
  const windowStart = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
  const windowEnd = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  if (
    Number.isNaN(windowStart.getTime()) ||
    Number.isNaN(windowEnd.getTime()) ||
    windowStart.getFullYear() !== sy ||
    windowStart.getMonth() !== sm - 1 ||
    windowStart.getDate() !== sd ||
    windowEnd.getFullYear() !== ey ||
    windowEnd.getMonth() !== em - 1 ||
    windowEnd.getDate() !== ed
  ) {
    return { error: "invalid_date" };
  }
  if (windowEnd.getTime() < windowStart.getTime()) {
    return { error: "end_before_start" };
  }
  // Cap the window at ~2 years of days as a defensive guard against
  // accidental "year 0001" inputs that would scan the entire events
  // table. The pilot won't run for years; if it does we revisit.
  const days =
    (windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000);
  if (days > 730) return { error: "window_too_large" };
  return { windowStart, windowEnd };
}

// POST /api/internal/analytics/pilot/snapshot -- create a snapshot.
router.post(
  "/analytics/pilot/snapshot",
  requireInternalKey,
  async (req: Request, res: Response) => {
    const parsed = snapshotCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_request", detail: parsed.error.issues });
      return;
    }
    const win = resolveWindow(parsed.data);
    if ("error" in win) {
      res.status(400).json({ error: win.error });
      return;
    }

    try {
      // Scope filters flow into both the metrics computation AND the
      // persisted row, so the snapshot row can stand alone later (the
      // metrics blob already records the scope it described, but the
      // top-level columns make list queries indexable).
      const platformId = parsed.data.platformId ?? null;
      const doctorId = parsed.data.doctorId ?? null;

      const metrics = await computePilotMetrics({
        windowStart: win.windowStart,
        windowEnd: win.windowEnd,
        platformId,
        doctorId,
      });

      const cohortStartDate = ymdLocal(win.windowStart);
      const cohortEndDate = ymdLocal(win.windowEnd);
      const generatedByLabel =
        parsed.data.generatedByLabel?.trim() || "operator";

      const [row] = await db
        .insert(pilotSnapshotsTable)
        .values({
          platformId,
          doctorUserId: doctorId,
          cohortStartDate,
          cohortEndDate,
          generatedByLabel,
          metricDefinitionVersion: PILOT_METRIC_DEFINITION_VERSION,
          patientCount: metrics.cohort.activated,
          metrics,
          notes: parsed.data.notes ?? null,
        })
        .returning();

      res.status(201).json(row);
    } catch (e) {
      req.log.error(
        { err: e },
        "pilot_snapshot_create_failed",
      );
      res
        .status(500)
        .json({ error: "snapshot_create_failed" });
    }
  },
);

// GET /api/internal/analytics/pilot/snapshots -- list metadata only.
// Intentionally omits the `metrics` JSONB blob so a list of N snapshots
// stays cheap to render; the detail route returns the full payload.
// Joins telehealth_platforms + users so the UI can show "Demo Platform /
// Dr. Smith" without an extra round-trip per row.
router.get(
  "/analytics/pilot/snapshots",
  requireInternalKey,
  async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          id: pilotSnapshotsTable.id,
          cohortStartDate: pilotSnapshotsTable.cohortStartDate,
          cohortEndDate: pilotSnapshotsTable.cohortEndDate,
          generatedAt: pilotSnapshotsTable.generatedAt,
          generatedByUserId: pilotSnapshotsTable.generatedByUserId,
          generatedByLabel: pilotSnapshotsTable.generatedByLabel,
          clinicName: pilotSnapshotsTable.clinicName,
          platformId: pilotSnapshotsTable.platformId,
          platformName: telehealthPlatformsTable.name,
          platformSlug: telehealthPlatformsTable.slug,
          doctorUserId: pilotSnapshotsTable.doctorUserId,
          doctorName: usersTable.name,
          metricDefinitionVersion: pilotSnapshotsTable.metricDefinitionVersion,
          patientCount: pilotSnapshotsTable.patientCount,
          notes: pilotSnapshotsTable.notes,
        })
        .from(pilotSnapshotsTable)
        .leftJoin(
          telehealthPlatformsTable,
          eq(telehealthPlatformsTable.id, pilotSnapshotsTable.platformId),
        )
        .leftJoin(
          usersTable,
          eq(usersTable.id, pilotSnapshotsTable.doctorUserId),
        )
        .orderBy(desc(pilotSnapshotsTable.generatedAt));
      res.json({ snapshots: rows });
    } catch (e) {
      req.log.error({ err: e }, "pilot_snapshot_list_failed");
      res.status(500).json({ error: "snapshot_list_failed" });
    }
  },
);

// GET /api/internal/analytics/pilot/snapshots/:id -- full row, plus
// resolved platform + doctor names (the UI's FrozenBanner needs them).
router.get(
  "/analytics/pilot/snapshots/:id",
  requireInternalKey,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    try {
      const [row] = await db
        .select({
          snapshot: pilotSnapshotsTable,
          platformName: telehealthPlatformsTable.name,
          platformSlug: telehealthPlatformsTable.slug,
          doctorName: usersTable.name,
        })
        .from(pilotSnapshotsTable)
        .leftJoin(
          telehealthPlatformsTable,
          eq(telehealthPlatformsTable.id, pilotSnapshotsTable.platformId),
        )
        .leftJoin(
          usersTable,
          eq(usersTable.id, pilotSnapshotsTable.doctorUserId),
        )
        .where(eq(pilotSnapshotsTable.id, id))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({
        ...row.snapshot,
        platformName: row.platformName,
        platformSlug: row.platformSlug,
        doctorName: row.doctorName,
      });
    } catch (e) {
      req.log.error({ err: e }, "pilot_snapshot_get_failed");
      res.status(500).json({ error: "snapshot_get_failed" });
    }
  },
);

// GET /api/internal/analytics/pilot/scopes -- selectors for the UI.
// Returns the list of telehealth platforms and the list of doctors per
// platform, so the New Snapshot panel and the live-view scope picker
// can render dropdowns without a separate admin endpoint. Doctors are
// scoped via patients.platform_id (denormalised at signup) so a doctor
// who has not yet been assigned to any platform won't appear; that's
// intentional -- pilot metrics are meaningless for them.
router.get(
  "/analytics/pilot/scopes",
  requireInternalKey,
  async (req: Request, res: Response) => {
    try {
      const platforms = await db
        .select({
          id: telehealthPlatformsTable.id,
          name: telehealthPlatformsTable.name,
          slug: telehealthPlatformsTable.slug,
          status: telehealthPlatformsTable.status,
        })
        .from(telehealthPlatformsTable)
        .orderBy(telehealthPlatformsTable.name);
      const doctors = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          platformId: usersTable.platformId,
        })
        .from(usersTable)
        .where(eq(usersTable.role, "doctor"))
        .orderBy(usersTable.name);
      res.json({ platforms, doctors });
    } catch (e) {
      req.log.error({ err: e }, "pilot_scopes_failed");
      res.status(500).json({ error: "scopes_failed" });
    }
  },
);

export default router;
