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

/** Signals available at the moment of intervention selection. */
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
  /** Stable tie-breaking seed (e.g. interventionId + dayIndex mod 100). */
  seed: number;
  // In-session history (cleared when card unmounts)
  lastEntryId: string | null;
  failedStrategyTypes: StrategyType[];
  successfulStrategyTypes: StrategyType[];
  // Dose context — influences scoring and explainability copy
  doseTier: "low" | "mid" | "high" | null;
  recentDoseChange: boolean;
}

export interface SelectionResult {
  entry: LibraryEntry;
  /** One-sentence explainability note. Null when context is obvious. */
  explainWhy: string | null;
}
