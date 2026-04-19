import { Router, type Request, type Response, type NextFunction } from "express";
import { and, eq, gte, isNotNull, sql, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  doctorNotesTable,
  interventionEventsTable,
  deriveStopTiming,
} from "@workspace/db";
import { computeRisk, deriveAction } from "../lib/risk";
import { logger } from "../lib/logger";
import { linkInterventionsToOutcomes } from "./interventions";
import { recomputeRecentOutcomesForAllPatients } from "./outcomes";

const router: Router = Router();

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
    const [{ count: invitesSent }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientsTable);

    const [{ count: activated }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientsTable)
      .where(isNotNull(patientsTable.activatedAt));

    // ---- Check-in coverage ------------------------------------------
    const [{ count: completedFirstCheckin }] = await db
      .select({
        count: sql<number>`cast(count(distinct ${patientCheckinsTable.patientUserId}) as int)`,
      })
      .from(patientCheckinsTable);

    const sevenDaysAgo = ymdDaysAgo(6); // inclusive 7-day window
    const [{ count: checkedInLast7 }] = await db
      .select({
        count: sql<number>`cast(count(distinct ${patientCheckinsTable.patientUserId}) as int)`,
      })
      .from(patientCheckinsTable)
      .where(gte(patientCheckinsTable.date, sevenDaysAgo));

    const [{ count: checkinsLast7Total }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(patientCheckinsTable)
      .where(gte(patientCheckinsTable.date, sevenDaysAgo));

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
      .where(isNotNull(patientsTable.activatedAt));

    let needsFollowup = 0;
    if (activatedPatients.length > 0) {
      // Pull last 14 days of check-ins for all activated patients in one
      // query, then group in memory -- mirrors what /patients does.
      const cutoff = ymdDaysAgo(13);
      const cks = await db
        .select()
        .from(patientCheckinsTable)
        .where(gte(patientCheckinsTable.date, cutoff))
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
  async (_req, res: Response) => {
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
      `);
      type StoppedRow = {
        stop_reason: string | null;
        started_on: string | Date | null;
        treatment_status_updated_at: string | Date | null;
      };
      const stoppedList = stoppedRows.rows as StoppedRow[];

      const reasonCounts: Record<string, number> = {};
      const timingCounts: Record<"early" | "mid" | "late" | "unknown", number> =
        { early: 0, mid: 0, late: 0, unknown: 0 };
      const reasonByTiming: Record<string, Record<string, number>> = {};
      for (const r of stoppedList) {
        const reason = r.stop_reason ?? "unknown";
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
        const { bucket } = deriveStopTiming(
          r.started_on,
          r.treatment_status_updated_at,
        );
        timingCounts[bucket] += 1;
        reasonByTiming[reason] ??= { early: 0, mid: 0, late: 0, unknown: 0 };
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
        early: timingCounts.early,
        mid: timingCounts.mid,
        late: timingCounts.late,
        unknown: timingCounts.unknown,
        // Pct relative to stopped patients with known timing -- otherwise
        // missing startedOn data drags every bucket down equally.
        knownDenom:
          timingCounts.early + timingCounts.mid + timingCounts.late,
      };
      const stopReasonByTiming = Object.entries(reasonByTiming).map(
        ([reason, buckets]) => ({
          reason,
          early: buckets.early ?? 0,
          mid: buckets.mid ?? 0,
          late: buckets.late ?? 0,
          unknown: buckets.unknown ?? 0,
        }),
      );

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
          union
          select patient_user_id as uid, occurred_on::date as d
          from intervention_events
          where occurred_on >= ${ymd30}
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
        .where(eq(usersTable.role, "doctor"));

      // Doctor activity windows.
      const doctorActivityRows = await db.execute(sql`
        with activity as (
          select doctor_user_id as uid, created_at::date as d
          from doctor_notes
          where created_at >= ${ymd30}::date
          union
          select treatment_status_updated_by as uid,
                 treatment_status_updated_at::date as d
          from patients
          where treatment_status_source = 'doctor'
            and treatment_status_updated_at >= ${ymd30}::date
            and treatment_status_updated_by is not null
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
      `);
      const appleHealthConnected = Number(
        (ahRows.rows?.[0] as { connected?: number } | undefined)?.connected ?? 0,
      );
      const [{ count: activatedCount }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(patientsTable)
        .where(isNotNull(patientsTable.activatedAt));
      const pctAppleHealthConnected =
        activatedCount > 0 ? appleHealthConnected / activatedCount : 0;

      // % completing check-ins = activated patients with a check-in in
      // the last 7 days. Mirrors what the doctor would call "active
      // logging" without inventing a new threshold.
      const checkin7Rows = await db.execute(sql`
        select cast(count(distinct patient_user_id) as int) as n
        from patient_checkins
        where date >= ${ymd7}
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
        .where(gte(doctorNotesTable.createdAt, sql`${ymd30}::date`));

      const reviewedRows = await db.execute(sql`
        select cast(count(distinct patient_user_id) as int) as n
        from doctor_notes
        where created_at >= ${ymd30}::date
      `);
      const patientsReviewed = Number(
        (reviewedRows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
      );

      const tsuRows = await db.execute(sql`
        select cast(count(*) as int) as n
        from patients
        where treatment_status_updated_at >= ${ymd30}::date
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
      const doctorRows = await db.execute(sql`
        select
          u.id as id,
          u.name as name,
          u.email as email,
          (select cast(count(*) as int) from patients p where p.doctor_id = u.id) as patient_count,
          (select cast(count(*) as int) from patients p
             where p.doctor_id = u.id and p.treatment_status = 'active') as active_patients,
          (select cast(count(*) as int) from patients p
             where p.doctor_id = u.id and p.treatment_status = 'stopped') as stopped_patients,
          (select cast(count(*) as int) from doctor_notes n
             where n.doctor_user_id = u.id and n.created_at >= ${ymd30}::date) as notes_written,
          (select cast(count(*) as int) from patients p
             where p.treatment_status_updated_by = u.id
               and p.treatment_status_updated_at >= ${ymd30}::date) as statuses_updated,
          greatest(
            (select max(created_at) from doctor_notes n where n.doctor_user_id = u.id),
            (select max(treatment_status_updated_at) from patients p
               where p.treatment_status_updated_by = u.id)
          ) as last_active_at
        from users u
        where u.role = 'doctor'
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
        timingCounts.early +
        timingCounts.mid +
        timingCounts.late +
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

      res.json({
        generatedAt: new Date().toISOString(),
        windowDays: 7,
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

export default router;
