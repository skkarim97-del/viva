export { generateGreeting, generateInputSummary, generateTodayStatus, generateTodayView } from "./todayEngine";
export type { InputSummaryOutput, TodayStatusOutput, TodayViewOutput } from "./todayEngine";

export { buildCorrelations, detectPatterns, buildGLP1Insights, buildKeyInsights, weeklyAverages, computeHabitWeeklyRates, computeCorrelation, getCorrelationStrength, generateTrendsView } from "./trendsEngine";
export type { TrendCorrelation, GLP1Insight, TrendsViewOutput } from "./trendsEngine";

export { buildCoachContext, computeHrvBaseline, computeSleepDebt, computeRecoveryTrend } from "./coachEngine";
export type { CoachContext } from "./coachEngine";

export { generateDailyPlan, generateWeeklyPlan, stateTagFromReadiness } from "./planEngine";
export type { MedContext } from "./planEngine";

export { selectDailyTreatmentState } from "./dailyState";
export type {
  DailyTreatmentState,
  ClaimsPolicy,
  DataSufficiencyMarkers,
  TreatmentStage,
  DoseDayPosition,
  PrimaryFocus,
  TreatmentDailyState,
  RiskBand,
  AdherenceSignal,
  EscalationNeed,
  MovementReadiness,
  SelectInputs,
} from "./dailyState";

export {
  selectStatusChip,
  selectHero,
  selectFocusItems,
  selectInterventions,
  selectInsightSummary,
  selectInsufficientDataNotice,
  selectClaimsPolicy,
  selectActiveInterventionForAck,
  selectWeeklyDayView,
} from "./selectors";
export type {
  StatusChip,
  HeroBlock,
  InsightSummary,
  InsufficientDataNotice,
  WeeklyDayView,
  WeeklyDayConfidence,
} from "./selectors";

export { generateCompletionFeedback } from "./feedbackEngine";

export { calculateDropoutRisk } from "@/data/riskEngine";
export { computeInputAnalytics, buildPatientSummary } from "@/data/inputScoring";
export { computeUserPatterns, generateAdaptiveInsights, shouldApplyPostDoseAdjustment } from "@/data/patternEngine";

export { computeInternalSeverity, applyAdaptiveOverrides, buildSeverityForCoach, buildSeverityForTrends } from "./weeklyAdaptiveEngine";
