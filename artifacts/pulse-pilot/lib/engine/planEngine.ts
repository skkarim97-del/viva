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
    if (glp1Inputs.nausea === "severe") {
      if (category === "move") idx = 0;
      if (category === "hydrate" || category === "recover") bump(1);
    } else if (glp1Inputs.nausea === "moderate") {
      if (category === "move") drop(1);
    }
    if (glp1Inputs.digestion === "diarrhea" || glp1Inputs.digestion === "constipated") {
      if (category === "hydrate") bump(1);
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
    return { title: opt, reason: "Daily check-ins help you spot patterns in energy, appetite, and recovery over time." };
  }

  const freq = medicationProfile.frequency || safeMedFrequency(medicationProfile.medicationBrand);
  const todayStr = new Date().toISOString().split("T")[0];

  if (freq === "daily") {
    const todayLogged = medicationLog?.some(e => e.date === todayStr && e.status === "taken");
    if (todayLogged) {
      return { title: "Dose logged \u2713", reason: "Today's dose is recorded. Consistent timing helps your body adjust." };
    }
    return { title: "Log today's dose", reason: "Logging your dose helps you spot patterns between dosing and how you feel." };
  }

  const today = new Date();
  const dayOfWeek = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const thisWeekLogged = medicationLog?.some(e => e.date >= weekStartStr && e.status === "taken");
  if (thisWeekLogged) {
    return { title: "Dose logged \u2713", reason: "This week's dose is recorded. Consistent weekly timing supports steadier levels." };
  }
  return { title: "Log your dose this week", reason: "Recording your weekly dose helps you track how your body responds across the week." };
}

function generateFocusItems(
  dailyState: import("@/types").DailyState,
  metrics: HealthMetrics,
  inputs?: WellnessInputs,
  glp1Inputs?: GLP1DailyInputs,
): FocusItem[] {
  const items: FocusItem[] = [];

  if (glp1Inputs?.appetite === "very_low" || glp1Inputs?.appetite === "low") {
    items.push({ text: "Start your first meal with protein. Even 15-20g helps protect muscle.", category: "fuel" });
  }

  if (glp1Inputs?.nausea === "moderate" || glp1Inputs?.nausea === "severe") {
    items.push({ text: "Stick to light movement today. A short walk after meals can ease nausea.", category: "move" });
    items.push({ text: "Sip water steadily rather than large amounts. Add electrolytes if nausea is strong.", category: "hydrate" });
  }

  if (glp1Inputs?.digestion === "constipated") {
    items.push({ text: "Extra water and fiber-rich foods help. Aim for 8+ cups of water today.", category: "hydrate" });
  } else if (glp1Inputs?.digestion === "diarrhea") {
    items.push({ text: "Replace lost fluids with electrolytes. Stick to bland, easy-to-digest foods.", category: "hydrate" });
  } else if (glp1Inputs?.digestion === "bloated") {
    items.push({ text: "Smaller meals spaced out may help. Avoid carbonated drinks and high-fat foods.", category: "fuel" });
  }

  if (metrics.sleepDuration < 7) {
    items.push({ text: `You got ${metrics.sleepDuration.toFixed(1)} hrs last night. Start winding down 30 min earlier tonight.`, category: "recover" });
  }

  if (dailyState === "recover" || dailyState === "maintain") {
    items.push({ text: "Log your check-in today. Tracking on harder days builds the most useful data.", category: "consistent" });
  }

  if (items.length === 0) {
    items.push({ text: "Aim for 6-8 cups of water spread across the day.", category: "hydrate" });
    items.push({ text: "Include 25-30g protein at each meal to preserve lean mass.", category: "fuel" });
    items.push({ text: "Log your dose if you have not already.", category: "consistent" });
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

  if (glp1Inputs?.nausea === "severe") readinessScore = Math.min(readinessScore, 35);
  else if (glp1Inputs?.nausea === "moderate") readinessScore = Math.min(readinessScore, 50);

  if (glp1Inputs?.digestion === "diarrhea") readinessScore = Math.min(readinessScore, 45);
  else if (glp1Inputs?.digestion === "constipated") readinessScore = Math.min(readinessScore, 55);

  if (glp1Inputs?.appetite === "very_low") readinessScore = Math.min(readinessScore, 50);

  if (glp1Inputs?.energy === "depleted") readinessScore = Math.min(readinessScore, 35);
  else if (glp1Inputs?.energy === "tired") readinessScore = Math.min(readinessScore, 50);

  if (medicationProfile) {
    const tier = getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue);
    if (medicationProfile.recentTitration) readinessScore = Math.max(readinessScore - 8, 0);
    if (tier === "high" && (glp1Inputs?.nausea === "moderate" || glp1Inputs?.nausea === "severe")) {
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

    const seAdj = shouldApplyPostDoseAdjustment(patterns, medicationLog, "nausea");
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
  const symptomsHeavy = glp1Inputs?.nausea === "severe" || glp1Inputs?.nausea === "moderate";
  const digestiveDistress = glp1Inputs?.digestion === "diarrhea" || glp1Inputs?.digestion === "constipated";
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

  if (sleepCritical || (glp1Inputs?.nausea === "severe" && glp1Inputs?.energy === "depleted")) {
    dailyState = "recover";
    headline = isTitrated
      ? "Your body is adjusting to the new dose. Keep today simple."
      : "Recovery is the priority today.";
    summary = symptomsHeavy
      ? "Nausea is heavy and energy is very low. Rest, hydration, and small meals are enough for today."
      : `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs and your body is showing it. Rest and hydration come first.`;
    dailyFocus = "Rest and recover";
    whyThisPlan = [
      symptomsHeavy
        ? isTitrated ? "Heavier nausea is expected in the 1-2 weeks after a dose change." : "Nausea is common in the early weeks of treatment."
        : `${metrics.sleepDuration.toFixed(1)} hrs of sleep affects energy, appetite, and how your body handles treatment.`,
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
      ? "Nausea from the dose change is showing. Simplify today."
      : "Nausea is heavier today. Keep things light.";
    summary = isHighDose
      ? "Higher doses can bring stronger nausea. Hydration, small meals, and rest are enough today."
      : "Nausea is making things harder. Hydration and small protein-rich meals will help most.";
    dailyFocus = "Manage symptoms";
    whyThisPlan = [
      isTitrated ? "Your body is still adjusting to the recent dose change. This typically improves within 1-2 weeks." : "When nausea is heavier, your body is using more energy to adjust.",
      "Hydration and small meals help manage nausea and fatigue.",
      "Lighter days protect your consistency over the next week.",
    ];
    workoutType = "Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 15;
    workoutDesc = "Short walk if you feel up to it. No pressure.";
    optional = "Ginger tea or small sips of electrolyte water can help with nausea.";
  } else if (appetiteLow && digestiveDistress) {
    dailyState = "maintain";
    headline = "Appetite is suppressed and digestion is off. Fueling takes priority today.";
    summary = isHighDose
      ? "At higher doses, appetite suppression is stronger. Protein-first small meals prevent muscle loss and keep energy steadier."
      : "Appetite is low and digestion is unsettled. Nutrient-dense small meals make the biggest difference today.";
    dailyFocus = "Focus on fueling";
    whyThisPlan = [
      "Low appetite is one of the most common effects of GLP-1 medications.",
      "Under-eating leads to muscle loss and lower energy, which compounds over time.",
      isHighDose ? "At your current dose, aiming for 25-30g protein per meal is especially important." : "Even 15-20g of protein per meal helps preserve lean mass.",
    ];
    workoutType = "Light Movement";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk or gentle movement. Focus energy on eating well.";
    optional = "Protein shakes or smoothies are a good option when appetite is low.";
  } else if (stressOverride || stress === "very_high") {
    dailyState = "recover";
    headline = "Stress is elevated. A simpler day will help.";
    summary = "High stress raises cortisol, which can blunt treatment benefits and disrupt sleep and appetite. Keep today low-pressure.";
    dailyFocus = "Simplify and recover";
    whyThisPlan = [
      "Elevated cortisol can interfere with how your body responds to treatment.",
      "A low-pressure day helps your nervous system settle, which improves sleep tonight.",
      "Recovery is not just physical. Mental rest supports better decisions tomorrow.",
    ];
    workoutType = "Rest or Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 15;
    workoutDesc = "Gentle movement only.";
    optional = "A 10-minute walk in fresh air can lower cortisol more than you would expect.";
  } else if (consecutivePoorRecovery || hrvDeclining5) {
    dailyState = "recover";
    headline = isTitrated
      ? "Recovery has been lower since the dose change. Give your body time."
      : "Recovery has been strained. A lighter day will help reset.";
    summary = `Recovery signals have been below your baseline for ${consecutivePoorRecovery ? "3+ days" : "the past week"}. A lighter day and solid sleep tonight will help you reset.`;
    dailyFocus = "Recovery protocol";
    whyThisPlan = [
      isTitrated ? "Lower recovery is common after a dose increase. It usually improves within 1-2 weeks." : "Declining recovery signals often show up before you feel the fatigue.",
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
    summary = `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs, HRV is above your baseline, and recovery is ${metrics.recoveryScore}%. A strong day for a strength session or longer walk.`;
    dailyFocus = "Make the most of today";
    whyThisPlan = [
      "Strong recovery and sleep create the best window for muscle-preserving activity.",
      "Strength training on GLP-1 is one of the most effective ways to protect lean mass during weight loss.",
      "Fuel well around your activity. Aim for 25-30g protein within an hour of your session.",
    ];
    workoutType = "Strength Session";
    workoutIntensity = "moderate";
    workoutDuration = 30;
    workoutDesc = "Strength session focused on compound movements.";
    optional = "Include a protein-rich meal within an hour after your session.";
  } else if (readinessScore >= 65) {
    dailyState = "build";
    headline = "A good day for steady progress.";
    summary = `Recovery is ${metrics.recoveryScore}% and supports activity today. Stay consistent with movement, protein, and hydration.`;
    dailyFocus = "Steady progress";
    whyThisPlan = [
      "Consistent moderate effort builds more results than occasional intense days.",
      "Your body can handle activity today without adding extra strain.",
      "Pairing movement with protein-rich meals maximizes the benefit.",
    ];
    workoutType = "Walk or Light Activity";
    workoutIntensity = "moderate";
    workoutDuration = 30;
    workoutDesc = "30 min walk or light activity session.";
    optional = "If energy drops later, a walk is always a solid fallback.";
  } else if (readinessScore >= 45) {
    dailyState = "maintain";
    headline = sleepLow
      ? `${metrics.sleepDuration.toFixed(1)} hrs of sleep. Keep today simple.`
      : "Your body could use a lighter day.";
    summary = sleepLow
      ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs. A lighter day with protein-rich meals and extra water will help you recover.`
      : `Recovery is at ${metrics.recoveryScore}%. Stay consistent with the basics and keep movement gentle.`;
    dailyFocus = "Basics first";
    whyThisPlan = [
      "On moderate days, the basics matter most: hydration, protein, rest.",
      "Gentle movement keeps you in rhythm without adding strain.",
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
    summary = `Recovery is at ${metrics.recoveryScore}%. Focus on rest, hydration, and nourishing food. Movement can wait.`;
    dailyFocus = "Rest and restore";
    whyThisPlan = [
      isTitrated ? "Your body needs time to adjust after a dose change. This usually stabilizes within 1-2 weeks." : "Rest days help your body adjust to treatment and recover.",
      "Protein and hydration are your most important tools right now.",
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
    dailyState === "recover" ? "Recovery is the priority. Gentle movement helps circulation without adding strain." + titrationNote
    : dailyState === "push" ? "Your body is ready. Strength training is the best way to preserve muscle while losing weight on GLP-1."
    : symptomsHeavy ? "Side effects are heavier today. A short walk after meals can help with nausea without adding strain." + doseWindowNote
    : sleepLow ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs. Lower intensity protects your energy for recovery.`
    : medCtx?.doseTier === "high" ? "At a higher dose, moderate movement paired with good recovery is the sweet spot."
    : "Daily movement supports digestion, energy, and muscle preservation on treatment." + doseWindowNote;

  const fuelReason =
    appetiteLow ? "Appetite suppression is common on GLP-1. Protein-first small meals prevent muscle loss even when you are not hungry." + doseWindowNote
    : dailyState === "push" ? "Activity days need fuel. Aim for 25-30g protein per meal to protect lean mass."
    : stressOverride ? "Stress depletes nutrients faster. Protein and complex carbs help stabilize your body's response."
    : dailyState === "recover" ? "Recovery meals help your body repair. Prioritize protein and easy-to-digest foods like eggs, yogurt, or soup."
    : medCtx?.doseTier === "high" ? "Higher doses suppress appetite more. Protein-first meals are the most effective way to maintain muscle."
    : "Steady fueling with protein at every meal supports energy, muscle, and treatment results.";

  const hydrateReason =
    isDehydrated ? "Hydration is low. GLP-1 medications increase fluid needs. Add electrolytes if you feel lightheaded."
    : symptomsHeavy ? "Extra hydration helps manage nausea and fatigue. Sip steadily rather than drinking large amounts at once."
    : medCtx?.doseTier === "high" ? "Hydration needs increase at higher doses. Electrolytes help your body absorb water and manage nausea."
    : "Consistent hydration supports energy, digestion, and how well your body responds to treatment.";

  const recoverReason =
    sleepDeclining3 ? "Sleep has been declining for 3 nights. An earlier bedtime tonight is the highest-impact change you can make."
    : sleepCritical ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs. Maximum rest priority tonight.`
    : dailyState === "recover" ? "Your body needs extra rest to bounce back. Aim for 8+ hours tonight." + titrationNote
    : medCtx?.recentTitration ? "Sleep matters more during a dose adjustment. Aim for the higher end of the range (8+ hrs)."
    : "Consistent sleep is your most powerful recovery tool on treatment. It affects energy, appetite, and side effects.";

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
    sleepSummary = `${sleepHours.toFixed(1)} hours. Below the 7-8 hr range that best supports treatment.`;
  } else if (sleepHours >= 8) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Strong foundation for recovery and energy.`;
  } else {
    sleepSummary = `${sleepHours.toFixed(1)} hours. In a good range for recovery.`;
  }

  let recoverySummary = "";
  if (metrics.recoveryScore >= 75) {
    recoverySummary = `Recovery is strong at ${metrics.recoveryScore}%.`;
  } else if (metrics.recoveryScore >= 50) {
    recoverySummary = `Recovery is moderate at ${metrics.recoveryScore}%.`;
  } else {
    recoverySummary = `Recovery is low at ${metrics.recoveryScore}%. Rest and hydration are the priority.`;
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
        ? "Appetite is suppressed. Prioritize protein-first small meals (eggs, yogurt, chicken, shakes). Aim for 25-30g protein per meal even in smaller portions."
        : symptomsHeavy
        ? "Side effects may make eating harder. Try bland, easy-to-digest foods like toast, broth, rice, and bananas. Sip water steadily."
        : isDehydrated
        ? "Hydration is low. Drink a cup of water with each meal and add electrolytes, especially if you feel lightheaded."
        : "Prioritize protein at every meal to preserve muscle. Aim for 100-120g total daily. Include vegetables and 6-8 cups of water.",
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
    weekSummary: "This week balances two strength sessions with lighter recovery days. Prioritize 25-30g protein at every meal, 6-8 cups of water daily, and consistent sleep. Strength sessions protect lean mass while you lose weight on treatment.",
    days: planDays,
    adjustmentNote: "If side effects are heavier after a dose change, swap any strength day for a gentle walk and prioritize rest and hydration instead.",
  };
}
