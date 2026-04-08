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
}

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
  | "stay_consistent";

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

export type DailyStatusLabel = "Strong Day" | "On Track" | "Slightly Off Track" | "Off Track";

export type ActionCategory = "move" | "fuel" | "recover" | "mind" | "hydrate";

export interface DailyAction {
  id: string;
  category: ActionCategory;
  text: string;
  recommended: string;
  completed: boolean;
}

export interface CompletionRecord {
  date: string;
  actions: { id: string; category: ActionCategory; completed: boolean; recommended?: string; chosen?: string }[];
  completionRate: number;
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
    mind: string;
  };
  whyThisPlan: string[];
  optional?: string;
  recoverySummary: string;
  sleepSummary: string;
  workoutRecommendation: WorkoutRecommendation;
  nutritionTarget: NutritionTarget;
  fastingGuidance?: string;
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

export interface CategoryOption {
  id: string;
  title: string;
  subtitle: string;
  category: ActionCategory;
  stateTag: StateTag;
  supportText?: string[];
  durationMinutes?: number;
  intensity?: "low" | "moderate" | "high";
}

export const CATEGORY_OPTIONS: Record<ActionCategory, CategoryOption[]> = {
  move: [
    { id: "move_great", title: "60 min strength training", subtitle: "Strong training day", category: "move", stateTag: "great", durationMinutes: 60, intensity: "high", supportText: ["5 min dynamic warmup", "Post-workout stretch"] },
    { id: "move_good", title: "45 min cardio", subtitle: "Solid baseline movement", category: "move", stateTag: "good", durationMinutes: 45, intensity: "moderate", supportText: ["Keep a conversational pace", "Cool down with 5 min walk"] },
    { id: "move_tired", title: "20 min recovery walk", subtitle: "Gentle recovery movement", category: "move", stateTag: "tired", durationMinutes: 20, intensity: "low", supportText: ["Fresh air helps energy", "No pace pressure"] },
    { id: "move_stressed", title: "15 min yoga or mobility", subtitle: "Nervous system reset", category: "move", stateTag: "stressed", durationMinutes: 15, intensity: "low", supportText: ["Focus on breathing", "Gentle stretching only"] },
  ],
  mind: [
    { id: "mind_great", title: "10 min journaling", subtitle: "Capture your clarity", category: "mind", stateTag: "great", durationMinutes: 10, supportText: ["Write freely, no rules", "Reflect on what's working"] },
    { id: "mind_good", title: "10 min guided meditation", subtitle: "Centered and focused", category: "mind", stateTag: "good", durationMinutes: 10, supportText: ["Use a timer or app", "Find a quiet spot"] },
    { id: "mind_tired", title: "15 min hot bath", subtitle: "Rest and restore", category: "mind", stateTag: "tired", durationMinutes: 15, supportText: ["Add epsom salts if available", "No screens during"] },
    { id: "mind_stressed", title: "5 min box breathing", subtitle: "Calm your nervous system", category: "mind", stateTag: "stressed", durationMinutes: 5, supportText: ["4 counts in, hold, out, hold", "Repeat 5 cycles"] },
  ],
  fuel: [
    { id: "fuel_great", title: "High protein focus", subtitle: "Fuel your performance", category: "fuel", stateTag: "great", supportText: ["Protein at every meal", "Include whole grains for energy"] },
    { id: "fuel_good", title: "Balanced meals", subtitle: "Solid everyday nutrition", category: "fuel", stateTag: "good", supportText: ["Protein, carbs, and fats each meal", "Include colorful vegetables"] },
    { id: "fuel_tired", title: "Light and easy digestion", subtitle: "Gentle on your system", category: "fuel", stateTag: "tired", supportText: ["Warm, simple meals", "Steady blood sugar support"] },
    { id: "fuel_stressed", title: "Whole-food reset", subtitle: "Nourish and simplify", category: "fuel", stateTag: "stressed", supportText: ["Magnesium-rich greens and nuts", "Minimize processed food"] },
  ],
  hydrate: [
    { id: "hydrate_great", title: "Post-workout hydration focus", subtitle: "Replace what you lose", category: "hydrate", stateTag: "great", supportText: ["Water + electrolytes around training", "Track intake if possible"] },
    { id: "hydrate_good", title: "8 cups water baseline", subtitle: "Stay consistent today", category: "hydrate", stateTag: "good", supportText: ["Sip throughout the day", "One glass with each meal"] },
    { id: "hydrate_tired", title: "10+ cups + electrolytes", subtitle: "Extra hydration for recovery", category: "hydrate", stateTag: "tired", supportText: ["Dehydration worsens fatigue", "Add a pinch of salt or electrolyte mix"] },
    { id: "hydrate_stressed", title: "Steady hydration + lower caffeine", subtitle: "Calm your system", category: "hydrate", stateTag: "stressed", supportText: ["Swap afternoon coffee for herbal tea", "Hydration supports stress response"] },
  ],
  recover: [
    { id: "recover_great", title: "Bed by 10:30 pm", subtitle: "Protect your gains", category: "recover", stateTag: "great", supportText: ["Wind down at 10:00", "Muscles repair during sleep"] },
    { id: "recover_good", title: "Aim for 8 hours", subtitle: "Solid recovery window", category: "recover", stateTag: "good", supportText: ["Screen-free 30 min before bed", "Keep the room cool and dark"] },
    { id: "recover_tired", title: "Bed by 9:30 pm", subtitle: "Prioritize extra rest", category: "recover", stateTag: "tired", supportText: ["Start winding down at 9:00", "Skip late-night screens"] },
    { id: "recover_stressed", title: "Warm bath + bed by 10 pm", subtitle: "Calm before sleep", category: "recover", stateTag: "stressed", supportText: ["Hot water lowers cortisol", "Try a body scan in bed"] },
  ],
};

export const WEEKLY_OPTIONS: Record<ActionCategory, string[]> = Object.fromEntries(
  (["move", "fuel", "hydrate", "recover", "mind"] as ActionCategory[]).map(cat => [
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

export const ACTION_OPTIONS: Record<ActionCategory, string[]> = Object.fromEntries(
  (["move", "fuel", "hydrate", "recover", "mind"] as ActionCategory[]).map(cat => [
    cat,
    CATEGORY_OPTIONS[cat].map(o => o.title),
  ])
) as Record<ActionCategory, string[]>;
