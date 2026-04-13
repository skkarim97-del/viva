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

export interface CoachContext {
  todayMetrics: {
    hrv: number;
    restingHeartRate: number;
    sleepDuration: number;
    sleepQuality: number;
    steps: number;
    recoveryScore: number;
    weight: number;
    strain: number;
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
}

export function computeHrvBaseline(metrics: HealthMetrics[]): number | undefined {
  if (metrics.length < 7) return undefined;
  return Math.round(metrics.slice(-7).reduce((s, m) => s + m.hrv, 0) / Math.min(metrics.length, 7));
}

export function computeSleepDebt(metrics: HealthMetrics[]): number | undefined {
  if (metrics.length < 3) return undefined;
  return +(metrics.slice(-3).reduce((s, m) => s + Math.max(0, 7.5 - m.sleepDuration), 0)).toFixed(1);
}

export function computeRecoveryTrend(metrics: HealthMetrics[]): "improving" | "declining" | "stable" | undefined {
  if (metrics.length < 3) return undefined;
  const scores = metrics.slice(-3).map(m => m.recoveryScore);
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
): CoachContext {
  return {
    todayMetrics: {
      hrv: todayMetrics.hrv,
      restingHeartRate: todayMetrics.restingHeartRate,
      sleepDuration: todayMetrics.sleepDuration,
      sleepQuality: todayMetrics.sleepQuality,
      steps: todayMetrics.steps,
      recoveryScore: todayMetrics.recoveryScore,
      weight: todayMetrics.weight,
      strain: todayMetrics.strain,
      caloriesBurned: todayMetrics.caloriesBurned,
      activeCalories: todayMetrics.activeCalories,
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
  };
}
