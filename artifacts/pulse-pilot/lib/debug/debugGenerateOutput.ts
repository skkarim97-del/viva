import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  GLP1DailyInputs,
  MedicationLogEntry,
  CompletionRecord,
  UserPatterns,
  AdaptiveInsight,
  PatientSummary,
  InputAnalytics,
  DropoutRiskResult,
} from "@/types";
import { generateTodayView } from "@/lib/engine/todayEngine";
import { generateTrendsView } from "@/lib/engine/trendsEngine";
import { buildCoachContext } from "@/lib/engine/coachEngine";
import { computeHabitStats } from "@/data/insights";
import type { DailyInsights } from "@/data/insights";

export interface DebugOutput {
  timestamp: string;
  inputs: {
    profile: UserProfile;
    todayMetrics: HealthMetrics | null;
    glp1Inputs: GLP1DailyInputs | null;
    medicationLog: MedicationLogEntry[];
    completionHistory: CompletionRecord[];
    metricsCount: number;
  };
  structuredOutputs: {
    dailyPlan: DailyPlan | null;
    todayView: ReturnType<typeof generateTodayView> | null;
    trendsView: ReturnType<typeof generateTrendsView> | null;
    userPatterns: UserPatterns | null;
    adaptiveInsights: AdaptiveInsight[];
    patientSummary: PatientSummary | null;
    inputAnalytics: InputAnalytics | null;
    riskResult: DropoutRiskResult | null;
  };
  aiOutputs: {
    coachContext: ReturnType<typeof buildCoachContext> | null;
  };
}

export function debugGenerateOutput(params: {
  profile: UserProfile;
  todayMetrics: HealthMetrics | null;
  metrics: HealthMetrics[];
  glp1Inputs: GLP1DailyInputs | null;
  medicationLog: MedicationLogEntry[];
  completionHistory: CompletionRecord[];
  dailyPlan: DailyPlan | null;
  insights: DailyInsights | null;
  userPatterns: UserPatterns | null;
  adaptiveInsights: AdaptiveInsight[];
  patientSummary: PatientSummary | null;
  inputAnalytics: InputAnalytics | null;
  riskResult: DropoutRiskResult | null;
  wellnessInputs: { feeling: any; energy: any; stress: any; hydration: any; trainingIntent: any };
  streakDays: number;
  weeklyConsistency: number;
  todayCompletionRate: number;
}): DebugOutput {
  const {
    profile, todayMetrics, metrics, glp1Inputs, medicationLog,
    completionHistory, dailyPlan, insights, userPatterns,
    adaptiveInsights, patientSummary, inputAnalytics, riskResult,
    wellnessInputs, streakDays, weeklyConsistency, todayCompletionRate,
  } = params;

  const habitStats = computeHabitStats(completionHistory);

  let todayView = null;
  if (dailyPlan && glp1Inputs) {
    todayView = generateTodayView(profile, dailyPlan, {
      energy: glp1Inputs.energy,
      appetite: glp1Inputs.appetite,
      hydration: glp1Inputs.hydration,
      proteinConfidence: glp1Inputs.proteinConfidence,
      sideEffects: glp1Inputs.sideEffects,
      movementIntent: glp1Inputs.movementIntent,
    }, adaptiveInsights);
  }

  let trendsView = null;
  if (metrics.length > 0) {
    trendsView = generateTrendsView(metrics, profile.medicationProfile, medicationLog, completionHistory, habitStats);
  }

  let coachContext = null;
  if (todayMetrics && dailyPlan) {
    coachContext = buildCoachContext(
      todayMetrics, metrics, profile, dailyPlan, insights,
      medicationLog,
      {
        energy: glp1Inputs?.energy ?? null,
        appetite: glp1Inputs?.appetite ?? null,
        hydration: glp1Inputs?.hydration ?? null,
        proteinConfidence: glp1Inputs?.proteinConfidence ?? null,
        sideEffects: glp1Inputs?.sideEffects ?? null,
        movementIntent: glp1Inputs?.movementIntent ?? null,
      },
      wellnessInputs,
      streakDays, weeklyConsistency, todayCompletionRate,
      patientSummary,
    );
  }

  return {
    timestamp: new Date().toISOString(),
    inputs: {
      profile,
      todayMetrics,
      glp1Inputs,
      medicationLog: medicationLog.slice(-5),
      completionHistory: completionHistory.slice(-7),
      metricsCount: metrics.length,
    },
    structuredOutputs: {
      dailyPlan,
      todayView,
      trendsView,
      userPatterns,
      adaptiveInsights,
      patientSummary,
      inputAnalytics,
      riskResult,
    },
    aiOutputs: {
      coachContext,
    },
  };
}
