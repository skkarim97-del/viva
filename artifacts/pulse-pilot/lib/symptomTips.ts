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
  // Short, natural recap (gerund phrase, no period) used as the
  // followup card subtext the next day. Ex: "Sipping water over
  // 10-15 min". Deliberately briefer than `cta` so the followup
  // reads like a quick check-in rather than re-presenting the
  // full instruction.
  followupSummary: string;
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
  if (input.nausea && input.nausea !== "none") {
    const factors: string[] = [];
    if (lowHydration(input.hydration)) factors.push("Low hydration");
    if (input.appetite === "very_low") factors.push("Low appetite");
    const severe = input.nausea === "severe";
    const moderate = input.nausea === "moderate";
    tips.push({
      symptom: "nausea",
      severity: severe ? 3 : moderate ? 2 : 1,
      title: severe ? "Pause food and sip slowly" : "Sip first, then 2–3 bites",
      urgency: severe
        ? "Do this for the next 15 minutes to give your stomach time to settle."
        : "Try this in the next 10 minutes to stop nausea from building.",
      cta: severe
        ? "Stop solid food for now. Take slow sips of water, Pedialyte, or ginger tea, a few sips every 2 minutes, for 15 minutes."
        : "Take 5 slow sips of water or ginger tea right now. Wait 10 minutes, then try 2–3 small bites.",
      example: severe
        ? "(after fluids settle: crackers, toast, banana, or rice)"
        : "(example: crackers, toast, Greek yogurt, or a banana)",
      ctaLabel: "Done",
      ctaCompleted: "Logged. Nice work.",
      followupSummary: severe
        ? "Fluids first, sips every 2 min for 15 min"
        : "5 sips of water, then 2–3 bites",
      factors,
    });
  }

  // ----- Constipation -----------------------------------------------
  if (
    input.digestion === "constipated" ||
    input.bowelMovementToday === false
  ) {
    const factors: string[] = [];
    if (lowHydration(input.hydration)) factors.push("Low hydration");
    const plan = input.planActivity ?? "normal_activity";
    const cta =
      plan === "full_rest"
        ? "Drink 6–8 oz of warm water or ginger tea right now. Then do 2 minutes of slow abdominal breathing: in for 4 counts, out for 6."
        : plan === "light_activity"
        ? "Drink 6–8 oz of warm water or ginger tea right now. Then take a slow 5-minute walk around the room or outside."
        : "Drink 6–8 oz of warm water or ginger tea right now. Then take a slow 5-minute walk around the room or outside.";
    const example =
      plan === "full_rest"
        ? "(warm water, ginger tea, or peppermint tea)"
        : "(warm water, ginger tea, or peppermint tea; then a loop around the block or a hallway)";
    const urgency =
      plan === "full_rest"
        ? "Do this now. Warm fluids and breathing can help even without movement."
        : "Do this within the next 15 minutes to help things move.";
    tips.push({
      symptom: "constipation",
      severity: input.digestion === "constipated" ? 2 : 1,
      title: "Warm drink + movement",
      urgency,
      cta,
      example,
      ctaLabel: "Done",
      ctaCompleted: "Logged. Nice work.",
      followupSummary:
        plan === "full_rest"
          ? "Warm fluids + 2 min abdominal breathing"
          : "Warm fluids + 5-min walk",
      factors,
    });
  }

  // ----- Low appetite -----------------------------------------------
  if (input.appetite === "low" || input.appetite === "very_low") {
    const factors: string[] = [];
    if (input.nausea && input.nausea !== "none") factors.push("Co-occurring nausea");
    if (lowHydration(input.hydration)) factors.push("Low hydration");
    const veryLow = input.appetite === "very_low";
    tips.push({
      symptom: "low_appetite",
      severity: veryLow ? 2 : 1,
      title: veryLow ? "Sip a smoothie for 10 minutes" : "Try 2–3 bites of protein now",
      urgency: "Do this in the next 10–15 minutes to keep nutrition coming in.",
      cta: veryLow
        ? "Make or order a simple smoothie with protein. Sip it slowly for 10–15 minutes. No pressure to finish it."
        : "Eat 2–3 bites of a protein-rich food right now. Stop and wait 10 minutes before eating more.",
      example: veryLow
        ? "(example: Greek yogurt + banana blend, or a protein shake)"
        : "(example: Greek yogurt, tofu, 1 hard-boiled egg, or cottage cheese)",
      ctaLabel: "Done",
      ctaCompleted: "Logged. Nice work.",
      followupSummary: veryLow ? "Smoothie sipped over 10–15 min" : "2–3 bites of protein, then a pause",
      factors,
    });
  }

  return tips;
}
