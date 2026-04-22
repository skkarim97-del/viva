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
  DailyState,
  DigestionStatus,
  HydrationLevel,
  NauseaLevel,
} from "@/types";

export type SymptomKind = "nausea" | "constipation" | "low_appetite";

// Plan guardrail for symptom CTAs. Symptom recommendations must never
// contradict the day's overall operating mode -- e.g. a "Walk 10
// minutes now" CTA on a full rest day breaks trust immediately. We
// collapse the planning engine's four-state DailyState into the three
// activity bands the symptom layer actually needs.
export type PlanActivityContext = "full_rest" | "light_activity" | "normal_activity";

export function planActivityFromState(state: DailyState): PlanActivityContext {
  // recover  -> rest is the explicit prescription for the day
  // maintain -> basics only; light, optional movement
  // build / push -> normal activity is on the table
  if (state === "recover") return "full_rest";
  if (state === "maintain") return "light_activity";
  return "normal_activity";
}

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
  // Single clear sentence the patient can act on, written in the
  // present tense and grounded in standard units (cup / glass /
  // minutes) so there's no ambiguity. Pairs with `example` to make
  // the action easy to picture without lengthening the sentence.
  cta: string;
  // One short, parenthetical example line giving 2-4 familiar items
  // or behaviors so the action is easier to visualize. Rendered
  // beneath the action sentence in the same card -- no extra
  // interaction. Optional only for back-compat; new copy should
  // always supply one.
  example?: string;
  // Microcopy shown after the CTA ("Done") is tapped, before the
  // card is dismissed. Warm, not gamified.
  ctaCompleted: string;
  // Generic confirmation label for the action button. Always reads
  // "Done" per the refreshed micro-intervention spec -- the action
  // sentence above carries the specifics.
  ctaLabel?: string;
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
  // Today's plan activity context. Symptom CTAs that involve movement
  // (currently constipation) downshift their action to stay coherent
  // with the daily plan -- on a "full rest" day a 10-minute walk
  // would directly contradict the plan headline. Optional for back
  // compat; defaults to "normal_activity" when omitted.
  planActivity?: PlanActivityContext;
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
      title: severe ? "Settle your stomach" : "Ease your nausea",
      urgency: severe
        ? "Do this in the next 15 minutes to settle your stomach."
        : "Try this in the next few minutes to feel better faster.",
      cta: severe
        ? "Sip about ½ cup of water and have one bland snack over the next 10-15 minutes."
        : "Sip about ½ cup of water slowly over the next 10-15 minutes.",
      example: severe
        ? "(example: plain crackers, dry toast, banana, or rice)"
        : "(example: still water, room-temperature water, or weak ginger tea)",
      ctaLabel: "Done",
      ctaCompleted: severe ? "Logged. Nice work." : "Logged. Nice work.",
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
    // Plan-aware CTA. Constipation guidance is movement-based, so it
    // has to respect the day's plan or it'll directly contradict the
    // headline ("full rest day" + "walk 10 minutes now"). We keep
    // urgency intact and only step the action down to the lightest
    // coherent variant for each plan band.
    const plan = input.planActivity ?? "normal_activity";
    const cta =
      plan === "full_rest"
        ? "Stand up and stretch gently for about 2 minutes."
        : plan === "light_activity"
        ? "Take a gentle 5 minute walk in the next hour."
        : "Take a 10 minute walk in the next hour.";
    const example =
      plan === "full_rest"
        ? "(example: shoulder rolls, gentle side bends, or a slow walk around the room)"
        : "(example: a loop around the block, a hallway at work, or pacing during a phone call)";
    const urgency =
      plan === "full_rest"
        ? "Gentle movement is enough today -- it can still help things move."
        : plan === "light_activity"
        ? "Do this within the next hour at an easy, comfortable pace."
        : "Do this within the next hour to help things move.";
    tips.push({
      symptom: "constipation",
      // Subjective "feels constipated" is treated as moderate;
      // a missed bowel movement alone (with no subjective signal)
      // is a milder, earlier signal.
      severity:
        input.digestion === "constipated"
          ? 2
          : 1,
      title: "Get things moving",
      urgency,
      cta,
      example,
      ctaLabel: "Done",
      ctaCompleted: "Logged. Nice work.",
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
      title: "Steady your appetite",
      urgency: "Do this in the next 15 minutes to support your energy.",
      cta: "Eat about ½ cup of a protein-rich food in the next 15 minutes.",
      example: "(example: ½ cup yogurt, 1 hard-boiled egg, a small handful of nuts, or a protein shake)",
      ctaLabel: "Done",
      ctaCompleted: "Logged. Nice work.",
      factors,
    });
  }

  return tips;
}
