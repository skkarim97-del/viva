import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  MedicationLogEntry,
  FeelingType,
  EnergyLevel,
  StressLevel,
  HydrationLevel,
  TrainingIntent,
  EnergyDaily,
  AppetiteLevel,
  NauseaLevel,
  DigestionStatus,
  PatientSummary,
} from "@/types";
import type { DailyInsights } from "@/data/insights";
import { buildTitrationContext } from "./titrationHelper";
import { buildTierContext, summarizeTierForCoach, type DataTier, type Confidence } from "./dataTier";

export interface CoachContext {
  todayMetrics: {
    hrv: number | null;
    restingHeartRate: number | null;
    sleepDuration: number;
    sleepQuality: number | null;
    steps: number;
    recoveryScore: number | null;
    weight: number | null;
    strain: number | null;
    caloriesBurned: number;
    activeCalories: number;
  };
  profile: {
    name?: string;
    age: number;
    sex: string;
    weight: number;
    goalWeight: number;
    goals: string[];
    glp1Medication?: string;
    glp1Duration?: string;
    proteinConfidence?: string;
    strengthTrainingBaseline?: string;
  };
  medicationProfile?: {
    medicationBrand: string;
    genericName: string;
    doseValue: number;
    doseUnit: string;
    frequency: string;
    recentTitration: boolean;
    timeOnMedicationBucket: string;
    daysSinceDoseChange?: number | null;
    previousDoseValue?: number | null;
    titrationIntensity?: "none" | "mild" | "moderate" | "peak";
  };
  recentDoseLog: { date: string; status: string; doseValue: number; doseUnit: string }[];
  readinessScore?: number;
  dailyState?: string;
  userFeeling: FeelingType;
  userEnergy: EnergyLevel;
  userStress: StressLevel;
  userHydration: HydrationLevel;
  userTrainingIntent: TrainingIntent;
  glp1DailyInputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    nausea: NauseaLevel;
    digestion: DigestionStatus;
  };
  sleepInsight?: string;
  hrvBaseline?: number;
  sleepDebt?: number;
  recoveryTrend?: "improving" | "declining" | "stable";
  streakDays: number;
  weeklyCompletionRate: number;
  todayCompletionRate: number;
  patientSummary?: PatientSummary;
  adaptiveState?: {
    currentState: string;
    recentPattern: string;
    planAdjustment: string;
  };
  // Tier-aware fields. The coach uses these to decide which physiological claims it can
  // make. If a metric is missing/unusable, do not reference it in the response.
  dataTier?: DataTier;
  recommendationConfidence?: Confidence;
  availableMetricTypes?: string[];
  validBaselines?: { sleep7d: boolean; rhr14d: boolean; hrv14d: boolean; stepsWeekly: boolean };
  freshness?: { hasFreshSleep: boolean; hasFreshSteps: boolean; hasFreshRhr: boolean; hasFreshHrv: boolean };
  unavailableWearableMetrics?: string[];
  basedOn?: "self_report_only" | "phone_health" | "wearable_enhanced";
}

export function computeHrvBaseline(metrics: HealthMetrics[]): number | undefined {
  if (metrics.length < 7) return undefined;
  const hrvVals = metrics.slice(-7).map(m => m.hrv).filter((v): v is number => typeof v === "number");
  if (hrvVals.length === 0) return undefined;
  return Math.round(hrvVals.reduce((s, v) => s + v, 0) / hrvVals.length);
}

export function computeSleepDebt(metrics: HealthMetrics[]): number | undefined {
  if (metrics.length < 3) return undefined;
  return +(metrics.slice(-3).reduce((s, m) => s + Math.max(0, 7.5 - m.sleepDuration), 0)).toFixed(1);
}

export function computeRecoveryTrend(metrics: HealthMetrics[]): "improving" | "declining" | "stable" | undefined {
  if (metrics.length < 3) return undefined;
  const scores = metrics.slice(-3).map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  if (scores.length < 2) return undefined;
  const diff = scores[scores.length - 1] - scores[0];
  if (diff > 5) return "improving";
  if (diff < -5) return "declining";
  return "stable";
}

export function buildCoachContext(
  todayMetrics: HealthMetrics,
  metrics: HealthMetrics[],
  profile: UserProfile,
  dailyPlan: DailyPlan | null,
  insights: DailyInsights | null,
  medicationLog: MedicationLogEntry[],
  glp1Inputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    nausea: NauseaLevel;
    digestion: DigestionStatus;
  },
  wellnessInputs: {
    feeling: FeelingType;
    energy: EnergyLevel;
    stress: StressLevel;
    hydration: HydrationLevel;
    trainingIntent: TrainingIntent;
  },
  streakDays: number,
  weeklyConsistency: number,
  todayCompletionRate: number,
  patientSummary?: PatientSummary | null,
  adaptiveState?: { currentState: string; recentPattern: string; planAdjustment: string } | null,
  availableMetricTypes: string[] = [],
): CoachContext {
  // Build the same tier context the planEngine uses, so the coach sees exactly the same
  // view of data adequacy. We then strip any metric we can't trust from todayMetrics so the
  // model can never reference it back to the user.
  const hasSubjectiveInputs = !!(wellnessInputs.feeling || wellnessInputs.energy || wellnessInputs.stress || wellnessInputs.trainingIntent || glp1Inputs);
  const tierCtx = buildTierContext(metrics, todayMetrics, availableMetricTypes, hasSubjectiveInputs, Date.now());
  const summary = summarizeTierForCoach(tierCtx);
  const tier = tierCtx.tier;

  return {
    todayMetrics: {
      // Wearable metrics: only forward when the metric is genuinely usable. Otherwise null
      // so the API server can suppress the line entirely.
      hrv: tier === "wearable" && tierCtx.usableHrv ? todayMetrics.hrv : null,
      restingHeartRate: tier === "wearable" && tierCtx.usableRhr ? todayMetrics.restingHeartRate : null,
      // Phone/wearable shared:
      sleepDuration: tierCtx.usableSleep ? todayMetrics.sleepDuration : 0,
      sleepQuality: tier === "wearable" ? todayMetrics.sleepQuality : null,
      steps: tierCtx.usableSteps ? todayMetrics.steps : 0,
      // Derived/synthesized scores: only forward on wearable tier when usable; else null.
      recoveryScore: tier === "wearable" && (tierCtx.usableHrv || tierCtx.usableRhr) ? todayMetrics.recoveryScore : null,
      weight: todayMetrics.weight,
      strain: tier === "wearable" ? todayMetrics.strain : null,
      caloriesBurned: tierCtx.usableSteps ? todayMetrics.caloriesBurned : 0,
      activeCalories: tierCtx.usableSteps ? todayMetrics.activeCalories : 0,
    },
    profile: {
      name: profile.name || undefined,
      age: profile.age,
      sex: profile.sex,
      weight: profile.weight,
      goalWeight: profile.goalWeight,
      goals: profile.goals,
      glp1Medication: profile.glp1Medication,
      glp1Duration: profile.glp1Duration,
      proteinConfidence: profile.proteinConfidence,
      strengthTrainingBaseline: profile.strengthTrainingBaseline,
    },
    medicationProfile: profile.medicationProfile ? (() => {
      const titration = buildTitrationContext(profile.medicationProfile);
      return {
        medicationBrand: profile.medicationProfile!.medicationBrand,
        genericName: profile.medicationProfile!.genericName,
        doseValue: profile.medicationProfile!.doseValue,
        doseUnit: profile.medicationProfile!.doseUnit,
        frequency: profile.medicationProfile!.frequency,
        recentTitration: profile.medicationProfile!.recentTitration,
        timeOnMedicationBucket: profile.medicationProfile!.timeOnMedicationBucket,
        daysSinceDoseChange: titration.daysSinceDoseChange,
        previousDoseValue: titration.previousDoseValue,
        titrationIntensity: titration.titrationIntensity,
      };
    })() : undefined,
    recentDoseLog: medicationLog.slice(-5).map(e => ({ date: e.date, status: e.status, doseValue: e.doseValue, doseUnit: e.doseUnit })),
    readinessScore: dailyPlan?.readinessScore,
    dailyState: dailyPlan?.dailyState,
    userFeeling: wellnessInputs.feeling,
    userEnergy: wellnessInputs.energy,
    userStress: wellnessInputs.stress,
    userHydration: wellnessInputs.hydration,
    userTrainingIntent: wellnessInputs.trainingIntent,
    glp1DailyInputs: glp1Inputs,
    sleepInsight: insights?.sleepIntelligence?.insight,
    hrvBaseline: computeHrvBaseline(metrics),
    sleepDebt: computeSleepDebt(metrics),
    recoveryTrend: computeRecoveryTrend(metrics),
    streakDays,
    weeklyCompletionRate: weeklyConsistency,
    todayCompletionRate,
    patientSummary: patientSummary ?? undefined,
    adaptiveState: adaptiveState ?? undefined,
    dataTier: dailyPlan?.dataTier ?? tier,
    recommendationConfidence: dailyPlan?.recommendationConfidence,
    availableMetricTypes: summary.availableMetricTypes,
    validBaselines: summary.validBaselines,
    freshness: summary.freshness,
    unavailableWearableMetrics: summary.unavailableWearableMetrics,
    basedOn: summary.basedOn as "self_report_only" | "phone_health" | "wearable_enhanced",
  };
}
