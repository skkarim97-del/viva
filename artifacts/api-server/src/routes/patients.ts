import { Router, type Response } from "express";
import { and, eq, desc, gte } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  doctorNotesTable,
} from "@workspace/db";
import { requireDoctor, type AuthedRequest } from "../middlewares/auth";
import { computeRisk } from "../lib/risk";

const router: Router = Router();

router.use(requireDoctor);

// GET /patients -- list every patient assigned to the calling doctor, with
// last-checkin date and computed risk band so the dashboard list view can
// render risk badges without N+1 round trips.
router.get("/", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      glp1Drug: patientsTable.glp1Drug,
      startedOn: patientsTable.startedOn,
    })
    .from(patientsTable)
    .innerJoin(usersTable, eq(usersTable.id, patientsTable.userId))
    .where(eq(patientsTable.doctorId, doctorId));

  // Pull last 14 days of check-ins for all patients in one query, then
  // group in memory. Keeps it simple while avoiding the per-patient query.
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const cutoff = fourteenDaysAgo.toISOString().split("T")[0]!;

  const patientIds = rows.map((r) => r.id);
  const checkins =
    patientIds.length === 0
      ? []
      : await db
          .select()
          .from(patientCheckinsTable)
          .where(gte(patientCheckinsTable.date, cutoff));

  const byPatient = new Map<number, typeof checkins>();
  for (const c of checkins) {
    if (!patientIds.includes(c.patientUserId)) continue;
    const arr = byPatient.get(c.patientUserId) ?? [];
    arr.push(c);
    byPatient.set(c.patientUserId, arr);
  }

  const result = rows.map((p) => {
    const cks = byPatient.get(p.id) ?? [];
    const risk = computeRisk(cks);
    const lastCheckin =
      cks.length > 0
        ? cks.reduce((acc, c) => (c.date > acc ? c.date : acc), cks[0]!.date)
        : null;
    return {
      ...p,
      lastCheckin,
      riskScore: risk.score,
      riskBand: risk.band,
    };
  });

  res.json(result);
});

// Helper: ensure a patient belongs to the calling doctor; throws 403 if not.
async function loadOwnedPatient(
  doctorId: number,
  patientId: number,
): Promise<{ id: number; name: string; email: string; glp1Drug: string | null; startedOn: string | null } | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      glp1Drug: patientsTable.glp1Drug,
      startedOn: patientsTable.startedOn,
      doctorId: patientsTable.doctorId,
    })
    .from(patientsTable)
    .innerJoin(usersTable, eq(usersTable.id, patientsTable.userId))
    .where(eq(patientsTable.userId, patientId))
    .limit(1);
  if (!row || row.doctorId !== doctorId) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    glp1Drug: row.glp1Drug,
    startedOn: row.startedOn,
  };
}

router.get("/:id", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(patient);
});

router.get("/:id/checkins", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, patientId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(60);
  res.json(cks);
});

router.get("/:id/risk", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, patientId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(30);
  res.json(computeRisk(cks));
});

router.get("/:id/notes", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const notes = await db
    .select()
    .from(doctorNotesTable)
    .where(eq(doctorNotesTable.patientUserId, patientId))
    .orderBy(desc(doctorNotesTable.createdAt));
  res.json(notes);
});

const noteSchema = z.object({ body: z.string().min(1).max(5000) });

router.post("/:id/notes", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [created] = await db
    .insert(doctorNotesTable)
    .values({
      patientUserId: patientId,
      doctorUserId: doctorId,
      body: parsed.data.body.trim(),
    })
    .returning();
  res.status(201).json(created);
});

router.delete("/:patientId/notes/:noteId", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.patientId);
  const noteId = Number(req.params.noteId);
  if (!Number.isFinite(patientId) || !Number.isFinite(noteId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Only the author can delete; another doctor on the same patient cannot
  // remove a peer's note.
  const result = await db
    .delete(doctorNotesTable)
    .where(
      and(
        eq(doctorNotesTable.id, noteId),
        eq(doctorNotesTable.patientUserId, patientId),
        eq(doctorNotesTable.doctorUserId, doctorId),
      ),
    )
    .returning();
  if (result.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
