import { Router, type Response } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  patientCheckinsTable,
  patientWeightsTable,
  patientHealthDailySummariesTable,
  patientTreatmentLogsTable,
  patientProfilesTable,
} from "@workspace/db";
import { requirePatient, type AuthedRequest } from "../middlewares/auth";
import { computeRisk } from "../lib/risk";
import { computeSymptomFlags } from "../lib/symptoms";
import { mediumApiLimiter } from "../middlewares/rateLimit";
import { phiAudit } from "../middlewares/phiAudit";

const router: Router = Router();
// Rate limit BEFORE the auth gate so an unauthenticated flood
// doesn't burn DB cycles on the bearer token lookup.
router.use(mediumApiLimiter);
router.use(requirePatient);
// HIPAA audit log for patient-self PHI. Mounted AFTER requirePatient
// so req.auth is set; getPatientId is the patient's own user id
// (every route in this router is naturally scoped to req.auth.userId
// -- /me has no other patient id surface).
router.use(
  phiAudit({
    getPatientId: (req) => (req as AuthedRequest).auth?.userId ?? null,
  }),
);

router.get("/checkins", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, userId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(60);
  res.json(cks);
});

// GET /me/checkins/today -- returns the patient's own check-in row for
// the current local YMD date if one exists, or 204 No Content if not.
// Used by the Today screen to hydrate the symptom sliders on cold start
// (e.g. after auto-login on the dev preview, where AsyncStorage is
// empty but the server already has today's seeded check-in row).
router.get("/checkins/today", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const today = `${y}-${m}-${day}`;
  const [row] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, today),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(204).end();
    return;
  }
  res.json(row);
});

// All symptom-management fields (appetite, digestion, hydration,
// bowelMovement, doseTakenToday) are OPTIONAL. Older mobile builds
// continue to submit just energy/nausea/mood and must keep working.
// guidanceShown is a small per-symptom ack object the patient app
// sends when the patient taps "Got it" on a symptom-tip card.
const checkinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.enum(["depleted", "tired", "good", "great"]),
  nausea: z.enum(["none", "mild", "moderate", "severe"]),
  mood: z.number().int().min(1).max(5),
  notes: z.string().max(2000).nullish(),
  appetite: z.enum(["strong", "normal", "low", "very_low"]).nullish(),
  digestion: z
    .enum(["fine", "bloated", "constipated", "diarrhea"])
    .nullish(),
  hydration: z
    .enum(["hydrated", "good", "low", "dehydrated"])
    .nullish(),
  bowelMovement: z.boolean().nullish(),
  doseTakenToday: z.boolean().nullish(),
  guidanceShown: z
    .object({
      nausea: z.boolean().optional(),
      constipation: z.boolean().optional(),
      low_appetite: z.boolean().optional(),
    })
    .nullish(),
});

router.post("/checkins", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const v = parsed.data;
  // Build the optional-field set once so the INSERT and UPDATE branches
  // stay in sync. Coerce undefined -> null so a patient who clears a
  // field on edit actually wipes the previous value rather than
  // preserving it (which would be a silent data lie on the dashboard).
  const symptomFields = {
    appetite: v.appetite ?? null,
    digestion: v.digestion ?? null,
    hydration: v.hydration ?? null,
    bowelMovement: v.bowelMovement ?? null,
    doseTakenToday: v.doseTakenToday ?? null,
    // For guidanceShown, undefined means "client didn't say" so we
    // preserve the existing value on update. Sending an explicit empty
    // object is treated as "reset acks for today".
    ...(v.guidanceShown !== undefined
      ? { guidanceShown: v.guidanceShown ?? {} }
      : {}),
  };
  // Upsert by (patient_user_id, date) so the patient can edit today's
  // entry without creating duplicates.
  const [row] = await db
    .insert(patientCheckinsTable)
    .values({
      patientUserId: userId,
      date: v.date,
      energy: v.energy,
      nausea: v.nausea,
      mood: v.mood,
      notes: v.notes ?? null,
      ...symptomFields,
    })
    .onConflictDoUpdate({
      target: [
        patientCheckinsTable.patientUserId,
        patientCheckinsTable.date,
      ],
      set: {
        energy: v.energy,
        nausea: v.nausea,
        mood: v.mood,
        notes: v.notes ?? null,
        ...symptomFields,
      },
    })
    .returning();
  res.status(201).json(row);
});

// PATCH /me/checkins/guidance -- mark the patient as having seen the
// in-app self-management guidance for one symptom on today's check-in
// row. Kept as its own endpoint so the tip card can fire-and-forget
// without rebuilding the full check-in payload.
const guidanceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptom: z.enum(["nausea", "constipation", "low_appetite"]),
});
router.patch("/checkins/guidance", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = guidanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { date, symptom } = parsed.data;
  const [existing] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, date),
      ),
    )
    .limit(1);
  if (!existing) {
    // We deliberately do NOT auto-create a check-in row here. The ack
    // is meaningful only against an actual day of data; otherwise we'd
    // tell the doctor "patient saw guidance" with no symptoms attached.
    res.status(404).json({ error: "no_checkin_today" });
    return;
  }
  const merged = { ...(existing.guidanceShown ?? {}), [symptom]: true };
  await db
    .update(patientCheckinsTable)
    .set({ guidanceShown: merged })
    .where(eq(patientCheckinsTable.id, existing.id));
  res.json({ ok: true, guidanceShown: merged });
});

// PATCH /me/checkins/trend -- patient answers the day-after follow-up
// "is this getting better, the same, or worse?" for one symptom.
// Returns 404 (silently ignorable) when there's no check-in row for
// the date, same as the guidance ack endpoint.
const trendSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptom: z.enum(["nausea", "constipation", "low_appetite"]),
  response: z.enum(["better", "same", "worse"]),
});
router.patch("/checkins/trend", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = trendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { date, symptom, response } = parsed.data;
  const [existing] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, date),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "no_checkin_today" });
    return;
  }
  const merged = { ...(existing.trendResponse ?? {}), [symptom]: response };
  await db
    .update(patientCheckinsTable)
    .set({ trendResponse: merged })
    .where(eq(patientCheckinsTable.id, existing.id));
  res.json({ ok: true, trendResponse: merged });
});

// PATCH /me/checkins/escalate -- patient explicitly asked the
// clinician to be aware of this symptom. Sticky: the doctor sees
// "Patient requested clinician" until the symptom resolves.
const escalateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptom: z.enum(["nausea", "constipation", "low_appetite"]),
});
router.patch("/checkins/escalate", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { date, symptom } = parsed.data;
  const [existing] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, date),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "no_checkin_today" });
    return;
  }
  const merged = { ...(existing.clinicianRequested ?? {}), [symptom]: true };
  await db
    .update(patientCheckinsTable)
    .set({ clinicianRequested: merged })
    .where(eq(patientCheckinsTable.id, existing.id));
  res.json({ ok: true, clinicianRequested: merged });
});

// -- Weekly weight log -------------------------------------------------
// Lives in its own table (patient_weights) and on its own cadence
// (every ~7 days), deliberately NOT inside the daily check-in payload.
// The mobile app calls /me/weights/latest on session start to decide
// whether to surface the weekly prompt; weeklyPromptDue flips true
// when the patient has no entry, or the latest entry is 7+ days old.

router.get("/weights/latest", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientWeightsTable)
    .where(eq(patientWeightsTable.patientUserId, userId))
    .orderBy(desc(patientWeightsTable.recordedAt))
    .limit(1);
  const latest = rows[0] ?? null;
  let daysSinceLast: number | null = null;
  if (latest) {
    const diffMs = Date.now() - new Date(latest.recordedAt).getTime();
    daysSinceLast = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  // Prompt the patient when they've never logged, or the last entry
  // is at least 7 days old. The "or" is important: a patient who has
  // never logged a weight should still see the prompt today.
  const weeklyPromptDue =
    daysSinceLast === null || daysSinceLast >= 7;
  res.json({
    latest: latest
      ? {
          weightLbs: latest.weightLbs,
          recordedAt: latest.recordedAt,
        }
      : null,
    daysSinceLast,
    weeklyPromptDue,
  });
});

const weightInputSchema = z.object({
  // Reasonable clinical bounds for adults in lbs. We do NOT validate
  // by patient (no kg path in MVP), so cap loosely to catch typos.
  weightLbs: z.number().positive().min(40).max(900),
});

router.post("/weights", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = weightInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [row] = await db
    .insert(patientWeightsTable)
    .values({
      patientUserId: userId,
      weightLbs: parsed.data.weightLbs,
    })
    .returning();
  res.status(201).json({
    id: row!.id,
    weightLbs: row!.weightLbs,
    recordedAt: row!.recordedAt,
  });
});

router.get("/risk", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, userId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(30);
  // Patient-facing /me/risk now includes symptomFlags so the mobile
  // app could render server-validated flags too -- today the app
  // computes tips client-side, but exposing the server view keeps the
  // contract symmetric with /patients/:id/risk.
  res.json({
    ...computeRisk(cks),
    symptomFlags: computeSymptomFlags(cks),
  });
});

// ---------------------------------------------------------------------
// Health daily summary. Mobile-side daily aggregation of HealthKit
// signals. Upsert by (patient, summaryDate). Every metric is nullable.
// We deliberately accept partial payloads so the mobile sync queue
// can post whatever it has without first reading the existing row.
// ---------------------------------------------------------------------
const healthSummarySchema = z.object({
  summaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().nonnegative().nullish(),
  sleepMinutes: z.number().int().nonnegative().nullish(),
  restingHeartRate: z.number().int().positive().max(300).nullish(),
  hrv: z.number().nonnegative().max(500).nullish(),
  activeCalories: z.number().int().nonnegative().nullish(),
  activeDay: z.boolean().nullish(),
  weightLbs: z.number().positive().min(40).max(900).nullish(),
  source: z.string().max(40).nullish(),
});

router.post("/health/daily-summary", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = healthSummarySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(patientHealthDailySummariesTable)
    .values({
      patientUserId: userId,
      summaryDate: d.summaryDate,
      steps: d.steps ?? null,
      sleepMinutes: d.sleepMinutes ?? null,
      restingHeartRate: d.restingHeartRate ?? null,
      hrv: d.hrv ?? null,
      activeCalories: d.activeCalories ?? null,
      activeDay: d.activeDay ?? null,
      weightLbs: d.weightLbs ?? null,
      source: d.source ?? null,
    })
    // Upsert by (patient, date). Nullable fields are coalesced so a
    // partial payload (e.g. weight-only sync) never zero-clobbers an
    // earlier full-day write.
    .onConflictDoUpdate({
      target: [
        patientHealthDailySummariesTable.patientUserId,
        patientHealthDailySummariesTable.summaryDate,
      ],
      set: {
        steps: sql`coalesce(excluded.steps, ${patientHealthDailySummariesTable.steps})`,
        sleepMinutes: sql`coalesce(excluded.sleep_minutes, ${patientHealthDailySummariesTable.sleepMinutes})`,
        restingHeartRate: sql`coalesce(excluded.resting_heart_rate, ${patientHealthDailySummariesTable.restingHeartRate})`,
        hrv: sql`coalesce(excluded.hrv, ${patientHealthDailySummariesTable.hrv})`,
        activeCalories: sql`coalesce(excluded.active_calories, ${patientHealthDailySummariesTable.activeCalories})`,
        activeDay: sql`coalesce(excluded.active_day, ${patientHealthDailySummariesTable.activeDay})`,
        weightLbs: sql`coalesce(excluded.weight_lbs, ${patientHealthDailySummariesTable.weightLbs})`,
        source: sql`coalesce(excluded.source, ${patientHealthDailySummariesTable.source})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.status(201).json(row);
});

router.get("/health/daily-summary/recent", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientHealthDailySummariesTable)
    .where(eq(patientHealthDailySummariesTable.patientUserId, userId))
    .orderBy(desc(patientHealthDailySummariesTable.summaryDate))
    .limit(30);
  res.json(rows);
});

// ---------------------------------------------------------------------
// Treatment log. Append-only patient-confirmed med history. Distinct
// from patients.glp1Drug / patients.dose which the doctor sets and
// which remain the source of truth for the dashboard.
// ---------------------------------------------------------------------
const treatmentLogSchema = z.object({
  medicationName: z.string().min(1).max(200),
  dose: z.number().positive().max(1000).nullish(),
  doseUnit: z.string().max(20).nullish(),
  frequency: z.string().max(40).nullish(),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

router.post("/treatment-log", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = treatmentLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(patientTreatmentLogsTable)
    .values({
      patientUserId: userId,
      medicationName: d.medicationName,
      dose: d.dose ?? null,
      doseUnit: d.doseUnit ?? null,
      frequency: d.frequency ?? null,
      startedOn: d.startedOn ?? null,
      source: "patient",
    })
    .returning();
  res.status(201).json(row);
});

router.get("/treatment-log/recent", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientTreatmentLogsTable)
    .where(eq(patientTreatmentLogsTable.patientUserId, userId))
    .orderBy(desc(patientTreatmentLogsTable.createdAt))
    .limit(30);
  res.json(rows);
});

// ---------------------------------------------------------------------
// Patient onboarding profile. One row per patient, blind-upsertable.
// We persist ONLY the fields the onboarding UI already collects --
// no extra PHI surface area beyond the existing in-app capture.
// ---------------------------------------------------------------------
const profileSchema = z.object({
  age: z.number().int().min(13).max(120).nullish(),
  sex: z.enum(["male", "female", "other"]).nullish(),
  heightInches: z.number().positive().max(120).nullish(),
  weightLbs: z.number().positive().min(40).max(900).nullish(),
  goalWeightLbs: z.number().positive().min(40).max(900).nullish(),
  units: z.enum(["imperial", "metric"]).nullish(),
  goals: z.array(z.string().max(60)).max(20).nullish(),
  glp1Medication: z.string().max(60).nullish(),
  glp1Reason: z.string().max(60).nullish(),
  glp1Duration: z.string().max(60).nullish(),
});

router.post("/profile", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(patientProfilesTable)
    .values({
      patientUserId: userId,
      age: d.age ?? null,
      sex: d.sex ?? null,
      heightInches: d.heightInches ?? null,
      weightLbs: d.weightLbs ?? null,
      goalWeightLbs: d.goalWeightLbs ?? null,
      units: d.units ?? null,
      goals: d.goals ?? [],
      glp1Medication: d.glp1Medication ?? null,
      glp1Reason: d.glp1Reason ?? null,
      glp1Duration: d.glp1Duration ?? null,
    })
    // Coalesce so a partial profile patch (e.g. units toggle only)
    // does not erase fields the onboarding flow has already captured.
    .onConflictDoUpdate({
      target: patientProfilesTable.patientUserId,
      set: {
        age: sql`coalesce(excluded.age, ${patientProfilesTable.age})`,
        sex: sql`coalesce(excluded.sex, ${patientProfilesTable.sex})`,
        heightInches: sql`coalesce(excluded.height_inches, ${patientProfilesTable.heightInches})`,
        weightLbs: sql`coalesce(excluded.weight_lbs, ${patientProfilesTable.weightLbs})`,
        goalWeightLbs: sql`coalesce(excluded.goal_weight_lbs, ${patientProfilesTable.goalWeightLbs})`,
        units: sql`coalesce(excluded.units, ${patientProfilesTable.units})`,
        // Goals overwrite the array (rather than coalesce) so a user
        // who deselects a goal sees it removed. Empty array is a
        // legitimate state.
        goals: sql`coalesce(excluded.goals, ${patientProfilesTable.goals})`,
        glp1Medication: sql`coalesce(excluded.glp1_medication, ${patientProfilesTable.glp1Medication})`,
        glp1Reason: sql`coalesce(excluded.glp1_reason, ${patientProfilesTable.glp1Reason})`,
        glp1Duration: sql`coalesce(excluded.glp1_duration, ${patientProfilesTable.glp1Duration})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json(row);
});

router.get("/profile", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const [row] = await db
    .select()
    .from(patientProfilesTable)
    .where(eq(patientProfilesTable.patientUserId, userId))
    .limit(1);
  if (!row) {
    res.json(null);
    return;
  }
  res.json(row);
});

export default router;
