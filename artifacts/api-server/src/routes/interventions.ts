import { Router, type Response } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  interventionEventsTable,
  outcomeSnapshotsTable,
  patientsTable,
  INTERVENTION_SURFACES,
  INTERVENTION_TYPES,
} from "@workspace/db";
import { requirePatient, requireAuth, type AuthedRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: Router = Router();

// ----- POST /interventions/log -------------------------------------
// Patient client batches the interventions it has rendered (Today,
// WeeklyPlan, Coach) and POSTs them here on a debounced schedule. We
// trust the client's snapshot of treatment-state at render time
// (cannot recompute from server -- the daily-state engine lives in
// the mobile app), but every event is forced under the calling
// patient's userId; the body cannot impersonate another patient.

const treatmentSnapshotSchema = z.object({
  primaryFocus: z.string(),
  escalationNeed: z.enum(["none", "monitor", "clinician"]),
  treatmentStage: z.string(),
  treatmentDailyState: z.string(),
  communicationMode: z.string(),
  dataTier: z.enum(["self_report", "phone_health", "wearable"]),
  recentTitration: z.boolean(),
  symptomBurden: z.enum(["low", "moderate", "high"]),
  adherenceSignal: z.enum(["stable", "attention", "rising"]),
  insufficientForPlan: z.boolean(),
});

const claimsPolicySummarySchema = z.object({
  canCiteSleep: z.boolean(),
  canCiteHRV: z.boolean(),
  canCiteRecovery: z.boolean(),
  canCiteSteps: z.boolean(),
  physiologicalClaimsAllowed: z.boolean(),
  narrativeConfidence: z.enum(["low", "moderate", "high"]),
});

const signalConfidenceLevel = z.enum(["none", "low", "medium", "high"]);
const signalConfidenceSummarySchema = z.object({
  hrv: signalConfidenceLevel,
  rhr: signalConfidenceLevel,
  sleepDuration: signalConfidenceLevel,
  sleepQuality: signalConfidenceLevel,
  recovery: signalConfidenceLevel,
  activity: signalConfidenceLevel,
});

const eventSchema = z.object({
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  surface: z.enum(INTERVENTION_SURFACES),
  interventionType: z.enum(INTERVENTION_TYPES),
  title: z.string().min(1).max(200),
  rationale: z.string().max(2000).nullish(),
  treatmentStateSnapshot: treatmentSnapshotSchema,
  claimsPolicySummary: claimsPolicySummarySchema,
  signalConfidenceSummary: signalConfidenceSummarySchema.nullish(),
});

const logSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

router.post("/log", requirePatient, async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const rows = parsed.data.events.map((e) => ({
      patientUserId: userId,
      occurredOn: e.occurredOn,
      surface: e.surface,
      interventionType: e.interventionType,
      title: e.title,
      rationale: e.rationale ?? null,
      treatmentStateSnapshot: e.treatmentStateSnapshot,
      claimsPolicySummary: e.claimsPolicySummary,
      signalConfidenceSummary: e.signalConfidenceSummary ?? null,
    }));
    await db.insert(interventionEventsTable).values(rows);
    res.json({ ok: true, inserted: rows.length });
  } catch (err) {
    logger.error({ err, userId }, "intervention_log_failed");
    res.status(500).json({ error: "log_failed" });
  }
});

// ----- linkInterventionsToOutcomes ---------------------------------
// Helper used by the analytics endpoint. For each intervention event
// in the window, find the outcome_snapshot whose snapshot_date is
// within `windowDays` AFTER the event. Joined in SQL so the analytics
// view doesn't blow up the row count in JS.
export async function linkInterventionsToOutcomes(
  patientUserId: number | null,
  windowDays: number,
): Promise<
  Array<{
    interventionId: number;
    interventionType: string;
    surface: string;
    occurredOn: string;
    communicationMode: string;
    primaryFocus: string;
    confidenceBand: "low" | "medium" | "high" | "mixed" | "none";
    adherenceImproved: boolean | null;
    symptomImproved: boolean | null;
    symptomWorsened: boolean | null;
    appEngaged72h: boolean | null;
    nextDayCheckin: boolean | null;
    reengagedAfterLow: boolean | null;
  }>
> {
  // Confidence band derived in JS from the JSONB summary (Postgres
  // doesn't have a one-liner for "max enum across keys").
  const where = patientUserId
    ? sql`ie.patient_user_id = ${patientUserId}`
    : sql`true`;
  const rows = await db.execute(sql`
    select
      ie.id                                 as intervention_id,
      ie.intervention_type                  as intervention_type,
      ie.surface                            as surface,
      ie.occurred_on                        as occurred_on,
      ie.treatment_state_snapshot->>'communicationMode' as communication_mode,
      ie.treatment_state_snapshot->>'primaryFocus'      as primary_focus,
      ie.signal_confidence_summary          as signal_confidence_summary,
      os.adherence_improved_3d              as adherence_improved,
      os.symptom_improved_3d                as symptom_improved,
      os.symptom_worsened_3d                as symptom_worsened,
      os.app_engaged_72h                    as app_engaged_72h,
      os.next_day_checkin_completed         as next_day_checkin,
      os.reengaged_after_low_adherence      as reengaged_after_low
    from intervention_events ie
    left join lateral (
      select *
      from outcome_snapshots os
      where os.patient_user_id = ie.patient_user_id
        and os.snapshot_date >= ie.occurred_on
        and os.snapshot_date <= (ie.occurred_on::date + (${windowDays} || ' days')::interval)
      order by os.snapshot_date asc
      limit 1
    ) os on true
    where ${where}
  `);

  const bandOf = (
    summary: Record<string, unknown> | null,
  ): "low" | "medium" | "high" | "mixed" | "none" => {
    if (!summary || typeof summary !== "object") return "none";
    const levels = Object.values(summary as Record<string, unknown>).filter(
      (v): v is "none" | "low" | "medium" | "high" =>
        v === "none" || v === "low" || v === "medium" || v === "high",
    );
    if (levels.length === 0) return "none";
    const present = new Set(levels.filter((l) => l !== "none"));
    if (present.size === 0) return "none";
    if (present.size === 1) return [...present][0]!;
    return "mixed";
  };

  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    interventionId: Number(r.intervention_id),
    interventionType: String(r.intervention_type),
    surface: String(r.surface),
    occurredOn: String(r.occurred_on),
    communicationMode: String(r.communication_mode ?? "unknown"),
    primaryFocus: String(r.primary_focus ?? "unknown"),
    confidenceBand: bandOf(
      r.signal_confidence_summary as Record<string, unknown> | null,
    ),
    adherenceImproved: (r.adherence_improved as boolean | null) ?? null,
    symptomImproved: (r.symptom_improved as boolean | null) ?? null,
    symptomWorsened: (r.symptom_worsened as boolean | null) ?? null,
    appEngaged72h: (r.app_engaged_72h as boolean | null) ?? null,
    nextDayCheckin: (r.next_day_checkin as boolean | null) ?? null,
    reengagedAfterLow: (r.reengaged_after_low as boolean | null) ?? null,
  }));
}

// Pre-existing patient-shaped helpers don't suit a quick read; we
// expose a tiny `GET /interventions/recent` for ad-hoc verification
// during development.
router.get("/recent", requireAuth, async (req, res: Response) => {
  const auth = (req as AuthedRequest).auth;
  // Patients can only read their own; doctors can read by ?patientId
  // ONLY for patients they own (doctorId match).
  let pid = auth.userId;
  if (auth.role === "doctor") {
    const q = z.coerce.number().int().positive().safeParse(req.query.patientId);
    if (!q.success) {
      res.status(400).json({ error: "patientId_required" });
      return;
    }
    const owns = await db
      .select({ userId: patientsTable.userId })
      .from(patientsTable)
      .where(
        and(
          eq(patientsTable.userId, q.data),
          eq(patientsTable.doctorId, auth.userId),
        ),
      )
      .limit(1);
    if (owns.length === 0) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    pid = q.data;
  }
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 14);
  const sinceYmd = sinceDate.toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(interventionEventsTable)
    .where(
      and(
        eq(interventionEventsTable.patientUserId, pid),
        gte(interventionEventsTable.occurredOn, sinceYmd),
      ),
    )
    .limit(200);
  res.json(rows);
});

export default router;
