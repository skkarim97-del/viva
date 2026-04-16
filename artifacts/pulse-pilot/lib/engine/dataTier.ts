import type { HealthMetrics } from "@/types";

export type DataTier = "self_report" | "phone_health" | "wearable";

export type Confidence = "low" | "moderate" | "high";

export interface DataSufficiency {
  hasSubjective: boolean;
  hasSleepHistory: boolean;
  hasStepsHistory: boolean;
  hasRhrBaseline: boolean;
  hasHrvBaseline: boolean;
  hasRecoveryHistory: boolean;
  recentDays: number;
  baselineDays: number;
}

export interface DataFreshness {
  hasFreshSleep: boolean;
  hasFreshSteps: boolean;
  hasFreshRhr: boolean;
  hasFreshHrv: boolean;
}

export interface Baselines {
  sleep7dAvg: number | null;
  rhr14dBaseline: number | null;
  hrv14dBaseline: number | null;
  stepsWeeklyBaseline: number | null;
}

export interface BaselineDeviations {
  sleepVsAvg: number | null;
  rhrVsBaseline: number | null;
  hrvVsBaselinePct: number | null;
  stepsVsBaseline: number | null;
}

export interface TierContext {
  tier: DataTier;
  sufficiency: DataSufficiency;
  freshness: DataFreshness;
  baselines: Baselines;
  deviations: BaselineDeviations;
  hasSubjectiveInputs: boolean;
  // Composite gates: sufficiency AND freshness. Use these to decide whether a metric is
  // safe to drive a recommendation right now.
  usableSleep: boolean;
  usableSteps: boolean;
  usableRhr: boolean;
  usableHrv: boolean;
  // Reflects available raw metric keys, exposed for downstream consumers (coach, UI).
  availableMetricTypes: string[];
}

const RECENT_WINDOW = 7;
const BASELINE_WINDOW = 14;
const MIN_BASELINE_SAMPLES = 5;
const MIN_SLEEP_HISTORY = 3;
const MIN_STEPS_HISTORY = 3;
const MIN_RECOVERY_HISTORY = 3;

const PHONE_ONLY_KEYS = new Set(["sleep", "steps", "distance", "activeCalories", "totalCalories", "calories"]);
// Tier classification uses ONLY raw observed wearable metrics. `recovery` is intentionally
// excluded because in this app it is either app-derived or only present on Whoop-style
// providers that also surface HRV/RHR; we never want a synthesized score to push someone
// into the wearable tier.
const WEARABLE_KEYS = new Set(["hrv", "restingHeartRate"]);

/**
 * Classify a user into a data tier based on which metrics actually have signal in their history.
 *
 * - wearable: at least one wearable-only metric (HRV or resting HR) has any non-null sample.
 *             These come from Apple Watch / Whoop / Garmin / similar.
 * - phone_health: at least one phone-derived metric (sleep duration or steps) has signal,
 *                 but no wearable-only metrics.
 * - self_report: no passive health metrics at all. Recommendations rely entirely on
 *                check-ins, GLP-1 inputs, and treatment context.
 */
export function classifyDataTier(availableMetricTypes: string[]): DataTier {
  const set = new Set(availableMetricTypes);
  const hasWearable = [...WEARABLE_KEYS].some(k => set.has(k));
  if (hasWearable) return "wearable";
  const hasPhone = [...PHONE_ONLY_KEYS].some(k => set.has(k));
  if (hasPhone) return "phone_health";
  return "self_report";
}

/**
 * Check whether enough recent and baseline history exists to support each kind of claim.
 * A "history" check (recent) just confirms we have multiple days of any signal.
 * A "baseline" check (14d) confirms we can do meaningful comparisons against a personal baseline.
 */
export function assessDataSufficiency(
  metrics: HealthMetrics[],
  availableMetricTypes: string[],
  hasSubjectiveInputs: boolean,
): DataSufficiency {
  const set = new Set(availableMetricTypes);
  const recent = metrics.slice(-RECENT_WINDOW);
  const baselineSlice = metrics.slice(-BASELINE_WINDOW);

  const sleepCount = recent.filter(m => typeof m.sleepDuration === "number" && m.sleepDuration > 0).length;
  const stepsCount = recent.filter(m => typeof m.steps === "number" && m.steps > 0).length;
  const rhrBaselineCount = baselineSlice.filter(m => typeof m.restingHeartRate === "number").length;
  const hrvBaselineCount = baselineSlice.filter(m => typeof m.hrv === "number").length;
  const recoveryCount = recent.filter(m => typeof m.recoveryScore === "number").length;

  return {
    hasSubjective: hasSubjectiveInputs,
    hasSleepHistory: set.has("sleep") && sleepCount >= MIN_SLEEP_HISTORY,
    hasStepsHistory: set.has("steps") && stepsCount >= MIN_STEPS_HISTORY,
    hasRhrBaseline: set.has("restingHeartRate") && rhrBaselineCount >= MIN_BASELINE_SAMPLES,
    hasHrvBaseline: set.has("hrv") && hrvBaselineCount >= MIN_BASELINE_SAMPLES,
    hasRecoveryHistory: set.has("recovery") && recoveryCount >= MIN_RECOVERY_HISTORY,
    recentDays: recent.length,
    baselineDays: baselineSlice.length,
  };
}

/**
 * Compute personal baselines from history. Returns null where there is not enough data
 * (callers should treat null as "do not make baseline-relative claims for this metric").
 */
export function computeBaselines(metrics: HealthMetrics[]): Baselines {
  const recent7 = metrics.slice(-RECENT_WINDOW);
  const baseline14 = metrics.slice(-BASELINE_WINDOW);

  const sleepVals = recent7.map(m => m.sleepDuration).filter((v): v is number => typeof v === "number" && v > 0);
  const rhrVals = baseline14.map(m => m.restingHeartRate).filter((v): v is number => typeof v === "number");
  const hrvVals = baseline14.map(m => m.hrv).filter((v): v is number => typeof v === "number");
  const stepsVals = baseline14.map(m => m.steps).filter((v): v is number => typeof v === "number" && v > 0);

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    sleep7dAvg: sleepVals.length >= MIN_SLEEP_HISTORY ? avg(sleepVals) : null,
    rhr14dBaseline: rhrVals.length >= MIN_BASELINE_SAMPLES ? avg(rhrVals) : null,
    hrv14dBaseline: hrvVals.length >= MIN_BASELINE_SAMPLES ? avg(hrvVals) : null,
    stepsWeeklyBaseline: stepsVals.length >= MIN_BASELINE_SAMPLES ? avg(stepsVals) : null,
  };
}

/**
 * Compute today's deviations from each baseline. Returns null when either today's value
 * or the baseline is missing — callers must use null to suppress baseline-relative language.
 */
export function computeDeviations(today: HealthMetrics, baselines: Baselines): BaselineDeviations {
  const sleepVsAvg = (typeof today.sleepDuration === "number" && today.sleepDuration > 0 && baselines.sleep7dAvg !== null)
    ? today.sleepDuration - baselines.sleep7dAvg
    : null;
  const rhrVsBaseline = (typeof today.restingHeartRate === "number" && baselines.rhr14dBaseline !== null)
    ? today.restingHeartRate - baselines.rhr14dBaseline
    : null;
  const hrvVsBaselinePct = (typeof today.hrv === "number" && baselines.hrv14dBaseline !== null && baselines.hrv14dBaseline > 0)
    ? ((today.hrv - baselines.hrv14dBaseline) / baselines.hrv14dBaseline) * 100
    : null;
  const stepsVsBaseline = (typeof today.steps === "number" && baselines.stepsWeeklyBaseline !== null)
    ? today.steps - baselines.stepsWeeklyBaseline
    : null;
  return { sleepVsAvg, rhrVsBaseline, hrvVsBaselinePct, stepsVsBaseline };
}

const HOURS = 60 * 60 * 1000;
const FRESH_PHONE_WINDOW_MS = 36 * HOURS;
const FRESH_WEARABLE_WINDOW_MS = 72 * HOURS;

/**
 * Find the most recent timestamp at which a given metric had a real (non-null, non-zero
 * where applicable) value. We use the metric's `date` field and treat noon as the sample
 * time so day-aligned metrics (Apple Health daily aggregates) don't get rejected by an
 * exact-now comparison.
 */
function lastSeenMs(metrics: HealthMetrics[], picker: (m: HealthMetrics) => boolean): number | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (picker(metrics[i])) {
      const t = new Date(metrics[i].date + "T12:00:00Z").getTime();
      return Number.isFinite(t) ? t : null;
    }
  }
  return null;
}

export function assessDataFreshness(metrics: HealthMetrics[], nowMs: number = Date.now()): DataFreshness {
  const sleepLast = lastSeenMs(metrics, m => typeof m.sleepDuration === "number" && m.sleepDuration > 0);
  const stepsLast = lastSeenMs(metrics, m => typeof m.steps === "number" && m.steps > 0);
  const rhrLast = lastSeenMs(metrics, m => typeof m.restingHeartRate === "number");
  const hrvLast = lastSeenMs(metrics, m => typeof m.hrv === "number");
  return {
    hasFreshSleep: sleepLast !== null && nowMs - sleepLast <= FRESH_PHONE_WINDOW_MS,
    hasFreshSteps: stepsLast !== null && nowMs - stepsLast <= FRESH_PHONE_WINDOW_MS,
    hasFreshRhr: rhrLast !== null && nowMs - rhrLast <= FRESH_WEARABLE_WINDOW_MS,
    hasFreshHrv: hrvLast !== null && nowMs - hrvLast <= FRESH_WEARABLE_WINDOW_MS,
  };
}

/**
 * Roll up a tier context for a user given their metrics, available types, and whether they
 * have subjective inputs today. Use this once per recommendation cycle. `nowMs` is injected
 * for testability and to allow callers to pin "now" to the latest metric's day.
 */
export function buildTierContext(
  metrics: HealthMetrics[],
  todayMetric: HealthMetrics | null,
  availableMetricTypes: string[],
  hasSubjectiveInputs: boolean,
  nowMs: number = Date.now(),
): TierContext {
  const tier = classifyDataTier(availableMetricTypes);
  const sufficiency = assessDataSufficiency(metrics, availableMetricTypes, hasSubjectiveInputs);
  const freshness = assessDataFreshness(metrics, nowMs);
  const baselines = computeBaselines(metrics);
  const deviations = todayMetric
    ? computeDeviations(todayMetric, baselines)
    : { sleepVsAvg: null, rhrVsBaseline: null, hrvVsBaselinePct: null, stepsVsBaseline: null };
  // Composite usability: a metric must pass both history sufficiency and freshness before
  // it can drive a daily recommendation.
  const usableSleep = sufficiency.hasSleepHistory && freshness.hasFreshSleep;
  const usableSteps = sufficiency.hasStepsHistory && freshness.hasFreshSteps;
  const usableRhr = sufficiency.hasRhrBaseline && freshness.hasFreshRhr;
  const usableHrv = sufficiency.hasHrvBaseline && freshness.hasFreshHrv;
  return {
    tier,
    sufficiency,
    freshness,
    baselines,
    deviations,
    hasSubjectiveInputs,
    usableSleep,
    usableSteps,
    usableRhr,
    usableHrv,
    availableMetricTypes: [...availableMetricTypes],
  };
}

/**
 * Compact summary intended for the coach context. Tells the coach what the user actually has
 * and what they don't, so the model can avoid making physiological claims it can't support.
 */
export function summarizeTierForCoach(ctx: TierContext) {
  const wearableMissing: string[] = [];
  if (!ctx.usableHrv) wearableMissing.push("hrv");
  if (!ctx.usableRhr) wearableMissing.push("restingHeartRate");
  return {
    dataTier: ctx.tier,
    availableMetricTypes: ctx.availableMetricTypes,
    validBaselines: {
      sleep7d: ctx.baselines.sleep7dAvg !== null,
      rhr14d: ctx.baselines.rhr14dBaseline !== null,
      hrv14d: ctx.baselines.hrv14dBaseline !== null,
      stepsWeekly: ctx.baselines.stepsWeeklyBaseline !== null,
    },
    freshness: ctx.freshness,
    unavailableWearableMetrics: wearableMissing,
    basedOn:
      ctx.tier === "self_report" ? "self_report_only"
      : ctx.tier === "phone_health" ? "phone_health"
      : "wearable_enhanced",
  };
}

/**
 * Decide the maximum confidence a recommendation can claim given the tier and which signals
 * fired. The rule of thumb:
 * - self_report tier maxes out at moderate (we cannot validate physiological state).
 * - phone_health tier reaches high only when sleep + steps history both exist.
 * - wearable tier reaches high only when at least one wearable baseline (HRV or RHR) is met.
 */
export function maxConfidenceForTier(ctx: TierContext): Confidence {
  if (ctx.tier === "self_report") return ctx.hasSubjectiveInputs ? "moderate" : "low";
  if (ctx.tier === "phone_health") {
    return ctx.sufficiency.hasSleepHistory && ctx.sufficiency.hasStepsHistory ? "high" : "moderate";
  }
  // wearable
  return (ctx.sufficiency.hasHrvBaseline || ctx.sufficiency.hasRhrBaseline) ? "high" : "moderate";
}

/**
 * Combine the cap above with a recommendation's local confidence to soften patient-facing
 * language. The hedges below are intentionally short so they slot in without clashing with
 * existing copy.
 */
export function softenIfLowConfidence(text: string, confidence: Confidence): string {
  if (!text) return text;
  if (confidence === "high") return text;
  if (confidence === "moderate") {
    if (/^based on/i.test(text) || /^so far/i.test(text)) return text;
    return text;
  }
  // low: prefix with a hedge if the sentence is assertive
  if (/^based on what you|^so far|^it looks like|^early signs/i.test(text)) return text;
  return "Based on what you've shared, " + text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Helper: a strong "rest day" recommendation should require multiple converging negative
 * signals, not a single short night. Returns true when the caller has enough evidence to
 * issue a strong rest recommendation.
 */
export function hasConvergingNegativeSignals(args: {
  sleepShort: boolean;
  rhrElevated: boolean;
  hrvBelowBaseline: boolean;
  recoveryLow: boolean;
  symptomsHeavy: boolean;
  energyLow: boolean;
  stressHigh: boolean;
}): boolean {
  const signals = [
    args.sleepShort,
    args.rhrElevated,
    args.hrvBelowBaseline,
    args.recoveryLow,
    args.symptomsHeavy,
    args.energyLow,
    args.stressHigh,
  ].filter(Boolean).length;
  return signals >= 2;
}
