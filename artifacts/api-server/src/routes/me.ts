import { Router, type Response } from "express";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, patientCheckinsTable } from "@workspace/db";
import { requirePatient, type AuthedRequest } from "../middlewares/auth";
import { computeRisk } from "../lib/risk";
import { computeSymptomFlags } from "../lib/symptoms";

const router: Router = Router();
router.use(requirePatient);

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

export default router;
