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
// Tone rules: short, supportive, practical, non-alarmist, not overly
// medical. Each tip is one urgency line + ONE concrete CTA the patient
// can tap to mark "done". Multiple suggestions in one card historically
// lowered follow-through -- a single verb-led CTA is the lever.

import type {
  AppetiteLevel,
  DigestionStatus,
  HydrationLevel,
  NauseaLevel,
} from "@/types";

export type SymptomKind = "nausea" | "constipation" | "low_appetite";

export interface SymptomTip {
  symptom: SymptomKind;
  // State-based title: reflects the current condition + an "(active)"
  // marker so the patient understands this is responding to what they
  // logged today, not a generic education card.
  title: string;
  // One-line, time-sensitive nudge ("Do this now ...", "Best to do
  // this within the next hour"). Replaces the previous multi-suggestion
  // body to drive a single decision.
  urgency: string;
  // Verb-led CTA that maps to a concrete physical action the patient
  // can complete in <10 minutes. Tapping it marks the symptom action
  // as done for the day.
  cta: string;
  // Microcopy shown after the CTA is tapped, before the card is
  // dismissed. Warm, not gamified.
  ctaCompleted: string;
  // The handful of contributing factors driving this tip. Rendered as
  // small chips so the patient understands the "why".
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
    const severe = input.nausea === "severe";
    tips.push({
      symptom: "nausea",
      title: severe
        ? "Easing severe nausea (active)"
        : "Easing nausea (active)",
      urgency: severe
        ? "Do this in the next 15 min to help settle the wave."
        : "Do this now -- small, steady sips ease the wave fastest.",
      cta: severe ? "Sip water + nibble a cracker" : "Sip water now",
      ctaCompleted: severe ? "Nice -- sips + cracker logged" : "Nice -- sips logged",
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
      title: "Get things moving (active)",
      urgency: "Best to do this within the next hour.",
      cta: "Take a 10-min walk",
      ctaCompleted: "Nice -- walk logged",
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
      title: "Low appetite support (active)",
      urgency: "Best to do this within the next hour to keep energy steady.",
      cta: "Eat 2 tbsp of protein",
      ctaCompleted: "Nice -- protein logged",
      factors,
    });
  }

  return tips;
}
