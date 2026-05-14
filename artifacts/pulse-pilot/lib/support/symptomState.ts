/**
 * Symptom support state helpers — single source of truth for severity
 * comparison and support-state invalidation decisions.
 *
 * All functions are pure and dependency-free so they can be unit-tested
 * independently of React.
 */

// ---------------------------------------------------------------------------
// Severity ranking
// ---------------------------------------------------------------------------

export const SEVERITY_RANK: Record<string, number> = {
  steady: 0,
  mild: 1,
  moderate: 2,
  severe: 3,
};

/** Numeric rank for a severity string. null / unknown maps to 0 (steady). */
export function severityRank(severity: string | null | undefined): number {
  return SEVERITY_RANK[severity ?? "steady"] ?? 0;
}

/** True when the current severity is strictly worse than the previous one. */
export function didSymptomsWorsen(
  prevSeverity: string | null,
  currentSeverity: string | null,
): boolean {
  return severityRank(currentSeverity) > severityRank(prevSeverity);
}

/** True when the current severity is strictly better than the previous one. */
export function didSymptomsImprove(
  prevSeverity: string | null,
  currentSeverity: string | null,
): boolean {
  return severityRank(currentSeverity) < severityRank(prevSeverity);
}

// ---------------------------------------------------------------------------
// Symptom signature
// ---------------------------------------------------------------------------

export interface CheckinSnapshot {
  nausea: string | null;
  appetite: string | null;
  energy: string | null;
  digestion: string | null;
  bowel: string | null;
}

/**
 * Returns a canonical string listing every elevated symptom and its level.
 * Normal / none values are excluded so an empty string means "no elevated
 * symptoms."
 *
 * Format: "nausea:moderate|appetite:low|digestion:constipated"
 */
export function getSymptomSignature(c: CheckinSnapshot): string {
  const parts: string[] = [];
  if (c.nausea && c.nausea !== "none") parts.push(`nausea:${c.nausea}`);
  if (c.appetite && c.appetite !== "good") parts.push(`appetite:${c.appetite}`);
  if (c.energy && c.energy !== "good") parts.push(`energy:${c.energy}`);
  if (c.digestion && c.digestion !== "normal") parts.push(`digestion:${c.digestion}`);
  if (c.bowel === "no") parts.push("bowel:no");
  return parts.join("|");
}

/** True when at least one symptom is above its normal baseline. */
export function hasElevatedSymptoms(c: CheckinSnapshot): boolean {
  return getSymptomSignature(c).length > 0;
}

// ---------------------------------------------------------------------------
// Support-state invalidation
// ---------------------------------------------------------------------------

export interface SupportStateParams {
  /** Live severity derived from current check-in inputs. */
  currentSeverity: string | null;
  /** True when all symptoms are back to normal / none. */
  symptomsFree: boolean;
  /** Whether the floating pill is showing an active support loop. */
  supportBannerVisible: boolean;
  /** Whether the green resolved state is active. */
  supportResolved: boolean;
  /** Severity captured at the moment the user said support helped. */
  resolvedSeverity: string | null;
}

export interface InvalidationResult {
  /** Clear the active support banner (checking / struggling phase). */
  clearActiveBanner: boolean;
  /** Clear the resolved / green state. */
  clearResolved: boolean;
}

/**
 * Single gate for deciding whether to invalidate support state.
 *
 * Rules:
 *  1. Symptoms fully cleared (→ steady / none) — clear EVERYTHING active.
 *  2. Symptoms worsened past the resolved baseline — clear the resolved state
 *     so the patient sees a fresh support recommendation.
 *  3. Symptoms unchanged or improved while support is active — preserve state.
 */
export function shouldInvalidateSupportState(
  params: SupportStateParams,
): InvalidationResult {
  const {
    symptomsFree,
    supportBannerVisible,
    supportResolved,
    resolvedSeverity,
    currentSeverity,
  } = params;

  // Rule 1: symptoms fully cleared
  if (symptomsFree) {
    return {
      clearActiveBanner: supportBannerVisible,
      clearResolved: supportResolved,
    };
  }

  // Rule 2: symptoms worsened past the resolved baseline
  const clearResolved =
    supportResolved &&
    resolvedSeverity !== null &&
    didSymptomsWorsen(resolvedSeverity, currentSeverity);

  return { clearActiveBanner: false, clearResolved };
}
