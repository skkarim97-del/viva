import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  GLP1DailyInputs,
  EnergyDaily,
  AppetiteLevel,
  HydrationDaily,
  ProteinConfidenceDaily,
  SideEffectSeverity,
  MovementIntent,
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
  hydration: HydrationDaily;
  proteinConfidence: ProteinConfidenceDaily;
  sideEffects: SideEffectSeverity;
  movementIntent: MovementIntent;
}): InputSummaryOutput {
  const filled = [inputs.energy, inputs.appetite, inputs.hydration, inputs.proteinConfidence, inputs.sideEffects, inputs.movementIntent].filter(Boolean).length;

  if (filled === 0) {
    return {
      text: "Tap each row to log how you are doing. Your plan and coach will adjust.",
      severity: "none",
    };
  }

  const parts: string[] = [];
  if (inputs.energy === "depleted" || inputs.energy === "tired") parts.push("energy is low");
  else if (inputs.energy === "great") parts.push("energy is strong");

  if (inputs.appetite === "very_low") parts.push("appetite is very low");
  else if (inputs.appetite === "low") parts.push("appetite is reduced");

  if (inputs.sideEffects === "rough") parts.push("side effects are rough");
  else if (inputs.sideEffects === "moderate") parts.push("some side effects");

  if (inputs.hydration === "poor") parts.push("hydration needs attention");
  if (inputs.proteinConfidence === "low") parts.push("protein intake is low");

  if (parts.length === 0) {
    if (filled >= 4) return { text: "Things are looking good today. Your plan reflects that.", severity: "none" };
    return { text: "", severity: "none" };
  }

  const severity: InputSummaryOutput["severity"] = parts.length >= 3 ? "high" : parts.length >= 2 ? "moderate" : "low";
  const concern = parts.length >= 3 ? "Your body may need more support today" :
    parts.length >= 2 ? "A few things to watch today" : "Something to keep in mind today";
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
    hydration: HydrationDaily;
    proteinConfidence: ProteinConfidenceDaily;
    sideEffects: SideEffectSeverity;
    movementIntent: MovementIntent;
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
