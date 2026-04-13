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
export type ProteinConfidenceDaily = "high" | "good" | "okay" | "low" | null;
export type HydrationDaily = "high" | "good" | "okay" | "poor" | null;
export type SideEffectSeverity = "none" | "mild" | "moderate" | "rough" | null;
export type MovementIntent = "walk" | "strength" | "light_recovery" | "rest" | null;
export type EnergyDaily = "great" | "good" | "tired" | "depleted" | null;

export interface GLP1DailyInputs {
  date: string;
  energy: EnergyDaily;
  appetite: AppetiteLevel;
  hydration: HydrationDaily;
  proteinConfidence: ProteinConfidenceDaily;
  sideEffects: SideEffectSeverity;
  movementIntent: MovementIntent;
}

export interface DailyCheckIn {
  date: string;
  energy: EnergyDaily;
  appetite: AppetiteLevel;
  hydration: HydrationDaily;
  proteinConfidence: ProteinConfidenceDaily;
  sideEffects: SideEffectSeverity;
  movementIntent: MovementIntent;
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
    { id: "move_great", title: "30 min strength training", subtitle: "Preserve muscle on treatment", category: "move", stateTag: "great", durationMinutes: 30, intensity: "moderate", supportText: ["Strength training helps preserve lean mass", "Focus on compound movements"] },
    { id: "move_good", title: "30 min walk", subtitle: "Steady daily movement", category: "move", stateTag: "good", durationMinutes: 30, intensity: "low", supportText: ["Walking supports digestion and energy", "Post-meal walks can help with nausea"] },
    { id: "move_tired", title: "15 min gentle movement", subtitle: "Keep momentum without overdoing it", category: "move", stateTag: "tired", durationMinutes: 15, intensity: "low", supportText: ["Gentle movement helps energy levels", "No pressure on pace or distance"] },
    { id: "move_stressed", title: "Full rest day", subtitle: "Let your body recover", category: "move", stateTag: "stressed", durationMinutes: 0, intensity: "low", supportText: ["Rest is part of the plan", "Your body needs time to adjust"] },
  ],
  fuel: [
    { id: "fuel_great", title: "3 protein-focused meals", subtitle: "Hit your protein targets today", category: "fuel", stateTag: "great", supportText: ["Aim for 25-30g protein per meal", "Protein preserves muscle during weight loss"] },
    { id: "fuel_good", title: "Balanced meals + protein snack", subtitle: "Steady fueling throughout the day", category: "fuel", stateTag: "good", supportText: ["Smaller meals may feel easier", "Include protein at every meal"] },
    { id: "fuel_tired", title: "Small frequent meals", subtitle: "Eat even if appetite is low", category: "fuel", stateTag: "tired", supportText: ["Low appetite is common on GLP-1s", "Try nutrient-dense small portions"] },
    { id: "fuel_stressed", title: "Focus on not under-eating", subtitle: "Your body still needs fuel", category: "fuel", stateTag: "stressed", supportText: ["Under-eating slows your metabolism", "Protein shakes can help when appetite is low"] },
  ],
  hydrate: [
    { id: "hydrate_great", title: "8 cups + electrolytes", subtitle: "Full hydration with activity", category: "hydrate", stateTag: "great", supportText: ["Electrolytes help with GLP-1 side effects", "Sip throughout the day"] },
    { id: "hydrate_good", title: "8 cups water", subtitle: "Stay consistent today", category: "hydrate", stateTag: "good", supportText: ["Front-load fluids before noon", "One glass with each meal"] },
    { id: "hydrate_tired", title: "10+ cups + electrolytes", subtitle: "Extra hydration for recovery", category: "hydrate", stateTag: "tired", supportText: ["Dehydration worsens fatigue and nausea", "Add electrolytes if feeling dizzy"] },
    { id: "hydrate_stressed", title: "Steady sipping all day", subtitle: "Hydration supports your body's response", category: "hydrate", stateTag: "stressed", supportText: ["Dehydration makes everything harder", "Set reminders if needed"] },
  ],
  recover: [
    { id: "recover_great", title: "Aim for 7-8 hours", subtitle: "Maintain your sleep quality", category: "recover", stateTag: "great", supportText: ["Consistent sleep supports treatment", "Keep a consistent wake time"] },
    { id: "recover_good", title: "Aim for 8 hours", subtitle: "Solid recovery target", category: "recover", stateTag: "good", supportText: ["Screen-free 30 min before bed", "Keep the room cool and dark"] },
    { id: "recover_tired", title: "Aim for 8+ hours", subtitle: "Your body needs extra rest", category: "recover", stateTag: "tired", supportText: ["Start winding down early", "Prioritize sleep above all else tonight"] },
    { id: "recover_stressed", title: "Early wind-down tonight", subtitle: "Full reset mode", category: "recover", stateTag: "stressed", supportText: ["Your body needs extra recovery", "Prioritize sleep above everything"] },
  ],
  consistent: [
    { id: "consistent_great", title: "Complete your daily check-in", subtitle: "Keep the momentum going", category: "consistent", stateTag: "great", supportText: ["Consistency compounds over time", "You're building a strong habit"] },
    { id: "consistent_good", title: "Log your meals and water", subtitle: "Small actions build habits", category: "consistent", stateTag: "good", supportText: ["Tracking helps you stay aware", "Even rough days count"] },
    { id: "consistent_tired", title: "Just check in today", subtitle: "Showing up is enough", category: "consistent", stateTag: "tired", supportText: ["A simple check-in keeps your streak", "Low days are part of the journey"] },
    { id: "consistent_stressed", title: "Keep routines simple today", subtitle: "Do the basics and rest", category: "consistent", stateTag: "stressed", supportText: ["Simplify to essentials today", "Tomorrow is a fresh start"] },
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
  hydration: HydrationDaily;
  proteinConfidence: ProteinConfidenceDaily;
  sideEffects: SideEffectSeverity;
  movementIntent: MovementIntent;
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
