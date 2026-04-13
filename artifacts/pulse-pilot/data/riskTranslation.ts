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
    return "Your recent patterns look steady. Keep doing what you are doing. Consistency with the basics is what supports your treatment best.";
  }

  const parts: string[] = [];

  if (categories.includes("recovery") && categories.includes("fueling")) {
    parts.push("Your body may be running a bit low on fuel and recovery right now. On treatment, both matter more than usual. Let's keep today simple. focus on hydration, small protein-rich meals, and rest.");
  } else if (categories.includes("activity") && categories.includes("symptoms")) {
    parts.push("Movement has been quieter recently and side effects may be making it harder. That is completely normal. A light day with simple habits can help you keep moving forward.");
  } else if (categories.includes("recovery")) {
    parts.push("Recovery has been a bit lower than usual. Your body may need more rest to adjust. This is a good time to lighten the load and prioritize sleep.");
  } else if (categories.includes("fueling")) {
    parts.push("Appetite and fueling have been a bit low lately. Even when you do not feel hungry, small protein-rich meals make a big difference in how you feel and how well your body responds to treatment.");
  } else if (categories.includes("symptoms")) {
    parts.push("Side effects have been a bit heavier recently. This is part of how your body adjusts to treatment. Keeping things simple today and focusing on hydration can help.");
  } else if (categories.includes("activity")) {
    parts.push("Movement has dipped a bit recently. Even a short walk today can help you keep momentum. Gentle activity also helps with digestion and energy on treatment.");
  } else if (categories.includes("consistency")) {
    parts.push("Getting back into a daily rhythm with check-ins and small actions can help you feel more on track. Every day you show up counts.");
  }

  if (parts.length === 0) {
    if (riskLevel === "elevated" || riskLevel === "high") {
      parts.push("A few things need attention today. Focusing on hydration, protein, and rest will help you feel better and stay consistent with your treatment.");
    } else {
      parts.push("A couple of small adjustments today can help you build momentum on your treatment journey.");
    }
  }

  if (riskLevel === "high" && drivers.length >= 3) {
    parts.push("Days like this happen, especially on treatment. Focus on the basics and be kind to yourself. You do not need to do everything perfectly today.");
  }

  return parts.join(" ");
}

export function translateRiskToUserMessage(riskLevel: RiskLevel, drivers: RiskDriver[]): TranslationResult {
  return {
    supportHeadline: pickRandom(HEADLINES[riskLevel]),
    userMessage: buildMessage(riskLevel, drivers),
  };
}
