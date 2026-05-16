/**
 * Contextual intervention selector.
 *
 * Converts patient context signals into a ranked intervention choice
 * from the library. All logic is rule-based and deterministic — no AI,
 * no randomness, no open-ended advice generation.
 *
 * Recommendation ladder (classifyState):
 *   first_line_support → new or mild symptom, no strong prior history
 *   repeat_success     → same symptom, prior strategy helped — reuse it
 *   try_alternative    → prior strategy didn't help — different approach
 *   escalate           → repeated failure or worsening — care team pathway
 *
 * Two selection modes:
 *  - "initial"  → picks the best-fit intervention from the full library
 *  - "adjusted" → excludes all failed strategy types and the last shown
 *                 entry, forcing a meaningfully different strategy
 *
 * Future AI planner upgrade path:
 *   Replace selectIntervention() with a server call that accepts LibraryContext
 *   and returns SelectionResult. The card layer is unchanged — it reads the
 *   same output shape. The rule-based fallback remains as a safety net when
 *   the model is unavailable or returns low confidence.
 */

import type {
  InterventionRecommendationState,
  LibraryContext,
  LibraryEntry,
  SelectionResult,
  StrategyType,
  SymptomTarget,
} from "./types";
import { LIBRARY } from "./library";

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function isEligible(
  entry: LibraryEntry,
  ctx: LibraryContext,
  mode: "initial" | "adjusted",
): boolean {
  if (entry.id === ctx.lastEntryId) return false;
  if (entry.avoidIfLowAppetite && ctx.hasVeryLowAppetite) return false;
  if (entry.avoidIfSevereNausea && ctx.hasSevereNausea) return false;
  if (!entry.severityTiers.includes(ctx.severityTier)) return false;
  if (!entry.symptomTargets.includes(ctx.primarySymptom)) return false;
  if (mode === "adjusted") {
    for (const failed of ctx.failedStrategyTypes) {
      if (entry.strategyType === failed) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scoring — higher is better
// ---------------------------------------------------------------------------

function scoreEntry(entry: LibraryEntry, ctx: LibraryContext): number {
  let s = 0;

  if (ctx.successfulStrategyTypes.includes(entry.strategyType)) s += 4;
  if (entry.hydrationRelated && ctx.hydrationLow) s += 2;
  if (entry.postDoseRelevant && ctx.postDose) s += 2;
  if (entry.recoveryFocused && (ctx.lowSleep || ctx.lowHrv)) s += 2;
  if (entry.behavioralBurden === "low" && ctx.severityTier === "severe") s += 1;
  if (entry.escalationPrevention && ctx.severityTier === "severe") s += 1;
  if (entry.foodRelated && ctx.hasLowAppetite) s -= 1;
  if (entry.behavioralBurden === "low" && ctx.recentDoseChange) s += 1;
  if (entry.hydrationRelated && ctx.doseTier === "high" && ctx.primarySymptom === "nausea") s += 1;
  if (entry.escalationPrevention && ctx.doseTier === "high" && ctx.severityTier === "severe") s += 1;

  return s;
}

// ---------------------------------------------------------------------------
// Stable tie-breaking (deterministic, not random)
// ---------------------------------------------------------------------------

function pickFromTied(entries: LibraryEntry[], seed: number): LibraryEntry {
  return entries[seed % entries.length]!;
}

// ---------------------------------------------------------------------------
// Recommendation ladder — pure classification helpers
// ---------------------------------------------------------------------------

function classifyState(
  mode: "initial" | "adjusted",
  wasSuccessfulBefore: boolean,
  shouldEscalate: boolean,
): InterventionRecommendationState {
  if (shouldEscalate) return "escalate";
  if (mode === "adjusted") return "try_alternative";
  if (wasSuccessfulBefore) return "repeat_success";
  return "first_line_support";
}

function buildRationale(
  state: InterventionRecommendationState,
  entry: LibraryEntry,
  ctx: LibraryContext,
): string {
  switch (state) {
    case "repeat_success":
      return "This approach helped before, so Viva is starting there again.";
    case "try_alternative":
      return "Since the last step did not help, Viva is trying a different approach today.";
    case "escalate":
      return "Since this has not improved after a few tries, your care team may be better positioned to help.";
    case "first_line_support":
      if (entry.hydrationRelated && ctx.hydrationLow)
        return "Viva is starting with hydration because fluid intake appears low.";
      if (entry.recoveryFocused && ctx.lowSleep)
        return "Viva is prioritizing rest because sleep was shorter than usual.";
      if (entry.postDoseRelevant && ctx.postDose)
        return "This step is timed for the post-dose window, when symptoms often peak.";
      if (ctx.recentDoseChange)
        return "Viva is keeping this gentle after your recent dose change.";
      if (entry.strategyType === "hydration-first" && ctx.hasSevereNausea)
        return "Viva is prioritizing fluids because severe nausea makes food harder to tolerate.";
      if (ctx.doseTier === "high" && entry.behavioralBurden === "low")
        return "Viva is keeping this gentle given your current dose context.";
      return "Viva selected this step based on today's symptoms.";
  }
}

function buildPatternInsight(
  state: InterventionRecommendationState,
  entry: LibraryEntry,
  ctx: LibraryContext,
): string | null {
  // repeat_success and try_alternative are self-explanatory from rationale — no extra line
  if (state !== "first_line_support") return null;
  // Only reference data that actually exists
  if (ctx.symptomRecurring7d)
    return "This symptom has appeared across recent check-ins.";
  // Only reference sleep if it's actually available and the entry matches
  if (ctx.lowSleep && !entry.recoveryFocused)
    return "Fatigue may feel heavier after lower sleep.";
  return null;
}

function buildEscalationReason(
  ctx: LibraryContext,
): SelectionResult["escalationReason"] {
  if (ctx.priorWorseCount7d >= 1) return "symptoms_reported_worse";
  // requested_review contributes to priorFailureCount7d via history.ts
  if (ctx.priorFailureCount7d >= 2) return "care_team_requested";
  if (ctx.priorFailureCount7d >= 3) return "repeated_no_change";
  return null;
}

// ---------------------------------------------------------------------------
// Core selector
// ---------------------------------------------------------------------------

export function selectIntervention(
  ctx: LibraryContext,
  mode: "initial" | "adjusted",
): SelectionResult {
  let eligible = LIBRARY.filter((e) => isEligible(e, ctx, mode));

  // Fallback 1: relax the severity filter only (keep all other guards)
  if (eligible.length === 0) {
    eligible = LIBRARY.filter((e) => {
      if (e.id === ctx.lastEntryId) return false;
      if (e.avoidIfLowAppetite && ctx.hasVeryLowAppetite) return false;
      if (e.avoidIfSevereNausea && ctx.hasSevereNausea) return false;
      if (!e.symptomTargets.includes(ctx.primarySymptom)) return false;
      if (mode === "adjusted") {
        for (const failed of ctx.failedStrategyTypes) {
          if (e.strategyType === failed) return false;
        }
      }
      return true;
    });
  }

  // Fallback 2: any safe entry for this symptom (last resort)
  if (eligible.length === 0) {
    eligible = LIBRARY.filter(
      (e) =>
        e.symptomTargets.includes(ctx.primarySymptom) &&
        !e.avoidIfLowAppetite &&
        !e.avoidIfSevereNausea,
    );
  }

  // Absolute fallback: first library entry (should never reach here in practice)
  if (eligible.length === 0) {
    const fallback = LIBRARY[0]!;
    return {
      entry: fallback,
      state: "first_line_support",
      rationale: "Viva selected this step based on today's symptoms.",
      patternInsight: null,
      isAlternativeAfterFailure: false,
      shouldEscalate: false,
      escalationReason: null,
    };
  }

  const scored = eligible
    .map((e) => ({ e, s: scoreEntry(e, ctx) }))
    .sort((a, b) => b.s - a.s);

  const topScore = scored[0]!.s;
  const tied = scored.filter((x) => x.s === topScore).map((x) => x.e);
  const best = pickFromTied(tied, ctx.seed);

  const wasSuccessfulBefore = ctx.successfulStrategyTypes.includes(best.strategyType);
  // Escalate when symptoms were explicitly reported worse, OR when 2+ total
  // failed/unresolved attempts (includes "same", "requested_review") in 7 days.
  const shouldEscalate =
    ctx.priorWorseCount7d >= 1 || ctx.priorFailureCount7d >= 2;
  const state = classifyState(mode, wasSuccessfulBefore, shouldEscalate);
  const rationale = buildRationale(state, best, ctx);
  const patternInsight = buildPatternInsight(state, best, ctx);
  const escalationReason = shouldEscalate ? buildEscalationReason(ctx) : null;

  return {
    entry: best,
    state,
    rationale,
    patternInsight,
    isAlternativeAfterFailure: mode === "adjusted",
    shouldEscalate,
    escalationReason,
  };
}

// ---------------------------------------------------------------------------
// Context builder — call from InterventionCard with available signals
// ---------------------------------------------------------------------------

export function buildLibraryContext(opts: {
  primarySymptom: SymptomTarget;
  severityTier: "mild" | "moderate" | "severe";
  hasSevereNausea: boolean;
  hasLowAppetite: boolean;
  hasVeryLowAppetite: boolean;
  hydrationLow?: boolean;
  postDose?: boolean;
  lowSleep?: boolean;
  lowHrv?: boolean;
  symptomRecurring7d?: boolean;
  interventionId: number;
  lastEntryId: string | null;
  failedStrategyTypes: StrategyType[];
  successfulStrategyTypes?: StrategyType[];
  doseTier?: "low" | "mid" | "high" | null;
  recentDoseChange?: boolean;
  priorFailureCount7d?: number;
  priorWorseCount7d?: number;
}): LibraryContext {
  const day = Math.floor(Date.now() / 86_400_000);
  return {
    primarySymptom: opts.primarySymptom,
    severityTier: opts.severityTier,
    hasSevereNausea: opts.hasSevereNausea,
    hasLowAppetite: opts.hasLowAppetite,
    hasVeryLowAppetite: opts.hasVeryLowAppetite,
    hydrationLow: opts.hydrationLow ?? false,
    postDose: opts.postDose ?? false,
    lowSleep: opts.lowSleep ?? false,
    lowHrv: opts.lowHrv ?? false,
    symptomRecurring7d: opts.symptomRecurring7d ?? false,
    seed: (opts.interventionId + day) % 97,
    lastEntryId: opts.lastEntryId,
    failedStrategyTypes: opts.failedStrategyTypes,
    successfulStrategyTypes: opts.successfulStrategyTypes ?? [],
    doseTier: opts.doseTier ?? null,
    recentDoseChange: opts.recentDoseChange ?? false,
    priorFailureCount7d: opts.priorFailureCount7d ?? 0,
    priorWorseCount7d: opts.priorWorseCount7d ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the card layer
// ---------------------------------------------------------------------------

/** Maps the InterventionCard RecCategory to a SymptomTarget. */
export function categoryToSymptomTarget(
  category: string,
): SymptomTarget {
  switch (category) {
    case "nausea":       return "nausea";
    case "appetite":     return "appetite";
    case "energy":       return "energy";
    case "constipation": return "digestion";
    case "hydration":    return "hydration";
    case "other":
    default:             return "nausea";
  }
}

/** Maps LiveSeverity to a SeverityTier (steady → mild as conservative floor). */
export function liveSeverityToTier(
  severity: string,
): "mild" | "moderate" | "severe" {
  if (severity === "severe")   return "severe";
  if (severity === "moderate") return "moderate";
  return "mild";
}
