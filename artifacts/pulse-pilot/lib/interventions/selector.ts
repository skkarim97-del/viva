/**
 * Contextual intervention selector.
 *
 * Converts patient context signals into a ranked intervention choice
 * from the library. All logic is rule-based and deterministic — no AI,
 * no randomness, no open-ended advice generation.
 *
 * Two modes:
 *  - "initial"  → picks the best-fit intervention from the full library
 *  - "adjusted" → excludes all failed strategy types and the last shown
 *                 entry, forcing a meaningfully different strategy
 *
 * Strategy rotation on failure:
 *   hydration-first      → posture-upright-reset or low-stimulation-reset
 *   food-first           → hydration-first
 *   posture-upright-reset→ low-stimulation-reset
 *   low-stimulation-reset→ rest-recovery-reset
 *   gentle-movement      → rest-recovery-reset
 *   warm-fluid-digestion → posture-upright-reset
 *   rest-recovery-reset  → hydration-first
 */

import type {
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
  // Never immediately repeat the same entry
  if (entry.id === ctx.lastEntryId) return false;
  // Safety: suppress food-heavy entries when appetite is very low
  if (entry.avoidIfLowAppetite && ctx.hasVeryLowAppetite) return false;
  // Safety: suppress food/movement entries when nausea is severe
  if (entry.avoidIfSevereNausea && ctx.hasSevereNausea) return false;
  // Severity must overlap
  if (!entry.severityTiers.includes(ctx.severityTier)) return false;
  // At least one symptom target must match the primary concern
  if (!entry.symptomTargets.includes(ctx.primarySymptom)) return false;
  // Adjusted mode: suppress all previously failed strategies
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

  // Previously successful strategy → strong preference
  if (ctx.successfulStrategyTypes.includes(entry.strategyType)) s += 4;

  // Hydration bonus when fluid intake is low
  if (entry.hydrationRelated && ctx.hydrationLow) s += 2;

  // Post-dose bonus on day-1/day-2 after dose
  if (entry.postDoseRelevant && ctx.postDose) s += 2;

  // Recovery focus matches low sleep or low HRV signal
  if (entry.recoveryFocused && (ctx.lowSleep || ctx.lowHrv)) s += 2;

  // Low behavioral burden preferred when severity is high
  if (entry.behavioralBurden === "low" && ctx.severityTier === "severe") s += 1;

  // Escalation prevention preferred for severe symptoms
  if (entry.escalationPrevention && ctx.severityTier === "severe") s += 1;

  // Penalize food entries when patient has low appetite (not filtered out,
  // just de-prioritized — another signal may override the penalty)
  if (entry.foodRelated && ctx.hasLowAppetite) s -= 1;

  return s;
}

// ---------------------------------------------------------------------------
// Stable tie-breaking (deterministic, not random)
// ---------------------------------------------------------------------------

function pickFromTied(entries: LibraryEntry[], seed: number): LibraryEntry {
  return entries[seed % entries.length]!;
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

function buildExplainWhy(
  entry: LibraryEntry,
  ctx: LibraryContext,
  mode: "initial" | "adjusted",
): string | null {
  if (mode === "adjusted") {
    // Always explain strategy shift after a failed round
    return "Viva switched to a different strategy after the previous step didn't help.";
  }

  // Initial selection: explain if a non-obvious context signal drove the pick
  if (entry.strategyType === "hydration-first" && ctx.hydrationLow) {
    return "Viva prioritized hydration because fluid intake has been low today.";
  }
  if (entry.strategyType === "hydration-first" && ctx.hasSevereNausea) {
    return "Viva prioritized hydration because severe nausea makes solid food harder to tolerate right now.";
  }
  if (entry.avoidIfLowAppetite && ctx.hasLowAppetite) {
    return "Viva avoided food-first support because appetite is very low right now.";
  }
  if (entry.strategyType === "rest-recovery-reset" && ctx.lowSleep) {
    return "Viva suggested rest because sleep quality has been low.";
  }
  if (entry.strategyType === "rest-recovery-reset" && ctx.lowHrv) {
    return "Viva suggested rest because recovery signals indicate low readiness today.";
  }
  if (entry.strategyType === "low-stimulation-reset" && ctx.hasSevereNausea) {
    return "Viva reduced stimulation targets because nausea is elevated and sensory input can make it worse.";
  }
  if (entry.postDoseRelevant && ctx.postDose) {
    return "Viva adjusted support for the post-dose window, when symptoms often peak.";
  }

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

  // Absolute fallback: first entry in the library (should never reach here)
  if (eligible.length === 0) {
    const fallback = LIBRARY[0]!;
    return { entry: fallback, explainWhy: null };
  }

  const scored = eligible
    .map((e) => ({ e, s: scoreEntry(e, ctx) }))
    .sort((a, b) => b.s - a.s);

  const topScore = scored[0]!.s;
  const tied = scored.filter((x) => x.s === topScore).map((x) => x.e);
  const best = pickFromTied(tied, ctx.seed);

  return { entry: best, explainWhy: buildExplainWhy(best, ctx, mode) };
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
  interventionId: number;
  lastEntryId: string | null;
  failedStrategyTypes: StrategyType[];
  successfulStrategyTypes?: StrategyType[];
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
    seed: (opts.interventionId + day) % 97,
    lastEntryId: opts.lastEntryId,
    failedStrategyTypes: opts.failedStrategyTypes,
    successfulStrategyTypes: opts.successfulStrategyTypes ?? [],
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
