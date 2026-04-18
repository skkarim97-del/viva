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
import { buildTitrationContext, titrationReadinessPenalty } from "./titrationHelper";
import {
  buildTierContext,
  maxConfidenceForTier,
  hasConvergingNegativeSignals,
  type DataTier,
  type Confidence,
  type TierContext,
} from "./dataTier";

export type MedContext = {
  doseTier: "low" | "mid" | "high";
  recentTitration: boolean;
  daysSinceDose: number | null;
  frequency: "weekly" | "daily";
  isNewToMed: boolean;
  titrationIntensity?: "none" | "mild" | "moderate" | "peak";
};

interface WhyPlanContext {
  dailyState: import("@/types").DailyState;
  medicationProfile?: MedicationProfile;
  medCtx: MedContext | null;
  glp1Inputs?: GLP1DailyInputs;
  metrics: HealthMetrics;
  readinessScore: number;
  trigger: string;
  wearableAvailable?: boolean;
}

function buildWhyThisPlan(ctx: WhyPlanContext): string[] {
  const { dailyState, medicationProfile, medCtx, glp1Inputs, metrics, trigger, wearableAvailable: wa } = ctx;
  const hasWearable = wa !== false;

  const brandName = medicationProfile?.medicationBrand || "your medication";
  const doseStr = medicationProfile ? `${medicationProfile.doseValue} ${medicationProfile.doseUnit}` : "";
  const fullMedStr = doseStr ? `${brandName} ${doseStr}` : brandName;
  const isTitrated = medCtx?.recentTitration === true;
  const isNew = medCtx?.isNewToMed === true;
  const isHigh = medCtx?.doseTier === "high";
  const doseWindow = medCtx?.daysSinceDose != null && medCtx?.frequency === "weekly" && medCtx.daysSinceDose! <= 2;

  const energyStr = glp1Inputs?.energy === "depleted" ? "very low" : glp1Inputs?.energy === "tired" ? "lower than usual" : glp1Inputs?.energy === "great" ? "strong" : null;
  const appetiteStr = glp1Inputs?.appetite === "very_low" ? "very suppressed" : glp1Inputs?.appetite === "low" ? "reduced" : null;
  const nauseaStr = glp1Inputs?.nausea === "severe" ? "significant" : glp1Inputs?.nausea === "moderate" ? "noticeable" : null;
  const digestionStr = glp1Inputs?.digestion === "diarrhea" ? "unsettled" : glp1Inputs?.digestion === "constipated" ? "sluggish" : glp1Inputs?.digestion === "bloated" ? "uncomfortable" : null;

  const inputParts: string[] = [];
  if (energyStr) inputParts.push(`energy is ${energyStr}`);
  if (appetiteStr) inputParts.push(`appetite is ${appetiteStr}`);
  if (nauseaStr) inputParts.push(`nausea is ${nauseaStr}`);
  if (digestionStr) inputParts.push(`digestion is ${digestionStr}`);

  const inputClause = inputParts.length > 0
    ? inputParts.join(", ").replace(/^./, c => c.toUpperCase()) + "."
    : "";

  let p1 = "";
  let p2 = "";
  let p3 = "";

  if (trigger === "sleep_critical") {
    p1 = hasWearable
      ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hours, which affects how your body processes ${fullMedStr}.`
      : `Your inputs suggest rest is the priority to support how your body processes ${fullMedStr}.`;
    if (isTitrated) p1 += " Dose adjustments can also disrupt sleep temporarily.";
    if (inputClause) p1 += " " + inputClause;
  } else if (trigger === "symptoms_severe") {
    p1 = isTitrated
      ? `Your body is adjusting to the recent ${brandName} dose change.${doseWindow ? " You are still within the peak adjustment window." : ""} ${inputClause}`
      : isNew
        ? `GI symptoms like nausea are common in the first weeks on ${brandName}. ${inputClause}`
        : isHigh
          ? `At ${doseStr}, symptom flares can happen periodically. ${inputClause}`
          : `${inputClause || "Symptoms are heavier today."} This can happen at various points during treatment with ${brandName}.`;
  } else if (trigger === "symptoms_moderate") {
    p1 = isTitrated
      ? `Nausea often increases for 1-2 weeks after a dose change on ${brandName}. ${inputClause}`
      : `${inputClause || "Nausea is noticeable today."} This is a common response to ${fullMedStr}${doseWindow ? ", especially close to dose day" : ""}.`;
  } else if (trigger === "appetite_digestion") {
    p1 = `Appetite suppression is one of the primary effects of ${brandName}${isHigh ? ` at ${doseStr}` : ""}. ${inputClause}`;
  } else if (trigger === "stress") {
    p1 = `Stress is elevated today. High cortisol can blunt how your body responds to ${brandName} and disrupt sleep and appetite.`;
    if (inputClause) p1 += " " + inputClause;
  } else if (trigger === "recovery_declining") {
    p1 = isTitrated
      ? `Recovery signals have been lower since the ${brandName} dose change. This is expected and usually resolves within 1-2 weeks. ${inputClause}`
      : `Recovery has been strained for several days. On ${brandName}, this can correlate with disrupted sleep or under-fueling. ${inputClause}`;
  } else if (trigger === "push_day") {
    const sleepPart = hasWearable && metrics.sleepDuration > 0 ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hours and y` : "Y";
    p1 = `${sleepPart}our body is responding well to ${fullMedStr}. ${inputClause || "Your inputs look solid today."}`;
  } else if (trigger === "build_day") {
    p1 = `Recovery signals support steady effort today on ${fullMedStr}. ${inputClause || "No major flags in your inputs."}`;
  } else if (trigger === "maintain_day") {
    const sleepNote = hasWearable && metrics.sleepDuration > 0 && metrics.sleepDuration < 7 ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hours. ` : "";
    p1 = `${sleepNote}Your body can handle the basics today but is not fully charged. On ${brandName}${isHigh ? ` at ${doseStr}` : ""}, days like this are normal. ${inputClause}`;
  } else if (trigger === "rest_day") {
    p1 = isTitrated
      ? `Your body is working hard to adjust after the ${brandName} dose change. ${inputClause}`
      : `Your body is signaling for rest. On ${fullMedStr}, rest days help your body recalibrate. ${inputClause}`;
  } else {
    p1 = `Your body could use some extra support today. On ${fullMedStr}, listening to these signals is part of the process. ${inputClause}`;
  }

  if (dailyState === "recover") {
    p2 = "Today's plan scales back activity and focuses on hydration, easy-to-digest protein, and rest. "
      + (nauseaStr ? "Smaller, more frequent meals and steady sipping help manage nausea better than skipping food entirely. " : "")
      + (digestionStr ? "Gentle movement after meals and extra water support digestion. " : "")
      + "This is not a step back. It is the right response to what your body is telling you.";
  } else if (dailyState === "push") {
    p2 = "Today's plan includes a strength session because this is your best window for muscle-preserving activity. "
      + "On GLP-1 treatment, strength training is one of the most effective ways to protect lean mass during weight loss. "
      + "Fuel well around your session with 25-30g protein within an hour.";
  } else if (dailyState === "build") {
    p2 = "Today's plan keeps effort moderate and consistent. "
      + (appetiteStr ? "Even with reduced appetite, getting protein at every meal protects muscle. " : "")
      + "Pairing movement with good fueling and hydration maximizes the benefit of each day on treatment.";
  } else {
    p2 = "Today's plan keeps things manageable so your body can stabilize. "
      + (appetiteStr ? "Protein-first small meals prevent the muscle loss that under-eating can cause. " : "")
      + (nauseaStr ? "Lighter food and steady hydration help manage how you are feeling. " : "")
      + "The basics done consistently matter more than big efforts on scattered days.";
  }

  if (isTitrated) {
    p3 = `Most people adjust to a new ${brandName} dose within 1-2 weeks. Staying consistent with your plan through this window sets a stronger baseline for the weeks ahead.`;
  } else if (isNew) {
    p3 = `The first month on ${brandName} is an adjustment period. Each day you stay consistent with your plan, your body adapts and the path gets smoother.`;
  } else if (isHigh) {
    p3 = `At ${doseStr}, maintaining fueling, hydration, and movement consistency is what separates great outcomes from average ones. You are building that foundation every day.`;
  } else {
    p3 = `Consistency is the most predictive factor in treatment success. Every day you follow through, even a lighter day like today, compounds over time.`;
  }

  return [p1.trim(), p2.trim(), p3.trim()].filter(s => s.length > 0);
}

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
  const titration = buildTitrationContext(medicationProfile);
  return {
    doseTier: getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue),
    recentTitration: medicationProfile.recentTitration === true,
    daysSinceDose: computeDaysSinceLastDose(medicationLog),
    frequency: medicationProfile.frequency || safeMedFrequency(medicationProfile.medicationBrand),
    isNewToMed: medicationProfile.timeOnMedicationBucket === "less_1_month",
    titrationIntensity: titration.titrationIntensity,
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
    if (medCtx.titrationIntensity === "peak") {
      if (needsMoreWhenStressed) bump(2); else drop(2);
    } else if (medCtx.titrationIntensity === "moderate") {
      if (needsMoreWhenStressed) bump(2); else drop(1);
    } else if (medCtx.recentTitration) {
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
  wearableAvailable?: boolean,
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

  if (wearableAvailable && metrics.sleepDuration > 0 && metrics.sleepDuration < 7) {
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
  mentalState?: import("@/types").MentalState,
  hasHealthData?: boolean,
  availableMetricTypes?: string[],
): DailyPlan {
  const feeling = inputs?.feeling ?? null;
  const energy = inputs?.energy ?? null;
  const stress = inputs?.stress ?? null;
  const hydration = inputs?.hydration ?? null;
  const trainingIntent = inputs?.trainingIntent ?? null;

  // Build the tier context once. We use this to gate which signals can fire and which
  // baseline-relative claims we can make. We pin "now" to today's metric date so freshness
  // gates degrade gracefully when the user hasn't synced for a while.
  const hasSubjectiveInputs = !!(feeling || energy || stress || trainingIntent || glp1Inputs);
  const nowMs = Date.now();
  const tierCtx: TierContext = buildTierContext(
    recentMetrics ?? [],
    metrics,
    availableMetricTypes ?? [],
    hasSubjectiveInputs,
    nowMs,
  );
  const tier: DataTier = tierCtx.tier;

  // Backwards-compat: existing code paths use `wearableAvailable` to gate physiological
  // claims. We treat phone_health as "wearable not available" so phone-tier users never
  // get HRV/recovery copy. Wearable tier additionally requires at least one usable wearable
  // metric (HRV or RHR passing both sufficiency AND freshness) to fire physiological logic.
  const wearableAvailable = tier === "wearable" && hasHealthData !== false && (tierCtx.usableHrv || tierCtx.usableRhr);

  const last7 = recentMetrics?.slice(-7) ?? [];
  const last3 = last7.slice(-3);
  const last5 = recentMetrics?.slice(-5) ?? [];

  // Filter-non-null averages so an unavailable metric contributes nothing instead of a fake 0.
  const hrvSamples7 = last7.map(m => m.hrv).filter((v): v is number => typeof v === "number");
  const rhrSamples7 = last7.map(m => m.restingHeartRate).filter((v): v is number => typeof v === "number");
  const strainSamples7 = last7.map(m => m.strain).filter((v): v is number => typeof v === "number");
  const avg7Hrv = wearableAvailable && hrvSamples7.length >= 3 ? hrvSamples7.reduce((s, v) => s + v, 0) / hrvSamples7.length : 0;
  const avg7Sleep = wearableAvailable && last7.length >= 3 ? last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length : 0;
  const avg7Rhr = wearableAvailable && rhrSamples7.length >= 3 ? rhrSamples7.reduce((s, v) => s + v, 0) / rhrSamples7.length : 0;

  const hrvDeviation = wearableAvailable && avg7Hrv > 0 && typeof metrics.hrv === "number" ? ((metrics.hrv - avg7Hrv) / avg7Hrv) * 100 : 0;
  const rhrElevated = wearableAvailable && avg7Rhr > 0 && typeof metrics.restingHeartRate === "number" && metrics.restingHeartRate > avg7Rhr + 5;

  const sleepDeclining3 = wearableAvailable && last3.length >= 3 && last3.every((m, i) => i === 0 || m.sleepDuration < last3[i - 1].sleepDuration);
  const hrvDeclining5 = wearableAvailable && last5.length >= 5
    && last5.every(m => typeof m.hrv === "number")
    && (last5[last5.length - 1].hrv as number) < (last5[0].hrv as number) - 5
    && last5.every((m, i) => i === 0 || (m.hrv as number) <= (last5[i - 1].hrv as number) + 2);

  // Strain is not implemented yet: all samples are null. Use neutral (5 of 21) instead of fake 0
  // so the user is never penalized for a metric that does not exist.
  const yesterdayStrainRaw = last7[last7.length - 2]?.strain;
  const yesterdayStrain = typeof yesterdayStrainRaw === "number" ? yesterdayStrainRaw : 5;
  const avgStrain = strainSamples7.length >= 3
    ? strainSamples7.reduce((s, v) => s + v, 0) / strainSamples7.length
    : 5;
  const consecutivePoorRecovery = wearableAvailable && last3.length >= 3 && last3.every(m => typeof m.recoveryScore === "number" && m.recoveryScore < 50);

  // Readiness score: weight only the metrics we actually have. Missing metrics drop out of the
  // formula and the remaining weights are renormalized to 100%. This prevents unimplemented
  // fields (recoveryScore, sleepQuality, strain) from penalizing the user to zero.
  let readinessScore: number;
  if (wearableAvailable) {
    const components: { value: number; weight: number }[] = [];
    if (typeof metrics.recoveryScore === "number") {
      components.push({ value: metrics.recoveryScore, weight: 0.3 });
    }
    if (typeof metrics.sleepQuality === "number") {
      components.push({ value: metrics.sleepQuality, weight: 0.3 });
    }
    if (typeof metrics.hrv === "number") {
      components.push({ value: Math.min((metrics.hrv / 60) * 100, 100), weight: 0.2 });
    }
    if (typeof metrics.restingHeartRate === "number") {
      components.push({ value: (1 - Math.min(metrics.restingHeartRate, 80) / 80) * 100, weight: 0.2 });
    }
    // Sleep duration as a fallback signal when derived scores are unavailable.
    if (components.length === 0 && metrics.sleepDuration > 0) {
      const sleepScore = Math.max(0, Math.min(100, (metrics.sleepDuration / 8) * 100));
      components.push({ value: sleepScore, weight: 1 });
    }
    if (components.length === 0) {
      readinessScore = 70;
    } else {
      const totalWeight = components.reduce((s, c) => s + c.weight, 0);
      readinessScore = Math.round(
        components.reduce((s, c) => s + c.value * (c.weight / totalWeight), 0)
      );
    }
  } else {
    readinessScore = 70;
  }

  if (!wearableAvailable) {
    let inputBonus = 0;
    let inputPenalty = 0;

    if (feeling === "great") inputBonus += 10;
    else if (feeling === "tired") inputPenalty += 15;
    else if (feeling === "stressed") inputPenalty += 20;

    if (energy === "excellent" || energy === "high") inputBonus += 10;
    else if (energy === "low") inputPenalty += 20;

    if (stress === "very_high") inputPenalty += 25;
    else if (stress === "high") inputPenalty += 15;
    else if (stress === "low") inputBonus += 5;

    if (trainingIntent === "none") inputPenalty += 15;
    else if (trainingIntent === "intense") inputBonus += 5;

    if (hydration === "dehydrated") inputPenalty += 10;
    else if (hydration === "low") inputPenalty += 5;
    else if (hydration === "good") inputBonus += 3;

    if (glp1Inputs?.nausea === "severe") inputPenalty += 25;
    else if (glp1Inputs?.nausea === "moderate") inputPenalty += 15;
    else if (glp1Inputs?.nausea === "none") inputBonus += 5;

    if (glp1Inputs?.digestion === "diarrhea") inputPenalty += 15;
    else if (glp1Inputs?.digestion === "constipated") inputPenalty += 10;
    else if (glp1Inputs?.digestion === "fine") inputBonus += 5;

    if (glp1Inputs?.appetite === "very_low") inputPenalty += 15;
    else if (glp1Inputs?.appetite === "low") inputPenalty += 8;
    else if (glp1Inputs?.appetite === "strong" || glp1Inputs?.appetite === "normal") inputBonus += 5;

    if (glp1Inputs?.energy === "depleted") inputPenalty += 25;
    else if (glp1Inputs?.energy === "tired") inputPenalty += 15;
    else if (glp1Inputs?.energy === "great") inputBonus += 10;

    readinessScore = Math.max(0, Math.min(100, readinessScore + inputBonus - inputPenalty));
  } else {
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
  }

  if (glp1Inputs?.nausea === "severe") readinessScore = Math.min(readinessScore, 35);
  else if (glp1Inputs?.nausea === "moderate") readinessScore = Math.min(readinessScore, 50);

  if (glp1Inputs?.digestion === "diarrhea") readinessScore = Math.min(readinessScore, 45);
  else if (glp1Inputs?.digestion === "constipated") readinessScore = Math.min(readinessScore, 55);

  if (glp1Inputs?.appetite === "very_low") readinessScore = Math.min(readinessScore, 50);

  if (glp1Inputs?.energy === "depleted") readinessScore = Math.min(readinessScore, 35);
  else if (glp1Inputs?.energy === "tired") readinessScore = Math.min(readinessScore, 50);

  if (medicationProfile) {
    const tier = getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue);
    const titration = buildTitrationContext(medicationProfile);
    const titrationPenalty = titrationReadinessPenalty(titration);
    if (titrationPenalty > 0) {
      readinessScore = Math.max(readinessScore - titrationPenalty, 0);
    } else if (medicationProfile.recentTitration) {
      readinessScore = Math.max(readinessScore - 8, 0);
    }
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

  if (mentalState === "burnt_out") {
    readinessScore = Math.min(readinessScore, 40);
  } else if (mentalState === "low") {
    readinessScore = Math.max(readinessScore - 10, 0);
  } else if (mentalState === "focused") {
    readinessScore = Math.min(readinessScore + 5, 100);
  }

  const readinessLabel = readinessScore >= 80 ? "Excellent" : readinessScore >= 65 ? "Good" : readinessScore >= 45 ? "Moderate" : "Low";

  const medCtx = buildMedContext(medicationProfile, medicationLog);

  const stressOverride = stress === "high" || stress === "very_high";
  const lowEnergy = energy === "low";
  const isDehydrated = hydration === "dehydrated" || hydration === "low";
  const sleepLow = wearableAvailable && metrics.sleepDuration > 0 && metrics.sleepDuration < 6.5;
  const sleepCritical = wearableAvailable && metrics.sleepDuration > 0 && metrics.sleepDuration < 6 && hrvDeviation < -10;
  const sleepGoodHrvGood = wearableAvailable && metrics.sleepDuration > 7.5 && hrvDeviation >= 0;
  const symptomsSevere = glp1Inputs?.nausea === "severe";
  const symptomsModerate = glp1Inputs?.nausea === "moderate";
  const symptomsHeavy = symptomsSevere || symptomsModerate;
  const digestionSevere = glp1Inputs?.digestion === "diarrhea";
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

  if (sleepCritical || (symptomsSevere && glp1Inputs?.energy === "depleted")) {
    dailyState = "recover";
    headline = isTitrated
      ? "Your body is adjusting to the new dose. Keep today simple."
      : "Recovery is the priority today.";
    summary = symptomsSevere
      ? "Severe nausea and very low energy mean today is about rest, hydration, and the smallest meals you can tolerate. Skip workouts."
      : symptomsModerate
        ? "Nausea is heavy and energy is very low. Rest, hydration, and small meals are enough for today."
        : wearableAvailable && metrics.sleepDuration > 0
          ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs and your body is showing it. Rest and hydration come first.`
          : "Your inputs suggest your body needs rest today. Hydration and small meals come first.";
    dailyFocus = "Rest and recover";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: sleepCritical ? "sleep_critical" : "symptoms_severe" });
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 0;
    workoutDesc = symptomsSevere
      ? "Full rest today. Skip workouts while nausea is severe."
      : "Full rest or a very gentle walk if you feel up to it.";
    optional = symptomsSevere
      ? "Sip electrolytes slowly. If vomiting, cannot keep fluids down, or symptoms worsen, contact your prescriber."
      : "A short walk after a meal can help with nausea and digestion.";
  } else if (symptomsSevere) {
    // Severe nausea without "depleted" energy still warrants recover mode
    // with firmer guardrails than moderate nausea.
    dailyState = "recover";
    headline = isTitrated
      ? "Severe nausea after the dose change. Pull back hard today."
      : "Severe nausea today. Rest, fluids, and the smallest meals you can tolerate.";
    summary = isHighDose
      ? "At higher doses severe nausea can escalate quickly. Focus on sipping fluids, electrolytes, and tiny protein-forward bites. No workout today."
      : "Severe nausea is a stop-signal from your body. Prioritize fluids, electrolytes, and very small meals. No workout today.";
    dailyFocus = "Rest and recover";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "symptoms_severe" });
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 0;
    workoutDesc = "Full rest. Skip all training while nausea is severe.";
    optional = "If you cannot keep fluids down, are vomiting, or symptoms worsen through the day, contact your prescriber.";
  } else if (digestionSevere && (symptomsModerate || glp1Inputs?.energy === "depleted")) {
    // Diarrhea stacked on other strain also warrants recover framing.
    dailyState = "recover";
    headline = "Digestion is off and your body is strained. Keep today very light.";
    summary = "Diarrhea plus other symptoms can drain fluids and electrolytes fast. Focus on rehydration and easy foods before anything else.";
    dailyFocus = "Rehydrate and rest";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "symptoms_severe" });
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 0;
    workoutDesc = "Rest. Resume light movement once digestion settles.";
    optional = "Oral rehydration drinks or broth help replace what you are losing.";
  } else if (symptomsModerate) {
    dailyState = "recover";
    headline = isTitrated
      ? "Nausea from the dose change is showing. Simplify today."
      : "Nausea is heavier today. Keep things light.";
    summary = isHighDose
      ? "Higher doses can bring stronger nausea. Hydration, small meals, and rest are enough today."
      : "Nausea is making things harder. Hydration and small protein-rich meals will help most.";
    dailyFocus = "Manage symptoms";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "symptoms_moderate" });
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
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "appetite_digestion" });
    workoutType = "Light Movement";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk or gentle movement. Focus energy on eating well.";
    optional = "Protein shakes or smoothies are a good option when appetite is low.";
  } else if (stressOverride || (stress as string) === "very_high") {
    dailyState = "recover";
    headline = "Stress is elevated. A simpler day will help.";
    summary = "High stress raises cortisol, which can blunt treatment benefits and disrupt sleep and appetite. Keep today low-pressure.";
    dailyFocus = "Simplify and recover";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "stress" });
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
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "recovery_declining" });
    workoutType = "Light Walk";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk and stretching only.";
    optional = "Start winding down 30 minutes earlier tonight.";
  } else if ((sleepGoodHrvGood || (!wearableAvailable && readinessScore >= 80)) && readinessScore >= 75 && !appetiteLow) {
    dailyState = "push";
    headline = isNewToMed
      ? "Your body is responding well to treatment. A good day to build."
      : !wearableAvailable
        ? "You're in a great spot today. Make the most of it."
        : "Recovery is strong. Make the most of today.";
    summary = wearableAvailable
      ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs and HRV is above your baseline. A strong day for a strength session or longer walk.`
      : "Your check-ins look strong across the board. A good time for a strength session or longer walk.";
    dailyFocus = "Make the most of today";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "push_day" });
    workoutType = "Strength Session";
    workoutIntensity = "moderate";
    workoutDuration = 30;
    workoutDesc = "Strength session focused on compound movements.";
    optional = "Include a protein-rich meal within an hour after your session.";
  } else if (readinessScore >= 65) {
    dailyState = "build";
    headline = "A good day for steady progress.";
    summary = "Today looks good for steady progress. Stay consistent with movement, protein, and hydration.";
    dailyFocus = "Steady progress";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "build_day" });
    workoutType = "Walk or Light Activity";
    workoutIntensity = "moderate";
    workoutDuration = 30;
    workoutDesc = "30 min walk or light activity session.";
    optional = "If energy drops later, a walk is always a solid fallback.";
  } else if (readinessScore >= 45) {
    dailyState = "maintain";
    const subjectiveGood = (energy === "high" || energy === "excellent" || feeling === "great" || glp1Inputs?.energy === "great") && !symptomsHeavy;
    headline = sleepLow && !subjectiveGood
      ? `${metrics.sleepDuration.toFixed(1)} hrs of sleep. Keep today simple.`
      : !wearableAvailable
        ? "A steady day. Stay consistent with the basics."
        : sleepLow && subjectiveGood
          ? "You're running on light sleep but feeling steady. Match effort to how you feel."
          : "Your body could use a lighter day.";
    summary = sleepLow && !subjectiveGood
      ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs. A lighter day with protein-rich meals and extra water will help you recover.`
      : sleepLow && subjectiveGood
        ? `Sleep was ${metrics.sleepDuration.toFixed(1)} hrs but your check-ins look solid. Stay flexible. Pull back if energy fades.`
        : "Keep things manageable today. Focus on protein, hydration, and gentle movement.";
    dailyFocus = "Basics first";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "maintain_day" });
    workoutType = "Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Easy walk. No pressure on pace or distance.";
    optional = "If you feel good, you can extend to 30 minutes.";
  } else {
    // Strong "rest day" requires multiple converging negative signals so that a single short
    // night, or a single low check-in, cannot push someone into a heavy rest recommendation
    // when other signals look fine.
    const subjectiveGoodFinal = (energy === "high" || energy === "excellent" || feeling === "great" || glp1Inputs?.energy === "great") && !symptomsHeavy;
    const converging = hasConvergingNegativeSignals({
      sleepShort: !!sleepLow,
      rhrElevated: !!rhrElevated,
      hrvBelowBaseline: wearableAvailable && (tierCtx.deviations.hrvVsBaselinePct ?? 0) < -10,
      recoveryLow: wearableAvailable && typeof metrics.recoveryScore === "number" && metrics.recoveryScore < 50,
      symptomsHeavy: !!symptomsHeavy,
      energyLow: energy === "low" || glp1Inputs?.energy === "depleted",
      // High/very-high stress would have already routed above; this branch only sees mild stress.
      stressHigh: false,
    });
    if (subjectiveGoodFinal && !converging) {
      // Downgrade to maintain: the only thing low is the readiness math, but the user is
      // telling us they feel fine and no other signal converges.
      dailyState = "maintain";
      headline = "You're feeling steady today. Keep it simple but do not pull back.";
      summary = "Your check-ins look good even though one or two numbers are softer. Stay with the basics and adjust if anything shifts.";
      dailyFocus = "Steady and flexible";
      whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "maintain_day" });
      workoutType = "Gentle Walk";
      workoutIntensity = "low";
      workoutDuration = 20;
      workoutDesc = "Easy walk. Lengthen if you feel up to it.";
      optional = "Pull back only if symptoms or fatigue show up later.";
    } else {
      dailyState = "recover";
      headline = isTitrated
        ? "Your body is working hard to adjust. Rest is the right call today."
        : "Your body needs a break today.";
      summary = "Your body needs a break. Focus on rest, hydration, and nourishing food. Movement can wait.";
      dailyFocus = "Rest and restore";
      whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "rest_day" });
      optional = "A 10-minute easy walk is the most you should do today.";
      workoutType = "Rest";
      workoutIntensity = "low";
      workoutDuration = 0;
      workoutDesc = "Full rest day.";
    }
  }

  if (mentalState === "burnt_out" && dailyState !== "recover") {
    dailyState = "recover";
    headline = "You are mentally burnt out. Let today be simple.";
    summary = "Mental fatigue matters as much as physical fatigue. A stripped-back day with small wins helps you reset without falling off track.";
    dailyFocus = "Small wins only";
    workoutType = "Rest or Gentle Walk";
    workoutIntensity = "low";
    workoutDuration = 10;
    workoutDesc = "A short walk if you feel like it. Nothing more.";
    optional = "Pick one small thing to complete. That is enough for today.";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "rest_day" });
  } else if (mentalState === "low" && (dailyState === "push" || dailyState === "build")) {
    dailyState = "maintain";
    headline = "Energy is there but your mind needs a lighter day.";
    summary = "When motivation is low, easy consistency matters most. Stay with the basics and protect your streak.";
    dailyFocus = "Easy consistency";
    workoutIntensity = "low";
    workoutDuration = Math.min(workoutDuration, 20);
    workoutDesc = "Gentle movement. Keep the bar low.";
    whyThisPlan = buildWhyThisPlan({ dailyState, medicationProfile, medCtx, glp1Inputs, metrics, readinessScore, wearableAvailable, trigger: "maintain_day" });
  }

  let recommendedTag = stateTagFromReadiness(readinessScore, feeling, stress, energy);
  if (mentalState === "burnt_out") {
    recommendedTag = "stressed";
  } else if (mentalState === "low" && (recommendedTag === "great" || recommendedTag === "good")) {
    recommendedTag = "tired";
  }

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
    : !wearableAvailable ? "Daily movement supports digestion, energy, and muscle preservation on treatment."
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
    : !wearableAvailable ? "Consistent sleep is your most powerful recovery tool on treatment. Aim for 7-8 hours tonight."
    : dailyState === "recover" ? "Your body needs extra rest to bounce back. Aim for 8+ hours tonight." + titrationNote
    : medCtx?.recentTitration ? "Sleep matters more during a dose adjustment. Aim for the higher end of the range (8+ hrs)."
    : "Consistent sleep is your most powerful recovery tool on treatment. It affects energy, appetite, and side effects.";

  const consistentReason = consistentData.reason;

  const actionReasons: { move: string; fuel: string; hydrate: string; recover: string; consistent: string } = { move: moveReason, fuel: fuelReason, hydrate: hydrateReason, recover: recoverReason, consistent: consistentReason };

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
  if (!wearableAvailable) {
    sleepSummary = "";
  } else if (sleepHours < 7) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Below the 7-8 hr range that best supports treatment.`;
  } else if (sleepHours >= 8) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Strong foundation for recovery and energy.`;
  } else {
    sleepSummary = `${sleepHours.toFixed(1)} hours. In a good range for recovery.`;
  }

  let recoverySummary = "";
  const recoveryScoreVal = metrics.recoveryScore;
  if (!wearableAvailable || typeof recoveryScoreVal !== "number") {
    recoverySummary = "";
  } else if (recoveryScoreVal >= 75) {
    recoverySummary = "Recovery is strong.";
  } else if (recoveryScoreVal >= 50) {
    recoverySummary = "Recovery is moderate.";
  } else {
    recoverySummary = "Recovery is low. Rest and hydration are the priority.";
  }

  // Tailored, context-aware lead phrase. Selects a pool based on the
  // strongest signal present (severe symptoms beat titration beats short
  // sleep beats low energy beats mixed-signal beats dailyState tier),
  // then picks a variant deterministically by date so the same day
  // always gets the same phrase. 10+ distinct variants across buckets,
  // warm and grounded rather than clinical.
  const statusLabel: import("@/types").DailyStatusLabel = (() => {
    // Note: `energy` (WellnessInputs) uses "low|medium|high|excellent",
    // while glp1Inputs?.energy (EnergyDaily) uses "great|good|tired|
    // depleted". We read each through its correct type so TS is happy and
    // the conditions actually line up with real user inputs.
    const glp1Energy = glp1Inputs?.energy ?? null;
    const subjectiveGood =
      feeling === "great" || energy === "excellent" || glp1Energy === "great";
    const objectiveWeak =
      (wearableAvailable && sleepHours < 7) ||
      (typeof metrics.recoveryScore === "number" && metrics.recoveryScore < 55);
    const objectiveStrong =
      wearableAvailable && sleepHours >= 7.5 &&
      (typeof metrics.recoveryScore !== "number" || metrics.recoveryScore >= 65);

    // Lead phrases live inside a small pill on the Today card, so they need
    // to read as a compact status tag (think 2-4 words, ~25 chars max), not
    // a sentence. The longer warm copy belongs in coachInsight below.
    // Status labels read as a short clinical tag, not a lifestyle phrase.
    // Pattern: a 2-4 word context tag a clinician would write in a chart
    // note ("Recovery phase", "Nausea management"), never slang or food
    // metaphors. Keep each label ≤ 25 chars; the headline below carries
    // the action-oriented directive.
    let pool: string[];
    if (symptomsSevere) {
      pool = ["Symptom management", "Recovery phase", "Stabilization day"];
    } else if (digestionSevere) {
      pool = ["Digestion management", "GI support", "Gentle nutrition"];
    } else if (medicationProfile?.recentTitration) {
      pool = ["Titration week", "Dose adjustment", "Adaptation phase"];
    } else if (wearableAvailable && sleepHours < 6) {
      pool = ["Sleep recovery", "Recovery priority", "Rest focus"];
    } else if (glp1Energy === "depleted" || glp1Energy === "tired" || energy === "low") {
      pool = ["Low energy support", "Energy conservation", "Reduced load"];
    } else if (subjectiveGood && objectiveWeak) {
      pool = ["Mixed signals", "Pace yourself", "Measured day"];
    } else if (!subjectiveGood && objectiveStrong && symptomsModerate) {
      pool = ["Capacity available", "Steady baseline", "Cleared to engage"];
    } else if (dailyState === "push") {
      pool = ["Active day", "Strong baseline", "Capacity day"];
    } else if (dailyState === "build") {
      pool = ["Build day", "Consistent progress", "Steady gains"];
    } else if (dailyState === "maintain") {
      pool = ["Stable today", "Maintenance day", "Steady state"];
    } else {
      pool = ["Recovery phase", "Repair day", "Stabilization"];
    }

    // Deterministic day-to-day rotation so the phrase is stable within a
    // day but rotates across days without needing any random seed.
    const d = new Date(metrics.date);
    const dayKey = d.getFullYear() * 1000 + (d.getMonth() + 1) * 40 + d.getDate();
    return pool[dayKey % pool.length];
  })();

  const statusDrivers: string[] = [];

  if (!wearableAvailable || typeof metrics.recoveryScore !== "number") {
  } else if (metrics.recoveryScore >= 70) statusDrivers.push("Recovery is solid");
  else if (metrics.recoveryScore >= 50) statusDrivers.push("Recovery is moderate");
  else statusDrivers.push("Recovery needs attention");

  if (!wearableAvailable) {
  } else if (sleepHours >= 7.5) statusDrivers.push("Slept well");
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
  else if (!wearableAvailable) {}
  else if (metrics.steps >= 6000) statusDrivers.push("Movement is on track");
  else statusDrivers.push("Movement has been light");

  if (statusDrivers.length === 0) {
    statusDrivers.push("Check in to personalize your plan");
  }

  const guidance =
    dailyState === "push" ? "Make the most of today"
    : dailyState === "build" ? "Stay consistent today"
    : dailyState === "maintain" ? "Focus on the basics today"
    : "Rest and support your body today";

  const focusItems = generateFocusItems(dailyState, metrics, inputs, glp1Inputs, wearableAvailable);

  // Recommendation confidence is the lower of the tier's max and a local "how strong is the
  // signal" estimate. We expose this on the plan so consumers (insights, copy) can soften
  // language when low. Never display the value numerically.
  const tierCap = maxConfidenceForTier(tierCtx);
  const localConfidence: Confidence =
    (consecutivePoorRecovery || hrvDeclining5 || sleepCritical || symptomsHeavy) ? "high"
    : (sleepLow || rhrElevated || stressOverride || appetiteLow) ? "moderate"
    : hasSubjectiveInputs ? "moderate" : "low";
  const order: Record<Confidence, number> = { low: 0, moderate: 1, high: 2 };
  const recommendationConfidence: Confidence = order[localConfidence] < order[tierCap] ? localConfidence : tierCap;

  // Dev-only debug log so we can see how the tier system is shaping recommendations
  // without ever surfacing it in patient UI. Gated on __DEV__ so production bundles drop it.
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const firedSignals: string[] = [];
    if (sleepCritical) firedSignals.push("sleepCritical");
    if (sleepLow) firedSignals.push("sleepLow");
    if (consecutivePoorRecovery) firedSignals.push("consecutivePoorRecovery");
    if (hrvDeclining5) firedSignals.push("hrvDeclining5");
    if (rhrElevated) firedSignals.push("rhrElevated");
    if (symptomsHeavy) firedSignals.push("symptomsHeavy");
    if (appetiteLow) firedSignals.push("appetiteLow");
    if (digestiveDistress) firedSignals.push("digestiveDistress");
    if (stressOverride) firedSignals.push("stressOverride");
    // eslint-disable-next-line no-console
    console.log("[planEngine] tier", {
      dataTier: tier,
      recommendationConfidence,
      sufficiency: tierCtx.sufficiency,
      freshness: tierCtx.freshness,
      usable: { sleep: tierCtx.usableSleep, steps: tierCtx.usableSteps, rhr: tierCtx.usableRhr, hrv: tierCtx.usableHrv },
      firedSignals,
      readinessScore,
      dailyState,
    });
  }

  return {
    date: metrics.date,
    readinessScore,
    readinessLabel,
    dataTier: tier,
    recommendationConfidence,
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
      carbs: (workoutIntensity as string) === "high" ? 180 : readinessScore >= 65 ? 160 : 140,
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
