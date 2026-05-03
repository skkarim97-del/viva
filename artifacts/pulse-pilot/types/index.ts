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
  glp1Duration?: "less_30_days" | "30_60_days" | "60_90_days" | "3_6_months" | "6_12_months" | "1_2_years" | "2_plus_years";

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
  timeOnMedicationBucket: "less_30_days" | "30_60_days" | "60_90_days" | "3_6_months" | "6_12_months" | "1_2_years" | "2_plus_years";
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
  // Fetched, 0 is a legitimate value (not a fake default).
  steps: number;
  caloriesBurned: number;
  activeCalories: number;
  sleepDuration: number;
  // Fetched but may be unavailable. null means "not measured that day" — never treat as 0.
  restingHeartRate: number | null;
  hrv: number | null;
  weight: number | null;
  // Not yet fetched from HealthKit. Currently always null. Consumers must gate via availableMetricTypes.
  sleepQuality: number | null;
  recoveryScore: number | null;
  strain: number | null;
  // Optional extras.
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

// Was a fixed literal union of 4 canned phrases. Now a free-form string so
// planEngine can surface a tailored, context-aware lead phrase (short sleep,
// severe nausea, dose titration, mixed signals, green-light day, etc.).
// Color is driven by plan.dailyState, not by the label text.
export type DailyStatusLabel = string;

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
  // Optional patient-reported objective signal for the constipation
  // engine. Null = unanswered; the planning engine ignores this field.
  bowelMovementToday?: boolean | null;
  // Same-day "previous value" snapshots. Captured at upsert time when
  // the patient edits a category later in the same day (e.g. 9am
  // energy=tired, 2pm energy=depleted -> previousEnergy="tired"). Null
  // when this is the first entry of the day, or when the new value
  // matches the previous one. Cleared on the next day's first save.
  // Used for intra-day deterioration detection ("Energy worsened
  // today") and smarter re-trigger logic, without polluting the trend
  // history -- there is still exactly one row per day.
  previousEnergy?: EnergyDaily | null;
  previousAppetite?: AppetiteLevel | null;
  previousNausea?: NauseaLevel | null;
  previousDigestion?: DigestionStatus | null;
}

export type MentalState = "focused" | "good" | "low" | "burnt_out" | null;

export interface DailyCheckIn {
  date: string;
  mentalState: MentalState;
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
  // Internal: data tier + recommendation confidence, used to soften patient-facing copy.
  // Never displayed numerically.
  dataTier?: "self_report" | "phone_health" | "wearable";
  recommendationConfidence?: "low" | "moderate" | "high";
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

export type InternalSeverity = "green" | "yellow" | "orange" | "red";

export interface WeeklyPlan {
  weekStartDate: string;
  weekSummary: string;
  days: WeeklyPlanDay[];
  adjustmentNote?: string;
  adaptiveSummary?: string;
  isAdapted?: boolean;
}

export interface WeeklyPlanDay {
  dayOfWeek: string;
  date: string;
  focusArea: string;
  actions: WeeklyDayAction[];
  adaptiveNote?: string;
  isAdapted?: boolean;
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
  // T006 -- distinguishes a structured (category+severity) turn from a
  // legacy free-text turn or a system notice (e.g. "safe mode is on").
  // Defaults to "free" when omitted so older persisted rows still render.
  kind?: "free" | "structured" | "notice";
  // For structured turns we render a small badge alongside the bubble
  // so the patient can scan their history without re-reading the body.
  category?: string;
  severity?: "mild" | "moderate" | "severe";
  templateId?: string;
  escalated?: boolean;
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

// Single source of truth for plan-item titles, subtitles, and tips.
// Consumed by the Today tab "Your plan" section and the Week tab
// option bottom-sheet, so editing copy here updates both surfaces.
//
// Copy guidelines (from the design refresh):
//  - specific enough to act on (real targets, real durations)
//  - concise enough to scan quickly
//  - premium and supportive, never harsh or scary
//  - avoid clunky titles like "Early wind-down + 8+ hours" and
//    avoid lines like "Under-eating slows your metabolism"
export const CATEGORY_OPTIONS: Record<ActionCategory, CategoryOption[]> = {
  move: [
    { id: "move_strength", title: "Strength training", subtitle: "20-30 minutes of light-to-moderate strength work, if energy feels steady.", category: "move", stateTag: "great", planTier: "high", durationMinutes: 25, intensity: "moderate", supportText: ["Compound moves like squats and presses give you the most for your time", "Strength work helps preserve muscle while you lose weight"] },
    { id: "move_walk", title: "Cardio", subtitle: "20-30 minutes of easy cardio. Keep the pace conversational.", category: "move", stateTag: "good", planTier: "moderate", durationMinutes: 25, intensity: "low", supportText: ["A post-meal walk can help with digestion and nausea", "Conversational pace means you can still talk in full sentences"] },
    { id: "move_light", title: "Light movement", subtitle: "10-15 minutes of gentle movement, like walking or stretching.", category: "move", stateTag: "tired", planTier: "low", durationMinutes: 12, intensity: "low", supportText: ["Keep things moving without strain", "No pressure on pace or distance"] },
    { id: "move_rest", title: "Full rest day", subtitle: "Take pressure off today. Light movement is enough.", category: "move", stateTag: "stressed", planTier: "minimal", durationMinutes: 0, intensity: "low", supportText: ["Rest is part of the plan", "Your body needs time to adjust"] },
  ],
  fuel: [
    { id: "fuel_full", title: "Protein-forward meals", subtitle: "Aim for ~25-30g of protein at each meal.", category: "fuel", stateTag: "great", planTier: "high", supportText: ["Protein at every meal helps preserve muscle while losing weight", "Eggs, yogurt, fish, tofu, and lean meats are easy options"] },
    { id: "fuel_balanced", title: "Steady fueling", subtitle: "2-3 balanced meals, with protein at each one.", category: "fuel", stateTag: "good", planTier: "moderate", supportText: ["Smaller meals can feel easier on GLP-1 medication", "A protein-rich snack can fill the gap if a meal feels like too much"] },
    { id: "fuel_light", title: "Small meals", subtitle: "Choose 2-3 smaller meals instead of forcing full portions.", category: "fuel", stateTag: "tired", planTier: "low", supportText: ["Low appetite is common on GLP-1 medication", "Nutrient-dense bites are more useful than big plates right now"] },
    { id: "fuel_minimal", title: "Gentle fueling", subtitle: "Keep meals small, simple, and protein-forward.", category: "fuel", stateTag: "stressed", planTier: "minimal", supportText: ["A few bites or sips still count", "Smoothies, soups, and yogurt are easy when appetite is low"] },
  ],
  hydrate: [
    // Order is most → least intensive to mirror the rest of the plan
    // ladders. Default selection is driven by stateTag mapping:
    //   tired   -> Hydration support  (tired days often signal symptoms,
    //                                  electrolytes help GLP-1 side effects)
    //   great   -> Steady hydration   (typical good day)
    //   good    -> Light hydration    (lighter day, lighter target)
    //   stressed-> Fluids first       (overwhelmed: just keep sipping)
    // Symptom-driven overrides (hydrate_side_effects in patternEngine)
    // can still promote Hydration support when the rule fires.
    { id: "hydrate_high", title: "Hydration support", subtitle: "Keep fluids steady. Add electrolytes if they usually help you.", category: "hydrate", stateTag: "tired", planTier: "high", supportText: ["Electrolytes can help on heavier-symptom days", "Sip slowly if nausea makes a full glass feel like too much"] },
    { id: "hydrate_standard", title: "Steady hydration", subtitle: "Aim for 6-8 cups across the day, adjusting for thirst and activity.", category: "hydrate", stateTag: "great", planTier: "moderate", supportText: ["Sip throughout the day rather than all at once", "One glass with each meal keeps you on pace"] },
    { id: "hydrate_light", title: "Light hydration", subtitle: "5-6 cups across the day. One glass with each meal.", category: "hydrate", stateTag: "good", planTier: "low", supportText: ["Front-load fluids before the afternoon", "Herbal tea and broths count too"] },
    { id: "hydrate_steady", title: "Fluids first", subtitle: "Start with small sips and build gradually.", category: "hydrate", stateTag: "stressed", planTier: "minimal", supportText: ["Small amounts are easier when nausea shows up", "Set a soft reminder if you tend to forget"] },
  ],
  recover: [
    { id: "recover_rest", title: "Earlier wind-down", subtitle: "Begin winding down 30-60 minutes earlier tonight.", category: "recover", stateTag: "stressed", planTier: "high", supportText: ["Lower the lights and put screens away earlier than usual", "An extra hour of rest tonight makes tomorrow easier"] },
    { id: "recover_extended", title: "Sleep support", subtitle: "Aim for 7-8 hours of sleep, if your schedule allows.", category: "recover", stateTag: "tired", planTier: "moderate", supportText: ["Start winding down a little earlier than usual", "Protect tonight's sleep above other to-dos"] },
    { id: "recover_solid", title: "Solid sleep", subtitle: "7-8 hours overnight. Keep the room cool and dark.", category: "recover", stateTag: "good", planTier: "low", supportText: ["Screen-free for the 30 minutes before bed", "Consistent timing matters more than perfect duration"] },
    { id: "recover_maintain", title: "Consistent rest", subtitle: "Protect a steady bedtime so your body keeps recovering.", category: "recover", stateTag: "great", planTier: "minimal", supportText: ["A consistent wake time supports treatment over the long run", "You're building a routine that compounds"] },
  ],
  consistent: [
    { id: "consistent_great", title: "Daily check-in", subtitle: "A quick check-in keeps your plan tuned to how you feel.", category: "consistent", stateTag: "great", planTier: "high", supportText: ["Consistency compounds over time", "You're building a strong habit"] },
    { id: "consistent_good", title: "Log meals and water", subtitle: "Small actions build the habit.", category: "consistent", stateTag: "good", planTier: "moderate", supportText: ["Tracking helps you spot what's working", "Rough days count too"] },
    { id: "consistent_tired", title: "Quick check-in", subtitle: "Showing up is enough today.", category: "consistent", stateTag: "tired", planTier: "low", supportText: ["A simple check-in keeps your streak", "Low days are part of the journey"] },
    { id: "consistent_stressed", title: "Keep it simple", subtitle: "Do the basics and rest. Tomorrow is a fresh start.", category: "consistent", stateTag: "stressed", planTier: "minimal", supportText: ["Simplify to essentials today", "Small wins still count"] },
  ],
};

export const WEEKLY_OPTIONS: Record<ActionCategory, string[]> = Object.fromEntries(
  (["move", "fuel", "hydrate", "recover", "consistent"] as ActionCategory[]).map(cat => [
    cat,
    CATEGORY_OPTIONS[cat].map(o => o.title),
  ])
) as Record<ActionCategory, string[]>;

// Recovery is a derived internal score that engines use but is never
// surfaced to patients as a % in the UI. It is deliberately omitted from
// MetricKey so no detail view, trend tile, or router path can reach it.
export type MetricKey = "sleep" | "hrv" | "steps" | "restingHR" | "weight" | "activeCalories" | "activeDays";

export interface MetricDetail {
  key: MetricKey;
  title: string;
  headline: string;
  explanation: string;
  whatItMeans: string;
  recommendation: string;
  currentValue: string;
  unit: string;
  // Optional secondary stat shown beneath the hero (e.g. "Today: 9,234 steps"
  // when the hero shows the 28-day average).
  secondaryLabel?: string;
  secondaryValue?: string;
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
  // Number of valid (non-zero) datapoints in the last 14 days. One
  // check-in per day max, so this also doubles as "days of data".
  // Used to gate trend insights so we never claim a 2-week pattern
  // off 3 datapoints.
  sampleSize14d: number;
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
