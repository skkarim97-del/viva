import { and, eq } from "drizzle-orm";
import { db, patientsTable } from "@workspace/db";

// canAccessPatient -- single source of truth for "is this doctor
// allowed to read/write this patient's PHI?".
//
// Why a dedicated helper:
//   * The inline `eq(patientsTable.doctorId, doctorId)` pattern is
//     scattered across patients.ts and careEvents.ts. A helper makes
//     it impossible to forget the second clause and surface a
//     cross-clinic patient row by accident.
//   * It returns a boolean (not the row), so callers that just need
//     a guard don't have to fetch and discard the whole patient
//     record. patients.ts keeps loadOwnedPatient as a separate
//     helper because most of its routes also want the row data.
//   * "Not yours" and "doesn't exist" are deliberately
//     indistinguishable -- both come back as `false`. Callers
//     should map false to a 404, never a 403, so a malicious
//     doctor cannot enumerate other clinics' patient ids by
//     timing or status code.
//
// Implementation note:
//   We intentionally do NOT consult an `isActive` or `treatmentStatus`
//   filter. A doctor still owns a stopped or paused patient and may
//   need to view their historical PHI for clinical follow-up; access
//   control here is strictly "is this doctor the assigned clinician".
//   Time-based revocation (e.g. former clinicians) is a future feature
//   tracked separately and out of scope for the pilot.
export async function canAccessPatient(
  doctorUserId: number,
  patientUserId: number,
): Promise<boolean> {
  if (
    !Number.isFinite(doctorUserId) ||
    doctorUserId <= 0 ||
    !Number.isFinite(patientUserId) ||
    patientUserId <= 0
  ) {
    return false;
  }
  const [row] = await db
    .select({ userId: patientsTable.userId })
    .from(patientsTable)
    .where(
      and(
        eq(patientsTable.userId, patientUserId),
        eq(patientsTable.doctorId, doctorUserId),
      ),
    )
    .limit(1);
  return !!row;
}
