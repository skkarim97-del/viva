export interface UserProfile {
  id: string;
  name: string;
  age: number;
  sex: "male" | "female" | "other";
  height: number;
  weight: number;
  goalWeight: number;
  bodyFatPercentage?: number;
  dietaryPreference: string;
  workoutPreference: string;
  injuries: string;
  availableWorkoutTime: number;
  daysAvailableToTrain: number;
  coachingTone: "motivating" | "gentle" | "direct";
  goals: HealthGoal[];
  tier: SubscriptionTier;
  onboardingComplete: boolean;
  fastingEnabled: boolean;
  fastingProtocol?: string;
  units: "imperial" | "metric";
  activityLevel?: "inactive" | "light" | "moderate" | "very_active";
  trainingTime?: "under_30" | "30_60" | "60_90" | "90_plus";
  energyBaseline?: "energized" | "good" | "tired" | "stressed" | "burnt_out";
  sleepHabit?: "7_8" | "6_7" | "under_6" | "inconsistent";
  usualBedtime?: string;
  usualWakeTime?: string;

  glp1Medication?: "semaglutide" | "tirzepatide" | "liraglutide" | "other";
  glp1Reason?: "weight_loss" | "metabolic_health" | "diabetes" | "other";
  glp1Duration?: "less_1_month" | "1_3_months" | "3_6_months" | "6_plus_months";
  glp1DoseOptional?: string;
  glp1InjectionDayOptional?: string;
  baselineSideEffects?: SideEffectType[];
  proteinConfidence?: "low" | "medium" | "high";
  hydrationConfidence?: "low" | "medium" | "high";
  mealsPerDay?: number;
  underEatingConcern?: boolean;
  strengthTrainingBaseline?: "yes" | "sometimes" | "no";
  walkingFrequency?: "daily" | "few_times" | "rarely" | "never";
  medicationProfile?: MedicationProfile;
}

export interface MedicationProfile {
  medicationBrand: string;
  genericName: string;
  indication: string;
  doseValue: number;
  doseUnit: string;
  frequency: "weekly" | "daily";
  weekOnCurrentDose?: number;
  startDate?: string | null;
  lastInjectionDate?: string | null;
  recentTitration: boolean;
  previousDoseValue?: number | null;
  previousDoseUnit?: string | null;
  previousFrequency?: "weekly" | "daily" | null;
  doseChangeDate?: string | null;
  timeOnMedicationBucket: "less_1_month" | "1_3_months" | "3_6_months" | "6_plus_months";
  telehealthPlatform?: string | null;
  plannedDoseDay?: string | null;
}

export type MedicationLogStatus = "taken" | "skipped" | "missed" | "delayed";

export interface MedicationLogEntry {
  id: string;
  date: string;
  medicationBrand: string;
  status: MedicationLogStatus;
  doseValue: number;
  doseUnit: string;
  notes?: string;
  timestamp: number;
}

export type SideEffectType =
  | "nausea"
  | "fatigue"
  | "constipation"
  | "poor_appetite"
  | "dizziness"
  | "sleep_disruption"
  | "none";

export type HealthGoal =
  | "fat_loss"
  | "muscle_gain"
  | "better_sleep"
  | "improved_energy"
  | "better_recovery"
  | "general_wellness"
  | "endurance"
  | "improve_fitness"
  | "reduce_stress"
  | "stay_consistent"
  | "metabolic_health"
  | "preserve_muscle";

export type SubscriptionTier = "free" | "premium" | "premium_plus";

export interface HealthMetrics {
  date: string;
  steps: number;
  caloriesBurned: number;
  activeCalories: number;
  restingHeartRate: number;
  hrv: number;
  weight: number;
  sleepDuration: number;
  sleepQuality: number;
  recoveryScore: number;
  strain: number;
  vo2Max?: number;
  distance?: number;
  pace?: number;
}

export interface WorkoutEntry {
  id: string;
  date: string;
  type: string;
  duration: number;
  intensity: "low" | "moderate" | "high" | "very_high";
  caloriesBurned: number;
  heartRateAvg?: number;
  notes?: string;
}

export type DailyState = "recover" | "maintain" | "build" | "push";

export type DailyStatusLabel =
  | "You're in a good place today"
  | "A few small adjustments will help today"
  | "Let's make today a bit easier"
  | "Your body may need more support today";

export type ActionCategory = "move" | "fuel" | "recover" | "hydrate" | "consistent";

export interface DailyAction {
  id: string;
  category: ActionCategory;
  text: string;
  recommended: string;
  completed: boolean;
  reason?: string;
}

export interface CompletionRecord {
  date: string;
  actions: { id: string; category: ActionCategory; completed: boolean; recommended?: string; chosen?: string }[];
  completionRate: number;
}

export type AppetiteLevel = "strong" | "normal" | "low" | "very_low" | null;
export type NauseaLevel = "none" | "mild" | "moderate" | "severe" | null;
export type DigestionStatus = "fine" | "bloated" | "constipated" | "diarrhea" | null;
export type EnergyDaily = "great" | "good" | "tired" | "depleted" | null;

export interface GLP1DailyInputs {
  date: string;
  energy: EnergyDaily;
  appetite: AppetiteLevel;
  nausea: NauseaLevel;
  digestion: DigestionStatus;
}

export interface DailyCheckIn {
  date: string;
  energy: EnergyDaily;
  appetite: AppetiteLevel;
  nausea: NauseaLevel;
  digestion: DigestionStatus;
}

export interface DailyPlan {
  date: string;
  readinessScore: number;
  readinessLabel: "Low" | "Moderate" | "Good" | "Excellent";
  dailyState: DailyState;
  recommendedStateTag: StateTag;
  statusLabel: DailyStatusLabel;
  statusDrivers: string[];
  guidance: string;
  headline: string;
  summary: string;
  dailyFocus: string;
  actions: DailyAction[];
  yourDay: {
    move: string;
    fuel: string;
    hydrate: string;
    recover: string;
    consistent: string;
  };
  whyThisPlan: string[];
  optional?: string;
  recoverySummary: string;
  sleepSummary: string;
  workoutRecommendation: WorkoutRecommendation;
  nutritionTarget: NutritionTarget;
  fastingGuidance?: string;
  focusItems?: FocusItem[];
}

export interface FocusItem {
  text: string;
  category: ActionCategory;
}

export interface WorkoutRecommendation {
  type: string;
  duration: number;
  intensity: "low" | "moderate" | "high";
  description: string;
  exercises?: string[];
}

export interface NutritionTarget {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  hydration: number;
  note: string;
}

export interface WeeklyPlan {
  weekStartDate: string;
  weekSummary: string;
  days: WeeklyPlanDay[];
  adjustmentNote?: string;
}

export interface WeeklyPlanDay {
  dayOfWeek: string;
  date: string;
  focusArea: string;
  actions: WeeklyDayAction[];
}

export interface WeeklyDayAction {
  category: ActionCategory;
  recommended: string;
  chosen: string;
  completed: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface TrendData {
  label: string;
  data: { date: string; value: number }[];
  unit: string;
  trend: "up" | "down" | "stable";
  summary: string;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  lastSync?: string;
}

export type FeelingType = "great" | "good" | "tired" | "stressed" | null;
export type EnergyLevel = "excellent" | "high" | "medium" | "low" | null;
export type StressLevel = "low" | "moderate" | "high" | "very_high" | null;
export type HydrationLevel = "hydrated" | "good" | "low" | "dehydrated" | null;
export type TrainingIntent = "none" | "light" | "moderate" | "intense" | null;

export type StateTag = "great" | "good" | "tired" | "stressed";

export type PlanTier = "high" | "moderate" | "low" | "minimal";

export interface CategoryOption {
  id: string;
  title: string;
  subtitle: string;
  category: ActionCategory;
  stateTag: StateTag;
  planTier: PlanTier;
  supportText?: string[];
  durationMinutes?: number;
  intensity?: "low" | "moderate" | "high";
}

export const CATEGORY_OPTIONS: Record<ActionCategory, CategoryOption[]> = {
  move: [
    { id: "move_strength", title: "30-45 min strength", subtitle: "Preserve muscle on treatment", category: "move", stateTag: "great", planTier: "high", durationMinutes: 37, intensity: "moderate", supportText: ["Strength training preserves lean mass during weight loss", "Focus on compound movements like squats and presses"] },
    { id: "move_walk", title: "20-40 min walk", subtitle: "Steady daily movement", category: "move", stateTag: "good", planTier: "moderate", durationMinutes: 30, intensity: "low", supportText: ["Walking supports digestion and energy", "Post-meal walks can help with nausea"] },
    { id: "move_light", title: "10-20 min light movement", subtitle: "Keep momentum without overdoing it", category: "move", stateTag: "tired", planTier: "low", durationMinutes: 15, intensity: "low", supportText: ["Gentle movement helps energy levels", "No pressure on pace or distance"] },
    { id: "move_rest", title: "Full rest day", subtitle: "Let your body recover", category: "move", stateTag: "stressed", planTier: "minimal", durationMinutes: 0, intensity: "low", supportText: ["Rest is part of the plan", "Your body needs time to adjust"] },
  ],
  fuel: [
    { id: "fuel_full", title: "3 protein-focused meals", subtitle: "Hit your protein targets today", category: "fuel", stateTag: "great", planTier: "high", supportText: ["Aim for 25-30g protein per meal", "Protein preserves muscle during weight loss"] },
    { id: "fuel_balanced", title: "2-3 meals + protein snack", subtitle: "Steady fueling throughout the day", category: "fuel", stateTag: "good", planTier: "moderate", supportText: ["Smaller meals may feel easier", "Include protein at every meal"] },
    { id: "fuel_light", title: "Small frequent meals + protein", subtitle: "Eat even if appetite is low", category: "fuel", stateTag: "tired", planTier: "low", supportText: ["Low appetite is common on GLP-1s", "Try nutrient-dense small portions"] },
    { id: "fuel_minimal", title: "Light meals + easy digestion", subtitle: "Your body still needs fuel", category: "fuel", stateTag: "stressed", planTier: "minimal", supportText: ["Under-eating slows your metabolism", "Protein shakes can help when appetite is low"] },
  ],
  hydrate: [
    { id: "hydrate_high", title: "10+ cups + electrolytes", subtitle: "High hydration for active or symptom days", category: "hydrate", stateTag: "tired", planTier: "high", supportText: ["Dehydration worsens fatigue and nausea", "Add electrolytes if feeling dizzy"] },
    { id: "hydrate_standard", title: "8-10 cups + electrolytes", subtitle: "Full hydration with activity", category: "hydrate", stateTag: "great", planTier: "moderate", supportText: ["Electrolytes help with GLP-1 side effects", "Sip throughout the day"] },
    { id: "hydrate_light", title: "6-8 cups water", subtitle: "Stay consistent today", category: "hydrate", stateTag: "good", planTier: "low", supportText: ["Front-load fluids before noon", "One glass with each meal"] },
    { id: "hydrate_steady", title: "Steady sipping all day", subtitle: "Hydration supports your body's response", category: "hydrate", stateTag: "stressed", planTier: "minimal", supportText: ["Dehydration makes everything harder", "Set reminders if needed"] },
  ],
  recover: [
    { id: "recover_rest", title: "Early wind-down + 8+ hours", subtitle: "Full reset mode", category: "recover", stateTag: "stressed", planTier: "high", supportText: ["Your body needs extra recovery", "Prioritize sleep above everything"] },
    { id: "recover_extended", title: "8+ hours sleep", subtitle: "Your body needs extra rest", category: "recover", stateTag: "tired", planTier: "moderate", supportText: ["Start winding down early", "Prioritize sleep above all else tonight"] },
    { id: "recover_solid", title: "7-8 hours sleep", subtitle: "Solid recovery target", category: "recover", stateTag: "good", planTier: "low", supportText: ["Screen-free 30 min before bed", "Keep the room cool and dark"] },
    { id: "recover_maintain", title: "Under 7 hours sleep", subtitle: "Maintain your sleep quality", category: "recover", stateTag: "great", planTier: "minimal", supportText: ["Consistent sleep supports treatment", "Keep a consistent wake time"] },
  ],
  consistent: [
    { id: "consistent_great", title: "Complete your daily check-in", subtitle: "Keep the momentum going", category: "consistent", stateTag: "great", planTier: "high", supportText: ["Consistency compounds over time", "You're building a strong habit"] },
    { id: "consistent_good", title: "Log your meals and water", subtitle: "Small actions build habits", category: "consistent", stateTag: "good", planTier: "moderate", supportText: ["Tracking helps you stay aware", "Even rough days count"] },
    { id: "consistent_tired", title: "Just check in today", subtitle: "Showing up is enough", category: "consistent", stateTag: "tired", planTier: "low", supportText: ["A simple check-in keeps your streak", "Low days are part of the journey"] },
    { id: "consistent_stressed", title: "Keep routines simple today", subtitle: "Do the basics and rest", category: "consistent", stateTag: "stressed", planTier: "minimal", supportText: ["Simplify to essentials today", "Tomorrow is a fresh start"] },
  ],
};

export const WEEKLY_OPTIONS: Record<ActionCategory, string[]> = Object.fromEntries(
  (["move", "fuel", "hydrate", "recover", "consistent"] as ActionCategory[]).map(cat => [
    cat,
    CATEGORY_OPTIONS[cat].map(o => o.title),
  ])
) as Record<ActionCategory, string[]>;

export type MetricKey = "sleep" | "hrv" | "steps" | "restingHR" | "recovery" | "weight";

export interface MetricDetail {
  key: MetricKey;
  title: string;
  headline: string;
  explanation: string;
  whatItMeans: string;
  recommendation: string;
  currentValue: string;
  unit: string;
  trend: TrendData;
}

export interface SleepIntelligence {
  avgDuration: number;
  bedtimeConsistency: "consistent" | "somewhat_consistent" | "inconsistent";
  sleepTrend: "improving" | "declining" | "stable";
  insight: string;
  recommendation: string;
}

export interface WellnessInputs {
  feeling: FeelingType;
  energy: EnergyLevel;
  stress: StressLevel;
  hydration: HydrationLevel;
  trainingIntent: TrainingIntent;
}

export interface GLP1WellnessInputs {
  energy: EnergyDaily;
  appetite: AppetiteLevel;
  nausea: NauseaLevel;
  digestion: DigestionStatus;
}

export type RiskLevel = "low" | "mild" | "elevated" | "high";

export interface RiskDriver {
  category: "recovery" | "activity" | "fueling" | "symptoms" | "consistency";
  label: string;
  score: number;
}

export interface DropoutRiskResult {
  riskLevel: RiskLevel;
  riskScore: number;
  riskDrivers: RiskDriver[];
  interventionFocus: string[];
  userMessage: string;
  supportHeadline: string;
}

export const ACTION_OPTIONS: Record<ActionCategory, string[]> = Object.fromEntries(
  (["move", "fuel", "hydrate", "recover", "consistent"] as ActionCategory[]).map(cat => [
    cat,
    CATEGORY_OPTIONS[cat].map(o => o.title),
  ])
) as Record<ActionCategory, string[]>;

export type InputCategory = "energy" | "appetite" | "nausea" | "digestion";

export type TrendDirection = "up" | "flat" | "down";

export interface ScoredInput {
  label: string;
  score: number;
}

export interface CategoryAnalytics {
  category: InputCategory;
  avg7d: number;
  trend: TrendDirection;
  values: number[];
}

export interface InputCorrelation {
  pair: [InputCategory, InputCategory];
  direction: "positive" | "negative";
  strength: "strong" | "moderate" | "weak";
  insight: string;
}

export type PatientStatus = "stable" | "needs_attention" | "improving" | "new_patient";

export type PatientFlag =
  | "low_appetite"
  | "declining_recovery"
  | "missed_dose"
  | "high_side_effects"
  | "low_hydration"
  | "low_protein"
  | "declining_activity"
  | "poor_energy"
  | "improving_appetite"
  | "improving_hydration"
  | "consistent_logging";

export interface AdherenceSummary {
  dosesTaken: number;
  dosesExpected: number;
  dosesMissed: number;
  dosesDelayed: number;
  adherenceRate: number;
  currentStreak: number;
  longestStreak: number;
}

export interface InputAnalytics {
  categories: CategoryAnalytics[];
  correlations: InputCorrelation[];
  insights: string[];
  lastUpdated: string;
}

export interface PatientSummary {
  patientStatus: PatientStatus;
  keyFlags: PatientFlag[];
  medicationContext: {
    brand: string;
    dose: string;
    frequency: "weekly" | "daily";
    titrationStatus: "recent" | "stable";
    timeOnMedication: string;
  } | null;
  adherenceSummary: AdherenceSummary;
  trendSummary: {
    energy: { avg: number; trend: TrendDirection };
    appetite: { avg: number; trend: TrendDirection };
    nausea: { avg: number; trend: TrendDirection };
    digestion: { avg: number; trend: TrendDirection };
  };
  last7DayOverview: {
    avgCompletionRate: number;
    daysLogged: number;
    consistencyScore: number;
  };
  weeklySummaryLines: string[];
  generatedAt: string;
  detectedPatterns?: UserPatterns;
}

export type PatternConfidence = "low" | "medium" | "high";

export interface DetectedPattern {
  id: string;
  description: string;
  confidence: PatternConfidence;
  dataPoints: number;
  lastSeen: string;
}

export interface RollingAverage {
  category: InputCategory;
  avg7d: number;
  avg14d: number;
  trend7d: TrendDirection;
  trend14d: TrendDirection;
  volatility: number;
}

export interface PostDosePattern {
  dayOffset: number;
  category: InputCategory;
  avgScore: number;
  sampleSize: number;
}

export interface UserPatterns {
  rollingAverages: RollingAverage[];
  postDoseEffects: PostDosePattern[];
  behavioralPatterns: DetectedPattern[];
  adaptiveOverrides: AdaptiveOverride[];
  overallConfidence: PatternConfidence;
  dataPointCount: number;
  lastComputed: string;
}

export interface AdaptiveOverride {
  ruleId: string;
  baseRecommendation: string;
  adaptedRecommendation: string;
  reason: string;
  confidence: PatternConfidence;
}

export interface AdaptiveInsight {
  id: string;
  text: string;
  category: InputCategory | "general";
  confidence: PatternConfidence;
  type: "pattern" | "trend" | "correlation" | "post_dose";
}
