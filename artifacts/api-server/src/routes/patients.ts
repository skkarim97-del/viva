import { Router, type Response } from "express";
import { and, eq, desc, gte, inArray, max } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  doctorNotesTable,
} from "@workspace/db";
import { requireDoctor, type AuthedRequest } from "../middlewares/auth";
import {
  computeRisk,
  deriveAction,
  deriveSignals,
  deriveSuggestedAction,
} from "../lib/risk";

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
      dose: patientsTable.dose,
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

  // Pull the most recent note timestamp per patient in a single grouped
  // query so the list view can show "Last note: 2d ago" without an
  // extra round trip. Surfacing this on the queue is what stops two
  // doctors from re-calling the same patient.
  const lastNoteRows =
    patientIds.length === 0
      ? []
      : await db
          .select({
            patientUserId: doctorNotesTable.patientUserId,
            last: max(doctorNotesTable.createdAt),
          })
          .from(doctorNotesTable)
          .where(inArray(doctorNotesTable.patientUserId, patientIds))
          .groupBy(doctorNotesTable.patientUserId);
  const lastNoteByPatient = new Map<number, string>();
  for (const r of lastNoteRows) {
    if (r.last) lastNoteByPatient.set(r.patientUserId, r.last as string);
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
      // Workflow state ("Needs follow-up" / "Monitor" / "Stable").
      // Computed server-side so the list and detail views agree and so
      // the dashboard can sort the queue without re-deriving the rule.
      action: deriveAction(risk.score, risk.rules, lastCheckin),
      // Up to two signals (primary + secondary) so two patients with
      // identical urgent signals don't read as visually identical.
      // E.g. ["No check-in for 3d", "Low energy trend (7d)"].
      signals: deriveSignals(risk.rules, lastCheckin),
      // ISO timestamp of the most recent care-team note, or null if
      // nobody has logged anything yet. The UI turns this into
      // "Last note: 2d ago" / "No recent action".
      lastNoteAt: lastNoteByPatient.get(p.id) ?? null,
    };
  });

  res.json(result);
});

// Helper: ensure a patient belongs to the calling doctor; throws 403 if not.
async function loadOwnedPatient(
  doctorId: number,
  patientId: number,
): Promise<{
  id: number;
  name: string;
  email: string;
  glp1Drug: string | null;
  dose: string | null;
  startedOn: string | null;
} | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      glp1Drug: patientsTable.glp1Drug,
      dose: patientsTable.dose,
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
    dose: row.dose,
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
  const risk = computeRisk(cks);
  const lastCheckin = cks[0]?.date ?? null;
  // Send the workflow state and the suggested action alongside the raw
  // risk so the detail page can render a directive without having to
  // re-derive the rules client-side.
  res.json({
    ...risk,
    action: deriveAction(risk.score, risk.rules, lastCheckin),
    suggestedAction: deriveSuggestedAction(risk.rules, lastCheckin),
  });
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
  // Join the author so the UI can render "Dr. Kim • 2m ago" without a
  // separate users lookup per note.
  const notes = await db
    .select({
      id: doctorNotesTable.id,
      patientUserId: doctorNotesTable.patientUserId,
      doctorUserId: doctorNotesTable.doctorUserId,
      doctorName: usersTable.name,
      body: doctorNotesTable.body,
      createdAt: doctorNotesTable.createdAt,
    })
    .from(doctorNotesTable)
    .innerJoin(usersTable, eq(usersTable.id, doctorNotesTable.doctorUserId))
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
  // Look up the author's display name so the response matches the GET
  // shape -- the UI can drop the row into its list without a refetch.
  const [author] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, doctorId))
    .limit(1);
  res.status(201).json({ ...created!, doctorName: author?.name ?? "" });
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
