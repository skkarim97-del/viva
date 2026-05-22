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
    {
      id: "move_strength",
      title: "Strength session",
      subtitle: "20-30 minutes of moderate strength work. Keep form over load.",
      category: "move", stateTag: "great", planTier: "high", durationMinutes: 25, intensity: "moderate",
      supportText: ["Compound moves like squats and presses give the most return", "Strength work protects muscle while losing weight on treatment"],
    },
    {
      id: "move_walk",
      title: "Steady cardio",
      subtitle: "20-30 minutes of easy cardio. Conversational pace.",
      category: "move", stateTag: "good", planTier: "moderate", durationMinutes: 25, intensity: "low",
      supportText: ["A post-meal walk can ease digestion and mild nausea", "Conversational pace means you can talk in full sentences while moving"],
    },
    {
      id: "move_light",
      title: "Light movement",
      subtitle: "10-15 minutes of gentle walking or stretching.",
      category: "move", stateTag: "tired", planTier: "low", durationMinutes: 12, intensity: "low",
      supportText: ["No pressure on pace or distance", "Gentle movement supports circulation without adding strain"],
    },
    {
      id: "move_rest",
      title: "Rest day",
      subtitle: "Rest is the plan. Gentle walking only if it feels okay.",
      category: "move", stateTag: "stressed", planTier: "minimal", durationMinutes: 0, intensity: "low",
      supportText: ["Rest is recovery", "Your body needs this time. It is not falling behind."],
    },
  ],
  fuel: [
    {
      id: "fuel_full",
      title: "Protein-forward meals",
      subtitle: "25-30g protein per meal. Focus on muscle retention.",
      category: "fuel", stateTag: "great", planTier: "high",
      supportText: ["Eggs, yogurt, fish, tofu, and lean meats are reliable options", "Protein at every meal is the highest-leverage nutrition habit on treatment"],
    },
    {
      id: "fuel_balanced",
      title: "Balanced fueling",
      subtitle: "2-3 structured meals, protein at each one.",
      category: "fuel", stateTag: "good", planTier: "moderate",
      supportText: ["A protein-rich snack bridges the gap if a meal feels like too much", "Smaller meals are normal and expected on GLP-1 treatment"],
    },
    {
      id: "fuel_light",
      title: "Small, frequent meals",
      subtitle: "Smaller portions, more often. Protein stays the priority.",
      category: "fuel", stateTag: "tired", planTier: "low",
      supportText: ["Low appetite is common on GLP-1 medication", "Nutrient-dense bites matter more than plate size when appetite is low"],
    },
    {
      id: "fuel_minimal",
      title: "Gentle fueling",
      subtitle: "Easy-to-digest foods, small amounts. Sip fluids between bites.",
      category: "fuel", stateTag: "stressed", planTier: "minimal",
      supportText: ["Smoothies, broth, and yogurt work well when GI symptoms are active", "A few bites every couple of hours still supports nutrition"],
    },
  ],
  hydrate: [
    // stateTag mapping is intentionally non-monotonic:
    //   tired    -> Active hydration   (symptom days benefit most from electrolytes)
    //   great    -> Standard hydration (steady good-day target)
    //   good     -> Regular fluids     (slightly lighter target)
    //   stressed -> Sip steadily       (overwhelmed: small sips, no pressure)
    {
      id: "hydrate_high",
      title: "Active hydration",
      subtitle: "Fluids first. Add electrolytes if you feel lightheaded or fatigued.",
      category: "hydrate", stateTag: "tired", planTier: "high",
      supportText: ["Electrolytes help on heavier-symptom days", "Sip slowly if nausea makes a full glass feel like too much"],
    },
    {
      id: "hydrate_standard",
      title: "Standard hydration",
      subtitle: "6-8 cups across the day. One glass with each meal.",
      category: "hydrate", stateTag: "great", planTier: "moderate",
      supportText: ["Sip throughout the day rather than all at once", "Front-load fluids in the morning when appetite is strongest"],
    },
    {
      id: "hydrate_light",
      title: "Regular fluids",
      subtitle: "5-6 cups. Sip steadily rather than all at once.",
      category: "hydrate", stateTag: "good", planTier: "low",
      supportText: ["Herbal tea and broths count toward your fluid target", "One glass before each meal is an easy anchor"],
    },
    {
      id: "hydrate_steady",
      title: "Sip steadily",
      subtitle: "Small sips every 15-20 minutes. Don't force large amounts at once.",
      category: "hydrate", stateTag: "stressed", planTier: "minimal",
      supportText: ["Small amounts are easier when nausea is active", "Set a soft reminder if you tend to forget"],
    },
  ],
  recover: [
    {
      id: "recover_rest",
      title: "Wind down early",
      subtitle: "Start winding down 30-60 minutes earlier tonight. Low light, no screens.",
      category: "recover", stateTag: "stressed", planTier: "high",
      supportText: ["Lower the lights and put screens away earlier than usual", "An extra hour of rest makes tomorrow noticeably easier"],
    },
    {
      id: "recover_extended",
      title: "Prioritize rest",
      subtitle: "Aim for 7-8 hours. Protect tonight's sleep above other to-dos.",
      category: "recover", stateTag: "tired", planTier: "moderate",
      supportText: ["Start winding down a little earlier than usual", "Sleep quality matters more than quantity: cool, quiet, dark"],
    },
    {
      id: "recover_solid",
      title: "Protect your sleep",
      subtitle: "7-8 hours. Cool, dark room. Screen-free 30 minutes before bed.",
      category: "recover", stateTag: "good", planTier: "low",
      supportText: ["Consistent timing matters more than perfect duration", "A consistent wake time anchors your rhythm all week"],
    },
    {
      id: "recover_maintain",
      title: "Maintain your rhythm",
      subtitle: "Keep a consistent bedtime. Same time each night compounds over time.",
      category: "recover", stateTag: "great", planTier: "minimal",
      supportText: ["You're in a good routine. Protect it.", "Sleep consistency is one of the highest-leverage recovery habits on treatment"],
    },
  ],
  consistent: [
    {
      id: "consistent_great",
      title: "Daily check-in",
      subtitle: "A quick check-in keeps your plan tuned to how you feel.",
      category: "consistent", stateTag: "great", planTier: "high",
      supportText: ["Consistency compounds over time", "You're building a strong habit"],
    },
    {
      id: "consistent_good",
      title: "Log meals and water",
      subtitle: "Small, consistent habits compound over time.",
      category: "consistent", stateTag: "good", planTier: "moderate",
      supportText: ["Tracking helps you spot what's working", "Rough days count too"],
    },
    {
      id: "consistent_tired",
      title: "Quick check-in",
      subtitle: "Showing up today is enough.",
      category: "consistent", stateTag: "tired", planTier: "low",
      supportText: ["A simple check-in keeps your streak", "Low days are part of the process"],
    },
    {
      id: "consistent_stressed",
      title: "Basics only",
      subtitle: "Rest, fluids, and medication. That's the priority today.",
      category: "consistent", stateTag: "stressed", planTier: "minimal",
      supportText: ["Simplify to essentials today", "Small wins still count"],
    },
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
