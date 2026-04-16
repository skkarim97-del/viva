import type {
  GLP1DailyInputs,
  MentalState,
  HealthMetrics,
  MedicationProfile,
  MedicationLogEntry,
  WeeklyPlan,
  WeeklyPlanDay,
  WeeklyDayAction,
  ActionCategory,
  InternalSeverity,
  CompletionRecord,
  DailyCheckIn,
} from "@/types";
import { CATEGORY_OPTIONS } from "@/types";
import { getDoseTier } from "@/data/medicationData";
import { buildTitrationContext, titrationSeverityBoost } from "./titrationHelper";

interface SeverityInput {
  recentInputs: GLP1DailyInputs[];
  recentCheckIns: DailyCheckIn[];
  recentMetrics: HealthMetrics[];
  medicationProfile?: MedicationProfile;
  medicationLog?: MedicationLogEntry[];
  completionHistory: CompletionRecord[];
  hasHealthData?: boolean;
}

interface SeverityResult {
  severity: InternalSeverity;
  score: number;
  drivers: string[];
  streakDays: number;
}

function inputSeverityScore(input: GLP1DailyInputs): number {
  let score = 0;
  if (input.energy === "depleted") score += 3;
  else if (input.energy === "tired") score += 1.5;
  if (input.nausea === "severe") score += 3;
  else if (input.nausea === "moderate") score += 1.5;
  if (input.digestion === "diarrhea") score += 2;
  else if (input.digestion === "constipated") score += 1;
  else if (input.digestion === "bloated") score += 0.5;
  if (input.appetite === "very_low") score += 2;
  else if (input.appetite === "low") score += 1;
  return score;
}

function mentalSeverityScore(ms: MentalState): number {
  if (ms === "burnt_out") return 3;
  if (ms === "low") return 1.5;
  return 0;
}

function countNegativeStreak(inputs: GLP1DailyInputs[], checkIns: DailyCheckIn[]): number {
  const sorted = [...inputs].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const inp of sorted) {
    const dayScore = inputSeverityScore(inp);
    const ci = checkIns.find(c => c.date === inp.date);
    const mentalScore = ci ? mentalSeverityScore(ci.mentalState) : 0;
    if (dayScore + mentalScore >= 3) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function computeInternalSeverity(input: SeverityInput): SeverityResult {
  const { recentInputs, recentCheckIns, recentMetrics, medicationProfile, hasHealthData } = input;
  const wearableAvailable = hasHealthData !== false;
  const drivers: string[] = [];

  const last3 = recentInputs.slice(-3);

  let compositeScore = 0;

  if (last3.length > 0) {
    const avgRecent = last3.reduce((s, i) => s + inputSeverityScore(i), 0) / last3.length;
    compositeScore += avgRecent * 3;
  }

  const recentCheckIn = recentCheckIns.length > 0
    ? recentCheckIns[recentCheckIns.length - 1]
    : null;
  if (recentCheckIn) {
    compositeScore += mentalSeverityScore(recentCheckIn.mentalState) * 2;
  }

  if (wearableAvailable && recentMetrics.length >= 3) {
    const recent3 = recentMetrics.slice(-3);
    const avgSleep = recent3.reduce((s, m) => s + m.sleepDuration, 0) / recent3.length;
    const recoveryVals = recent3.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
    const avgRecovery = recoveryVals.length ? recoveryVals.reduce((s, v) => s + v, 0) / recoveryVals.length : 0;
    if (avgSleep < 5.5) {
      compositeScore += 3;
      drivers.push("sleep_low");
    } else if (avgSleep < 6.5) {
      compositeScore += 1.5;
      drivers.push("sleep_moderate");
    }
    if (avgRecovery < 40) {
      compositeScore += 2;
      drivers.push("recovery_low");
    }
  }

  if (medicationProfile) {
    const tier = getDoseTier(medicationProfile.medicationBrand, medicationProfile.doseValue);
    const titration = buildTitrationContext(medicationProfile);
    if (titration.isWithinTitrationWindow) {
      const boost = titrationSeverityBoost(titration);
      compositeScore += boost;
      drivers.push("recent_titration");
      if (titration.titrationIntensity === "peak") {
        drivers.push("titration_peak_window");
      }
    } else if (medicationProfile.recentTitration) {
      compositeScore += 2;
      drivers.push("recent_titration");
    }
    if (tier === "high") {
      compositeScore += 1;
      drivers.push("high_dose");
    }
    if (medicationProfile.timeOnMedicationBucket === "less_1_month") {
      compositeScore += 1;
      drivers.push("new_to_medication");
    }
  }

  const streakDays = countNegativeStreak(recentInputs, recentCheckIns);
  if (streakDays >= 3) {
    compositeScore += 3;
    drivers.push("multi_day_difficulty");
  } else if (streakDays >= 2) {
    compositeScore += 1.5;
    drivers.push("consecutive_difficulty");
  }

  if (last3.length > 0) {
    const hasNausea = last3.some(i => i.nausea === "severe" || i.nausea === "moderate");
    const hasLowEnergy = last3.some(i => i.energy === "depleted" || i.energy === "tired");
    const hasDigestion = last3.some(i => i.digestion === "diarrhea" || i.digestion === "constipated");
    const hasLowAppetite = last3.some(i => i.appetite === "very_low");
    if (hasNausea) drivers.push("nausea");
    if (hasLowEnergy) drivers.push("low_energy");
    if (hasDigestion) drivers.push("digestion_issues");
    if (hasLowAppetite) drivers.push("low_appetite");
  }

  if (recentCheckIn?.mentalState === "burnt_out") drivers.push("mental_burnout");
  else if (recentCheckIn?.mentalState === "low") drivers.push("mental_low");

  let severity: InternalSeverity;
  if (compositeScore >= 18) severity = "red";
  else if (compositeScore >= 12) severity = "orange";
  else if (compositeScore >= 6) severity = "yellow";
  else severity = "green";

  return { severity, score: compositeScore, drivers, streakDays };
}

type SeverityStateTag = "great" | "good" | "tired" | "stressed";

function severityToStateTag(severity: InternalSeverity): SeverityStateTag {
  switch (severity) {
    case "green": return "great";
    case "yellow": return "good";
    case "orange": return "tired";
    case "red": return "stressed";
  }
}

function pickAdaptiveAction(category: ActionCategory, severity: InternalSeverity): string {
  const tag = severityToStateTag(severity);
  const options = CATEGORY_OPTIONS[category];
  const match = options.find(o => o.stateTag === tag);
  return match ? match.title : options[1].title;
}

function adaptiveFocusArea(severity: InternalSeverity, originalFocus: string, dayOfWeek: string): string {
  switch (severity) {
    case "red":
      return "Rest + Gentle Support";
    case "orange":
      if (originalFocus.toLowerCase().includes("strength")) return "Light Movement + Recovery";
      return "Gentle Routine + Hydration";
    case "yellow":
      if (originalFocus.toLowerCase().includes("strength")) return "Modified Strength + Recovery";
      return originalFocus;
    case "green":
      return originalFocus;
  }
}

function antiSnowballDuration(severity: InternalSeverity, streakDays: number): number {
  if (severity === "red") return Math.min(streakDays + 2, 4);
  if (severity === "orange") return Math.min(streakDays + 1, 3);
  if (severity === "yellow") return 1;
  return 0;
}

function adaptiveDayNote(severity: InternalSeverity, drivers: string[]): string | undefined {
  if (severity === "green") return undefined;

  const parts: string[] = [];

  if (severity === "red") {
    if (drivers.includes("titration_peak_window")) {
      parts.push("Your dose just changed. Your body needs a few days to settle in. Today is about rest and comfort.");
    } else if (drivers.includes("recent_titration")) {
      parts.push("Your body is adjusting to the dose change. Taking it easy is the right move.");
    } else if (drivers.includes("multi_day_difficulty")) {
      parts.push("The last few days have been tough. Today is lighter so your body can catch up.");
    } else {
      parts.push("Today is a gentler day. Rest and hydration are your priorities.");
    }
  } else if (severity === "orange") {
    if (drivers.includes("nausea") || drivers.includes("digestion_issues")) {
      parts.push("Side effects can make things harder. Today's plan is adjusted to keep you comfortable.");
    } else if (drivers.includes("mental_burnout") || drivers.includes("mental_low")) {
      parts.push("It is okay to take things down a notch. Today's plan is a bit lighter.");
    } else if (drivers.includes("low_energy")) {
      parts.push("Energy has been lower recently. The plan is scaled to match how you are feeling.");
    } else {
      parts.push("Today's plan is adjusted to give you more breathing room.");
    }
  } else {
    if (drivers.includes("sleep_low") || drivers.includes("sleep_moderate")) {
      parts.push("Sleep has been shorter recently. A small adjustment today helps you stay on track.");
    } else if (drivers.includes("consecutive_difficulty")) {
      parts.push("A slight adjustment today keeps things sustainable.");
    } else {
      parts.push("A small tweak today to match how things are going.");
    }
  }

  return parts[0];
}

function adaptiveWeekSummary(severity: InternalSeverity, drivers: string[], originalSummary: string): string {
  if (severity === "green") return originalSummary;

  if (severity === "red") {
    if (drivers.includes("titration_peak_window")) {
      return "Your dose just changed. The first few days are often the hardest. This week focuses entirely on comfort, hydration, and rest. You will ease back into your routine once your body settles.";
    }
    if (drivers.includes("recent_titration")) {
      return "Your dose recently changed, and your body is adapting. This week focuses on rest, hydration, and easy nutrition. Strength sessions are paused so you can settle in. You will build back up once things stabilize.";
    }
    if (drivers.includes("multi_day_difficulty")) {
      return "The last few days have been harder. This week is lighter to let your body recover. Hydration, gentle movement, and protein-first meals are the priorities. You are not falling behind. This is part of the process.";
    }
    return "This week is adjusted for extra support. Rest, hydration, and comfortable meals come first. Activity is scaled way back. You will ramp up when your body is ready.";
  }

  if (severity === "orange") {
    if (drivers.includes("nausea") || drivers.includes("digestion_issues")) {
      return "Side effects are more noticeable this week. The plan dials down intensity and focuses on comfortable movement, hydration, and easy-to-digest meals. Protein remains important but portion sizes are flexible.";
    }
    if (drivers.includes("mental_burnout") || drivers.includes("mental_low")) {
      return "This week keeps things lighter to give you some breathing room. Walks replace heavier sessions, and the focus is on consistency over intensity. Small wins add up.";
    }
    return "This week is slightly adjusted based on how things have been going. Movement is gentler, nutrition stays protein-focused, and there is more room for rest. You are still making progress.";
  }

  if (drivers.includes("sleep_low") || drivers.includes("sleep_moderate")) {
    return originalSummary + " Sleep has been shorter recently, so recovery gets a bit more attention this week.";
  }
  if (drivers.includes("consecutive_difficulty")) {
    return originalSummary + " A couple of days were tougher, so the plan has a small buffer built in.";
  }
  return originalSummary;
}

export function applyAdaptiveOverrides(
  plan: WeeklyPlan,
  severityResult: SeverityResult,
): WeeklyPlan {
  const { severity, drivers, streakDays } = severityResult;

  if (severity === "green") {
    return {
      ...plan,
      isAdapted: false,
      adaptiveSummary: undefined,
    };
  }

  const protectedDays = antiSnowballDuration(severity, streakDays);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayIndex = plan.days.findIndex(d => d.date === todayStr);

  const adaptedDays: WeeklyPlanDay[] = plan.days.map((day, i) => {
    if (day.date < todayStr) return day;

    const dayOffset = todayIndex >= 0 ? i - todayIndex : i;
    if (dayOffset < 0) return day;

    let daySeverity: InternalSeverity;
    if (dayOffset === 0) {
      daySeverity = severity;
    } else if (dayOffset < protectedDays) {
      daySeverity = severity === "red" ? "orange" : "yellow";
    } else if (dayOffset < protectedDays + 1) {
      daySeverity = severity === "red" ? "yellow" : "green";
    } else {
      daySeverity = "green";
    }

    if (daySeverity === "green") return day;

    if (day.actions.some(a => a.completed)) {
      return day;
    }

    const adaptedActions: WeeklyDayAction[] = day.actions.map(action => {
      const adaptedRec = pickAdaptiveAction(action.category, daySeverity);
      const userChose = action.chosen !== action.recommended;
      return {
        ...action,
        recommended: adaptedRec,
        chosen: userChose ? action.chosen : adaptedRec,
      };
    });

    return {
      ...day,
      focusArea: adaptiveFocusArea(daySeverity, day.focusArea, day.dayOfWeek),
      actions: adaptedActions,
      adaptiveNote: adaptiveDayNote(daySeverity, drivers),
      isAdapted: true,
    };
  });

  return {
    ...plan,
    days: adaptedDays,
    weekSummary: adaptiveWeekSummary(severity, drivers, plan.weekSummary),
    adaptiveSummary: adaptiveWeekSummary(severity, drivers, plan.weekSummary),
    isAdapted: true,
  };
}

export function buildSeverityForCoach(severityResult: SeverityResult): {
  currentState: string;
  recentPattern: string;
  planAdjustment: string;
} {
  const { severity, drivers, streakDays } = severityResult;

  const stateMap: Record<InternalSeverity, string> = {
    green: "stable",
    yellow: "slightly strained",
    orange: "noticeably strained",
    red: "significantly strained",
  };

  const driverDescriptions: string[] = [];
  if (drivers.includes("nausea")) driverDescriptions.push("nausea");
  if (drivers.includes("digestion_issues")) driverDescriptions.push("digestive discomfort");
  if (drivers.includes("low_energy")) driverDescriptions.push("low energy");
  if (drivers.includes("low_appetite")) driverDescriptions.push("suppressed appetite");
  if (drivers.includes("mental_burnout")) driverDescriptions.push("feeling burnt out");
  if (drivers.includes("mental_low")) driverDescriptions.push("feeling low");
  if (drivers.includes("sleep_low") || drivers.includes("sleep_moderate")) driverDescriptions.push("reduced sleep");
  if (drivers.includes("recent_titration")) driverDescriptions.push("recent dose change");
  if (drivers.includes("recovery_low")) driverDescriptions.push("low recovery scores");

  const patternStr = streakDays >= 2
    ? `Difficult days for ${streakDays} days in a row.`
    : driverDescriptions.length > 0
    ? `Recent factors: ${driverDescriptions.join(", ")}.`
    : "No concerning patterns.";

  const adjustMap: Record<InternalSeverity, string> = {
    green: "No plan adjustments needed.",
    yellow: "Minor plan adjustments applied for comfort.",
    orange: "Plan scaled back to prioritize recovery and comfort.",
    red: "Plan significantly reduced. Focus on rest, hydration, and easy nutrition.",
  };

  return {
    currentState: stateMap[severity],
    recentPattern: patternStr,
    planAdjustment: adjustMap[severity],
  };
}

export function buildSeverityForTrends(severityResult: SeverityResult): {
  adaptiveWeekNote: string | null;
} {
  const { severity, drivers } = severityResult;
  if (severity === "green") return { adaptiveWeekNote: null };

  if (severity === "red") {
    return { adaptiveWeekNote: "This week's plan was adjusted significantly to support recovery. Progress may look different, and that is okay." };
  }
  if (severity === "orange") {
    return { adaptiveWeekNote: "This week included some lighter days based on how things were going. The plan adapted to keep things sustainable." };
  }
  return { adaptiveWeekNote: "A few small adjustments were made this week based on recent inputs." };
}
