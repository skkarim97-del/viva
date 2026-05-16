/**
 * Shared types for the structured adaptive intervention library.
 * Import from here; library.ts and selector.ts both depend on these.
 */

export type StrategyType =
  | "hydration-first"
  | "food-first"
  | "posture-upright-reset"
  | "low-stimulation-reset"
  | "gentle-movement"
  | "warm-fluid-digestion"
  | "rest-recovery-reset"
  | "sleep-downshift"
  | "escalation-readiness";

export type BehavioralBurden = "low" | "medium";

export type SymptomTarget =
  | "nausea"
  | "appetite"
  | "energy"
  | "digestion"
  | "sleep"
  | "hydration";

export type SeverityTier = "mild" | "moderate" | "severe";

/**
 * Recommendation ladder — classifies each selection into one of four states.
 *
 * Future AI planner: this type would become the output of a model that
 * learns patient-specific response patterns. The rule-based selector
 * (selector.ts) produces the same shape so the card layer needs no changes.
 */
export type InterventionRecommendationState =
  | "first_line_support"  // new or mild symptom, no strong prior history
  | "repeat_success"      // same symptom, prior strategy helped — reuse it
  | "try_alternative"     // prior strategy didn't help — try a different approach
  | "escalate";           // repeated failure or worsening — care team pathway

/** One structured entry in the curated intervention library. */
export interface LibraryEntry {
  /** Stable kebab-case identifier. Never reuse a retired id. */
  id: string;
  strategyType: StrategyType;
  symptomTargets: SymptomTarget[];
  severityTiers: SeverityTier[];
  behavioralBurden: BehavioralBurden;
  /** How long before the patient should check back in. */
  expectedFeedbackWindowMinutes: number;
  // Semantic flags for scoring and eligibility filtering
  hydrationRelated: boolean;
  foodRelated: boolean;
  movementRelated: boolean;
  nervousSystemRelated: boolean;
  recoveryFocused: boolean;
  /** Especially relevant in the 1–2 days after a dose or titration. */
  postDoseRelevant: boolean;
  /** Suppress when appetite is very low (patient cannot tolerate food prompts). */
  avoidIfLowAppetite: boolean;
  /** Suppress when nausea is severe (food or movement may worsen symptoms). */
  avoidIfSevereNausea: boolean;
  /** True when the intervention is aimed at preventing an escalation. */
  escalationPrevention: boolean;
  exampleContextTriggers: string[];
  copy: {
    title: string;
    body: string;
    /** Short rationale or safety note shown beneath the body. */
    helper: string;
  };
}

/**
 * Signals available at the moment of intervention selection.
 *
 * Future AI planner inputs (same contract, richer implementation):
 *  - patient context + medication stage
 *  - prior intervention outcomes (successfulStrategyTypes, failedStrategyTypes)
 *  - recent trends (symptomRecurring7d, lowSleep, lowHrv)
 *  - safety guardrails (hasSevereNausea, hasVeryLowAppetite)
 *  - dose context (doseTier, recentDoseChange, postDose)
 */
export interface LibraryContext {
  primarySymptom: SymptomTarget;
  severityTier: SeverityTier;
  hasSevereNausea: boolean;
  hasLowAppetite: boolean;
  hasVeryLowAppetite: boolean;
  hydrationLow: boolean;
  /** Whether the current day is within 2 days of the most recent dose. */
  postDose: boolean;
  lowSleep: boolean;
  lowHrv: boolean;
  /** True when the primary symptom appeared 3+ times in the past 7 days. */
  symptomRecurring7d: boolean;
  /** Stable tie-breaking seed (e.g. interventionId + dayIndex mod 100). */
  seed: number;
  // In-session history (cleared when card unmounts)
  lastEntryId: string | null;
  failedStrategyTypes: StrategyType[];
  successfulStrategyTypes: StrategyType[];
  // Dose context — influences scoring and explainability copy
  doseTier: "low" | "mid" | "high" | null;
  recentDoseChange: boolean;
  // Cross-session history signals (sourced from history.ts deriveWeights)
  priorFailureCount7d: number;
  priorWorseCount7d: number;
}

/**
 * Result of a single intervention selection.
 *
 * Future AI planner outputs (same contract, richer implementation):
 *  - state: classification from model (same type)
 *  - rationale: model-generated but safety-reviewed sentence
 *  - patternInsight: pattern observation from longitudinal data
 *  - shouldEscalate: model confidence threshold + safety rule
 *  - escalationReason: structured reason for clinical summary
 *  - confidence: 0–1 model confidence score (not exposed in v1)
 *  - providerSummary: "Recurring nausea. Hydration helped once. Review requested."
 */
export interface SelectionResult {
  entry: LibraryEntry;
  /** Recommendation ladder state — drives copy and escalation UI. */
  state: InterventionRecommendationState;
  /** Always non-null. Explains why this specific intervention was selected. */
  rationale: string;
  /** Pattern observation — only set when real data supports it, else null. */
  patternInsight: string | null;
  /** True when this selection is an alternative after a prior strategy failed. */
  isAlternativeAfterFailure: boolean;
  /** True when history signals repeated failure — show care team pathway. */
  shouldEscalate: boolean;
  /** Structured reason for escalation. Null when shouldEscalate is false. */
  escalationReason: "symptoms_reported_worse" | "repeated_no_change" | "care_team_requested" | null;
}
