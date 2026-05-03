// UI selectors for DailyTreatmentState.
//
// Every Today-screen surface goes through one of these selectors so
// that recommendation copy lives in ONE place per surface. New rule
// changes ship through the selector without touching the consumer.
//
// Selectors are pure functions. Memoize at the call site if needed.

import type { DailyTreatmentState, PrimaryFocus } from "./dailyState";
import type { DailyState, FocusItem, WeeklyPlanDay } from "@/types";
import type { SymptomKind, SymptomTip } from "@/lib/symptomTips";

// ---------- Status chip --------------------------------------------------

export interface StatusChip {
  label: string;
  // Color tone for the chip pill. Maps to existing useColors() entries
  // in the consumer; selector returns the semantic name only.
  tone: "success" | "accent" | "warning" | "destructive" | "muted";
}

// Tone -> color in the consumer:
//   success     = green  (steady / good)
//   accent      = blue   (neutral / primary support)
//   warning     = amber  (heavier / attention / review)
//   destructive = red    (reserved for true clinical red-flags)
//   muted       = gray   (insufficient data)
// Recover is intentionally amber, not red. Worsening but normal
// GLP-1 symptoms (nausea, low appetite, tiredness) should read as
// "we're paying attention" -- not as a clinical alarm.
const TONE_FOR_STATE: Record<DailyState, StatusChip["tone"]> = {
  push: "success",
  build: "accent",
  maintain: "warning",
  recover: "warning",
};

export function selectStatusChip(state: DailyTreatmentState): StatusChip {
  // Insufficient-data path: the chip stops asserting a band and
  // becomes a calm "Log a check-in to personalize" prompt cue. No
  // band color -- muted tone signals "we're waiting on you", not
  // "you're failing".
  if (state.dataSufficiency.insufficientForPlan) {
    return { label: "Set up your day", tone: "muted" };
  }
  // Treatment-state-aware overrides for the new tiers above the
  // legacy 4-state. Otherwise fall through to plan.statusLabel +
  // plan.dailyState tone, preserving today's behavior.
  if (state.treatmentDailyState === "escalate") {
    // Amber, not red: "Symptom check needed" is a soft prompt to
    // loop in the care team for normal-but-heavier symptoms; true
    // clinical red-flag states are handled by separate flagging
    // logic and can use the destructive tone there.
    return { label: "Symptom check needed", tone: "warning" };
  }
  if (state.treatmentDailyState === "support") {
    // Continuity-support / hydration-support / fueling-support all
    // collapse to the same chip tone. The hero text differentiates.
    return { label: pickSupportChipLabel(state), tone: "warning" };
  }
  return {
    label: state.plan.statusLabel,
    tone: TONE_FOR_STATE[state.plan.dailyState] ?? "accent",
  };
}

function pickSupportChipLabel(state: DailyTreatmentState): string {
  switch (state.primaryFocus) {
    case "symptom_relief": return "Symptom support";
    case "hydration": return "Hydration focus";
    case "fueling": return "Fueling focus";
    case "continuity_support":
      return state.recentTitration ? "Adjustment week" :
             state.treatmentStage === "first_30d" ? "Early treatment" :
             "Steady support";
    default: return "Support day";
  }
}

// ---------- Hero (headline + drivers) ------------------------------------

export interface HeroBlock {
  headline: string;
  drivers: string[];
}

export function selectHero(state: DailyTreatmentState): HeroBlock {
  if (state.dataSufficiency.insufficientForPlan) {
    return {
      headline: "Tell us how today is going",
      drivers: ["A 30-second check-in personalizes your plan"],
    };
  }
  if (state.treatmentDailyState === "escalate") {
    return {
      headline: "Let's slow down and stabilize",
      drivers: ["Symptoms are stacking. Hydration and rest first."],
    };
  }
  // Continuity-support headlines are stage-aware so early-treatment
  // patients get reassurance, not generic wellness phrasing.
  if (state.treatmentDailyState === "support" && state.primaryFocus === "continuity_support") {
    if (state.treatmentStage === "first_30d") {
      return {
        headline: "Early weeks: steady wins",
        drivers: ["Many patients feel this in the first month. Small, consistent steps today."],
      };
    }
    if (state.recentTitration) {
      return {
        headline: "Your body is adjusting to the new dose",
        drivers: ["Hydration, gentle movement, and lighter meals today."],
      };
    }
    if (state.doseDayPosition === "day_1_post" || state.doseDayPosition === "day_2_post") {
      return {
        headline: "Post-dose support day",
        drivers: ["Symptoms are common 1-2 days after dose. Hydration first."],
      };
    }
  }
  if (state.treatmentDailyState === "support" && state.primaryFocus === "hydration") {
    return {
      headline: "Hydration is the priority",
      drivers: ["Sip steadily through the day. Add electrolytes if you can."],
    };
  }
  if (state.treatmentDailyState === "support" && state.primaryFocus === "fueling") {
    return {
      headline: "Small, steady fuel today",
      drivers: ["Aim for protein in 2-3 small portions."],
    };
  }
  // Fall through to planEngine's existing headline + drivers, which
  // remain the source of truth for movement / performance days.
  return {
    headline: state.plan.headline,
    drivers: state.plan.statusDrivers,
  };
}

// ---------- Focus items --------------------------------------------------

export function selectFocusItems(state: DailyTreatmentState): FocusItem[] {
  if (state.dataSufficiency.insufficientForPlan) return [];
  return state.plan.focusItems ?? [];
}

// ---------- Interventions (symptom tips) ---------------------------------

export function selectInterventions(state: DailyTreatmentState): SymptomTip[] {
  return state.interventions;
}

// ---------- Insight summary ("based on your inputs" line) ----------------

export interface InsightSummary {
  text: string;
  tone: "neutral" | "low" | "moderate" | "high";
}

// Composes the "based on your inputs" line from the lenses, NOT from
// a separate engine. This replaces the old `generateInputSummary` so
// the line cannot disagree with the day state.
export function selectInsightSummary(state: DailyTreatmentState): InsightSummary | null {
  if (state.dataSufficiency.insufficientForPlan) {
    return null; // The insufficient-data card handles this surface.
  }
  if (!state.dataSufficiency.checkinToday) {
    return {
      text: "Log how you are feeling today. Your plan adjusts based on what you share.",
      tone: "neutral",
    };
  }
  const parts: string[] = [];
  if (state.symptomBurden === "high") parts.push("symptoms are heavier today");
  else if (state.symptomBurden === "moderate") parts.push("some symptoms to watch");
  if (state.hydrationRisk === "high") parts.push("hydration is low");
  else if (state.hydrationRisk === "moderate") parts.push("hydration could be higher");
  if (state.fuelingRisk === "high") parts.push("fueling is the bigger concern");
  else if (state.fuelingRisk === "moderate") parts.push("appetite is reduced");
  if (parts.length === 0) {
    return { text: "Your inputs look steady today. Your plan is set for a good day.", tone: "low" };
  }
  const tone: InsightSummary["tone"] =
    parts.length >= 3 ? "high" : parts.length >= 2 ? "moderate" : "low";
  const concern =
    parts.length >= 3 ? "Your body may need more support today" :
    parts.length >= 2 ? "A couple of areas to watch today" :
    "One thing to keep in mind today";
  const text = `${concern}. ${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.`;
  return { text, tone };
}

// ---------- Insufficient-data notice --------------------------------------

export interface InsufficientDataNotice {
  title: string;
  body: string;
  primaryCta: string;
  secondaryCta?: string;
}

// Returns a notice when the engine doesn't have enough to produce a
// confident plan. Replaces the historical silent 70%-readiness
// fallback. Today screen renders this in place of the chip + hero.
export function selectInsufficientDataNotice(
  state: DailyTreatmentState,
): InsufficientDataNotice | null {
  if (!state.dataSufficiency.insufficientForPlan) return null;
  if (state.dataTier === "self_report") {
    return {
      title: "Your day is yours to set up",
      body: "Share a quick check-in and we'll personalize today's support around it. Most patients finish in under a minute.",
      primaryCta: "Start check-in",
    };
  }
  return {
    title: "Catching up on your data",
    body: "We don't have fresh signals from today yet. Open Health to sync, or share a quick check-in to personalize your day.",
    primaryCta: "Start check-in",
    secondaryCta: "Sync Health",
  };
}

// ---------- Claims policy projection (for coach + copy templates) --------

export function selectClaimsPolicy(state: DailyTreatmentState) {
  return state.claimsPolicy;
}

// ---------- Acknowledgement re-trigger helper for symptom tips -----------

export interface AckSnapshot { severity: 1 | 2 | 3; symptom: SymptomKind; }

export function selectActiveInterventionForAck(
  state: DailyTreatmentState,
  symptom: SymptomKind,
): AckSnapshot | null {
  const tip = state.interventions.find(t => t.symptom === symptom);
  if (!tip) return null;
  return { severity: tip.severity, symptom: tip.symptom };
}

// ---------- Weekly day view ----------------------------------------------
//
// The weekly plan is generated from a snapshot of recent inputs and
// then "adapted" once per refresh. That makes future days inherently
// less reliable than today, and even today's stamped focusArea /
// adaptiveNote can drift from the live DailyTreatmentState as the
// patient logs new inputs through the day. This selector resolves
// both contradictions at render time:
//
//   - past days  : keep the historical record (what was planned + what was done)
//   - today      : override focus copy from the live treatment state so
//                  the weekly tile cannot disagree with the Today tab hero
//   - future days: marked tentative, soften workout-specific phrasing,
//                  suppress per-day adaptiveNote (which was extrapolated
//                  from current severity and cannot honestly forecast a
//                  day we haven't observed yet)
//
// Callers should render the returned fields directly and ignore the
// raw `day.focusArea` / `day.adaptiveNote` for confidence != "past".

export type WeeklyDayConfidence = "past" | "today" | "tentative";

export interface WeeklyDayView {
  confidence: WeeklyDayConfidence;
  // Small uppercase label rendered above the focus text
  // ("DONE" / "TODAY'S FOCUS" / "PLANNED FOCUS").
  focusLabel: string;
  // The main focus text. For tentative days this is the original
  // focusArea softened; for today it is the live state's focus.
  focusText: string;
  // One-line caption explaining tentative state ("Updates as the
  // week unfolds"). Only set when confidence === "tentative".
  tentativeCaption?: string;
  // Whether to render the day's stamped adaptiveNote. False for
  // tentative (extrapolated, contradiction risk) and for today
  // (the hero already carries this signal on the Today tab).
  showAdaptiveNote: boolean;
}

const FOCUS_LABEL_FOR_PRIMARY: Record<PrimaryFocus, string> = {
  symptom_relief: "Symptom support",
  continuity_support: "Steady support",
  hydration: "Hydration focus",
  fueling: "Fueling first",
  recovery: "Recovery and rest",
  movement: "Steady movement",
  performance: "Stronger session",
};

// Words that imply firm prescription / intensity. Future-day copy
// should not assert these because the recommendation may change once
// today's signals come in. We replace them with calmer equivalents.
const SOFTEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bHeavy\b/gi, "Moderate"],
  [/\bHIIT\b/g, "Conditioning"],
  [/\bLong Run\b/gi, "Steady run"],
  [/\bStrength\b/g, "Strength (planned)"],
];

function softenFocusForFuture(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SOFTEN_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function selectWeeklyDayView(
  day: WeeklyPlanDay,
  todayIso: string,
  state: DailyTreatmentState | null,
): WeeklyDayView {
  if (day.date < todayIso) {
    return {
      confidence: "past",
      focusLabel: "Done",
      focusText: day.focusArea,
      showAdaptiveNote: !!day.adaptiveNote,
    };
  }
  if (day.date === todayIso) {
    // Live override: today's focus comes from the treatment state,
    // never from the pre-stamped weekly value. The action list on
    // the tile still mutates through toggleWeeklyAction (kept in
    // sync with dailyPlan in AppContext), so only the framing copy
    // changes here.
    let focusText: string;
    if (!state) {
      focusText = day.focusArea;
    } else if (state.dataSufficiency.insufficientForPlan) {
      // Mirror the Today tab "Set up your day" framing so the two
      // surfaces cannot disagree on the same calendar day.
      focusText = "Awaiting today's check-in";
    } else if (state.treatmentDailyState === "escalate") {
      // Escalation deserves a firmer label than the generic
      // symptom_relief mapping; keep it in lockstep with the Today
      // chip ("Symptom check needed") tone.
      focusText = "Symptom stabilization";
    } else {
      focusText = FOCUS_LABEL_FOR_PRIMARY[state.primaryFocus];
    }
    return {
      confidence: "today",
      focusLabel: "Today's focus",
      focusText,
      // The Today tab hero is the canonical place for today's note.
      // Repeating it here (with potentially staler copy) creates the
      // exact contradiction this slice is meant to remove.
      showAdaptiveNote: false,
    };
  }
  // Future days
  return {
    confidence: "tentative",
    focusLabel: "Planned focus",
    focusText: softenFocusForFuture(day.focusArea),
    tentativeCaption: "Tentative. Updates as the week unfolds.",
    showAdaptiveNote: false,
  };
}
