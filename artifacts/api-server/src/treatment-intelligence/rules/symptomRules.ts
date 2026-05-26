// =====================================================================
// symptomRules.ts  (Treatment Intelligence Layer)
// =====================================================================
// Entry point for symptom flag computation and escalation rules in the
// treatment intelligence layer. During Phase 1 of the cleanup pass,
// this is a thin re-export wrapper — all logic remains in
// lib/symptoms.ts unchanged.
//
// Callers should import from here; direct imports from lib/symptoms.ts
// will be migrated to this path in Phase 2.

export {
  computeSymptomFlags,
  symptomsRequireFollowup,
  summarizeFlagForList,
} from "../../lib/symptoms";

export type {
  Symptom,
  Persistence,
  SymptomSeverity,
  TrendResponse,
  SymptomFlag,
} from "../../lib/symptoms";
