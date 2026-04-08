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

export const WEEKLY_OPTIONS: Record<ActionCategory, string[]> = {
  move: [
    "20 min walk",
    "30 min yoga",
    "40 min cardio",
    "45 min strength",
    "Mobility & stretching",
    "Active recovery",
    "Rest day",
  ],
  fuel: [
    "Balanced meals",
    "High protein",
    "Moderate carb",
    "Lighter meals",
    "Recovery nutrition",
  ],
  hydrate: [
    "8 cups water",
    "10+ cups water",
    "Water + electrolytes",
    "Hydration focus",
  ],
  recover: [
    "Bed by 10:00 pm",
    "Bed by 10:30 pm",
    "Aim for 7 hours",
    "Aim for 8 hours",
    "Wind down 30 min early",
  ],
  mind: [
    "5 min breathing",
    "10 min breathing",
    "5 min meditation",
    "10 min meditation",
    "Quiet time",
    "Skip",
  ],
};

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

export const ACTION_OPTIONS: Record<ActionCategory, string[]> = {
  move: [
    "20 min walk",
    "30 min yoga or stretch",
    "40 min cardio",
    "Strength training",
    "Stretch / mobility",
    "Active recovery · gentle movement",
    "Nature walk · fresh air",
    "Rest & recovery",
  ],
  fuel: [
    "Balanced meals · protein + veggies each meal",
    "High protein · lean meats, eggs, legumes",
    "Whole-food focus · minimize processed food",
    "Anti-inflammatory foods · leafy greens, berries, fish",
    "Light meals · easy on digestion",
    "Recovery nutrition · extra protein + complex carbs",
    "Meal prep for tomorrow",
    "Mindful eating · slow down, no screens",
  ],
  hydrate: [
    "8+ cups water throughout the day",
    "10+ cups water + electrolytes",
    "Herbal tea in the evening",
    "Start morning with a big glass of water",
    "Reduce caffeine after 2 pm",
    "Track water intake today",
  ],
  recover: [
    "Bed by 10:00 pm · wind down at 9:30",
    "Aim for 8 hours · protect your sleep window",
    "Wind down 30 min before bed · no screens",
    "Take a warm bath or shower before bed",
    "15 min stretch or foam roll",
    "Epsom salt soak · muscle recovery",
    "Limit alcohol tonight",
    "Sleep in / recovery focus",
  ],
  mind: [
    "5 min box breathing",
    "10 min guided meditation",
    "Gratitude journaling · 3 things",
    "15 min screen-free break",
    "10 min walk outside · no phone",
    "Body scan relaxation",
    "Call or connect with someone you care about",
    "Skip for today",
  ],
};
