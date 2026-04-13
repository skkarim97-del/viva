import type { RiskLevel, RiskDriver } from "@/types";

interface TranslationResult {
  userMessage: string;
  supportHeadline: string;
}

const HEADLINES: Record<RiskLevel, string[]> = {
  low: [
    "You're in a good place today",
    "Things are looking steady",
    "Your body is responding well",
  ],
  mild: [
    "A few small adjustments will help today",
    "A couple of things to keep an eye on",
    "Small tweaks can make today better",
  ],
  elevated: [
    "Let's make today a bit easier",
    "Your body could use a lighter day",
    "Today is a good day to simplify",
  ],
  high: [
    "Your body may need more support today",
    "Let's focus on the basics today",
    "A gentle day will help you stay on track",
  ],
};

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildMessage(riskLevel: RiskLevel, drivers: RiskDriver[]): string {
  const categories = drivers.map(d => d.category);

  if (riskLevel === "low" || drivers.length === 0) {
    return "Your recent patterns look steady. Sleep, hydration, and movement are in a good range. Keep this rhythm going.";
  }

  const parts: string[] = [];

  if (categories.includes("recovery") && categories.includes("fueling")) {
    parts.push("Recovery and fueling are both running lower than your recent averages. On treatment, under-eating and poor sleep compound each other. Focus on hydration, small protein-rich meals, and an earlier bedtime tonight.");
  } else if (categories.includes("activity") && categories.includes("symptoms")) {
    parts.push("Side effects have been heavier and movement has dropped off. That is a normal response. A short walk and steady hydration today can help without adding strain.");
  } else if (categories.includes("recovery")) {
    parts.push("Recovery has been below your baseline for several days. Your body may need more rest to adjust. Lighten the load and prioritize sleep tonight.");
  } else if (categories.includes("fueling")) {
    parts.push("Protein and overall intake have been falling short. Even when appetite is suppressed, small protein-first meals help preserve muscle and stabilize energy.");
  } else if (categories.includes("symptoms")) {
    parts.push("Side effects have been heavier recently. This is part of how your body adjusts to treatment. Extra hydration and bland, easy-to-digest foods can help.");
  } else if (categories.includes("activity")) {
    parts.push("Daily movement has dropped below your recent average. Even a 10-minute walk after a meal supports digestion and energy on treatment.");
  } else if (categories.includes("consistency")) {
    parts.push("Logging and plan completion have been inconsistent. Getting back to a daily rhythm with even two or three actions helps rebuild momentum.");
  }

  if (parts.length === 0) {
    if (riskLevel === "elevated" || riskLevel === "high") {
      parts.push("A few areas need attention today. Prioritize hydration, protein, and rest. These three basics do the most to support your body during treatment.");
    } else {
      parts.push("A couple of small adjustments today can help you build on what is already working.");
    }
  }

  if (riskLevel === "high" && drivers.length >= 3) {
    parts.push("Days like this happen on treatment. Focus on the basics and do not try to catch up on everything at once. One good meal and an early bedtime go a long way.");
  }

  return parts.join(" ");
}

export function translateRiskToUserMessage(riskLevel: RiskLevel, drivers: RiskDriver[]): TranslationResult {
  return {
    supportHeadline: pickRandom(HEADLINES[riskLevel]),
    userMessage: buildMessage(riskLevel, drivers),
  };
}
