import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  WeeklyPlan,
  CompletionRecord,
  MedicationProfile,
  MedicationLogEntry,
  AdaptiveInsight,
  FeelingType,
  EnergyLevel,
  StressLevel,
  HydrationLevel,
  TrainingIntent,
  EnergyDaily,
  AppetiteLevel,
  HydrationDaily,
  ProteinConfidenceDaily,
  SideEffectSeverity,
  MovementIntent,
  PatientSummary,
  DailyStatusLabel,
} from "@/types";
import type { DailyInsights } from "@/data/insights";
import { generateGreeting, generateInputSummary, generateTodayStatus } from "@/lib/engine/todayEngine";
import type { InputSummaryOutput, TodayStatusOutput } from "@/lib/engine/todayEngine";
import { buildCoachContext, computeHrvBaseline, computeSleepDebt, computeRecoveryTrend } from "@/lib/engine/coachEngine";
import type { CoachContext } from "@/lib/engine/coachEngine";
import {
  buildCorrelations,
  detectPatterns,
  buildGLP1Insights,
  buildKeyInsights,
  weeklyAverages,
  computeHabitWeeklyRates,
} from "@/lib/engine/trendsEngine";
import type { TrendCorrelation, GLP1Insight } from "@/lib/engine/trendsEngine";

export interface TodayViewModel {
  greeting: string;
  inputSummary: InputSummaryOutput;
  status: TodayStatusOutput;
  insights: AdaptiveInsight[];
  plan: DailyPlan;
  hrvBaseline: number | undefined;
  sleepDebt: number | undefined;
  recoveryTrend: "improving" | "declining" | "stable" | undefined;
}

export interface PlanViewModel {
  dailyPlan: DailyPlan;
  weeklyPlan: WeeklyPlan | null;
  statusLabel: DailyStatusLabel;
  completedCount: number;
  totalCount: number;
}

export interface TrendsViewModel {
  correlations: TrendCorrelation[];
  patterns: string[];
  keyInsights: string[];
  glp1Insights: GLP1Insight[];
  sparkData: {
    sleepWeekly: number[];
    hrvWeekly: number[];
    stepsWeekly: number[];
    recoveryWeekly: number[];
    consistencyWeekly: number[];
  };
}

export interface CoachViewModel {
  context: CoachContext;
}

export function buildTodayViewModel(
  profile: UserProfile,
  plan: DailyPlan,
  metrics: HealthMetrics[],
  glp1Inputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    hydration: HydrationDaily;
    proteinConfidence: ProteinConfidenceDaily;
    sideEffects: SideEffectSeverity;
    movementIntent: MovementIntent;
  },
  adaptiveInsights: AdaptiveInsight[],
): TodayViewModel {
  return {
    greeting: generateGreeting(profile),
    inputSummary: generateInputSummary(glp1Inputs),
    status: generateTodayStatus(plan),
    insights: adaptiveInsights.slice(0, 3),
    plan,
    hrvBaseline: computeHrvBaseline(metrics),
    sleepDebt: computeSleepDebt(metrics),
    recoveryTrend: computeRecoveryTrend(metrics),
  };
}

export function buildPlanViewModel(
  dailyPlan: DailyPlan,
  weeklyPlan: WeeklyPlan | null,
): PlanViewModel {
  const supportActions = dailyPlan.actions.filter(a => a.category !== "consistent");
  return {
    dailyPlan,
    weeklyPlan,
    statusLabel: dailyPlan.statusLabel,
    completedCount: supportActions.filter(a => a.completed).length,
    totalCount: supportActions.length,
  };
}

export function buildTrendsViewModel(
  metrics: HealthMetrics[],
  medicationProfile: MedicationProfile | undefined,
  medicationLog: MedicationLogEntry[],
  completionHistory: CompletionRecord[],
  habitStats: {
    weeklyPercent: number;
    streakDays: number;
    todayCompleted: number;
    todayTotal: number;
    topHabit: string | null;
    topHabitPercent: number;
  },
): TrendsViewModel {
  return {
    correlations: buildCorrelations(metrics),
    patterns: detectPatterns(metrics),
    keyInsights: buildKeyInsights(metrics, habitStats),
    glp1Insights: buildGLP1Insights(metrics, medicationProfile, medicationLog, completionHistory),
    sparkData: {
      sleepWeekly: weeklyAverages(metrics.map(m => m.sleepDuration)),
      hrvWeekly: weeklyAverages(metrics.map(m => m.hrv)),
      stepsWeekly: weeklyAverages(metrics.map(m => m.steps)),
      recoveryWeekly: weeklyAverages(metrics.map(m => m.recoveryScore)),
      consistencyWeekly: computeHabitWeeklyRates(completionHistory),
    },
  };
}

export function buildCoachViewModel(
  todayMetrics: HealthMetrics,
  metrics: HealthMetrics[],
  profile: UserProfile,
  dailyPlan: DailyPlan | null,
  insights: DailyInsights | null,
  medicationLog: MedicationLogEntry[],
  glp1Inputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    hydration: HydrationDaily;
    proteinConfidence: ProteinConfidenceDaily;
    sideEffects: SideEffectSeverity;
    movementIntent: MovementIntent;
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
): CoachViewModel {
  return {
    context: buildCoachContext(
      todayMetrics,
      metrics,
      profile,
      dailyPlan,
      insights,
      medicationLog,
      glp1Inputs,
      wellnessInputs,
      streakDays,
      weeklyConsistency,
      todayCompletionRate,
      patientSummary,
    ),
  };
}
