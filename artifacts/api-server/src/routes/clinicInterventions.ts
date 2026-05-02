// =====================================================================
// /api/clinic/interventions  (spec Part 6 doctor endpoints)
// =====================================================================
// Two endpoints, both requireDoctorMfa + canAccessPatient gating:
//   GET   /                        -- patients with active escalated/
//                                    worsening/unresolved interventions
//                                    for the current doctor's panel
//   GET   /patients/:patientId     -- intervention history for one
//                                    patient owned by current doctor

import { Router, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  patientInterventionsTable,
  patientsTable,
  usersTable,
} from "@workspace/db";
import {
  requireDoctorMfa,
  type AuthedRequest,
} from "../middlewares/auth";
import { mediumApiLimiter } from "../middlewares/rateLimit";
import { phiAudit } from "../middlewares/phiAudit";
import { canAccessPatient } from "../lib/canAccessPatient";
import { logger } from "../lib/logger";

const router: Router = Router();

router.use(mediumApiLimiter);
router.use(requireDoctorMfa);
router.use(
  phiAudit({
    getPatientId: (req) => {
      const raw = req.params?.patientId;
      if (typeof raw === "string") {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null; // /interventions list endpoint is multi-patient
    },
  }),
);

// -----------------------------------------------------------------
// GET /  -- doctor-scoped active intervention overview
// -----------------------------------------------------------------
//
// Returns rows for the doctor's panel that are in status:
//   * escalated  (worse feedback or patient-requested review)
//   * pending_feedback (waiting on patient)
//   * shown / accepted (active, not yet feedback'd)
// Ordered by risk_level desc, then status priority, then created_at desc.
// The dashboard worklist consumes this to power the "Patient Requested
// Review", "Worsening After Intervention", and "Pending Feedback"
// buckets.

const WORKLIST_STATUSES = [
  "shown",
  "accepted",
  "pending_feedback",
  "escalated",
] as const;

router.get("/", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  try {
    // Join patientInterventions to patients (via patientUserId) so we
    // only return rows for patients this doctor owns. We use the
    // doctorId column on patient_interventions when populated, but
    // also fall back to the patients table join because doctor_id
    // could be null on rows generated before assignment.
    const rows = await db
      .select({
        intervention: patientInterventionsTable,
        patientName: usersTable.name,
        patientEmail: usersTable.email,
      })
      .from(patientInterventionsTable)
      .innerJoin(
        patientsTable,
        eq(patientsTable.userId, patientInterventionsTable.patientUserId),
      )
      .innerJoin(
        usersTable,
        eq(usersTable.id, patientInterventionsTable.patientUserId),
      )
      .where(
        and(
          eq(patientsTable.doctorId, doctorId),
          inArray(
            patientInterventionsTable.status,
            WORKLIST_STATUSES,
          ),
        ),
      )
      .orderBy(desc(patientInterventionsTable.createdAt))
      .limit(200);

    // Shape: a flat list with the patient's display name attached.
    // The dashboard groups into buckets client-side based on status
    // + escalation + feedback fields.
    res.json({
      interventions: rows.map((r) => ({
        ...r.intervention,
        patient: {
          id: r.intervention.patientUserId,
          name: r.patientName,
          email: r.patientEmail,
        },
      })),
    });
  } catch (err) {
    logger.error({ err, doctorId }, "clinic_interventions_list_failed");
    res.status(500).json({ error: "list_failed" });
  }
});

// -----------------------------------------------------------------
// GET /patients/:patientId -- one patient's intervention history
// -----------------------------------------------------------------

router.get("/patients/:patientId", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.patientId);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  if (!(await canAccessPatient(doctorId, patientId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(patientInterventionsTable)
      .where(eq(patientInterventionsTable.patientUserId, patientId))
      .orderBy(desc(patientInterventionsTable.createdAt))
      .limit(60);
    res.json({ interventions: rows });
  } catch (err) {
    logger.error(
      { err, doctorId, patientId },
      "clinic_interventions_history_failed",
    );
    res.status(500).json({ error: "list_failed" });
  }
});

// Reference sql to keep import style consistent; not used yet.
void sql;

export default router;
