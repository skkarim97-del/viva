// =====================================================================
// riskScoring.service.ts  (Treatment Intelligence Layer)
// =====================================================================
// Entry point for churn-risk scoring in the treatment intelligence
// layer. During Phase 1 of the cleanup pass, this is a thin re-export
// wrapper — all scoring logic remains in lib/risk.ts unchanged.
//
// Callers should import from here; direct imports from lib/risk.ts
// will be migrated to this path in Phase 2.

export {
  computeRisk,
  deriveAction,
  deriveSignals,
  deriveSuggestedAction,
} from "../../lib/risk";

export type { RiskBand, Action, FiredRule, RiskResult } from "../../lib/risk";
