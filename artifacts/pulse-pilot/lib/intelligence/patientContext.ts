// lib/intelligence/patientContext.ts
//
// Shared patient context builder. All patient-facing outputs (Today plan,
// Week plan, intervention cards, Why this plan, trends) derive from this
// single structured snapshot so recommendations are consistent across
// every surface in the app.
//
// Design constraints:
//   - Rule-based only. No LLM calls, no autonomous advice.
//   - All fields are nullable/optional; missing data degrades gracefully.
//   - No free-text PHI is stored or logged.
//   - Medication dosing advice is never generated.

import type {
  GLP1DailyInputs,
  MedicationProfile,
  MedicationLogEntry,
  CompletionRecord,
} from "@/types";
import { getDoseTier, getMedicationFrequency, type MedicationBrand } from "@/data/medicationData";

// =====================================================================
// Public types
// =====================================================================

export type SymptomBurden = "none" | "low" | "moderate" | "high" | "severe";
export type TrendDirection = "stable" | "improving" | "worsening" | "unknown";
export type EngagementState = "active" | "moderate" | "dropping";
export type PlanPriority = 1 | 2 | 3 | 4 | 5 | 6;
export type DataConfidence = "high" | "moderate" | "low";

export interface MedicationCtx {
  medicationName: string | null;
  currentDose: string | null;
  doseTier: "low" | "mid" | "high" | null;
  doseDay: string | null;           // YYYY-MM-DD of last dose
  daysSinceDose: number | null;
  daysUntilNextDose: number | null;
  recentTitration: boolean;
  isNewToMedication: boolean;
  frequency: "weekly" | "daily" | null;
}

export interface SymptomCtx {
  nausea: "none" | "mild" | "moderate" | "severe" | null;
  appetite: "strong" | "normal" | "low" | "very_low" | null;
  digestion: "fine" | "bloated" | "constipated" | "diarrhea" | null;
  bowel: "yes" | "no" | null;
  energy: "great" | "good" | "tired" | "depleted" | null;
  overallBurden: SymptomBurden;
  hasElevatedGI: boolean;   // nausea moderate+ OR constipation/diarrhea
  hasLowIntake: boolean;    // appetite low or very_low
  hasLowEnergy: boolean;    // energy tired or depleted
}

export interface TrendMetric {
  count7d: number;          // days with this symptom in last 7
  direction: TrendDirection;
  recentAvg: number;        // average score in last 3 days (0-3 scale)
}

export interface TrendCtx {
  nausea: TrendMetric;
  appetite: TrendMetric;
  digestion: TrendMetric;
  energy: TrendMetric;
  checkInConsistency: "consistent" | "occasional" | "sparse";
  checkInStreak: number;
  doseDayPatternLikely: boolean;   // nausea spikes on days 1-2 post-dose
  overallTrend: TrendDirection;    // worst-case across all dimensions
}

export interface EngagementCtx {
  planCompletionRate7d: number;         // 0–1
  checkInStreak: number;
  engagementState: EngagementState;
  recentCompletedCategories: string[];  // categories completed ≥3 of last 7 days
  planItemsEngaged: boolean;
}

export interface WearableCtx {
  connected: boolean;
  sleepTrend: "good" | "declining" | "poor" | "unknown";
  activityTrend: "active" | "moderate" | "low" | "unknown";
  hrvTrend: "strong" | "declining" | "low" | "unknown";
}

export interface PatientIntelligenceContext {
  medication: MedicationCtx;
  symptoms: SymptomCtx;
  trends: TrendCtx;
  engagement: EngagementCtx;
  wearable: WearableCtx;
  planPriority: PlanPriority;
  dataConfidence: DataConfidence;
  reasonSignals: string[];   // structured tags, no free-text PHI
}

// =====================================================================
// Input type
// =====================================================================

// Matches the shape of LiveCheckin from InterventionCard without
// creating a circular import.
export interface TodayCheckin {
  nausea?: "none" | "mild" | "moderate" | "severe" | null;
  appetite?: "strong" | "normal" | "low" | "very_low" | null;
  energy?: "great" | "good" | "tired" | "depleted" | null;
  digestion?: "fine" | "bloated" | "constipated" | "diarrhea" | null;
  bowel?: "yes" | "no" | null;
}

export interface PatientContextInputs {
  glp1History?: GLP1DailyInputs[];
  medicationProfile?: MedicationProfile;
  medicationLog?: MedicationLogEntry[];
  completionHistory?: CompletionRecord[];
  todayCheckin?: TodayCheckin | null;
  hasHealthData?: boolean;
  // Pre-computed wearable trends (already in planEngine output)
  sleepTrend?: "good" | "declining" | "poor";
  activityTrend?: "active" | "moderate" | "low";
}

// =====================================================================
// Scoring helpers (0–3 scale, consistent with weeklyAdaptiveEngine)
// =====================================================================

function nauseaScore(inp: GLP1DailyInputs): number {
  if (inp.nausea === "severe") return 3;
  if (inp.nausea === "moderate") return 2;
  if (inp.nausea === "mild") return 1;
  return 0;
}

function appetiteScore(inp: GLP1DailyInputs): number {
  if (inp.appetite === "very_low") return 2;
  if (inp.appetite === "low") return 1;
  return 0;
}

function energyScore(inp: GLP1DailyInputs): number {
  if (inp.energy === "depleted") return 2;
  if (inp.energy === "tired") return 1;
  return 0;
}

function digestionScore(inp: GLP1DailyInputs): number {
  if (inp.digestion === "diarrhea") return 2;
  if (inp.digestion === "constipated") return 2;
  if (inp.digestion === "bloated") return 1;
  return 0;
}

// =====================================================================
// Trend direction computation
// =====================================================================

function computeTrendMetric(
  last7: GLP1DailyInputs[],
  scoreFn: (inp: GLP1DailyInputs) => number,
  elevated: (inp: GLP1DailyInputs) => boolean,
  threshold = 0.5,
): TrendMetric {
  if (last7.length === 0) {
    return { count7d: 0, direction: "unknown", recentAvg: 0 };
  }

  const sorted = [...last7].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, 3);  // days 1-3 (most recent)
  const prior = sorted.slice(3, 7);   // days 4-7

  const count7d = last7.filter(elevated).length;
  const recentAvg =
    recent.length > 0
      ? recent.reduce((s, i) => s + scoreFn(i), 0) / recent.length
      : 0;

  let direction: TrendDirection = "unknown";
  if (prior.length >= 2 && recent.length >= 2) {
    const priorAvg = prior.reduce((s, i) => s + scoreFn(i), 0) / prior.length;
    if (recentAvg > priorAvg + threshold) {
      direction = "worsening";
    } else if (recentAvg < priorAvg - threshold) {
      direction = "improving";
    } else {
      direction = "stable";
    }
  } else if (recent.length >= 2) {
    direction = "stable";
  }

  return { count7d, direction, recentAvg };
}

// =====================================================================
// Check-in streak
// =====================================================================

function computeCheckInStreak(history: GLP1DailyInputs[]): number {
  if (history.length === 0) return 0;
  const dates = new Set(history.map((i) => i.date));
  const today = new Date();
  let streak = 0;
  for (let d = 0; d <= 60; d++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - d);
    const str = dt.toISOString().split("T")[0]!;
    if (dates.has(str)) {
      streak++;
    } else if (d === 0) {
      // Haven't checked in today yet — don't penalise, look from yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}

// =====================================================================
// Completion stats
// =====================================================================

function computePlanCompletionRate(history: CompletionRecord[], days = 7): number {
  if (!history || history.length === 0) return 0;
  const today = new Date().toISOString().split("T")[0]!;
  const recent = history
    .filter((r) => r.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
  if (recent.length === 0) return 0;
  return (
    recent.reduce((s, r) => s + (r.completionRate ?? 0), 0) /
    recent.length /
    100
  );
}

function computeRecentCompletedCategories(
  history: CompletionRecord[],
  days = 7,
): string[] {
  const today = new Date().toISOString().split("T")[0]!;
  const recent = history
    .filter((r) => r.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);

  const counts: Record<string, number> = {};
  for (const record of recent) {
    for (const action of record.actions ?? []) {
      if (action.completed) {
        counts[action.category] = (counts[action.category] ?? 0) + 1;
      }
    }
  }
  // Categories completed on at least 3 of the last 7 days
  return Object.entries(counts)
    .filter(([, n]) => n >= 3)
    .map(([cat]) => cat);
}

// =====================================================================
// Days since last dose
// =====================================================================

function computeDaysSinceDose(log?: MedicationLogEntry[]): number | null {
  if (!log || log.length === 0) return null;
  const taken = log
    .filter((e) => e.status === "taken")
    .sort((a, b) => b.date.localeCompare(a.date));
  if (taken.length === 0) return null;
  const todayStr = new Date().toISOString().split("T")[0]!;
  const [ty, tm, td] = todayStr.split("-").map(Number) as [number, number, number];
  const [dy, dm, dd] = taken[0]!.date.split("-").map(Number) as [number, number, number];
  const todayDate = new Date(ty, tm - 1, td);
  const doseDate = new Date(dy, dm - 1, dd);
  return Math.max(0, Math.round((todayDate.getTime() - doseDate.getTime()) / 86400000));
}

// =====================================================================
// Symptom burden
// =====================================================================

function computeSymptomBurden(s: SymptomCtx): SymptomBurden {
  if (s.nausea === "severe") return "severe";
  let score = 0;
  if (s.nausea === "moderate") score += 3;
  else if (s.nausea === "mild") score += 1;
  if (s.appetite === "very_low") score += 2;
  else if (s.appetite === "low") score += 1;
  if (s.energy === "depleted") score += 2;
  else if (s.energy === "tired") score += 1;
  if (s.digestion === "diarrhea" || s.digestion === "constipated") score += 2;
  else if (s.digestion === "bloated") score += 1;
  if (score >= 6) return "high";
  if (score >= 3) return "moderate";
  if (score >= 1) return "low";
  return "none";
}

// =====================================================================
// Plan priority (1 = most urgent, 6 = data too sparse)
// =====================================================================

function computePlanPriority(
  symptoms: SymptomCtx,
  trends: TrendCtx,
  dataConfidence: DataConfidence,
): PlanPriority {
  if (
    symptoms.overallBurden === "severe" ||
    (symptoms.overallBurden === "high" && trends.nausea.direction === "worsening")
  )
    return 1;
  if (symptoms.hasElevatedGI) return 2;
  if (symptoms.hasLowIntake) return 3;
  if (symptoms.hasLowEnergy) return 4;
  if (dataConfidence === "low") return 6;
  return 5;
}

// =====================================================================
// Dose-day pattern detection
// =====================================================================

function detectDoseDayPattern(
  log: MedicationLogEntry[],
  history: GLP1DailyInputs[],
  frequency: "weekly" | "daily" | null,
): boolean {
  if (frequency !== "weekly" || log.length === 0 || history.length < 4) return false;
  const takenDates = log
    .filter((e) => e.status === "taken")
    .map((e) => e.date)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 4); // last 4 doses
  if (takenDates.length < 2) return false;

  const historyMap = new Map(history.map((i) => [i.date, i]));
  let postDoseTotal = 0;
  let postDoseNausea = 0;

  for (const doseDate of takenDates) {
    for (let d = 1; d <= 2; d++) {
      const dt = new Date(doseDate);
      dt.setDate(dt.getDate() + d);
      const str = dt.toISOString().split("T")[0]!;
      const checkin = historyMap.get(str);
      if (checkin) {
        postDoseTotal++;
        if (checkin.nausea === "moderate" || checkin.nausea === "severe") {
          postDoseNausea++;
        }
      }
    }
  }
  // Pattern: nausea elevated on ≥60% of tracked post-dose days, with ≥3 data points
  return postDoseTotal >= 3 && postDoseNausea / postDoseTotal >= 0.6;
}

// =====================================================================
// Main builder
// =====================================================================

export function buildPatientContext(
  inputs: PatientContextInputs,
): PatientIntelligenceContext {
  const {
    glp1History = [],
    medicationProfile,
    medicationLog,
    completionHistory = [],
    todayCheckin = null,
    hasHealthData = false,
    sleepTrend,
    activityTrend,
  } = inputs;

  // ---- Medication context ------------------------------------------
  const daysSinceDose = computeDaysSinceDose(medicationLog);
  let frequency: "weekly" | "daily" | null = null;
  let doseTier: "low" | "mid" | "high" | null = null;
  let daysUntilNextDose: number | null = null;
  let doseDay: string | null = null;

  if (medicationProfile) {
    try {
      frequency = getMedicationFrequency(
        medicationProfile.medicationBrand.toLowerCase() as MedicationBrand,
      );
    } catch {
      frequency = "weekly";
    }
    doseTier = getDoseTier(
      medicationProfile.medicationBrand,
      medicationProfile.doseValue,
    );
    if (frequency === "weekly" && daysSinceDose !== null) {
      daysUntilNextDose = Math.max(0, 7 - daysSinceDose);
    }
    const taken = (medicationLog ?? [])
      .filter((e) => e.status === "taken")
      .sort((a, b) => b.date.localeCompare(a.date));
    if (taken.length > 0) doseDay = taken[0]!.date;
  }

  const medication: MedicationCtx = {
    medicationName: medicationProfile?.medicationBrand ?? null,
    currentDose: medicationProfile
      ? `${medicationProfile.doseValue} ${medicationProfile.doseUnit}`
      : null,
    doseTier,
    doseDay,
    daysSinceDose,
    daysUntilNextDose,
    recentTitration: medicationProfile?.recentTitration === true,
    isNewToMedication:
      medicationProfile?.timeOnMedicationBucket === "less_30_days",
    frequency,
  };

  // ---- Symptom context (today's check-in) -------------------------
  const tc = todayCheckin;
  const nausea = tc?.nausea ?? null;
  const appetite = tc?.appetite ?? null;
  const digestion = tc?.digestion ?? null;
  const bowel = tc?.bowel ?? null;
  const energy = tc?.energy ?? null;

  const hasElevatedGI =
    nausea === "moderate" ||
    nausea === "severe" ||
    digestion === "diarrhea" ||
    digestion === "constipated";
  const hasLowIntake = appetite === "low" || appetite === "very_low";
  const hasLowEnergy = energy === "tired" || energy === "depleted";

  const partialSymptoms: SymptomCtx = {
    nausea,
    appetite,
    digestion,
    bowel,
    energy,
    overallBurden: "none",
    hasElevatedGI,
    hasLowIntake,
    hasLowEnergy,
  };
  partialSymptoms.overallBurden = computeSymptomBurden(partialSymptoms);
  const symptoms = partialSymptoms;

  // ---- Trend context (7-day history) ------------------------------
  const todayStr = new Date().toISOString().split("T")[0]!;
  const sevenAgoDate = new Date();
  sevenAgoDate.setDate(sevenAgoDate.getDate() - 7);
  const sevenAgoStr = sevenAgoDate.toISOString().split("T")[0]!;
  const last7 = glp1History
    .filter((i) => i.date >= sevenAgoStr && i.date <= todayStr)
    .sort((a, b) => b.date.localeCompare(a.date));

  const nauseaTrend = computeTrendMetric(
    last7,
    nauseaScore,
    (i) => i.nausea === "moderate" || i.nausea === "severe",
  );
  const appetiteTrend = computeTrendMetric(
    last7,
    appetiteScore,
    (i) => i.appetite === "low" || i.appetite === "very_low",
  );
  const digestionTrend = computeTrendMetric(
    last7,
    digestionScore,
    (i) => i.digestion === "constipated" || i.digestion === "diarrhea",
  );
  const energyTrend = computeTrendMetric(
    last7,
    energyScore,
    (i) => i.energy === "tired" || i.energy === "depleted",
  );

  const checkInStreak = computeCheckInStreak(glp1History);
  const checkInRate = last7.length;
  const checkInConsistency: TrendCtx["checkInConsistency"] =
    checkInRate >= 5 ? "consistent" : checkInRate >= 3 ? "occasional" : "sparse";

  const doseDayPatternLikely = detectDoseDayPattern(
    medicationLog ?? [],
    glp1History,
    frequency,
  );

  const dirs = [
    nauseaTrend.direction,
    appetiteTrend.direction,
    digestionTrend.direction,
    energyTrend.direction,
  ];
  const overallTrend: TrendDirection = dirs.includes("worsening")
    ? "worsening"
    : dirs.filter((d) => d !== "unknown").every((d) => d === "improving" || d === "stable") &&
      dirs.includes("improving")
    ? "improving"
    : dirs.every((d) => d === "unknown")
    ? "unknown"
    : "stable";

  const trends: TrendCtx = {
    nausea: nauseaTrend,
    appetite: appetiteTrend,
    digestion: digestionTrend,
    energy: energyTrend,
    checkInConsistency,
    checkInStreak,
    doseDayPatternLikely,
    overallTrend,
  };

  // ---- Engagement context -----------------------------------------
  const completionRate = computePlanCompletionRate(completionHistory);
  const recentCompletedCategories = computeRecentCompletedCategories(
    completionHistory,
  );
  const engagementState: EngagementState =
    checkInStreak >= 3 && completionRate >= 0.5
      ? "active"
      : checkInStreak <= 1 &&
        completionRate < 0.3 &&
        last7.length <= 2
      ? "dropping"
      : "moderate";

  const engagement: EngagementCtx = {
    planCompletionRate7d: completionRate,
    checkInStreak,
    engagementState,
    recentCompletedCategories,
    planItemsEngaged: completionRate > 0.2,
  };

  // ---- Wearable context -------------------------------------------
  const wearable: WearableCtx = {
    connected: hasHealthData === true,
    sleepTrend: sleepTrend ?? "unknown",
    activityTrend: activityTrend ?? "unknown",
    hrvTrend: "unknown",
  };

  // ---- Data confidence --------------------------------------------
  const dataConfidence: DataConfidence =
    last7.length >= 4 ? "high" : last7.length >= 2 ? "moderate" : "low";

  // ---- Plan priority ----------------------------------------------
  const planPriority = computePlanPriority(symptoms, trends, dataConfidence);

  // ---- Reason signals (structured tags, no PHI) -------------------
  const reasonSignals: string[] = [];
  if (nausea && nausea !== "none") reasonSignals.push(`nausea_${nausea}`);
  if (appetite && appetite !== "strong" && appetite !== "normal")
    reasonSignals.push(`appetite_${appetite}`);
  if (energy && energy !== "great" && energy !== "good")
    reasonSignals.push(`energy_${energy}`);
  if (digestion && digestion !== "fine") reasonSignals.push(`digestion_${digestion}`);
  if (medication.recentTitration) reasonSignals.push("recent_titration");
  if (medication.isNewToMedication) reasonSignals.push("new_to_medication");
  if (daysSinceDose !== null && daysSinceDose <= 2)
    reasonSignals.push("within_dose_window");
  if (nauseaTrend.direction === "worsening") reasonSignals.push("nausea_worsening_trend");
  if (appetiteTrend.direction === "worsening")
    reasonSignals.push("appetite_worsening_trend");
  if (overallTrend === "improving") reasonSignals.push("symptoms_improving");
  if (doseDayPatternLikely) reasonSignals.push("dose_day_pattern_detected");
  if (recentCompletedCategories.includes("hydrate"))
    reasonSignals.push("hydration_consistent");
  if (recentCompletedCategories.includes("move"))
    reasonSignals.push("movement_consistent");
  if (engagementState === "dropping") reasonSignals.push("engagement_dropping");
  if (dataConfidence === "low") reasonSignals.push("low_data_confidence");
  if (hasHealthData) reasonSignals.push("apple_health_connected");

  return {
    medication,
    symptoms,
    trends,
    engagement,
    wearable,
    planPriority,
    dataConfidence,
    reasonSignals,
  };
}

// =====================================================================
// Reason metadata (structured logging payload)
// =====================================================================

export interface ReasonMetadata {
  outputType: string;
  reasonSignals: string[];
  symptomBurden: SymptomBurden;
  trendDirection: TrendDirection;
  engagementState: EngagementState;
  appleHealthConnected: boolean;
  planPriority: PlanPriority;
  sourceScreen?: string;
}

export function buildReasonMetadata(
  ctx: PatientIntelligenceContext,
  outputType: string,
  sourceScreen?: string,
): ReasonMetadata {
  return {
    outputType,
    reasonSignals: ctx.reasonSignals,
    symptomBurden: ctx.symptoms.overallBurden,
    trendDirection: ctx.trends.overallTrend,
    engagementState: ctx.engagement.engagementState,
    appleHealthConnected: ctx.wearable.connected,
    planPriority: ctx.planPriority,
    sourceScreen,
  };
}
