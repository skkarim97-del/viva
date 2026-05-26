// =====================================================================
// triggerDetection.ts  (Treatment Intelligence Layer)
// =====================================================================
// Entry point for intervention trigger detection in the treatment
// intelligence layer. During Phase 1 of the cleanup pass, this is a
// thin re-export wrapper — all logic remains in
// lib/interventionEngine/triggers.ts unchanged.
//
// Callers should import from here; direct imports from
// lib/interventionEngine/triggers.ts will be migrated in Phase 2.

export {
  detectInterventionTriggers,
  detectCosignals,
  pickBestTrigger,
  pickRelevantTriggers,
} from "../../lib/interventionEngine/triggers";

export type {
  DetectedTrigger,
  Cosignal,
} from "../../lib/interventionEngine/triggers";
