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
// Tone rules: calm, clinical, reassuring -- but the urgency line and
// CTA are deliberately written to push the patient to act in the next
// minute. Each tip carries exactly ONE concrete physical action so a
// single decision stays in front of the patient (multiple suggestions
// in one card historically lowered follow-through).

import type {
  AppetiteLevel,
  DigestionStatus,
  HydrationLevel,
  NauseaLevel,
} from "@/types";

export type SymptomKind = "nausea" | "constipation" | "low_appetite";

export interface SymptomTip {
  symptom: SymptomKind;
  // Numeric severity score driving the urgency cue and the
  // re-trigger logic in the parent ("did this worsen since the
  // patient last acked?"). 1 = mild, 2 = moderate, 3 = severe.
  severity: 1 | 2 | 3;
  // State-based title: reflects the current condition + an "(active)"
  // marker so the patient understands this is responding to what they
  // logged today, not generic education content.
  title: string;
  // Time-sensitive, outcome-oriented nudge
  // ("Do this now to ease nausea faster"). Replaced the previous
  // multi-suggestion body so a single decision stays in front of the
  // patient.
  urgency: string;
  // Highly specific, immediate verb-led CTA the patient can finish in
  // <2 minutes ("Drink 5 sips now"). Tapping marks the symptom action
  // as done for the day and mirrors the choice to the server.
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
      severity: severe ? 3 : input.nausea === "moderate" ? 2 : 1,
      title: severe
        ? "Settle severe nausea (active)"
        : "Ease nausea now (active)",
      urgency: severe
        ? "Do this in the next 15 minutes to settle your stomach."
        : "Do this now to ease nausea faster.",
      cta: severe ? "Sip water + cracker now" : "Drink 5 sips now",
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
      // Subjective "feels constipated" is treated as moderate;
      // a missed bowel movement alone (with no subjective signal)
      // is a milder, earlier signal.
      severity:
        input.digestion === "constipated"
          ? 2
          : 1,
      title: "Get things moving (active)",
      urgency: "Do this within the next hour to help things move.",
      cta: "Walk 10 minutes now",
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
      severity: input.appetite === "very_low" ? 2 : 1,
      title: "Steady your appetite (active)",
      urgency: "Do this now to support your energy today.",
      cta: "Eat 2 tbsp yogurt or nuts now",
      ctaCompleted: "Nice -- snack logged",
      factors,
    });
  }

  return tips;
}
