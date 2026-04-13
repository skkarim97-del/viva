import type { RiskLevel, RiskDriver } from "@/types";

interface TranslationResult {
  userMessage: string;
  supportHeadline: string;
}

const HEADLINES: Record<RiskLevel, string[]> = {
  low: [
    "You're in a good place today",
    "Things are looking steady",
    "You're on track",
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
    return "Your recent patterns look steady. Keep doing what you're doing and stay consistent with the basics.";
  }

  const parts: string[] = [];

  if (categories.includes("recovery") && categories.includes("fueling")) {
    parts.push("Your body may be a bit under-fueled right now. Let's keep today simple and focus on hydration and protein.");
  } else if (categories.includes("activity") && categories.includes("symptoms")) {
    parts.push("You've had a quieter stretch recently and symptoms may be making it harder to keep momentum. A light day with simple habits may help.");
  } else if (categories.includes("recovery")) {
    parts.push("Recovery looks a bit lower than usual. This may be a good time to lighten the load and prioritize rest.");
  } else if (categories.includes("fueling")) {
    parts.push("Appetite and fueling have been a bit low lately. Even small, protein-rich meals can make a big difference in how you feel.");
  } else if (categories.includes("symptoms")) {
    parts.push("Side effects have been a bit heavier recently. Keeping things simple today and focusing on hydration can help your body adjust.");
  } else if (categories.includes("activity")) {
    parts.push("Movement has dipped a bit recently. Even a short walk today can help you keep momentum without overdoing it.");
  } else if (categories.includes("consistency")) {
    parts.push("Getting back into a daily rhythm with check-ins and small actions can help you feel more on track.");
  }

  if (parts.length === 0) {
    if (riskLevel === "elevated" || riskLevel === "high") {
      parts.push("A few things need attention today. Focusing on hydration, protein, and rest will help you feel better and stay consistent.");
    } else {
      parts.push("A couple of small adjustments today can help you keep building momentum on your journey.");
    }
  }

  if (riskLevel === "high" && drivers.length >= 3) {
    parts.push("This is a good moment to reset and focus on the basics. You don't need to do everything perfectly today.");
  }

  return parts.join(" ");
}

export function translateRiskToUserMessage(riskLevel: RiskLevel, drivers: RiskDriver[]): TranslationResult {
  return {
    supportHeadline: pickRandom(HEADLINES[riskLevel]),
    userMessage: buildMessage(riskLevel, drivers),
  };
}
