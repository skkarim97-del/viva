import { Router, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, patientCheckinsTable } from "@workspace/db";
import { requirePatient, type AuthedRequest } from "../middlewares/auth";
import { computeRisk } from "../lib/risk";

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

const checkinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.enum(["depleted", "tired", "good", "great"]),
  nausea: z.enum(["none", "mild", "moderate", "severe"]),
  mood: z.number().int().min(1).max(5),
  notes: z.string().max(2000).nullish(),
});

router.post("/checkins", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const v = parsed.data;
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
      },
    })
    .returning();
  res.status(201).json(row);
});

router.get("/risk", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, userId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(30);
  res.json(computeRisk(cks));
});

export default router;
