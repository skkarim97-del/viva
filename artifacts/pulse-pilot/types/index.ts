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
}

export type HealthGoal =
  | "fat_loss"
  | "muscle_gain"
  | "better_sleep"
  | "improved_energy"
  | "better_recovery"
  | "general_wellness"
  | "endurance";

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

export interface DailyPlan {
  date: string;
  readinessScore: number;
  readinessLabel: "Low" | "Moderate" | "Good" | "Excellent";
  headline: string;
  summary: string;
  dailyFocus: string;
  todaysPlan: {
    workout: string;
    movement: string;
    nutrition: string;
    recoveryMind: string;
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
  days: WeeklyPlanDay[];
  nutritionPriorities: string[];
  stepGoal: number;
  fastingSchedule?: string;
  adjustmentNote?: string;
}

export interface WeeklyPlanDay {
  dayOfWeek: string;
  date: string;
  isRestDay: boolean;
  workout?: WorkoutRecommendation;
  focusArea: string;
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

export type FeelingType = "great" | "good" | "tired" | "exhausted" | "stressed" | null;
export type EnergyLevel = "high" | "medium" | "low" | null;
export type StressLevel = "low" | "moderate" | "high" | null;

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
}
