// =====================================================================
// interventionState.ts  (Treatment Intelligence Layer)
// =====================================================================
// Additive-only foundation for the intervention lifecycle state machine.
//
// Phase 2D: audit + constants only. Nothing here is enforced at runtime
// yet -- routes still guard transitions individually. This file exists
// so the next cleanup pass has a single place to read the intended
// lifecycle and a typed constant to replace the duplicated inline sets.

import { PATIENT_INTERVENTION_STATUSES } from "@workspace/db";
import type { PatientInterventionStatus } from "@workspace/db";

// Re-export the DB type under a shorter local alias. Both names refer
// to the same underlying union -- callers can use either.
export type InterventionStatus = PatientInterventionStatus;

// Re-export the canonical DB array for callers that want the full list
// without importing directly from @workspace/db.
export { PATIENT_INTERVENTION_STATUSES };

// ---- Active set --------------------------------------------------------
//
// Statuses where the intervention is live: visible to the patient via
// GET /active and surfaced on the doctor worklist. This exact set is
// currently duplicated inline across patientInterventions.ts,
// clinicInterventions.ts, lib/interventionEngine/context.ts, and dev.ts.
// Centralised here so a future status addition only needs one edit.
export const ACTIVE_INTERVENTION_STATUSES = [
  "shown",
  "accepted",
  "pending_feedback",
  "escalated",
] as const satisfies readonly InterventionStatus[];

// ---- Terminal set -------------------------------------------------------
//
// Statuses from which no further patient-driven transition is intended.
//
// Implementation note: the current /escalate guard does NOT yet block
// dismissed → escalated or feedback_collected → escalated. Those paths
// look like implementation gaps vs spec intent (the spec lists escalate
// sources as {shown, accepted, pending_feedback} only). They are NOT
// included in VALID_INTERVENTION_TRANSITIONS below. A future guard
// tightening pass will make the route match this table.
export const TERMINAL_INTERVENTION_STATUSES = [
  "dismissed",
  "resolved",
  "feedback_collected",
  "expired",
] as const satisfies readonly InterventionStatus[];

export function isTerminalInterventionStatus(
  status: InterventionStatus,
): boolean {
  return (TERMINAL_INTERVENTION_STATUSES as readonly string[]).includes(status);
}

// ---- Transition table --------------------------------------------------
//
// Maps each status to the statuses reachable from it via the current
// route handlers. Includes explicit patient actions AND the two
// auto-transitions in /generate:
//   - shown      → dismissed  (auto-dismiss when symptoms clear)
//   - escalated  → resolved   (auto-resolve when symptoms change/clear)
//
// NOT enforced at runtime yet. Use canTransitionInterventionStatus()
// for read-only checks; it is intended to become the single enforcement
// point once all routes are migrated.
export const VALID_INTERVENTION_TRANSITIONS: Record<
  InterventionStatus,
  readonly InterventionStatus[]
> = {
  shown:              ["pending_feedback", "dismissed", "escalated"],
  accepted:           ["pending_feedback", "escalated"],
  pending_feedback:   ["feedback_collected", "resolved", "escalated", "expired"],
  feedback_collected: [],
  resolved:           [],
  dismissed:          [],
  escalated:          ["resolved"],
  expired:            [],
};

export function canTransitionInterventionStatus(
  from: InterventionStatus,
  to: InterventionStatus,
): boolean {
  return (VALID_INTERVENTION_TRANSITIONS[from] as readonly string[]).includes(
    to,
  );
}
