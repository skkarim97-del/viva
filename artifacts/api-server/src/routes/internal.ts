import { Router, type Request, type Response, type NextFunction } from "express";
import { and, eq, gte, isNotNull, sql, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  patientsTable,
  patientCheckinsTable,
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
//   * Set INTERNAL_API_KEY in the deployment environment.
//   * The /internal dashboard page prompts the operator for the key
//     and stores it in localStorage; the page sends it as
//     Authorization: Bearer <key>.
//
// In dev, if INTERNAL_API_KEY is not set we fall back to a fixed dev
// string so a fresh checkout works without configuration. In prod we
// hard-fail closed -- never serve metrics if the key is unset.

const DEV_FALLBACK_KEY = "viva-internal-dev";

function expectedKey(): string | null {
  const k = (process.env.INTERNAL_API_KEY || "").trim();
  if (k) return k;
  if (process.env.NODE_ENV === "production") return null;
  return DEV_FALLBACK_KEY;
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

      res.json({
        generatedAt: new Date().toISOString(),
        windowDays: 7,
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
