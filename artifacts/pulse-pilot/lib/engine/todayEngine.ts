import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  GLP1DailyInputs,
  EnergyDaily,
  AppetiteLevel,
  NauseaLevel,
  DigestionStatus,
  DailyStatusLabel,
  AdaptiveInsight,
} from "@/types";

export interface InputSummaryOutput {
  text: string;
  severity: "none" | "low" | "moderate" | "high";
}

export interface TodayStatusOutput {
  statusLabel: DailyStatusLabel;
  statusColor: "success" | "accent" | "warning" | "destructive";
  statusDrivers: string[];
  headline: string;
  summary: string;
}

export interface TodayViewOutput {
  greeting: string;
  inputSummary: InputSummaryOutput;
  status: TodayStatusOutput;
  insights: AdaptiveInsight[];
}

const STATUS_COLOR_MAP: Record<DailyStatusLabel, TodayStatusOutput["statusColor"]> = {
  "You're in a good place today": "success",
  "A few small adjustments will help today": "accent",
  "Let's make today a bit easier": "warning",
  "Your body may need more support today": "destructive",
};

export function generateGreeting(profile: UserProfile): string {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = profile?.name?.trim();
  return firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;
}

export function generateInputSummary(inputs: {
  energy: EnergyDaily;
  appetite: AppetiteLevel;
  nausea: NauseaLevel;
  digestion: DigestionStatus;
}): InputSummaryOutput {
  const filled = [inputs.energy, inputs.appetite, inputs.nausea, inputs.digestion].filter(Boolean).length;

  if (filled === 0) {
    return {
      text: "Log how you are feeling today. Your plan adjusts based on what you share.",
      severity: "none",
    };
  }

  const parts: string[] = [];
  if (inputs.energy === "depleted" || inputs.energy === "tired") parts.push("energy is low");
  else if (inputs.energy === "great") parts.push("energy is strong");

  if (inputs.appetite === "very_low") parts.push("appetite is very low");
  else if (inputs.appetite === "low") parts.push("appetite is reduced");

  if (inputs.nausea === "severe") parts.push("nausea is severe");
  else if (inputs.nausea === "moderate") parts.push("nausea is noticeable");

  if (inputs.digestion === "diarrhea") parts.push("digestion is unsettled");
  else if (inputs.digestion === "constipated") parts.push("constipation is present");
  else if (inputs.digestion === "bloated") parts.push("some bloating today");

  if (parts.length === 0) {
    if (filled >= 3) return { text: "Your inputs look solid today. Your plan is set for a good day.", severity: "none" };
    return { text: "", severity: "none" };
  }

  const severity: InputSummaryOutput["severity"] = parts.length >= 3 ? "high" : parts.length >= 2 ? "moderate" : "low";
  const concern = parts.length >= 3 ? "Your body may need more support today" :
    parts.length >= 2 ? "A couple of areas to watch today" : "One thing to keep in mind today";
  const text = `${concern}. ${parts.join(", ").replace(/^./, (c: string) => c.toUpperCase())}.`;

  return { text, severity };
}

export function generateTodayStatus(plan: DailyPlan): TodayStatusOutput {
  return {
    statusLabel: plan.statusLabel,
    statusColor: STATUS_COLOR_MAP[plan.statusLabel] ?? "accent",
    statusDrivers: plan.statusDrivers,
    headline: plan.headline,
    summary: plan.summary,
  };
}

export function generateTodayView(
  profile: UserProfile,
  plan: DailyPlan,
  glp1Inputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    nausea: NauseaLevel;
    digestion: DigestionStatus;
  },
  adaptiveInsights: AdaptiveInsight[],
): TodayViewOutput {
  return {
    greeting: generateGreeting(profile),
    inputSummary: generateInputSummary(glp1Inputs),
    status: generateTodayStatus(plan),
    insights: adaptiveInsights.slice(0, 3),
  };
}
