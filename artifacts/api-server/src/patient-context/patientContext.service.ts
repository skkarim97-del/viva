// =====================================================================
// patientContext.service.ts  (Patient Context Layer)
// =====================================================================
// Entry point for assembling a patient's longitudinal context snapshot.
// During Phase 1 of the cleanup pass, this is a thin re-export wrapper
// — all DB query logic remains in lib/interventionEngine/context.ts
// unchanged.
//
// The patient context snapshot is PHI-bearing and must never cross
// the OpenAI boundary. Only the treatment intelligence layer (via the
// intervention engine orchestrator) is allowed to read it.
//
// Callers should import from here; direct imports from
// lib/interventionEngine/context.ts will be migrated in Phase 2.

export { buildPatientInterventionContext } from "../lib/interventionEngine/context";

export type { PatientInterventionContext } from "../lib/interventionEngine/context";
