// =====================================================================
// engagement.service.ts  (Patient Context Layer)
// =====================================================================
// Pure predicates and computations for patient engagement state.
// All functions are side-effect free and injectable with a `now` date
// so they are trivially testable without mocking the system clock.
//
// None of these functions touch the database. Callers are responsible
// for providing pre-fetched data (last check-in date, activation
// timestamp, open-workflow flag).

import {
  ACTIVITY_THRESHOLD_DAYS,
  STALE_INVITE_HOURS,
} from "../shared/constants";

// ---- Archive status ---------------------------------------------------

/**
 * A patient is "archived" when their treatment is stopped AND they have
 * no unresolved workflow item (escalation without a doctor review or
 * follow-up). Archived patients are hidden from the active dashboard
 * queue by default but remain accessible via patient detail.
 *
 * @param treatmentStatus  The patient's current treatment_status value.
 * @param hasOpenWorkflow  True when careEventsTable shows an
 *   escalation_requested with no later doctor_reviewed or
 *   follow_up_completed for this patient. Caller computes this from
 *   the bulk workflow query.
 */
export function isPatientArchived(
  treatmentStatus: string,
  hasOpenWorkflow: boolean,
): boolean {
  return treatmentStatus === "stopped" && !hasOpenWorkflow;
}

// ---- Inactivity flag --------------------------------------------------

/**
 * A patient is considered "inactive" when:
 *   1. Their treatment_status is "active" or "unknown" (patients who
 *      have stopped or are pending don't get flagged here).
 *   2. They were activated more than ACTIVITY_THRESHOLD_DAYS ago
 *      (newly enrolled patients get a grace window before the flag
 *      fires).
 *   3. Their last check-in date is older than ACTIVITY_THRESHOLD_DAYS,
 *      or they have never checked in.
 *
 * @param treatmentStatus   The patient's current treatment_status value.
 * @param activatedAt       The patient's activatedAt timestamp (any
 *   value accepted by `new Date()`). Pass null/undefined for pending
 *   patients who haven't activated yet.
 * @param lastCheckinDate   YYYY-MM-DD string of the most recent check-in,
 *   or null/undefined if the patient has never checked in.
 * @param now               Injected "current" date; defaults to
 *   `new Date()`. Pass the same value for all patients in a single
 *   request so the cutoff is consistent within a list render.
 */
export function isPatientInactive(
  treatmentStatus: string,
  activatedAt: unknown,
  lastCheckinDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (treatmentStatus !== "active" && treatmentStatus !== "unknown") {
    return false;
  }
  if (!activatedAt) return false;

  const activityCutoff = new Date(now);
  activityCutoff.setDate(activityCutoff.getDate() - ACTIVITY_THRESHOLD_DAYS);
  const activityCutoffDateStr = activityCutoff.toISOString().split("T")[0]!;

  const activatedTs = new Date(activatedAt as string).getTime();
  if (activatedTs > activityCutoff.getTime()) return false;

  // Never checked in, or last check-in is on or before the cutoff date.
  return !lastCheckinDate || lastCheckinDate <= activityCutoffDateStr;
}

// ---- Invite age -------------------------------------------------------

/**
 * Compute the age of a pending patient invite from its issuance
 * timestamp. Used by the doctor dashboard to surface a "stale invite"
 * chip when an invite has been sitting unclaimed longer than
 * STALE_INVITE_HOURS.
 *
 * Returns:
 *   inviteAgeHours  Integer hours since the token was issued, clamped
 *     to >= 0. Null when activationTokenIssuedAt is missing or not a
 *     valid date (bad rows must not serialize as NaN or trip the stale
 *     chip with a negative age).
 *   staleInvite     True when inviteAgeHours >= STALE_INVITE_HOURS.
 *
 * @param activationTokenIssuedAt  Raw value from the DB row (any type
 *   accepted by `new Date()`).
 * @param now  Injected "current" date; defaults to `new Date()`. Pass
 *   the same value for all patients in a single list render so the age
 *   is consistent across the response.
 */
export function computeInviteAge(
  activationTokenIssuedAt: unknown,
  now: Date = new Date(),
): { inviteAgeHours: number | null; staleInvite: boolean } {
  const issuedRaw = activationTokenIssuedAt
    ? new Date(activationTokenIssuedAt as string).getTime()
    : NaN;
  const inviteAgeHours = Number.isFinite(issuedRaw)
    ? Math.max(0, Math.floor((now.getTime() - issuedRaw) / (1000 * 60 * 60)))
    : null;
  const staleInvite = inviteAgeHours !== null && inviteAgeHours >= STALE_INVITE_HOURS;
  return { inviteAgeHours, staleInvite };
}
