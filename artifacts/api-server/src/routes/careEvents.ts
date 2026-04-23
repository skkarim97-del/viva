import { Router, type Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  careEventsTable,
  patientsTable,
  usersTable,
  CARE_EVENT_TYPES,
} from "@workspace/db";
import {
  requireAuth,
  requirePatient,
  requireDoctor,
  type AuthedRequest,
} from "../middlewares/auth";
import { logger } from "../lib/logger";

// ----------------------------------------------------------------------
// /care-events -- the dual-layer intervention event stream.
//
// Routes:
//   POST   /                  patient: batch-log viva/patient events
//   POST   /:patientId/reviewed   doctor: log doctor_reviewed
//   GET    /:patientId        doctor:  list recent events + escalationOpen
//
// Doctor-side `doctor_note` and `treatment_status_updated` events are
// written from the existing /patients/:id/notes and /patients/:id/
// treatment-status routes (see patients.ts) -- this router doesn't
// duplicate those write paths, only the read.
// ----------------------------------------------------------------------

const router: Router = Router();

// ---- patient: batched log -------------------------------------------
//
// The mobile client posts events as the patient interacts with the app.
// We force the SOURCE based on the type so the client cannot lie about
// who emitted it (a patient cannot post a doctor_note, etc.).

const PATIENT_EVENT_TYPES = [
  "coach_message",
  "recommendation_shown",
  "escalation_requested",
  // Patient self-report after trying a Today symptom tip. Source is
  // forced to "patient" so the actor attribution stays honest.
  "intervention_feedback",
] as const;
type PatientEventType = (typeof PATIENT_EVENT_TYPES)[number];

const SOURCE_BY_TYPE: Record<PatientEventType, "viva" | "patient"> = {
  coach_message: "viva",
  recommendation_shown: "viva",
  escalation_requested: "patient",
  intervention_feedback: "patient",
};

const patientEventSchema = z.object({
  type: z.enum(PATIENT_EVENT_TYPES),
  metadata: z.record(z.unknown()).nullish(),
});

const patientLogSchema = z.object({
  events: z.array(patientEventSchema).min(1).max(50),
});

router.post("/", requirePatient, async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = patientLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const rows = parsed.data.events.map((e) => ({
      patientUserId: userId,
      // Patient-driven escalation gets actorUserId=patient. The viva-
      // emitted "I rendered a coach message" gets actorUserId=null
      // because no human took the action.
      actorUserId: SOURCE_BY_TYPE[e.type] === "patient" ? userId : null,
      source: SOURCE_BY_TYPE[e.type],
      type: e.type,
      metadata: e.metadata ?? null,
    }));
    await db.insert(careEventsTable).values(rows);
    res.json({ ok: true, inserted: rows.length });
  } catch (err) {
    logger.error({ err, userId }, "care_events_log_failed");
    res.status(500).json({ error: "log_failed" });
  }
});

// ---- doctor: mark reviewed ------------------------------------------
//
// Cheap one-shot. Logs a doctor_reviewed care event for the patient
// the doctor owns. Idempotent in spirit -- the funnel uses the most
// recent doctor_reviewed per patient -- but we don't dedupe, since
// repeated reviews are themselves a useful signal.

async function ownsPatient(
  doctorId: number,
  patientId: number,
): Promise<boolean> {
  const rows = await db
    .select({ userId: patientsTable.userId })
    .from(patientsTable)
    .where(
      and(
        eq(patientsTable.userId, patientId),
        eq(patientsTable.doctorId, doctorId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---- doctor: mark follow-up completed -------------------------------
//
// The explicit "I actually followed up with this patient" signal --
// distinct from doctor_reviewed (which only acknowledges the
// escalation was seen). We link the follow-up back to the most recent
// escalation_requested for this patient via trigger_event_id so the
// analytics funnel can compute time-to-follow-up. If the patient has
// never escalated, we still log the event with trigger_event_id NULL
// (the doctor may be following up on a non-escalation reason); the
// analytics queries gate on the trigger so unlinked rows don't pollute
// the time-to-follow-up averages.

router.post(
  "/:patientId/follow-up-completed",
  requireDoctor,
  async (req, res: Response) => {
    const doctorId = (req as AuthedRequest).auth.userId;
    const patientId = Number(req.params.patientId);
    if (!Number.isFinite(patientId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    if (!(await ownsPatient(doctorId, patientId))) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      // Find the most-recent escalation for linkage. We pick the
      // newest escalation regardless of whether it was previously
      // marked reviewed -- the doctor is following up on it now.
      const triggerRows = await db
        .select({ id: careEventsTable.id })
        .from(careEventsTable)
        .where(
          and(
            eq(careEventsTable.patientUserId, patientId),
            eq(careEventsTable.type, "escalation_requested"),
          ),
        )
        .orderBy(desc(careEventsTable.occurredAt))
        .limit(1);
      const triggerEventId = triggerRows[0]?.id ?? null;
      const [created] = await db
        .insert(careEventsTable)
        .values({
          patientUserId: patientId,
          actorUserId: doctorId,
          source: "doctor",
          type: "follow_up_completed",
          triggerEventId,
          metadata: null,
        })
        .returning();
      res.status(201).json(created);
    } catch (err) {
      logger.error(
        { err, doctorId, patientId },
        "care_events_follow_up_failed",
      );
      res.status(500).json({ error: "follow_up_failed" });
    }
  },
);

router.post(
  "/:patientId/reviewed",
  requireDoctor,
  async (req, res: Response) => {
    const doctorId = (req as AuthedRequest).auth.userId;
    const patientId = Number(req.params.patientId);
    if (!Number.isFinite(patientId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    if (!(await ownsPatient(doctorId, patientId))) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      const [created] = await db
        .insert(careEventsTable)
        .values({
          patientUserId: patientId,
          actorUserId: doctorId,
          source: "doctor",
          type: "doctor_reviewed",
          metadata: null,
        })
        .returning();
      res.status(201).json(created);
    } catch (err) {
      logger.error(
        { err, doctorId, patientId },
        "care_events_review_failed",
      );
      res.status(500).json({ error: "review_failed" });
    }
  },
);

// ---- doctor: read patient timeline ----------------------------------
//
// Returns recent events (last 60d, capped) plus a derived
// `escalationOpen` flag: true iff the most recent escalation_requested
// is newer than the most recent doctor_reviewed (or no review yet).

router.get("/:patientId", requireAuth, async (req, res: Response) => {
  const auth = (req as AuthedRequest).auth;
  const patientId = Number(req.params.patientId);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  // Patients can read their own; doctors only patients they own.
  if (auth.role === "patient" && auth.userId !== patientId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (auth.role === "doctor" && !(await ownsPatient(auth.userId, patientId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const rows = await db
    .select({
      id: careEventsTable.id,
      patientUserId: careEventsTable.patientUserId,
      actorUserId: careEventsTable.actorUserId,
      actorName: usersTable.name,
      source: careEventsTable.source,
      type: careEventsTable.type,
      occurredAt: careEventsTable.occurredAt,
      metadata: careEventsTable.metadata,
    })
    .from(careEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, careEventsTable.actorUserId))
    .where(
      and(
        eq(careEventsTable.patientUserId, patientId),
        gte(careEventsTable.occurredAt, since),
      ),
    )
    .orderBy(desc(careEventsTable.occurredAt))
    .limit(200);

  // Derive escalationOpen from dedicated max() queries rather than the
  // capped timeline above: a noisy patient (lots of coach_message /
  // recommendation_shown rows) could otherwise push the escalation or
  // review event out of the window and break banner state.
  const stateRows = await db.execute(sql`
    select
      max(case when type = 'escalation_requested' then occurred_at end) as last_escalation_at,
      max(case when type = 'doctor_reviewed'      then occurred_at end) as last_review_at,
      max(case when type = 'follow_up_completed'  then occurred_at end) as last_follow_up_at
    from care_events
    where patient_user_id = ${patientId}
  `);
  const stateRow = (stateRows.rows?.[0] ?? {}) as {
    last_escalation_at?: string | Date | null;
    last_review_at?: string | Date | null;
    last_follow_up_at?: string | Date | null;
  };
  const lastEscalationAt = stateRow.last_escalation_at
    ? new Date(stateRow.last_escalation_at)
    : null;
  const lastReviewAt = stateRow.last_review_at
    ? new Date(stateRow.last_review_at)
    : null;
  const lastFollowUpAt = stateRow.last_follow_up_at
    ? new Date(stateRow.last_follow_up_at)
    : null;
  const escalationOpen =
    !!lastEscalationAt &&
    (!lastReviewAt || lastReviewAt < lastEscalationAt);
  // followUpPending = there's an escalation that hasn't been
  // followed-up on yet. Drives whether we show the "Follow-up
  // completed" button. Independent of reviewed state -- doctors
  // routinely review (acknowledge) before the actual follow-up call.
  const followUpPending =
    !!lastEscalationAt &&
    (!lastFollowUpAt || lastFollowUpAt < lastEscalationAt);

  res.json({
    escalationOpen,
    lastEscalationAt: lastEscalationAt?.toISOString() ?? null,
    lastReviewAt: lastReviewAt?.toISOString() ?? null,
    lastFollowUpAt: lastFollowUpAt?.toISOString() ?? null,
    followUpPending,
    events: rows,
  });
});

// ---- doctor: ids of own patients with an open escalation ------------
//
// Cheap lookup the worklist uses to badge rows. Returns just the ids
// to keep the response tiny; the full event stream is per-patient.

router.get("/_ids/needs-review", requireDoctor, async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  // Pull most-recent escalation per patient and most-recent review per
  // patient, then keep the ones the doctor owns where escalation is
  // newer than review (or no review yet).
  const result = await db.execute(sql`
    with own_patients as (
      select user_id from patients where doctor_id = ${doctorId}
    ),
    last_esc as (
      select patient_user_id, max(occurred_at) as ts
      from care_events
      where type = 'escalation_requested'
      group by patient_user_id
    ),
    last_rev as (
      select patient_user_id, max(occurred_at) as ts
      from care_events
      where type = 'doctor_reviewed'
      group by patient_user_id
    )
    select op.user_id as patient_id
    from own_patients op
    join last_esc le on le.patient_user_id = op.user_id
    left join last_rev lr on lr.patient_user_id = op.user_id
    where lr.ts is null or lr.ts < le.ts
  `);
  const ids = (result.rows as Array<Record<string, unknown>>).map((r) =>
    Number(r.patient_id),
  );
  res.json({ ids });
});

export default router;
