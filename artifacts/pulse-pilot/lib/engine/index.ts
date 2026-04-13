export { generateGreeting, generateInputSummary, generateTodayStatus, generateTodayView } from "./todayEngine";
export type { InputSummaryOutput, TodayStatusOutput, TodayViewOutput } from "./todayEngine";

export { buildCorrelations, detectPatterns, buildGLP1Insights, buildKeyInsights, weeklyAverages, computeHabitWeeklyRates, computeCorrelation, getCorrelationStrength, generateTrendsView } from "./trendsEngine";
export type { TrendCorrelation, GLP1Insight, TrendsViewOutput } from "./trendsEngine";

export { buildCoachContext, computeHrvBaseline, computeSleepDebt, computeRecoveryTrend } from "./coachEngine";
export type { CoachContext } from "./coachEngine";

export { generateDailyPlan, generateWeeklyPlan, stateTagFromReadiness } from "./planEngine";
export type { MedContext } from "./planEngine";

export { generateCompletionFeedback } from "./feedbackEngine";

export { calculateDropoutRisk } from "@/data/riskEngine";
export { computeInputAnalytics, buildPatientSummary } from "@/data/inputScoring";
export { computeUserPatterns, generateAdaptiveInsights, shouldApplyPostDoseAdjustment } from "@/data/patternEngine";

export { computeInternalSeverity, applyAdaptiveOverrides, buildSeverityForCoach, buildSeverityForTrends } from "./weeklyAdaptiveEngine";
