import { Platform } from "react-native";
import {
  CATEGORY_OPTIONS,
  type UserProfile,
  type HealthMetrics,
  type DailyPlan,
  type WeeklyPlan,
  type WeeklyPlanDay,
  type TrendData,
  type WorkoutEntry,
  type IntegrationStatus,
  type MetricDetail,
  type MetricKey,
  type WellnessInputs,
  type DailyAction,
  type CompletionRecord,
  type ActionCategory,
  type StateTag,
  type FeelingType,
  type StressLevel,
  type EnergyLevel,
  type CategoryOption,
  type FocusItem,
  type GLP1DailyInputs,
  type MedicationProfile,
} from "@/types";
import { getDoseTier } from "./medicationData";

export const defaultProfile: UserProfile = {
  id: "user_1",
  name: "",
  age: 32,
  sex: "female",
  height: 65,
  weight: 195,
  goalWeight: 160,
  dietaryPreference: "balanced",
  workoutPreference: "mixed",
  injuries: "",
  availableWorkoutTime: 30,
  daysAvailableToTrain: 3,
  coachingTone: "gentle",
  goals: ["fat_loss", "stay_consistent"],
  tier: "free",
  onboardingComplete: false,
  fastingEnabled: false,
  units: "imperial",
  glp1Medication: undefined,
  glp1Reason: undefined,
  glp1Duration: undefined,
  proteinConfidence: undefined,
  hydrationConfidence: undefined,
  mealsPerDay: 3,
  underEatingConcern: false,
  strengthTrainingBaseline: "no",
  activityLevel: "light",
};

function generateDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

export function generateMockMetrics(days: number = 30): HealthMetrics[] {
  const metrics: HealthMetrics[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const baseHrv = 42 + Math.sin(i / 7) * 8;
    const baseRhr = 62 - Math.sin(i / 10) * 3;
    const baseSleep = 7.2 + Math.sin(i / 5) * 0.8;
    const baseSteps = 6000 + Math.sin(i / 3) * 2000;
    const baseWeight = 195 - (i > 15 ? 0 : (15 - i) * 0.2);

    metrics.push({
      date: generateDateString(i),
      steps: Math.round(baseSteps + (Math.random() - 0.5) * 1000),
      caloriesBurned: Math.round(1800 + (Math.random() - 0.5) * 300),
      activeCalories: Math.round(250 + (Math.random() - 0.5) * 150),
      restingHeartRate: Math.round(baseRhr + (Math.random() - 0.5) * 4),
      hrv: Math.round(baseHrv + (Math.random() - 0.5) * 6),
      weight: Math.round((baseWeight + (Math.random() - 0.5) * 1) * 10) / 10,
      sleepDuration: Math.round((baseSleep + (Math.random() - 0.5) * 1.2) * 10) / 10,
      sleepQuality: Math.round(70 + Math.sin(i / 6) * 15 + (Math.random() - 0.5) * 10),
      recoveryScore: Math.round(65 + Math.sin(i / 5) * 15 + (Math.random() - 0.5) * 10),
      strain: Math.round(6 + Math.sin(i / 4) * 3 + (Math.random() - 0.5) * 2),
      vo2Max: 38,
    });
  }
  return metrics;
}

export function generateMockWorkouts(): WorkoutEntry[] {
  const workouts: WorkoutEntry[] = [];
  const types = ["Walking", "Strength Session", "Walking", "Gentle Stretching", "Walking", "Walking"];
  for (let i = 13; i >= 0; i--) {
    if (i % 2 === 0) {
      const type = types[i % types.length];
      workouts.push({
        id: `w_${i}`,
        date: generateDateString(i),
        type,
        duration: 20 + Math.round(Math.random() * 20),
        intensity: type === "Strength Session" ? "moderate" : type === "Gentle Stretching" ? "low" : "low",
        caloriesBurned: 100 + Math.round(Math.random() * 150),
      });
    }
  }
  return workouts;
}

export function generateTodayMetrics(): HealthMetrics {
  const all = generateMockMetrics(1);
  return all[0];
}

function makeActions(yourDay: { move: string; fuel: string; hydrate: string; recover: string; consistent: string }, reasons?: { move: string; fuel: string; hydrate: string; recover: string; consistent: string }): DailyAction[] {
  const categories: ActionCategory[] = ["move", "fuel", "hydrate", "recover", "consistent"];
  return categories.map(cat => ({
    id: cat,
    category: cat,
    text: yourDay[cat],
    recommended: yourDay[cat],
    completed: false,
    reason: reasons?.[cat],
  }));
}

export function stateTagFromReadiness(
  readinessScore: number,
  feeling: FeelingType,
  stress: StressLevel,
  energy: EnergyLevel,
): StateTag {
  if (stress === "very_high" || feeling === "stressed") return "stressed";
  if (feeling === "tired" || energy === "low") return "tired";
  if (feeling === "great" || (readinessScore >= 75 && (energy === "excellent" || energy === "high"))) return "great";
  if (readinessScore >= 45) return "good";
  if (readinessScore < 35) return "stressed";
  return "tired";
}

function pickOptionTitle(category: ActionCategory, tag: StateTag): string {
  const options: CategoryOption[] = CATEGORY_OPTIONS[category];
  const match = options.find(o => o.stateTag === tag);
  return match ? match.title : options[1].title;
}

function generateFocusItems(
  dailyState: import("@/types").DailyState,
  metrics: HealthMetrics,
  inputs?: WellnessInputs,
  glp1Inputs?: GLP1DailyInputs,
): FocusItem[] {
  const items: FocusItem[] = [];

  if (glp1Inputs?.appetite === "very_low" || glp1Inputs?.appetite === "low") {
    items.push({ text: "Prioritize protein early today. Even small amounts help.", category: "fuel" });
  }

  if (glp1Inputs?.hydration === "poor" || glp1Inputs?.hydration === "okay") {
    items.push({ text: "Front-load hydration this morning.", category: "hydrate" });
  }

  if (glp1Inputs?.sideEffects === "moderate" || glp1Inputs?.sideEffects === "rough") {
    items.push({ text: "Keep movement light and easy today.", category: "move" });
  }

  if (glp1Inputs?.proteinConfidence === "low") {
    items.push({ text: "Add one extra protein-rich snack if you can.", category: "fuel" });
  }

  if (metrics.sleepDuration < 7) {
    items.push({ text: "Aim for an earlier wind-down tonight.", category: "recover" });
  }

  if (dailyState === "recover" || dailyState === "maintain") {
    items.push({ text: "Complete your daily check-in to keep your streak.", category: "consistent" });
  }

  if (items.length === 0) {
    items.push({ text: "Stay consistent with your routine today.", category: "consistent" });
    items.push({ text: "Keep hydration steady throughout the day.", category: "hydrate" });
    items.push({ text: "Include protein at every meal.", category: "fuel" });
  }

  return items.slice(0, 5);
}

export function generateDailyPlan(metrics: HealthMetrics, inputs?: WellnessInputs, history?: CompletionRecord[], recentMetrics?: HealthMetrics[], glp1Inputs?: GLP1DailyInputs, medicationProfile?: MedicationProfile): DailyPlan {
  const feeling = inputs?.feeling ?? null;
  const energy = inputs?.energy ?? null;
  const stress = inputs?.stress ?? null;
  const hydration = inputs?.hydration ?? null;
  const trainingIntent = inputs?.trainingIntent ?? null;

  const last7 = recentMetrics?.slice(-7) ?? [];
  const last3 = last7.slice(-3);
  const last5 = recentMetrics?.slice(-5) ?? [];

  const avg7Hrv = last7.length >= 7 ? last7.reduce((s, m) => s + m.hrv, 0) / last7.length : 0;
  const avg7Sleep = last7.length >= 3 ? last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length : 0;
  const avg7Rhr = last7.length >= 3 ? last7.reduce((s, m) => s + m.restingHeartRate, 0) / last7.length : 0;

  const hrvDeviation = avg7Hrv > 0 ? ((metrics.hrv - avg7Hrv) / avg7Hrv) * 100 : 0;
  const rhrElevated = avg7Rhr > 0 && metrics.restingHeartRate > avg7Rhr + 5;

  const sleepDeclining3 = last3.length >= 3 && last3.every((m, i) => i === 0 || m.sleepDuration < last3[i - 1].sleepDuration);
  const hrvDeclining5 = last5.length >= 5 && last5[last5.length - 1].hrv < last5[0].hrv - 5 && last5.every((m, i) => i === 0 || m.hrv <= last5[i - 1].hrv + 2);

  const yesterdayStrain = last7.length >= 2 ? last7[last7.length - 2]?.strain ?? 0 : 0;
  const avgStrain = last7.length >= 3 ? last7.reduce((s, m) => s + m.strain, 0) / last7.length : 5;
  const consecutivePoorRecovery = last3.length >= 3 && last3.every(m => m.recoveryScore < 50);

  let readinessScore = Math.round(
    metrics.recoveryScore * 0.3 +
    metrics.sleepQuality * 0.3 +
    (metrics.hrv / 60) * 100 * 0.2 +
    (1 - Math.min(metrics.restingHeartRate, 80) / 80) * 100 * 0.2
  );

  if (feeling === "tired") readinessScore = Math.min(readinessScore, 55);
  else if (feeling === "stressed") readinessScore = Math.min(readinessScore, 50);
  else if (feeling === "great") readinessScore = Math.max(readinessScore, 75);

  if (energy === "low") readinessScore = Math.min(readinessScore, 45);
  else if (energy === "excellent" || energy === "high") readinessScore = Math.max(readinessScore, 70);

  if (stress === "high") readinessScore = Math.min(readinessScore, 50);
  else if (stress === "very_high") readinessScore = Math.min(readinessScore, 35);

  if (trainingIntent === "none") readinessScore = Math.min(readinessScore, 40);

  if (hydration === "low") readinessScore = Math.max(readinessScore - 5, 0);
  else if (hydration === "dehydrated") readinessScore = Math.max(readinessScore - 10, 0);

  if (hrvDeviation < -15) readinessScore = Math.min(readinessScore, 40);
  else if (hrvDeviation < -10) readinessScore = Math.min(readinessScore, 50);

  if (consecutivePoorRecovery) readinessScore = Math.min(readinessScore, 35);
  if (hrvDeclining5) readinessScore = Math.min(readinessScore, 45);
  if (rhrElevated && Math.abs(hrvDeviation) < 5) readinessScore = Math.min(readinessScore, 50);
  if (sleepDeclining3) readinessScore = Math.min(readinessScore, 55);

  if (glp1Inputs?.sideEffects === "rough") readinessScore = Math.min(readinessScore, 35);
  else if (glp1Inputs?.sideEffects === "moderate") readinessScore = Math.min(readinessScore, 50);

  if (glp1Inputs?.appetite === "very_low") readinessScore = Math.min(readinessScore, 50);

  if (glp1Inputs?.energy === "depleted") readinessScore = Math.min(readinessScore, 35);
  else if (glp1Inputs?.energy === "tired") readinessScore = Math.min(readinessScore, 50);

  if (medicationProfile) {
    const tier = getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue);
    if (medicationProfile.recentTitration) readinessScore = Math.max(readinessScore - 8, 0);
    if (tier === "high" && (glp1Inputs?.sideEffects === "moderate" || glp1Inputs?.sideEffects === "rough")) {
      readinessScore = Math.max(readinessScore - 5, 0);
    }
    if (medicationProfile.timeOnMedicationBucket === "less_1_month") readinessScore = Math.max(readinessScore - 5, 0);
  }

  const readinessLabel = readinessScore >= 80 ? "Excellent" : readinessScore >= 65 ? "Good" : readinessScore >= 45 ? "Moderate" : "Low";

  const stressOverride = stress === "high" || stress === "very_high";
  const lowEnergy = energy === "low";
  const isDehydrated = hydration === "dehydrated" || hydration === "low";
  const sleepLow = metrics.sleepDuration < 6.5;
  const sleepCritical = metrics.sleepDuration < 6 && hrvDeviation < -10;
  const sleepGoodHrvGood = metrics.sleepDuration > 7.5 && hrvDeviation >= 0;
  const symptomsHeavy = glp1Inputs?.sideEffects === "rough" || glp1Inputs?.sideEffects === "moderate";
  const appetiteLow = glp1Inputs?.appetite === "very_low" || glp1Inputs?.appetite === "low";

  let headline = "";
  let summary = "";
  let dailyFocus = "";
  let dailyState: import("@/types").DailyState = "maintain";
  let whyThisPlan: string[] = [];
  let optional = "";
  let workoutType = "";
  let workoutIntensity: "low" | "moderate" | "high" = "moderate";
  let workoutDuration = 30;
  let workoutDesc = "";

  if (sleepCritical || (glp1Inputs?.sideEffects === "rough" && glp1Inputs?.energy === "depleted")) {
    dailyState = "recover";
    headline = "Let's keep today gentle.";
    summary = symptomsHeavy
      ? "Side effects are heavy and energy is very low. Your body needs a simple, supportive day."
      : "Sleep was very short and your body is showing it. Rest and hydration are the priority.";
    dailyFocus = "Rest and recover";
    whyThisPlan = [
      symptomsHeavy ? "Heavy side effects on GLP-1 are common in the early weeks and after dose changes." : "Short sleep affects energy, appetite, and how your body handles treatment.",
      "A gentle day now helps you stay consistent over the longer term.",
      "Focus on hydration, small protein-rich meals, and rest.",
    ];
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 0;
    workoutDesc = "Full rest or a very gentle walk if you feel up to it.";
    optional = "A short walk after a meal can help with nausea and digestion.";
  } else if (symptomsHeavy) {
    dailyState = "recover";
    headline = "Symptoms are heavier today. Let's simplify.";
    summary = "Side effects can make everything harder. Today is about doing what feels manageable and not pushing.";
    dailyFocus = "Manage symptoms";
    whyThisPlan = [
      "When side effects are heavier, your body is working harder to adjust.",
      "Hydration and small meals help manage nausea and fatigue.",
      "Lighter days are part of staying on track long-term.",
    ];
    workoutType = "Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 15;
    workoutDesc = "Short walk if you feel up to it. No pressure.";
    optional = "Ginger tea or small sips of electrolyte water can help with nausea.";
  } else if (appetiteLow && (isDehydrated || glp1Inputs?.proteinConfidence === "low")) {
    dailyState = "maintain";
    headline = "Fueling needs attention today.";
    summary = "Appetite is low and hydration or protein may be falling short. Small, nutrient-dense meals will help you feel better.";
    dailyFocus = "Focus on fueling";
    whyThisPlan = [
      "Low appetite is one of the most common effects of GLP-1 medications.",
      "Under-eating can lead to muscle loss and lower energy over time.",
      "Even small amounts of protein-rich food make a real difference.",
    ];
    workoutType = "Light Movement";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk or gentle movement. Focus energy on eating well.";
    optional = "Protein shakes or smoothies are a good option when appetite is low.";
  } else if (stressOverride || stress === "very_high") {
    dailyState = "recover";
    headline = "Take it slow today.";
    summary = "Stress affects how your body handles treatment, sleep, and appetite. Simplify today.";
    dailyFocus = "Simplify and recover";
    whyThisPlan = [
      "Stress raises cortisol, which can interfere with treatment benefits.",
      "A simple, low-pressure day helps your body stay in a better place.",
      "Recovery is not just physical. your mind needs rest too.",
    ];
    workoutType = "Rest or Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 15;
    workoutDesc = "Gentle movement only.";
    optional = "A short walk in fresh air can help reset your system.";
  } else if (consecutivePoorRecovery || hrvDeclining5) {
    dailyState = "recover";
    headline = "Your body is asking for more recovery.";
    summary = "Recovery signals have been lower than usual. A lighter day with good sleep tonight will help you get back on track.";
    dailyFocus = "Recovery protocol";
    whyThisPlan = [
      "Lower recovery signals often show up before you feel tired.",
      "Catching it early prevents bigger dips in energy and consistency.",
      "Prioritize sleep and hydration over activity today.",
    ];
    workoutType = "Light Walk";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk and stretching only.";
    optional = "Start winding down 30 minutes earlier tonight.";
  } else if (sleepGoodHrvGood && readinessScore >= 75 && !appetiteLow) {
    dailyState = "push";
    headline = "You're in a good place today.";
    summary = "Sleep was solid, recovery is strong, and your body is ready. A good day for a strength session or a longer walk.";
    dailyFocus = "Make the most of today";
    whyThisPlan = [
      "Good recovery and sleep support muscle-preserving activity.",
      "Strength sessions are especially important on GLP-1 to preserve lean mass.",
      "Fuel well around your activity today.",
    ];
    workoutType = "Strength Session";
    workoutIntensity = "moderate";
    workoutDuration = 30;
    workoutDesc = "Strength session focused on compound movements.";
    optional = "Include a protein-rich meal within an hour after your session.";
  } else if (readinessScore >= 65) {
    dailyState = "build";
    headline = "A solid day to build momentum.";
    summary = "Recovery supports activity today. Stay consistent with movement, protein, and hydration.";
    dailyFocus = "Steady progress";
    whyThisPlan = [
      "Consistent moderate effort is more effective than occasional intense days.",
      "Your body can handle activity today without adding extra strain.",
      "Pair your movement with good fueling for the best results.",
    ];
    workoutType = "Walk or Light Activity";
    workoutIntensity = "moderate";
    workoutDuration = 30;
    workoutDesc = "30 min walk or light activity session.";
    optional = "If energy drops, a walk is always a great fallback.";
  } else if (readinessScore >= 45) {
    dailyState = "maintain";
    headline = "Keep it steady today.";
    summary = sleepLow
      ? "Sleep was short. A lighter day with good nutrition will help you recover."
      : "Recovery is moderate. Stay consistent with the basics and keep movement gentle.";
    dailyFocus = "Basics first";
    whyThisPlan = [
      "On moderate days, the basics matter most. hydration, protein, rest.",
      "Gentle movement helps you stay in rhythm without overdoing it.",
      "Consistency on days like this is what builds long-term results.",
    ];
    workoutType = "Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk. No pressure on pace or distance.";
    optional = "If you feel good, you can extend to 30 minutes.";
  } else {
    dailyState = "recover";
    headline = "Your body needs a break today.";
    summary = "Recovery is low. Focus on rest, hydration, and nourishing food. Movement can wait.";
    dailyFocus = "Rest and restore";
    whyThisPlan = [
      "Rest days help your body adjust to treatment and recover.",
      "Good nutrition and hydration are your best tools right now.",
      "Pushing through fatigue creates more fatigue, not progress.",
    ];
    optional = "A 10-minute easy walk is the most you should do today.";
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 0;
    workoutDesc = "Full rest day.";
  }

  const recommendedTag = stateTagFromReadiness(readinessScore, feeling, stress, energy);
  const yourDay = {
    move: pickOptionTitle("move", recommendedTag),
    fuel: pickOptionTitle("fuel", recommendedTag),
    hydrate: pickOptionTitle("hydrate", recommendedTag),
    recover: pickOptionTitle("recover", recommendedTag),
    consistent: pickOptionTitle("consistent", recommendedTag),
  };

  const moveReason =
    dailyState === "recover" ? "Recovery is the priority. Gentle movement helps without adding strain."
    : dailyState === "push" ? "Your body is ready for activity. Strength training helps preserve muscle on GLP-1."
    : symptomsHeavy ? "Side effects are heavier today. Keep movement light and comfortable."
    : sleepLow ? "Sleep was short. Lower intensity protects your energy."
    : "Consistent gentle movement supports your treatment journey.";

  const fuelReason =
    appetiteLow ? "Appetite is low, which is common on GLP-1. Small, protein-rich meals help prevent under-eating."
    : dailyState === "push" ? "Activity needs fuel. Focus on protein to preserve muscle."
    : stressOverride ? "Stress depletes nutrients. Nourishing food supports your body's response."
    : dailyState === "recover" ? "Recovery meals help your body repair. Prioritize protein and easy-to-digest foods."
    : "Steady fueling with protein at every meal supports your treatment.";

  const hydrateReason =
    isDehydrated ? "Hydration is low. Extra water and electrolytes are important on GLP-1."
    : symptomsHeavy ? "Good hydration helps manage side effects like nausea and fatigue."
    : "Consistent hydration supports energy, digestion, and treatment effectiveness.";

  const recoverReason =
    sleepDeclining3 ? "Sleep has been declining. Prioritize an earlier bedtime tonight."
    : sleepCritical ? "Sleep was very short. Maximum rest priority tonight."
    : dailyState === "recover" ? "Your body needs extra rest to bounce back."
    : "Consistent sleep is your most powerful recovery tool on treatment.";

  const consistentReason =
    "Checking in daily helps you stay aware of patterns and build momentum on your journey.";

  const actionReasons = { move: moveReason, fuel: fuelReason, hydrate: hydrateReason, recover: recoverReason, consistent: consistentReason };

  const sleepHours = metrics.sleepDuration;
  let sleepSummary = "";
  if (sleepHours < 7) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Below what your body needs.`;
  } else if (sleepHours >= 8) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Solid rest.`;
  } else {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Adequate.`;
  }

  let recoverySummary = "";
  if (metrics.recoveryScore >= 75) {
    recoverySummary = "Recovery is strong.";
  } else if (metrics.recoveryScore >= 50) {
    recoverySummary = "Recovery is moderate.";
  } else {
    recoverySummary = "Recovery is low.";
  }

  const statusLabel: import("@/types").DailyStatusLabel =
    dailyState === "push" ? "You're in a good place today"
    : dailyState === "build" ? "A few small adjustments will help today"
    : dailyState === "maintain" ? "Let's make today a bit easier"
    : "Your body may need more support today";

  const statusDrivers: string[] = [];

  if (metrics.recoveryScore >= 70) statusDrivers.push("Recovery is solid");
  else if (metrics.recoveryScore >= 50) statusDrivers.push("Recovery is moderate");
  else statusDrivers.push("Recovery is low");

  if (sleepHours >= 7.5) statusDrivers.push("Slept well");
  else if (sleepHours >= 6.5) statusDrivers.push("Sleep was adequate");
  else statusDrivers.push("Sleep was short");

  if (symptomsHeavy) statusDrivers.push("Symptoms are heavier today");
  else if (appetiteLow) statusDrivers.push("Appetite is low");
  else if (feeling === "great" || energy === "excellent" || energy === "high") statusDrivers.push("Feeling good");
  else if (feeling === "stressed" || stressOverride) statusDrivers.push("Stress is elevated");
  else if (feeling === "tired") statusDrivers.push("Feeling tired");
  else if (energy === "low") statusDrivers.push("Energy is low");
  else if (isDehydrated) statusDrivers.push("Hydration is low");
  else if (metrics.steps >= 6000) statusDrivers.push("Movement is on track");
  else statusDrivers.push("Movement has been light");

  const guidance =
    dailyState === "push" ? "Make the most of today"
    : dailyState === "build" ? "Stay consistent today"
    : dailyState === "maintain" ? "Focus on the basics today"
    : "Rest and support your body today";

  const focusItems = generateFocusItems(dailyState, metrics, inputs, glp1Inputs);

  return {
    date: metrics.date,
    readinessScore,
    readinessLabel,
    dailyState,
    recommendedStateTag: recommendedTag,
    statusLabel,
    statusDrivers: statusDrivers.slice(0, 3),
    guidance,
    headline,
    summary,
    dailyFocus,
    actions: makeActions(yourDay, actionReasons),
    yourDay,
    whyThisPlan,
    optional,
    recoverySummary,
    sleepSummary,
    workoutRecommendation: {
      type: workoutType,
      duration: workoutDuration,
      intensity: workoutIntensity,
      description: workoutDesc,
    },
    nutritionTarget: {
      calories: readinessScore >= 65 ? 1800 : 1600,
      protein: 120,
      carbs: workoutIntensity === "high" ? 180 : readinessScore >= 65 ? 160 : 140,
      fat: 55,
      hydration: isDehydrated ? 112 : 96,
      note: appetiteLow
        ? "Appetite is low. Focus on nutrient-dense, protein-rich foods in smaller portions. Protein shakes can help."
        : symptomsHeavy
        ? "Side effects may make eating harder. Try bland, easy-to-digest foods and sip water throughout the day."
        : isDehydrated
        ? "Hydration is low. Drink water with each meal and consider adding electrolytes."
        : "Focus on protein at every meal to preserve muscle. Include vegetables and stay hydrated.",
    },
    focusItems,
  };
}

export function generateWeeklyPlan(): WeeklyPlan {
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const focusAreas = [
    "Strength + Protein Focus",
    "Walking + Hydration",
    "Recovery + Gentle Movement",
    "Strength + Protein Focus",
    "Walking + Consistency",
    "Recovery + Rest",
    "Light Movement + Meal Prep",
  ];

  const stateRotation: StateTag[] = ["great", "good", "tired", "great", "good", "stressed", "tired"];
  const dayConfigs = stateRotation.map(tag => ({
    move: pickOptionTitle("move", tag),
    fuel: pickOptionTitle("fuel", tag),
    hydrate: pickOptionTitle("hydrate", tag),
    recover: pickOptionTitle("recover", tag),
    consistent: pickOptionTitle("consistent", tag),
  }));

  const categories: ActionCategory[] = ["move", "fuel", "hydrate", "recover", "consistent"];

  const planDays: WeeklyPlanDay[] = dayNames.map((name, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const cfg = dayConfigs[i];
    return {
      dayOfWeek: name,
      date: date.toISOString().split("T")[0],
      focusArea: focusAreas[i],
      actions: categories.map((cat) => ({
        category: cat,
        recommended: cfg[cat],
        chosen: cfg[cat],
        completed: false,
      })),
    };
  });

  return {
    weekStartDate: monday.toISOString().split("T")[0],
    weekSummary: "This week balances strength training with lighter recovery days. Focus on protein at every meal, consistent hydration, and keeping movement simple. Two strength sessions support muscle preservation while you lose weight.",
    days: planDays,
    adjustmentNote: "If side effects are heavier after a dose change, swap any training day for gentle walking and extra rest.",
  };
}

export function generateTrendData(): TrendData[] {
  return generateTrendDataFromMetrics(generateMockMetrics(28));
}

function computeTrend(values: number[]): "up" | "down" | "stable" {
  if (values.length < 4) return "stable";
  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const change = (avgSecond - avgFirst) / (avgFirst || 1);
  if (change > 0.03) return "up";
  if (change < -0.03) return "down";
  return "stable";
}

function trendSummary(label: string, values: number[], trend: "up" | "down" | "stable", unit: string): string {
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const latest = values[values.length - 1];
  const first = values[0];
  const change = latest - first;

  switch (label) {
    case "Weight": {
      if (Math.abs(change) < 0.5) return "Weight has been steady over the last 4 weeks.";
      return trend === "down"
        ? `Down ${Math.abs(change).toFixed(1)} lbs over the past 4 weeks. Steady progress on treatment.`
        : `Up ${Math.abs(change).toFixed(1)} lbs over the past 4 weeks. This is normal early in treatment and may stabilize.`;
    }
    case "HRV": {
      if (trend === "up") return "Trending up. Your body is adapting well and recovery is improving.";
      if (trend === "down") return "Trending down. This may reflect accumulated fatigue or treatment adjustment.";
      return `Holding steady around ${Math.round(avg)} ms. Consistent recovery patterns.`;
    }
    case "Resting HR": {
      if (trend === "down") return "Gradually decreasing. A positive sign for cardiovascular health.";
      if (trend === "up") return "Trending higher. Consider whether stress, poor sleep, or dehydration may be a factor.";
      return `Stable around ${Math.round(avg)} bpm.`;
    }
    case "Sleep": {
      if (avg >= 7.5) return `Averaging ${avg.toFixed(1)} hours. Solid sleep supports your treatment.`;
      if (avg < 6.5) return `Averaging ${avg.toFixed(1)} hours. More sleep would help with energy and side effects.`;
      return `Averaging ${avg.toFixed(1)} hours. A bit more sleep would support better recovery.`;
    }
    case "Steps": {
      const avgK = Math.round(avg).toLocaleString();
      if (avg >= 7000) return `Averaging ${avgK} daily. Good daily movement.`;
      if (avg >= 4000) return `Averaging ${avgK} daily. A short daily walk could help.`;
      return `Averaging ${avgK} daily. Adding more gentle movement would support your journey.`;
    }
    case "Recovery": {
      if (avg >= 70) return "Recovery has been strong. Your body is responding well.";
      if (avg < 50) return "Recovery has been lower. Better sleep and hydration would help.";
      return "Recovery is moderate. Consistent sleep and rest days will help it improve.";
    }
    default:
      return "";
  }
}

export function generateTrendDataFromMetrics(metrics: HealthMetrics[]): TrendData[] {
  if (!metrics || metrics.length === 0) return generateTrendData();

  const configs: { label: string; extract: (m: HealthMetrics) => number; unit: string }[] = [
    { label: "Weight", extract: (m) => m.weight, unit: "lbs" },
    { label: "HRV", extract: (m) => m.hrv, unit: "ms" },
    { label: "Resting HR", extract: (m) => m.restingHeartRate, unit: "bpm" },
    { label: "Sleep", extract: (m) => m.sleepDuration, unit: "hrs" },
    { label: "Steps", extract: (m) => m.steps, unit: "steps" },
    { label: "Recovery", extract: (m) => m.recoveryScore, unit: "%" },
  ];

  return configs.map(({ label, extract, unit }) => {
    const data = metrics.map((m) => ({ date: m.date, value: extract(m) }));
    const values = data.map((d) => d.value);
    const trend = computeTrend(values);
    const summary = trendSummary(label, values, trend, unit);
    return { label, data, unit, trend, summary };
  });
}

export function getMetricDetail(
  key: MetricKey,
  todayMetrics: HealthMetrics,
  allMetrics: HealthMetrics[]
): MetricDetail {
  const trendData = allMetrics.map((m) => {
    let value = 0;
    switch (key) {
      case "sleep": value = m.sleepDuration; break;
      case "hrv": value = m.hrv; break;
      case "steps": value = m.steps; break;
      case "restingHR": value = m.restingHeartRate; break;
      case "recovery": value = m.recoveryScore; break;
      case "weight": value = m.weight; break;
    }
    return { date: m.date, value };
  });

  const recent = trendData.slice(-7);
  const avg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const current = trendData[trendData.length - 1].value;
  const trendDir: "up" | "down" | "stable" =
    current > avg * 1.03 ? "up" : current < avg * 0.97 ? "down" : "stable";

  const details: Record<MetricKey, Omit<MetricDetail, "key" | "trend">> = {
    sleep: {
      title: "Sleep",
      headline: todayMetrics.sleepDuration >= 7.5
        ? "You slept well."
        : todayMetrics.sleepDuration >= 6.5
        ? "Sleep was okay."
        : "Sleep was short last night.",
      explanation: `${todayMetrics.sleepDuration.toFixed(1)} hours, ${todayMetrics.sleepQuality}% quality. 7-day average: ${avg.toFixed(1)} hours.`,
      whatItMeans: "Sleep is when your body recovers and adjusts to treatment. Consistent sleep supports energy, appetite regulation, and side effect management.",
      recommendation: todayMetrics.sleepDuration < 7
        ? "Try winding down 30 minutes earlier tonight. Keep the room cool and dark."
        : "Keep this up. Consistent sleep supports your treatment.",
      currentValue: `${todayMetrics.sleepDuration.toFixed(1)}`,
      unit: "hrs",
    },
    hrv: {
      title: "Heart Rate Variability",
      headline: todayMetrics.hrv >= 45
        ? "HRV looks good. Recovery is on track."
        : todayMetrics.hrv >= 35
        ? "HRV is slightly below average."
        : "HRV is low. Your body needs more rest.",
      explanation: `${todayMetrics.hrv} ms today. 7-day average: ${Math.round(avg)} ms.`,
      whatItMeans: "HRV reflects how well-recovered your nervous system is. Higher values mean your body is handling stress well.",
      recommendation: todayMetrics.hrv < 38
        ? "Take it easy. Focus on hydration, gentle movement, and rest."
        : "HRV supports activity today. Listen to your body.",
      currentValue: `${todayMetrics.hrv}`,
      unit: "ms",
    },
    steps: {
      title: "Daily Steps",
      headline: todayMetrics.steps >= 7000
        ? "Good movement today."
        : todayMetrics.steps >= 4000
        ? "Partway to your movement goal."
        : "Movement has been light today.",
      explanation: `${todayMetrics.steps.toLocaleString()} steps. 7-day average: ${Math.round(avg).toLocaleString()}.`,
      whatItMeans: "Gentle daily movement supports digestion, energy, and treatment effectiveness. Walking after meals can help with nausea.",
      recommendation: todayMetrics.steps < 5000
        ? "A 15-minute walk after your next meal can help with energy and digestion."
        : "On track. Keep moving throughout the day.",
      currentValue: todayMetrics.steps.toLocaleString(),
      unit: "steps",
    },
    restingHR: {
      title: "Resting Heart Rate",
      headline: todayMetrics.restingHeartRate <= 60
        ? "Resting heart rate is excellent."
        : todayMetrics.restingHeartRate <= 68
        ? "Resting heart rate is normal."
        : "Resting heart rate is elevated.",
      explanation: `${todayMetrics.restingHeartRate} bpm today. 7-day average: ${Math.round(avg)} bpm.`,
      whatItMeans: "Resting heart rate reflects overall cardiovascular health and recovery status.",
      recommendation: todayMetrics.restingHeartRate > 66
        ? "Elevated resting HR may mean more recovery or hydration is needed."
        : "In a healthy range. Keep up your routine.",
      currentValue: `${todayMetrics.restingHeartRate}`,
      unit: "bpm",
    },
    recovery: {
      title: "Recovery",
      headline: todayMetrics.recoveryScore >= 75
        ? "Recovery is strong."
        : todayMetrics.recoveryScore >= 50
        ? "Recovery is moderate."
        : "Recovery is low. Take it easy.",
      explanation: `Recovery is at ${todayMetrics.recoveryScore}%. Based on HRV, resting heart rate, and sleep quality.`,
      whatItMeans: "Recovery shows how prepared your body is for activity. On GLP-1, listening to recovery signals helps you stay consistent.",
      recommendation: todayMetrics.recoveryScore < 50
        ? "Focus on rest, hydration, and protein today. Skip intense activity."
        : "Recovery supports activity today. Match effort to how you feel.",
      currentValue: `${todayMetrics.recoveryScore}`,
      unit: "%",
    },
    weight: {
      title: "Weight",
      headline: trendDir === "down"
        ? "Weight is trending down."
        : trendDir === "up"
        ? "Weight has been trending up."
        : "Weight is stable.",
      explanation: `${todayMetrics.weight} lbs today. 7-day average: ${avg.toFixed(1)} lbs.`,
      whatItMeans: "Weight changes on GLP-1 are expected. Focus on the weekly trend, not daily fluctuations. Preserving muscle matters as much as the number.",
      recommendation: "Weigh yourself at the same time each day. Focus on protein and strength training to preserve muscle.",
      currentValue: `${todayMetrics.weight}`,
      unit: "lbs",
    },
  };

  const detail = details[key];
  return {
    key,
    ...detail,
    trend: {
      label: detail.title,
      data: trendData,
      unit: detail.unit,
      trend: trendDir,
      summary: detail.explanation,
    },
  };
}

const platformIntegrations: IntegrationStatus[] = Platform.OS === "ios"
  ? [
      { id: "apple_health", name: "Apple Health", icon: "heart", connected: false },
      { id: "garmin", name: "Garmin", icon: "watch", connected: false },
    ]
  : Platform.OS === "android"
  ? [
      { id: "health_connect", name: "Health Connect", icon: "activity", connected: false },
      { id: "garmin", name: "Garmin", icon: "watch", connected: false },
    ]
  : [
      { id: "apple_health", name: "Apple Health", icon: "heart", connected: false },
      { id: "health_connect", name: "Health Connect", icon: "activity", connected: false },
      { id: "garmin", name: "Garmin", icon: "watch", connected: false },
    ];

export const integrations: IntegrationStatus[] = platformIntegrations;
