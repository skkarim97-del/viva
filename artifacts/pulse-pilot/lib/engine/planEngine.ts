import {
  CATEGORY_OPTIONS,
  type HealthMetrics,
  type DailyPlan,
  type WeeklyPlan,
  type WeeklyPlanDay,
  type DailyAction,
  type WellnessInputs,
  type CompletionRecord,
  type ActionCategory,
  type StateTag,
  type PlanTier,
  type CategoryOption,
  type FocusItem,
  type FeelingType,
  type StressLevel,
  type EnergyLevel,
  type GLP1DailyInputs,
  type MedicationProfile,
  type MedicationLogEntry,
  type UserPatterns,
} from "@/types";
import { getDoseTier, getMedicationFrequency, type MedicationBrand } from "@/data/medicationData";
import { shouldApplyPostDoseAdjustment } from "@/data/patternEngine";

export type MedContext = {
  doseTier: "low" | "mid" | "high";
  recentTitration: boolean;
  daysSinceDose: number | null;
  frequency: "weekly" | "daily";
  isNewToMed: boolean;
};

function makeActions(
  yourDay: { move: string; fuel: string; hydrate: string; recover: string; consistent: string },
  reasons?: { move: string; fuel: string; hydrate: string; recover: string; consistent: string },
): DailyAction[] {
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

function computeDaysSinceLastDose(medicationLog?: MedicationLogEntry[]): number | null {
  if (!medicationLog || medicationLog.length === 0) return null;
  const takenDoses = medicationLog.filter(e => e.status === "taken").sort((a, b) => b.date.localeCompare(a.date));
  if (takenDoses.length === 0) return null;
  const todayStr = new Date().toISOString().split("T")[0];
  const todayParts = todayStr.split("-").map(Number);
  const doseParts = takenDoses[0].date.split("-").map(Number);
  const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const doseDate = new Date(doseParts[0], doseParts[1] - 1, doseParts[2]);
  return Math.max(0, Math.round((todayDate.getTime() - doseDate.getTime()) / 86400000));
}

function safeMedFrequency(brand: string): "weekly" | "daily" {
  try {
    return getMedicationFrequency(brand.toLowerCase() as MedicationBrand);
  } catch {
    return "weekly";
  }
}

function buildMedContext(medicationProfile?: MedicationProfile, medicationLog?: MedicationLogEntry[]): MedContext | null {
  if (!medicationProfile) return null;
  return {
    doseTier: getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue),
    recentTitration: medicationProfile.recentTitration === true,
    daysSinceDose: computeDaysSinceLastDose(medicationLog),
    frequency: medicationProfile.frequency || safeMedFrequency(medicationProfile.medicationBrand),
    isNewToMed: medicationProfile.timeOnMedicationBucket === "less_1_month",
  };
}

function pickMedAwarePlanTier(
  category: ActionCategory,
  baseTag: StateTag,
  glp1Inputs?: GLP1DailyInputs,
  medCtx?: MedContext | null,
): PlanTier {
  const needsMoreWhenStressed = category === "recover" || category === "hydrate";
  const baseTierMap: Record<StateTag, PlanTier> = needsMoreWhenStressed
    ? { stressed: "high", tired: "moderate", good: "low", great: "minimal" }
    : { great: "high", good: "moderate", tired: "low", stressed: "minimal" };
  const tiers: PlanTier[] = ["minimal", "low", "moderate", "high"];
  let idx = tiers.indexOf(baseTierMap[baseTag]);

  const bump = (n: number) => { idx = Math.min(3, idx + n); };
  const drop = (n: number) => { idx = Math.max(0, idx - n); };

  if (medCtx) {
    if (medCtx.recentTitration) {
      if (needsMoreWhenStressed) bump(1); else drop(1);
    }
    if (medCtx.doseTier === "high") {
      if (category === "hydrate" || category === "recover") bump(1);
      if (category === "move" || category === "fuel") drop(1);
    }
    if (medCtx.daysSinceDose !== null && medCtx.frequency === "weekly") {
      if (medCtx.daysSinceDose <= 2) {
        if (category === "move" || category === "fuel") drop(1);
        if (category === "hydrate" || category === "recover") bump(1);
      } else if (medCtx.daysSinceDose >= 5) {
        if (category === "move") bump(1);
      }
    }
    if (medCtx.isNewToMed) {
      if (category === "move") drop(1);
      if (category === "recover") bump(1);
    }
  }

  if (glp1Inputs) {
    if (glp1Inputs.appetite === "very_low" && category === "fuel") drop(1);
    if (glp1Inputs.sideEffects === "rough") {
      if (category === "move") idx = 0;
      if (category === "hydrate" || category === "recover") bump(1);
    } else if (glp1Inputs.sideEffects === "moderate") {
      if (category === "move") drop(1);
    }
    if (glp1Inputs.energy === "great" && category === "move") bump(1);
    else if (glp1Inputs.energy === "depleted" && category === "move") idx = 0;
  }

  return tiers[Math.max(0, Math.min(3, idx))];
}

function pickOptionByTier(category: ActionCategory, tier: PlanTier): CategoryOption {
  const options = CATEGORY_OPTIONS[category];
  const match = options.find(o => o.planTier === tier);
  return match || options[1];
}

function pickMedAwareOption(
  category: ActionCategory,
  baseTag: StateTag,
  glp1Inputs?: GLP1DailyInputs,
  medCtx?: MedContext | null,
): CategoryOption {
  const tier = pickMedAwarePlanTier(category, baseTag, glp1Inputs, medCtx);
  return pickOptionByTier(category, tier);
}

function buildConsistentAction(
  baseTag: StateTag,
  medicationProfile?: MedicationProfile,
  medicationLog?: MedicationLogEntry[],
): { title: string; reason: string } {
  if (!medicationProfile) {
    const opt = pickOptionTitle("consistent", baseTag);
    return { title: opt, reason: "Checking in daily helps you stay aware of patterns and build momentum." };
  }

  const freq = medicationProfile.frequency || safeMedFrequency(medicationProfile.medicationBrand);
  const todayStr = new Date().toISOString().split("T")[0];

  if (freq === "daily") {
    const todayLogged = medicationLog?.some(e => e.date === todayStr && e.status === "taken");
    if (todayLogged) {
      return { title: "Dose logged \u2713", reason: "Today's dose is recorded. Keep it up." };
    }
    return { title: "Log today's dose", reason: "Tracking your daily dose helps you stay on schedule." };
  }

  const today = new Date();
  const dayOfWeek = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const thisWeekLogged = medicationLog?.some(e => e.date >= weekStartStr && e.status === "taken");
  if (thisWeekLogged) {
    return { title: "Dose logged \u2713", reason: "This week's dose is recorded. Stay consistent with your schedule." };
  }
  return { title: "Log your dose this week", reason: "Logging your weekly dose helps you stay on track with treatment." };
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
    items.push({ text: "Keep hydration steady throughout the day.", category: "hydrate" });
    items.push({ text: "Include protein at every meal.", category: "fuel" });
    items.push({ text: "Log your dose if you haven't already.", category: "consistent" });
  }

  return items.slice(0, 5);
}

export function generateDailyPlan(
  metrics: HealthMetrics,
  inputs?: WellnessInputs,
  history?: CompletionRecord[],
  recentMetrics?: HealthMetrics[],
  glp1Inputs?: GLP1DailyInputs,
  medicationProfile?: MedicationProfile,
  medicationLog?: MedicationLogEntry[],
  patterns?: UserPatterns,
): DailyPlan {
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

  if (patterns && patterns.overallConfidence !== "low" && medicationLog) {
    const energyAdj = shouldApplyPostDoseAdjustment(patterns, medicationLog, "energy");
    if (energyAdj.shouldAdjust && energyAdj.confidence !== "low") {
      const penalty = energyAdj.severity === "significant" ? 8 : energyAdj.severity === "moderate" ? 5 : 3;
      readinessScore = Math.max(readinessScore - penalty, 0);
    }

    const seAdj = shouldApplyPostDoseAdjustment(patterns, medicationLog, "sideEffects");
    if (seAdj.shouldAdjust && seAdj.confidence !== "low") {
      const penalty = seAdj.severity === "significant" ? 8 : seAdj.severity === "moderate" ? 4 : 2;
      readinessScore = Math.max(readinessScore - penalty, 0);
    }

    const restOverride = patterns.adaptiveOverrides.find(o => o.ruleId === "move_low_energy" && o.adaptedRecommendation.includes("Rest"));
    if (restOverride && restOverride.confidence === "high" && readinessScore < 50) {
      readinessScore = Math.max(readinessScore - 5, 0);
    }
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

  const isTitrated = medicationProfile?.recentTitration === true;
  const isNewToMed = medicationProfile?.timeOnMedicationBucket === "less_1_month";
  const isHighDose = medicationProfile ? getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue) === "high" : false;

  if (sleepCritical || (glp1Inputs?.sideEffects === "rough" && glp1Inputs?.energy === "depleted")) {
    dailyState = "recover";
    headline = isTitrated
      ? "Your body is adjusting to the new dose. Keep today simple."
      : "Let's keep today gentle.";
    summary = symptomsHeavy
      ? "Side effects are heavy and energy is very low. Your body needs a simple, supportive day."
      : "Sleep was very short and your body is showing it. Rest and hydration come first.";
    dailyFocus = "Rest and recover";
    whyThisPlan = [
      symptomsHeavy
        ? isTitrated ? "Heavier side effects are expected in the 1-2 weeks after a dose change." : "Heavy side effects are common in the early weeks of treatment."
        : "Short sleep affects energy, appetite, and how your body handles treatment.",
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
    headline = isTitrated
      ? "Side effects from the dose change are showing. Let's simplify."
      : "Symptoms are heavier today. Let's simplify.";
    summary = isHighDose
      ? "Higher doses can bring stronger side effects. Today is about doing what feels manageable."
      : "Side effects can make everything harder. Today is about doing what feels manageable.";
    dailyFocus = "Manage symptoms";
    whyThisPlan = [
      isTitrated ? "Your body is still adjusting to the recent dose change. This is expected." : "When side effects are heavier, your body is working harder to adjust.",
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
    headline = "Appetite and fueling need more support today.";
    summary = isHighDose
      ? "Appetite suppression is stronger at higher doses. Small, nutrient-dense meals will help you feel better."
      : "Appetite is low and hydration or protein may be falling short. Small, nutrient-dense meals will help.";
    dailyFocus = "Focus on fueling";
    whyThisPlan = [
      "Low appetite is one of the most common effects of GLP-1 medications.",
      "Under-eating can lead to muscle loss and lower energy over time.",
      isHighDose ? "At your current dose, getting enough protein is especially important." : "Even small amounts of protein-rich food make a real difference.",
    ];
    workoutType = "Light Movement";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk or gentle movement. Focus energy on eating well.";
    optional = "Protein shakes or smoothies are a good option when appetite is low.";
  } else if (stressOverride || stress === "very_high") {
    dailyState = "recover";
    headline = "Stress is elevated. Let's simplify today.";
    summary = "Stress affects how your body handles treatment, sleep, and appetite. A simpler day helps.";
    dailyFocus = "Simplify and recover";
    whyThisPlan = [
      "Stress raises cortisol, which can interfere with treatment benefits.",
      "A simple, low-pressure day helps your body stay in a better place.",
      "Recovery is not just physical. Your mind needs rest too.",
    ];
    workoutType = "Rest or Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 15;
    workoutDesc = "Gentle movement only.";
    optional = "A short walk in fresh air can help reset your system.";
  } else if (consecutivePoorRecovery || hrvDeclining5) {
    dailyState = "recover";
    headline = isTitrated
      ? "Recovery has been lower since the dose change. Let's be patient."
      : "Recovery looks a bit strained. A lighter day will help.";
    summary = "Recovery signals have been lower than usual. A lighter day with good sleep tonight will help you reset.";
    dailyFocus = "Recovery protocol";
    whyThisPlan = [
      isTitrated ? "Lower recovery is common after a dose increase. It usually improves within 1-2 weeks." : "Lower recovery signals often show up before you feel tired.",
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
    headline = isNewToMed
      ? "Your body is responding well to treatment. A good day to build."
      : "Recovery is strong. Make the most of today.";
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
    headline = "This looks like a good day to keep momentum simple.";
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
    headline = sleepLow
      ? "Short sleep tonight. Keep today simple."
      : "Your body may benefit from a lighter day.";
    summary = sleepLow
      ? "Sleep was short. A lighter day with good nutrition will help you recover."
      : "Recovery is moderate. Stay consistent with the basics and keep movement gentle.";
    dailyFocus = "Basics first";
    whyThisPlan = [
      "On moderate days, the basics matter most. Hydration, protein, rest.",
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
    headline = isTitrated
      ? "Your body is working hard to adjust. Rest is the right call today."
      : "Your body needs a break today.";
    summary = "Recovery is low. Focus on rest, hydration, and nourishing food. Movement can wait.";
    dailyFocus = "Rest and restore";
    whyThisPlan = [
      isTitrated ? "Your body needs time to adjust after a dose change." : "Rest days help your body adjust to treatment and recover.",
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
  const medCtx = buildMedContext(medicationProfile, medicationLog);

  const moveOpt = pickMedAwareOption("move", recommendedTag, glp1Inputs, medCtx);
  const fuelOpt = pickMedAwareOption("fuel", recommendedTag, glp1Inputs, medCtx);
  const hydrateOpt = pickMedAwareOption("hydrate", recommendedTag, glp1Inputs, medCtx);
  const recoverOpt = pickMedAwareOption("recover", recommendedTag, glp1Inputs, medCtx);
  const consistentData = buildConsistentAction(recommendedTag, medicationProfile, medicationLog);

  const yourDay = {
    move: moveOpt.title,
    fuel: fuelOpt.title,
    hydrate: hydrateOpt.title,
    recover: recoverOpt.title,
    consistent: consistentData.title,
  };

  const doseWindowNote = medCtx?.daysSinceDose !== null && medCtx?.frequency === "weekly" && medCtx.daysSinceDose <= 2
    ? " You're within 1-2 days of your dose, so lighter is better."
    : "";
  const titrationNote = medCtx?.recentTitration
    ? " Your body is still adjusting to the new dose."
    : "";

  const moveReason =
    dailyState === "recover" ? "Recovery is the priority. Gentle movement helps without adding strain." + titrationNote
    : dailyState === "push" ? "Your body is ready for activity. Strength training helps preserve muscle on GLP-1."
    : symptomsHeavy ? "Side effects are heavier today. Keep movement light and comfortable." + doseWindowNote
    : sleepLow ? "Sleep was short. Lower intensity protects your energy."
    : medCtx?.doseTier === "high" ? "At a higher dose, moderate movement with good recovery is the sweet spot."
    : "Consistent gentle movement supports your treatment journey." + doseWindowNote;

  const fuelReason =
    appetiteLow ? "Appetite is low, which is common on GLP-1. Small, protein-rich meals help prevent under-eating." + doseWindowNote
    : dailyState === "push" ? "Activity needs fuel. Focus on protein to preserve muscle."
    : stressOverride ? "Stress depletes nutrients. Nourishing food supports your body's response."
    : dailyState === "recover" ? "Recovery meals help your body repair. Prioritize protein and easy-to-digest foods."
    : medCtx?.doseTier === "high" ? "Higher doses can suppress appetite more. Protein-first meals help maintain muscle."
    : "Steady fueling with protein at every meal supports your treatment.";

  const hydrateReason =
    isDehydrated ? "Hydration is low. Extra water and electrolytes are important on GLP-1."
    : symptomsHeavy ? "Good hydration helps manage side effects like nausea and fatigue."
    : medCtx?.doseTier === "high" ? "Hydration needs increase at higher doses. Electrolytes help with nausea."
    : "Consistent hydration supports energy, digestion, and treatment effectiveness.";

  const recoverReason =
    sleepDeclining3 ? "Sleep has been declining. Prioritize an earlier bedtime tonight."
    : sleepCritical ? "Sleep was very short. Maximum rest priority tonight."
    : dailyState === "recover" ? "Your body needs extra rest to bounce back." + titrationNote
    : medCtx?.recentTitration ? "Sleep matters more during a dose adjustment. Aim for the higher end of the range."
    : "Consistent sleep is your most powerful recovery tool on treatment.";

  const consistentReason = consistentData.reason;

  const actionReasons: Record<string, string> = { move: moveReason, fuel: fuelReason, hydrate: hydrateReason, recover: recoverReason, consistent: consistentReason };

  if (patterns && patterns.overallConfidence !== "low") {
    for (const override of patterns.adaptiveOverrides) {
      if (override.confidence === "low") continue;

      if (override.ruleId === "fuel_low_appetite" && appetiteLow) {
        actionReasons.fuel = override.reason + ". " + override.adaptedRecommendation;
      }
      if (override.ruleId === "move_low_energy" && (dailyState === "recover" || dailyState === "maintain")) {
        actionReasons.move = override.reason + ". " + override.adaptedRecommendation;
      }
      if (override.ruleId === "hydrate_side_effects" && symptomsHeavy) {
        actionReasons.hydrate = override.reason + ". " + override.adaptedRecommendation;
      } else if (override.ruleId === "hydrate_energy" && !symptomsHeavy) {
        actionReasons.hydrate = override.reason + ". " + override.adaptedRecommendation;
      }
    }
  }

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
  else statusDrivers.push("Recovery needs attention");

  if (sleepHours >= 7.5) statusDrivers.push("Slept well");
  else if (sleepHours >= 6.5) statusDrivers.push("Sleep was adequate");
  else statusDrivers.push("Sleep was short");

  if (medicationProfile?.recentTitration) statusDrivers.push("Recent dose change");
  else if (symptomsHeavy) statusDrivers.push("Side effects are heavier");
  else if (appetiteLow) statusDrivers.push("Appetite is reduced");
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
