// Lightweight client-side companion to the server's lib/symptoms.
//
// The server is the source of truth for the doctor-facing symptom flag
// (escalation, persistence across days, contributors). This file
// produces the same-day in-app GUIDANCE the patient sees on the Today
// tab the moment they fill in their inputs -- before any check-in is
// even submitted.
//
// We intentionally keep this stateless and based ONLY on today's
// inputs. Multi-day persistence is something the server already
// handles; bringing it client-side would mean shipping the same logic
// in two places without a reason.
//
// Tone rules (see spec): short, supportive, practical, non-alarmist,
// not overly medical. Each tip is one sentence + one or two concrete
// suggestions.

import type {
  AppetiteLevel,
  DigestionStatus,
  HydrationLevel,
  NauseaLevel,
} from "@/types";

export type SymptomKind = "nausea" | "constipation" | "low_appetite";

export interface SymptomTip {
  symptom: SymptomKind;
  title: string;
  body: string;
  // The handful of contributing factors driving this tip. Rendered as
  // small chips under the body so the patient understands the "why".
  factors: string[];
}

export interface SymptomInputs {
  nausea: NauseaLevel;
  appetite: AppetiteLevel;
  digestion: DigestionStatus;
  hydration: HydrationLevel;
  bowelMovementToday: boolean | null;
}

function lowHydration(h: HydrationLevel): boolean {
  return h === "low" || h === "dehydrated";
}

export function deriveSymptomTips(input: SymptomInputs): SymptomTip[] {
  const tips: SymptomTip[] = [];

  // ----- Nausea -----------------------------------------------------
  // Any non-"none" nausea today triggers the tip. Tone scales with
  // severity but we deliberately do NOT alarm the patient -- the
  // doctor-side escalation is what handles severe persistent cases.
  if (input.nausea && input.nausea !== "none") {
    const factors: string[] = [];
    if (lowHydration(input.hydration)) factors.push("Low hydration");
    if (input.appetite === "very_low") factors.push("Long fasting window");
    tips.push({
      symptom: "nausea",
      title:
        input.nausea === "severe"
          ? "Nausea is hitting hard today"
          : "Easing today's nausea",
      body:
        "Try sipping water steadily, eating small bland snacks (toast, rice, crackers), and slowing down meals. Avoid lying flat right after eating.",
      factors,
    });
  }

  // ----- Constipation -----------------------------------------------
  // Subjective signal (digestion === "constipated") OR an explicit
  // "no bowel movement today" check is enough for the same-day tip.
  // The server still owns the "3+ day streak" escalation.
  if (
    input.digestion === "constipated" ||
    input.bowelMovementToday === false
  ) {
    const factors: string[] = [];
    if (lowHydration(input.hydration)) factors.push("Low hydration");
    tips.push({
      symptom: "constipation",
      title: "Help things move along",
      body:
        "Aim for steady water through the day, a 10-15 minute walk after meals, and gradually add fiber (fruit, oats, vegetables). Increase fiber slowly to avoid bloating.",
      factors,
    });
  }

  // ----- Low appetite -----------------------------------------------
  if (input.appetite === "low" || input.appetite === "very_low") {
    const factors: string[] = [];
    if (input.nausea && input.nausea !== "none") {
      factors.push("Co-occurring nausea");
    }
    if (lowHydration(input.hydration)) factors.push("Low hydration");
    tips.push({
      symptom: "low_appetite",
      title: "When appetite is low",
      body:
        "Prioritize protein in small, nutrient-dense meals (eggs, yogurt, cottage cheese, fish). It's normal on GLP-1 -- aim for consistency, not volume.",
      factors,
    });
  }

  return tips;
}
