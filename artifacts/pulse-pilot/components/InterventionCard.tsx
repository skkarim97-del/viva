// Today-tab card that surfaces an AI-personalized micro-intervention.
//
// Treatment-intelligence inputs the card consumes (no medical advice
// is ever generated; these only shape provenance + tone):
//   - liveCheckin: today's symptom selections (drives severity and
//     adapts the title/body/supports).
//   - hasHealthData: whether Apple Health is connected. When true,
//     a small "Apple Health" provenance chip is rendered; when false,
//     a one-line "Connect Apple Health" invitation appears so we
//     never imply biometric signals we don't actually have.
//   - doseContext: { position, recentTitration } from
//     DailyTreatmentState. When the day sits in a post-dose window
//     AND severity is moderate/severe we surface a small "Around
//     dose timing" signal chip. The chip is provenance only -- the
//     engine already biases toward gentler hydration/fueling on
//     these days; the chip just makes that intelligence visible.
//
// Patient-facing UX (clinical micro-protocol rework):
//   Title:    "Symptom support"
//   Subtitle: "Based on your check-in, here's what may help today."
//   Section:  "What we noticed"
//             Plain-language sentence built from the symptom
//             categories present, plus a short "we'll start with X
//             because Y" reasoning clause when more than one symptom
//             is present.
//   Primary:  One prominent "Start here" action card for the
//             highest-priority symptom, drawn from the
//             RECOMMENDATIONS map (clinical micro-protocol with a
//             concrete next step, e.g. "Settle nausea without
//             skipping nutrition: try 3 to 5 bites of bland protein
//             and small sips of water over 20-30 minutes...").
//             Buttons: "I'll try this" / "Show me another option".
//             "Show me another option" swaps to the category's
//             alternate micro-protocol and flips the right button to
//             "Back".
//   Section:  "More support for today" -- COLLAPSED by default with
//             a tappable header showing a count + chevron. Subtitle
//             "Other steps that may help with appetite, energy or
//             digestion." Expanded rows reuse the same micro-protocol
//             content as the primary card, in compact form.
//   Footer:   Subtle clinical guardrail copy.
//
// Per-row state machine:
//   default   -> "I'll try this" / "Show me another option"
//   committed -> "How do you feel after trying it?" ->
//                 Better / About the same / Worse
//   better    -> "Good. Keep following your plan and check in again
//                 if symptoms come back." (+ change-response link)
//   no_change -> "Thanks. Let's try a different step before
//                 escalating." -> "Show me another option" /
//                 "Check again later". "Check again later" collapses
//                 the panel to a quiet ack.
//   worse     -> "Sorry that got worse. Viva can suggest another
//                 step now or flag this for your care team." ->
//                 "Try another option" / "Ask my care team"
//
// Priority ordering (see priorityRank): moderate/severe nausea ->
// very low appetite -> constipation -> low appetite -> mild nausea ->
// low energy -> low hydration. Reflects what most often drives GLP-1
// discontinuation and what becomes a persistence problem if untreated.
//
// Server contract (preserved):
//   - First per-row "I'll try this" tap fires onAccept ONCE per
//     session (shown -> pending_feedback). Subsequent commits don't
//     re-fire.
//   - "Ask my care team" from the worse panel is the SINGLE point
//     that calls onFeedback("worse"); the server treats that as the
//     auto-escalation signal. Per-row Better/Same outcomes stay
//     LOCAL so one row's Better never overwrites another row's
//     Worse in flight.
//   - All network calls are best-effort; errors leave the card in
//     its current state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  type FeedbackResult,
  type PatientIntervention,
  type InterventionTriggerType,
} from "@/lib/api/interventionsClient";
import type { DoseDayPosition } from "@/lib/engine/dailyState";
import { logEvent } from "@/lib/analytics/client";

// =====================================================================
// Recommendation parsing
// =====================================================================
// The backend `recommendation` field is plain text, optionally
// composed of multiple `\n\n`-separated sections shaped as
// "<Label>: <body>". We surface each as a row with its own state.

interface RecommendationSection {
  label: string | null;
  body: string;
}

function parseRecommendationSections(
  recommendation: string,
): RecommendationSection[] {
  const text = (recommendation ?? "").trim();
  if (!text) return [];
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (blocks.length <= 1) {
    return [{ label: null, body: text }];
  }
  return blocks.map((block) => {
    const m = block.match(/^([^\n:]{1,30}):\s*([\s\S]+)$/);
    if (!m) return { label: null, body: block };
    return { label: m[1]!.trim(), body: m[2]!.trim() };
  });
}

// =====================================================================
// Category mapping, priority, friendly copy
// =====================================================================
type RecCategory =
  | "nausea"
  | "appetite"
  | "energy"
  | "constipation"
  | "hydration"
  | "other";

function categoryFromLabel(
  label: string | null,
  fallback: PatientIntervention["recommendationCategory"],
): RecCategory {
  const l = (label ?? "").toLowerCase();
  if (l.includes("nausea")) return "nausea";
  if (l.includes("appetite")) return "appetite";
  if (l.includes("energy")) return "energy";
  if (l.includes("constipation") || l.includes("digestion")) return "constipation";
  if (l.includes("hydration") || l.includes("fluid")) return "hydration";
  switch (fallback) {
    case "hydration":
      return "hydration";
    case "small_meal":
    case "protein":
      return "appetite";
    case "rest":
      return "energy";
    case "fiber":
      return "constipation";
    default:
      return "other";
  }
}

// Priority rank: lower = more urgent. Ordering reflects what most
// often drives GLP-1 discontinuation (nausea + low intake) and what
// becomes a persistence problem if untreated (constipation):
//   1. moderate or severe nausea
//   2. very low appetite
//   3. constipation
//   4. low appetite
//   5. mild nausea
//   6. low energy
//   7. low hydration
// Severity is the intervention-level numeric severity; we don't have
// per-row severity from the server, so it's used as a proxy for the
// row's clinical urgency.
function priorityRank(cat: RecCategory, severity: number | null | undefined): number {
  const sev = typeof severity === "number" ? severity : 0;
  switch (cat) {
    case "nausea":
      // moderate (sev>=3) or severe (sev>=4) nausea -> top.
      // Mild nausea drops below the appetite/constipation tier.
      return sev >= 3 ? 1 : 5;
    case "appetite":
      // very low (sev>=4) leaps above constipation; ordinary low
      // sits below it.
      return sev >= 4 ? 2 : 4;
    case "constipation":
      return 3;
    case "energy":
      return 6;
    case "hydration":
      return 7;
    default:
      return 9;
  }
}

// Clinical micro-protocols. Each category exposes a primary
// recommendation (the headline next step) AND an alternate (used
// when the patient taps "Show me another option" on the primary card
// or "Try another option" from the worse panel). Copy uses hedged
// language ("may help", "can support") -- never "this will fix" or
// "this prevents stopping treatment" -- and stays patient-friendly
// while being specific enough to feel clinical instead of generic.
interface RecContent {
  title: string;
  body: string;
  helper: string;
}
const RECOMMENDATIONS: Record<RecCategory, { variants: RecContent[] }> = {
  nausea: {
    variants: [
      {
        title: "Settle nausea, then refuel slowly",
        body: "Take 5 small sips of water now, wait 10 minutes, then try 3 to 5 bites of yogurt, tofu, soup or a smoothie.",
        helper:
          "Letting fluids settle first calms the stomach before you reintroduce food, which is gentler than eating into active nausea.",
      },
      {
        title: "Hydrate slowly first",
        body: "Sip water or an electrolyte drink for 20 minutes \u2014 small sips every minute or two \u2014 before trying any solid food.",
        helper:
          "Steady fluids first can settle the stomach so the next bite is less likely to trigger more nausea.",
      },
      {
        title: "Switch to something gentler",
        body: "Try crackers, ginger tea or a few spoonfuls of soup. Pause for a few minutes if nausea increases.",
        helper:
          "Plain, low-odor foods are usually easier to keep down than a full meal when nausea is active.",
      },
      {
        title: "Rest 10 minutes, then a small bite",
        body: "Sit upright in a quiet spot for 10 minutes, then try one bite of bland protein like yogurt or tofu.",
        helper: "A short pause before food can reduce the urge to skip the meal entirely.",
      },
    ],
  },
  appetite: {
    variants: [
      {
        title: "Small fuel + steady fluids",
        body: "Try a few bites of protein now (yogurt, tofu, soup or a smoothie), then sip water or electrolytes over the next hour.",
        helper:
          "Small portions are easier when appetite is low, and steady fluids help keep low intake from turning into low energy later.",
      },
      {
        title: "Half a meal beats a skipped one",
        body: "Aim for a half-portion of your usual meal in the next 30 minutes. Stop when you feel full \u2014 you can come back to it later.",
        helper: "A partial meal preserves more nutrition than waiting until appetite returns on its own.",
      },
      {
        title: "Drink your protein",
        body: "Try a smoothie or protein shake instead of a full meal. Sip it slowly over 20 to 30 minutes.",
        helper: "Liquid calories are usually easier to take in when chewing or strong flavors feel like too much.",
      },
      {
        title: "Bland and low-friction",
        body: "Try toast, rice, oatmeal or crackers with a small protein on the side. Skip greasy or strongly flavored foods today.",
        helper: "Bland foods are less likely to worsen nausea or push appetite even lower.",
      },
    ],
  },
  energy: {
    variants: [
      {
        title: "Refuel with protein in the next 30 minutes",
        body: "Pair a small protein with a carb \u2014 yogurt with fruit, soup with tofu, or a smoothie \u2014 then rest for 10 minutes.",
        helper: "Protein plus a carb steadies blood sugar more reliably than carbs alone, which often crash energy again.",
      },
      {
        title: "Pace today, push tomorrow",
        body: "Plan a rest block in the next 2 hours and add protein to your next meal. Save bigger tasks for tomorrow.",
        helper: "Pacing keeps your energy steadier across the day instead of spiking and crashing.",
      },
      {
        title: "Sip + sit + small snack",
        body: "Take small sips of water, sit or lie down for 10 minutes, then try a small protein-plus-carb snack if you feel ready.",
        helper: "Low intake and dehydration deepen fatigue, so fluids first usually helps before food does.",
      },
      {
        title: "Add protein to your next meal",
        body: "Pair your next bite with a protein source (Greek yogurt, eggs, beans or a smoothie with protein powder).",
        helper: "Protein steadies energy more reliably than carbs alone.",
      },
    ],
  },
  constipation: {
    variants: [
      {
        title: "Walk + water in the next hour",
        body: "Take a 10-minute walk after your next meal and finish a full glass of water with it.",
        helper: "Movement and fluids together stimulate digestion better than either one alone.",
      },
      {
        title: "Steady fluids over the afternoon",
        body: "Sip warm water, tea or broth every 20 minutes for the next few hours.",
        helper: "Warm fluids help relax the gut and keep stool softer than cold water alone.",
      },
      {
        title: "Add fiber gradually",
        body: "Add a small fiber boost to your next meal \u2014 berries, chia, beans or vegetables \u2014 and finish a glass of water with it.",
        helper: "Fiber moves things along when paired with steady fluids; adding too much at once can backfire and cause bloating.",
      },
      {
        title: "Gentle bowel-support combo",
        body: "Pair a short walk with warm fluids and a fiber-rich snack. Keep the changes small to avoid bloating.",
        helper: "Gradual changes are less likely to swap constipation for bloating.",
      },
    ],
  },
  hydration: {
    variants: [
      {
        title: "Small sips every 10 minutes for the next hour",
        body: "Take a few sips of water or an electrolyte drink every 10 minutes for the next hour. Small and steady is easier than a big glass.",
        helper: "Steady sips absorb better and feel gentler on your stomach than drinking a lot at once.",
      },
      {
        title: "Switch to something gentler",
        body: "If plain water feels hard, try an electrolyte drink, diluted juice, warm tea or broth instead.",
        helper: "A different flavor or temperature can make fluids easier to keep down when water feels off.",
      },
      {
        title: "Pair fluids with a bland snack",
        body: "Sip water alongside a few crackers, a piece of toast or a small piece of fruit over the next 20 minutes.",
        helper: "A small bland snack can settle the stomach while you rehydrate.",
      },
      {
        title: "Cool fluids if warm feels off",
        body: "Try ice chips, a chilled electrolyte drink or cold tea instead. Small sips, every few minutes.",
        helper: "The temperature that feels best is the one you\u2019ll actually keep drinking.",
      },
    ],
  },
  other: {
    variants: [
      {
        title: "Pick one small action in the next 15 minutes",
        body: "Choose one of: a few sips of water, a few bites of a familiar food, or a 5-minute rest in a quiet spot.",
        helper: "One small, finishable action is more useful right now than trying to fix everything at once.",
      },
      {
        title: "Lower the bar even further",
        body: "Try the smallest version: a single sip of fluid, one minute of slow breathing, or sitting somewhere comfortable for 5 minutes.",
        helper: "When everything feels like too much, the smallest possible step is the one most likely to actually happen.",
      },
    ],
  },
};


// Stable per-category salt so different categories don't all land on
// the same variant index for the same intervention id on the same day.
const CATEGORY_SALT: Record<RecCategory, number> = {
  nausea: 0,
  appetite: 1,
  energy: 2,
  constipation: 3,
  hydration: 4,
  other: 5,
};

// Pick a deterministic primary + alternate variant for this category
// using the intervention id and current day. Same intervention shows
// the same variant within a day, but different interventions (and
// the same intervention across days) cycle through the variant list.
// "Another option" toggles to the next variant in the cycle.
function pickVariants(
  category: RecCategory,
  interventionId: number,
): { primary: RecContent; alternate: RecContent } {
  const variants = RECOMMENDATIONS[category].variants;
  const day = Math.floor(Date.now() / 86_400_000);
  const len = variants.length;
  const salt = CATEGORY_SALT[category];
  const raw = (interventionId + day + salt) % len;
  const primaryIdx = ((raw % len) + len) % len;
  const alternateIdx = (primaryIdx + 1) % len;
  return { primary: variants[primaryIdx]!, alternate: variants[alternateIdx]! };
}


// Per-row state machine. Each row drives its own progression.
type SectionStatus =
  | "committed"
  | "not_for_me"
  | "skipped"
  | "better"
  | "no_change"
  | "worse"
  | "didnt_try";

// Statuses that have a render branch in the simplified UX. Legacy
// values from the prior rework ("not_for_me", "skipped") and the
// even-older "did/skipped" model are intentionally NOT in this set --
// they have no panel in the new flow, so a row stuck in one of them
// would render body text with no actionable controls. We coerce them
// to null on hydration so the row falls back to the default
// "I'll try this / Another idea" state.
const VALID_STATUSES: ReadonlySet<string> = new Set([
  "committed",
  "better",
  "no_change",
  "worse",
  "didnt_try",
]);

function coercePersistedStatus(raw: string | null): SectionStatus | null {
  if (!raw) return null;
  if (VALID_STATUSES.has(raw)) return raw as SectionStatus;
  if (raw === "did") return "committed";
  // Legacy "not_for_me" / "skipped" -> drop back to default so the
  // row stays interactive instead of dead-ending the patient.
  return null;
}

// Returns true when the row should expose the "Ask my care team"
// affordance. Currently fires on "worse" only.
// TODO: when historical patient_intervention data is wired in, also
// escalate when the same category has been "no_change" repeatedly or
// "not_for_me" multiple times across recent check-ins.
export function shouldOfferEscalation(
  _category: RecCategory,
  rowState: SectionStatus | null,
  _history?: { sameCategoryUnresolvedCount?: number },
): boolean {
  if (rowState === "worse") return true;
  // TODO: if (history && (history.sameCategoryUnresolvedCount ?? 0) >= 3) return true;
  return false;
}

function rowKey(interventionId: number, label: string | null, index: number): string {
  const tag = label ? `label:${label.toLowerCase()}` : `idx:${index}`;
  return `pulsepilot.intervention.${interventionId}.row.${tag}`;
}

function buildRowKeys(
  interventionId: number,
  sections: RecommendationSection[],
): string[] {
  const seen = new Map<string, number>();
  return sections.map((s, i) => {
    const base = rowKey(interventionId, s.label, i);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// =====================================================================
// Visual tokens (fixed light surface — works correctly in dark mode)
// =====================================================================
const SUCCESS_FG = "#1F8A3F";
const CARD_TEXT = "#142240";
const CARD_MUTED = "#6B7FA3";
const CARD_BORDER = "#E2E8F0";

// Live check-in snapshot used to drive severity-aware adaptations.
// All fields are nullable so the card can render before the patient
// has finished filling things in. The values mirror the option keys
// declared in app/(tabs)/index.tsx so we don't introduce a second
// vocabulary.
export interface LiveCheckin {
  nausea?: "none" | "mild" | "moderate" | "severe" | null;
  appetite?: "strong" | "normal" | "low" | "very_low" | null;
  energy?: "great" | "good" | "tired" | "depleted" | null;
  digestion?: "fine" | "bloated" | "constipated" | "diarrhea" | null;
  bowel?: "yes" | "no" | null;
}

export type LiveSeverity = "steady" | "mild" | "moderate" | "severe";

// Pure client-side severity derivation. This is what makes the card
// feel live: the moment the patient changes a chip in the check-in
// row above, this re-runs and the card adapts within React's normal
// render cycle (well under the 1-2s budget the spec asks for) --
// no /generate round-trip required.
//
// Tiering (per-field max + "lots of moderate" guard):
//   severe   -> any field reads "severe"-equivalent OR three+ fields
//               are at moderate level
//   moderate -> any field reads "moderate"-equivalent
//   mild     -> any field reads "mild"-equivalent
//   steady   -> no field reads a negative value (null/unset fields
//               count as "no concern" so the card transitions to the
//               maintenance layout the moment the patient deselects
//               their last symptom chip)
export function deriveLiveSeverity(
  c: LiveCheckin | null | undefined,
): LiveSeverity | null {
  if (!c) return null;
  const nauseaScore =
    c.nausea === "severe"
      ? 3
      : c.nausea === "moderate"
        ? 2
        : c.nausea === "mild"
          ? 1
          : 0;
  const appetiteScore =
    c.appetite === "very_low" ? 3 : c.appetite === "low" ? 2 : 0;
  const energyScore =
    c.energy === "depleted" ? 3 : c.energy === "tired" ? 2 : 0;
  const digestionScore =
    c.digestion === "diarrhea"
      ? 3
      : c.digestion === "constipated"
        ? 2
        : c.digestion === "bloated"
          ? 1
          : 0;
  const bowelScore = c.bowel === "no" ? 1 : 0;
  const all = [
    nauseaScore,
    appetiteScore,
    energyScore,
    digestionScore,
    bowelScore,
  ];
  const max = Math.max(...all);
  const heavyCount = all.filter((s) => s >= 2).length;
  if (max >= 3 || heavyCount >= 3) return "severe";
  if (max >= 2) return "moderate";
  if (max >= 1) return "mild";
  return "steady";
}

// =====================================================================
// LIVE DECISION MATRIX
// =====================================================================
// `deriveLiveSeverity` adapts the card CHROME (badge tone, signal
// chips, escalation CTA). The matrix below adapts the card CONTENT --
// the recommendation title, body, and the mix of support categories
// shown -- so changing a chip in the check-in row above visibly
// changes WHAT the card recommends, not just how it is decorated.
//
// This is intentionally a pure client-side derivation. The server's
// PatientIntervention still owns the id, status, accept / feedback
// wiring and persistence. We just swap the displayed copy when the
// live check-in disagrees with the server's snapshot, so the patient
// doesn't have to wait for a /generate round-trip to feel the card
// react to their selectors.
//
// Priority order for the PRIMARY concern (highest first):
//   1. severe nausea           -> "Settle nausea first" (amber/heavier)
//   2. moderate nausea         -> "Settle nausea without skipping nutrition"
//   3. constipation OR no BM   -> "Help things move gently"
//      (only when nausea is absent, otherwise nausea wins)
//   4. mild nausea             -> "Stay ahead of nausea" (light)
//   5. very_low appetite       -> bland-vs-protein appetite copy
//   6. low appetite            -> bland-vs-protein appetite copy
//   7. depleted energy         -> "Reset with fluids and a short break"
//   8. diarrhea                -> "Steady fluids and bland foods"
//   9. bloating                -> "Ease bloating gently" (NO fiber copy)
//  10. tired energy            -> "Take a lighter day"
//
// Bloating is intentionally NOT treated like constipation -- if the
// patient picked bloated (not constipated and BM=yes) we do not
// recommend fiber, we recommend gentle movement / smaller meals.
//
// Bloating + diarrhea map to RecCategory "other" because the existing
// enum doesn't carry them; the override copy carries the real title.

interface LivePlanRow {
  category: RecCategory;
  copy: RecContent;
  // Human-readable tag used by the dev-only debug line so we can
  // verify the matrix is recalculating from the chip selectors.
  reason: string;
}

interface LivePlan {
  severity: LiveSeverity;
  primaryConcern: string;
  rows: LivePlanRow[];
  // Compact symptom signature for the dev-only debug line.
  signature: string;
}

function nauseaCopy(
  level: "severe" | "moderate" | "mild",
  withLowAppetite: boolean,
): RecContent {
  if (level === "severe") {
    return {
      title: "Settle nausea before food",
      body:
        "Start with small sips of water for 10 minutes. Only try a few bites of bland food (toast, crackers, yogurt or tofu) if nausea eases. Pause if it gets worse.",
      helper:
        "If nausea is hard to manage, getting worse, or you can\u2019t keep fluids down, ask your care team to review.",
    };
  }
  if (level === "moderate") {
    return {
      title: "Settle nausea without skipping food",
      body: withLowAppetite
        ? "Try a few bites of bland protein (yogurt, tofu, soup or a smoothie), then sip water slowly over the next 20 minutes."
        : "Try a small bland snack (yogurt, tofu, soup or a smoothie) and sip water slowly over the next 20 minutes.",
      helper:
        "Small bland portions are easier on the stomach while keeping protein and fluids in.",
    };
  }
  return {
    title: "Stay ahead of nausea",
    body: "Keep portions small today and sip water steadily between bites instead of drinking a lot at once.",
    helper: "Small, preventive steps can keep mild nausea from building later in the day.",
  };
}

function appetiteCopy(hasNausea: boolean): RecContent {
  if (hasNausea) {
    return {
      title: "Eat small and bland",
      body:
        "Try a few bites of toast, crackers, rice or oatmeal with a small protein on the side. Skip greasy or strongly flavored foods today.",
      helper:
        "Bland, low-friction foods are easier when nausea is also present.",
    };
  }
  return {
    title: "Small fuel + steady fluids",
    body:
      "Try a few bites of protein now (yogurt, tofu, soup or a smoothie), then sip water or electrolytes over the next hour.",
    helper:
      "Small portions are easier when appetite is low, and steady fluids help keep low intake from turning into low energy later.",
  };
}

function constipationCopy(): RecContent {
  return {
    title: "Walk + water + a fiber bite",
    body:
      "Sip warm fluids over the next few hours, add a fiber-rich food (berries, chia, beans or vegetables) to your next meal, and take a short walk if you feel up for it.",
    helper:
      "Movement, fluids and fiber together work better for constipation than any one of them alone.",
  };
}

function bloatingCopy(): RecContent {
  return {
    title: "Smaller portions + a short walk",
    body:
      "Try smaller portions for the rest of today and a 5- to 10-minute walk after eating. Skip carbonated drinks and heavily seasoned foods.",
    helper:
      "Gentle movement and smaller meals usually help bloating more than adding fiber does.",
  };
}

function diarrheaCopy(): RecContent {
  return {
    title: "Steady fluids + bland foods",
    body:
      "Sip water or an electrolyte drink slowly over the next hour and stick to bland foods like rice, toast or bananas. Skip greasy or high-fiber foods today.",
    helper:
      "Steady fluids replace what\u2019s being lost; bland foods are easier on an irritated gut.",
  };
}

function energyCopy(level: "tired" | "depleted"): RecContent {
  if (level === "depleted") {
    return {
      title: "Sip + sit + small snack",
      body:
        "Take small sips of water, sit or lie down for 10 minutes, then try a small protein-plus-carb snack if you feel ready.",
      helper:
        "Low intake and dehydration deepen fatigue, so fluids and a small refuel together help most.",
    };
  }
  return {
    title: "Pace today, push tomorrow",
    body:
      "Plan a rest block in the next few hours and pair your next meal with a protein source. Save bigger tasks for tomorrow.",
    helper:
      "Pacing keeps your energy steadier across the day instead of spiking and crashing.",
  };
}

function hydrationCopy(): RecContent {
  return {
    title: "Small sips every 10 minutes for the next hour",
    body:
      "Take a few sips of water or an electrolyte drink every 10 minutes for the next hour. If plain water feels hard, try warm tea or broth.",
    helper:
      "Steady sips absorb better and feel gentler on the stomach than a big glass at once.",
  };
}

export function deriveLivePlan(
  c: LiveCheckin | null | undefined,
  severity: LiveSeverity | null,
): LivePlan | null {
  // No live data -> let the server-derived rows render unchanged.
  // Steady -> the InterventionCard short-circuits to the maintenance
  // card before reading the plan, so we can early-return null too.
  if (!c || !severity || severity === "steady") return null;

  const hasNausea =
    c.nausea === "mild" || c.nausea === "moderate" || c.nausea === "severe";
  const hasLowAppetite = c.appetite === "low" || c.appetite === "very_low";
  const hasConstipation =
    c.digestion === "constipated" || c.bowel === "no";
  const hasBloating = c.digestion === "bloated";
  const hasDiarrhea = c.digestion === "diarrhea";
  const energyTier: "depleted" | "tired" | null =
    c.energy === "depleted"
      ? "depleted"
      : c.energy === "tired"
        ? "tired"
        : null;

  // -- Pick PRIMARY concern by clinical priority ---------------------
  // `kind` is the matrix-level concern (used for de-duping secondaries
  // and for the debug tag). `category` is the RecCategory we expose
  // to the renderer; bloating + diarrhea map to "other" because the
  // RecCategory enum doesn't carry them, and the override copy carries
  // the real title/body.
  let kind: string | null = null;
  let primaryCategory: RecCategory | null = null;
  let primaryCopy: RecContent | null = null;

  if (c.nausea === "severe") {
    kind = "nausea-severe";
    primaryCategory = "nausea";
    primaryCopy = nauseaCopy("severe", hasLowAppetite);
  } else if (c.nausea === "moderate") {
    kind = "nausea-moderate";
    primaryCategory = "nausea";
    primaryCopy = nauseaCopy("moderate", hasLowAppetite);
  } else if (hasConstipation) {
    // Constipation outranks mild nausea / low appetite when nausea is
    // not at least moderate -- it's a concrete, actionable signal.
    kind = "constipation";
    primaryCategory = "constipation";
    primaryCopy = constipationCopy();
  } else if (c.nausea === "mild") {
    kind = "nausea-mild";
    primaryCategory = "nausea";
    primaryCopy = nauseaCopy("mild", hasLowAppetite);
  } else if (hasLowAppetite) {
    kind = c.appetite === "very_low" ? "appetite-very-low" : "appetite-low";
    primaryCategory = "appetite";
    primaryCopy = appetiteCopy(hasNausea);
  } else if (energyTier === "depleted") {
    kind = "energy-depleted";
    primaryCategory = "energy";
    primaryCopy = energyCopy("depleted");
  } else if (hasDiarrhea) {
    kind = "diarrhea";
    primaryCategory = "other";
    primaryCopy = diarrheaCopy();
  } else if (hasBloating) {
    kind = "bloating";
    primaryCategory = "other";
    primaryCopy = bloatingCopy();
  } else if (energyTier === "tired") {
    kind = "energy-tired";
    primaryCategory = "energy";
    primaryCopy = energyCopy("tired");
  } else {
    return null;
  }

  const rows: LivePlanRow[] = [
    { category: primaryCategory, copy: primaryCopy, reason: kind },
  ];
  // Track which concern KINDS are already represented so secondaries
  // don't double up. Keyed by symptom kind, not RecCategory, so
  // bloating + diarrhea (both "other") don't shadow each other.
  const used = new Set<string>([kind]);
  const usedCats = new Set<RecCategory>([primaryCategory]);

  // Appetite secondary
  if (
    !usedCats.has("appetite") &&
    hasLowAppetite
  ) {
    rows.push({
      category: "appetite",
      copy: appetiteCopy(hasNausea),
      reason: c.appetite === "very_low" ? "appetite-very-low" : "appetite-low",
    });
    usedCats.add("appetite");
  }

  // Constipation secondary -- only adds when nausea (not constipation)
  // was the primary, so digestion guidance still surfaces.
  if (!usedCats.has("constipation") && hasConstipation) {
    rows.push({
      category: "constipation",
      copy: constipationCopy(),
      reason: "constipation",
    });
    usedCats.add("constipation");
  }

  // Bloating secondary -- ONLY when constipation isn't also selected.
  // Constipation already covers fiber+walk; bloating uses opposite
  // copy (gentler, no fiber) and would conflict.
  if (!used.has("bloating") && hasBloating && !hasConstipation) {
    rows.push({
      category: "other",
      copy: bloatingCopy(),
      reason: "bloating",
    });
    used.add("bloating");
  }

  // Hydration secondary -- when nausea is moderate+/severe, appetite
  // is very_low, or digestion is diarrhea.
  if (
    !usedCats.has("hydration") &&
    (c.nausea === "moderate" ||
      c.nausea === "severe" ||
      c.appetite === "very_low" ||
      hasDiarrhea)
  ) {
    rows.push({
      category: "hydration",
      copy: hydrationCopy(),
      reason: "hydration",
    });
    usedCats.add("hydration");
  }

  // Energy secondary
  if (!usedCats.has("energy") && energyTier) {
    rows.push({
      category: "energy",
      copy: energyCopy(energyTier),
      reason: `energy-${energyTier}`,
    });
    usedCats.add("energy");
  }

  const signature = `n=${c.nausea ?? "-"}|a=${c.appetite ?? "-"}|e=${c.energy ?? "-"}|d=${c.digestion ?? "-"}|b=${c.bowel ?? "-"}`;

  return {
    severity,
    primaryConcern: kind,
    rows,
    signature,
  };
}

// Short, clean card title derived from live check-in signal or server trigger.
// Uses the same category vocabulary as the rest of the card copy.
// No em dashes, no chatbot-style observations.
function buildInsightTitle(
  livePlan: LivePlan | null,
  liveSeverity: LiveSeverity | null,
  triggerType: InterventionTriggerType,
): string {
  if (livePlan) {
    const kind = livePlan.primaryConcern;
    if (kind === "nausea-severe" || kind === "nausea-moderate" || kind === "nausea-mild")
      return "Nausea support for today";
    if (kind === "constipation" || kind === "diarrhea" || kind === "bloating")
      return "Digestion support for today";
    if (kind === "appetite-very-low" || kind === "appetite-low")
      return "Appetite support for today";
    if (kind === "energy-depleted" || kind === "energy-tired")
      return "Energy support for today";
    if (kind === "hydration")
      return "Hydration support for today";
  }
  if (liveSeverity === "severe" || liveSeverity === "moderate" || liveSeverity === "mild")
    return "Recovery support for today";
  switch (triggerType) {
    case "nausea": return "Nausea support for today";
    case "constipation": return "Digestion support for today";
    case "low_energy": return "Energy support for today";
    case "low_hydration": return "Hydration support for today";
    case "low_food_intake": return "Appetite support for today";
    case "missed_checkin": return "Getting back on track";
    case "rapid_weight_change": return "Weight change noticed";
    case "worsening_symptom": return "Symptom support for today";
    case "repeated_symptom": return "Symptom support for today";
    case "patient_requested_review": return "Support requested";
    default: return "Today's support";
  }
}

// =====================================================================
// Wearable + signal context paragraph
// =====================================================================
export interface WearableContext {
  steps?: number | null;
  sleepHours?: number | null;
  restingHR?: number | null;
  activeCalories?: number | null;
}

function buildContextParagraph(
  liveCheckin: LiveCheckin | null | undefined,
  doseContext: {
    position: DoseDayPosition | null | undefined;
    recentTitration?: boolean;
    daysSinceLastDose?: number | null;
  } | null | undefined,
  symptomCounts?: {
    nausea7d: number;
    lowAppetite7d: number;
    lowEnergy7d: number;
    constipation7d: number;
  } | null,
  wearableContext?: WearableContext | null,
): string {
  const parts: string[] = [];
  const n7 = symptomCounts?.nausea7d ?? 0;
  const a7 = symptomCounts?.lowAppetite7d ?? 0;
  const c7 = symptomCounts?.constipation7d ?? 0;

  if (liveCheckin?.nausea === "severe") {
    parts.push(n7 >= 3 ? `nausea is elevated today (${n7} of the past 7 days)` : "nausea is elevated today");
  } else if (liveCheckin?.nausea === "moderate") {
    parts.push(n7 >= 3 ? `nausea is present today (${n7} of the past 7 days)` : "nausea is present today");
  } else if (liveCheckin?.nausea === "mild") {
    parts.push("mild nausea today");
  } else if (n7 >= 3) {
    parts.push(`nausea has been present for ${n7} of the past 7 days`);
  }

  if (liveCheckin?.appetite === "very_low") {
    parts.push(a7 >= 3 ? "appetite is very low — lower for most of this week" : "appetite is very low today");
  } else if (liveCheckin?.appetite === "low") {
    parts.push("appetite is lower than usual");
  } else if (a7 >= 3) {
    parts.push("appetite has been lower for most of this week");
  }

  if (liveCheckin?.digestion === "constipated" || liveCheckin?.bowel === "no") {
    parts.push(c7 >= 3 ? `constipation is recurring (${c7} of 7 days this week)` : "digestion is sluggish today");
  } else if (c7 >= 4) {
    parts.push("constipation has been recurring this week");
  }

  if (liveCheckin?.energy === "depleted") parts.push("energy is very low today");
  else if (liveCheckin?.energy === "tired") parts.push("energy is lower than usual");

  const days = doseContext?.daysSinceLastDose;
  const pos = doseContext?.position;
  if (days === 1 || pos === "day_1_post") {
    parts.push("you're one day after your dose, when side effects often peak");
  } else if (days === 2 || pos === "day_2_post") {
    parts.push("you're two days after your dose");
  } else if (days === 3 || pos === "day_3_post") {
    parts.push("three days after your dose");
  } else if (days === 0 || pos === "dose_day") {
    parts.push("today is your dose day");
  }
  if (doseContext?.recentTitration) {
    parts.push("your dose was recently increased, which can intensify early side effects");
  }

  if (wearableContext?.sleepHours != null && wearableContext.sleepHours > 0 && wearableContext.sleepHours < 6) {
    parts.push(`sleep was shorter than usual last night (${wearableContext.sleepHours.toFixed(1)} hrs)`);
  }
  if (wearableContext?.steps != null && wearableContext.steps > 0 && wearableContext.steps < 3000) {
    parts.push("your step count is lower than usual today");
  }

  if (parts.length === 0) return "Your check-in and treatment history shaped this recommendation.";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (parts.length === 1) return cap(parts[0]!) + ".";
  const [first, ...rest] = parts;
  if (rest.length === 1) return `${cap(first!)} and ${rest[0]}.`;
  return `${cap(first!)}, ${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}.`;
}

export function buildContextChips(
  liveCheckin: LiveCheckin | null | undefined,
  doseContext: {
    position: DoseDayPosition | null | undefined;
    recentTitration?: boolean;
    daysSinceLastDose?: number | null;
  } | null | undefined,
  symptomCounts?: {
    nausea7d: number;
    lowAppetite7d: number;
    lowEnergy7d: number;
    constipation7d: number;
  } | null,
): string[] {
  const chips: string[] = [];
  const n7 = symptomCounts?.nausea7d ?? 0;
  const a7 = symptomCounts?.lowAppetite7d ?? 0;

  if (liveCheckin?.nausea === "severe" || liveCheckin?.nausea === "moderate") {
    chips.push("Nausea elevated today");
  } else if (liveCheckin?.nausea === "mild") {
    chips.push("Mild nausea today");
  } else if (n7 >= 3) {
    chips.push("Nausea recurring");
  }

  if (liveCheckin?.appetite === "very_low" || liveCheckin?.appetite === "low") {
    chips.push(a7 >= 3 ? "Appetite lower this week" : "Appetite lower today");
  } else if (a7 >= 3) {
    chips.push("Appetite lower this week");
  }

  if (liveCheckin?.energy === "depleted") {
    chips.push("Energy very low");
  } else if (liveCheckin?.energy === "tired") {
    chips.push("Energy lower today");
  }

  if (liveCheckin?.digestion === "constipated" || liveCheckin?.bowel === "no") {
    chips.push("Digestion sluggish");
  }

  const days = doseContext?.daysSinceLastDose;
  const pos = doseContext?.position;
  if (days === 1 || pos === "day_1_post") chips.push("1 day after dose");
  else if (days === 2 || pos === "day_2_post") chips.push("2 days after dose");
  else if (days === 3 || pos === "day_3_post") chips.push("3 days after dose");
  else if (days === 0 || pos === "dose_day") chips.push("Dose day");

  if (doseContext?.recentTitration && chips.length < 3) chips.push("Dose increased");

  return chips.slice(0, 3);
}

interface InterventionCardProps {
  intervention: PatientIntervention;
  navy: string;
  accent: string;
  cardBg: string;
  background: string;
  mutedForeground: string;
  warning: string;
  // Whether HealthKit / Apple Health data is connected for this
  // patient. Drives the subtitle copy: when true we reference
  // "Apple Health trends" so the subtitle reflects the actual signal
  // mix; when false we omit it.
  hasHealthData?: boolean;
  // Optional dose-context hint sourced from DailyTreatmentState. The
  // card uses this only to surface a small "Around dose timing"
  // signal chip when the day sits in a post-dose window AND symptoms
  // are running moderate/severe. No medical advice is implied or
  // rendered -- the chip is provenance, not prescription. When the
  // data is absent the card behaves exactly as before.
  doseContext?: {
    position: DoseDayPosition | null | undefined;
    recentTitration?: boolean;
    daysSinceLastDose?: number | null;
  } | null;
  // 7-day symptom frequency counts computed from glp1InputHistory.
  symptomCounts?: {
    nausea7d: number;
    lowAppetite7d: number;
    lowEnergy7d: number;
    constipation7d: number;
  } | null;
  // Wearable signals (steps, sleep, HR) from HealthKit / Apple Health.
  // Used by buildContextParagraph to weave in objective context naturally.
  wearableContext?: WearableContext | null;
  // Live snapshot of the patient's current check-in selections.
  liveCheckin?: LiveCheckin | null;
  // Called when the card's interaction phase changes. Parent uses this
  // to dim surrounding content when the card is in active focus.
  onEngaged?: (engaged: boolean) => void;
  // Phase to initialise the card at (used when the parent persists
  // phase across sheet open/close cycles).
  initialPhase?: InteractionPhase;
  // Fires whenever the interaction phase changes (mirrors internal state
  // upward so the parent can persist it across remounts).
  onPhaseChange?: (phase: InteractionPhase) => void;
  // Fires ~1.5 s after the card enters the "better" resolution state,
  // giving the parent a signal to close the support sheet.
  onDone?: () => void;

  onAccept: (id: number) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  onFeedback: (id: number, result: FeedbackResult) => Promise<void>;
  onEscalate: (id: number) => Promise<void>;
}

function categoryIcon(
  category: PatientIntervention["recommendationCategory"],
): keyof typeof Feather.glyphMap {
  switch (category) {
    case "hydration":
      return "droplet";
    case "activity":
      return "activity";
    case "protein":
      return "award";
    case "fiber":
      return "feather";
    case "small_meal":
      return "coffee";
    case "rest":
      return "moon";
    case "tracking":
      return "edit-3";
    case "care_team_review":
      return "message-circle";
    default:
      return "heart";
  }
}

function safeLog(name: string): void {
  try {
    void logEvent(name);
  } catch {
    /* analytics is fire-and-forget */
  }
}

export type InteractionPhase = "default" | "checking" | "feedback" | "better" | "struggling";

function tap(): void {
  try {
    Haptics.selectionAsync();
  } catch {
    /* best-effort */
  }
}

export function InterventionCard({
  intervention,
  navy: _themeNavy,
  accent: _accent,
  cardBg: _cardBg,
  background: _themeBackground,
  mutedForeground: _themeMuted,
  warning,
  hasHealthData: _hasHealthData,
  doseContext = null,
  symptomCounts = null,
  wearableContext = null,
  liveCheckin = null,
  onEngaged,
  initialPhase,
  onPhaseChange,
  onDone,
  onAccept,
  onDismiss: _onDismiss,
  onFeedback,
  onEscalate: _onEscalate,
}: InterventionCardProps) {
  const navy = CARD_TEXT;
  const mutedForeground = CARD_MUTED;

  const liveSeverity = deriveLiveSeverity(liveCheckin);
  const livePlan = useMemo(
    () => deriveLivePlan(liveCheckin, liveSeverity),
    [liveCheckin, liveSeverity],
  );

  const [phase, setPhase] = useState<InteractionPhase>(initialPhase ?? "default");

  const setEngagedPhase = useCallback(
    (next: InteractionPhase) => {
      setPhase(next);
      onPhaseChange?.(next);
      if (next === "default" || next === "better") {
        onEngaged?.(false);
      } else {
        onEngaged?.(true);
      }
    },
    [onEngaged, onPhaseChange],
  );

  // Spring entrance animation — all hooks must precede any early return
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      tension: 65,
      friction: 11,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [enter]);

  // Notify parent to close the sheet ~1.5 s after support completes.
  useEffect(() => {
    if (phase !== "better") return;
    const t = setTimeout(() => onDone?.(), 1500);
    return () => clearTimeout(t);
  }, [phase, onDone]);
  const animatedStyle = {
    opacity: enter,
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [0, 1],
          outputRange: [14, 0],
        }),
      },
    ],
  };

  // Swipe gesture for feedback phase
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeRightRef = useRef<() => void>(() => {});
  const swipeLeftRef = useRef<() => void>(() => {});

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.2,
      onPanResponderMove: Animated.event([null, { dx: swipeX }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 90) swipeRightRef.current();
        else if (gs.dx < -90) swipeLeftRef.current();
        else
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: false,
            tension: 120,
            friction: 7,
          }).start();
      },
    }),
  ).current;

  // Backend call guards
  const acceptFiredRef = useRef(false);
  const escalateFiredRef = useRef(false);
  const viewLoggedRef = useRef<number | null>(null);

  useEffect(() => {
    if (viewLoggedRef.current === intervention.id) return;
    viewLoggedRef.current = intervention.id;
    safeLog("intervention_plan_viewed");
  }, [intervention.id]);

  // Content derivation
  const sections = useMemo(
    () => parseRecommendationSections(intervention.recommendation),
    [intervention.recommendation],
  );
  const sectionKeys = useMemo(
    () => buildRowKeys(intervention.id, sections),
    [intervention.id, sections],
  );

  const orderedRows = useMemo(() => {
    const enriched = sections.map((s, i) => {
      const category = categoryFromLabel(
        s.label,
        intervention.recommendationCategory,
      );
      return {
        section: s,
        index: i,
        key: sectionKeys[i]!,
        category,
        rank: priorityRank(category, intervention.severity),
      };
    });
    enriched.sort((a, b) => a.rank - b.rank || a.index - b.index);
    return enriched;
  }, [
    sections,
    sectionKeys,
    intervention.recommendationCategory,
    intervention.severity,
  ]);

  const displayRows = useMemo(() => {
    if (!livePlan) return orderedRows;
    return livePlan.rows.map((r, i) => ({
      section: { label: r.category, body: r.copy.body },
      index: i,
      key: `live:${intervention.id}:${r.category}:${i}`,
      category: r.category,
      rank: i,
    }));
  }, [livePlan, orderedRows, intervention.id]);

  const liveOverrides = useMemo<Record<string, RecContent>>(() => {
    if (!livePlan) return {};
    const m: Record<string, RecContent> = {};
    livePlan.rows.forEach((r, i) => {
      m[`live:${intervention.id}:${r.category}:${i}`] = r.copy;
    });
    return m;
  }, [livePlan, intervention.id]);

  const primary = displayRows[0];

  const primaryContent = useMemo<RecContent>(() => {
    if (!primary) {
      return {
        title: buildInsightTitle(livePlan, liveSeverity, intervention.triggerType),
        body: intervention.recommendation,
        helper: "",
      };
    }
    const override = liveOverrides[primary.key];
    if (override) return override;
    const picked = pickVariants(primary.category, intervention.id);
    if (primary.category === "other") {
      return { ...picked.primary, body: primary.section.body || picked.primary.body };
    }
    return picked.primary;
  }, [
    primary,
    liveOverrides,
    intervention.id,
    intervention.recommendation,
    livePlan,
    liveSeverity,
    intervention.triggerType,
  ]);

  const alternateContent = useMemo<RecContent>(() => {
    if (!primary) return primaryContent;
    const picked = pickVariants(primary.category, intervention.id);
    return picked.alternate;
  }, [primary, primaryContent, intervention.id]);

  const contextParagraph = useMemo(
    () => buildContextParagraph(liveCheckin, doseContext, symptomCounts, wearableContext),
    [liveCheckin, doseContext, symptomCounts, wearableContext],
  );

  const contextChips = useMemo(
    () => buildContextChips(liveCheckin, doseContext, symptomCounts),
    [liveCheckin, doseContext, symptomCounts],
  );

  // Swipe card background interpolates: orange (left) → white (center) → green (right)
  const swipeCardBg = swipeX.interpolate({
    inputRange: [-150, 0, 150],
    outputRange: ["#FFF7ED", "#FFFFFF", "#F0FDF4"],
    extrapolate: "clamp",
  });

  // Handlers
  const handleCommit = useCallback(async () => {
    tap();
    setEngagedPhase("checking");
    safeLog("intervention_started");
    if (!acceptFiredRef.current) {
      acceptFiredRef.current = true;
      try {
        await onAccept(intervention.id);
      } catch {
        if (intervention.status === "shown") acceptFiredRef.current = false;
      }
    }
  }, [intervention.id, intervention.status, onAccept, setEngagedPhase]);

  const handleAskCareTeam = useCallback(async () => {
    tap();
    if (intervention.status === "escalated") return;
    if (escalateFiredRef.current) return;
    escalateFiredRef.current = true;
    safeLog("care_team_escalation_requested");
    try {
      if (intervention.status === "shown" && !acceptFiredRef.current) {
        acceptFiredRef.current = true;
        try {
          await onAccept(intervention.id);
        } catch {
          if (intervention.status === "shown") acceptFiredRef.current = false;
        }
      }
      await onFeedback(intervention.id, "worse");
    } catch {
      escalateFiredRef.current = false;
    }
  }, [intervention.id, intervention.status, onAccept, onFeedback]);

  const handleSwipeRight = useCallback(async () => {
    tap();
    Animated.spring(swipeX, {
      toValue: 400,
      useNativeDriver: false,
      tension: 80,
      friction: 8,
    }).start(() => {
      setEngagedPhase("better");
      swipeX.setValue(0);
    });
    safeLog("intervention_feedback_better");
    try {
      await onFeedback(intervention.id, "better");
    } catch {
      /* best-effort */
    }
  }, [intervention.id, onFeedback, swipeX, setEngagedPhase]);

  const handleSwipeLeft = useCallback(() => {
    tap();
    Animated.spring(swipeX, {
      toValue: 0,
      useNativeDriver: false,
      tension: 120,
      friction: 7,
    }).start();
    setEngagedPhase("struggling");
    safeLog("intervention_feedback_no_change");
  }, [swipeX, setEngagedPhase]);

  swipeRightRef.current = handleSwipeRight;
  swipeLeftRef.current = handleSwipeLeft;

  const status = intervention.status;
  // In the new phase UX there is no per-row "worse" outcome — escalation is
  // always offered in the struggling phase and for severe live severity.
  const offerEscalationInStruggling = shouldOfferEscalation(
    primary?.category ?? "other",
    "worse",
  );
  const pillLabel =
    status === "escalated"
      ? "Review requested"
      : liveSeverity === "severe" || liveSeverity === "moderate"
        ? "Extra support today"
        : liveSeverity === "mild"
          ? "Stay ahead"
          : "Symptom support";

  // -- Early returns (all hooks declared above) --
  if (status === "resolved" || status === "expired" || status === "dismissed") {
    return null;
  }

  // Steady state: calm maintenance card
  if (liveSeverity === "steady") {
    const isEscalated = status === "escalated";
    const accentColor = isEscalated ? warning : SUCCESS_FG;
    const steadyTitle = isEscalated
      ? "Latest check-in looks better"
      : "Your symptoms look steady";
    const steadyBody = isEscalated
      ? "Your symptoms have eased since the review request. Your care team can still see today's symptoms and support history."
      : "Keep hydration, protein and routine consistent. Viva will adjust support if symptoms change.";
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.supportPill}>
          <Feather
            name="check-circle"
            size={11}
            color={accentColor}
            style={{ marginRight: 4 }}
          />
          <Text style={[styles.supportPillText, { color: accentColor }]}>
            {isEscalated ? "Review requested" : "Stable today"}
          </Text>
        </View>
        <Text style={[styles.cardTitle, { color: navy }]}>{steadyTitle}</Text>
        <Text style={[styles.sectionBody, { color: mutedForeground }]}>
          {steadyBody}
        </Text>
      </Animated.View>
    );
  }

  const cardTitle = buildInsightTitle(livePlan, liveSeverity, intervention.triggerType);

  // == Better: quiet resolved state ==
  if (phase === "better") {
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.resolvedContainer}>
          <Feather name="check-circle" size={20} color={SUCCESS_FG} />
          <Text style={[styles.sectionBody, { textAlign: "center", color: navy }]}>
            Support completed.{"\n"}We'll keep monitoring.
          </Text>
        </View>
      </Animated.View>
    );
  }

  // == Feedback phase: swipe card ==
  if (phase === "feedback") {
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <Text style={[styles.feedbackPrompt, { color: navy }]}>
          How are you feeling now?
        </Text>
        <Text
          style={[
            styles.sectionLabel,
            { textAlign: "center", color: mutedForeground, marginBottom: 8 },
          ]}
        >
          SWIPE TO RESPOND
        </Text>
        <View style={styles.swipeArea} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.swipeCard,
              {
                backgroundColor: swipeCardBg as any,
                transform: [{ translateX: swipeX }],
              },
            ]}
          >
            <Feather name="move" size={16} color={CARD_MUTED} />
            <Text
              style={[
                styles.sectionBody,
                { textAlign: "center", fontSize: 12, color: mutedForeground },
              ]}
            >
              {"← Still struggling   Improving →"}
            </Text>
          </Animated.View>
        </View>
        <View style={styles.feedbackBtnRow}>
          <Pressable
            style={styles.feedbackBtn}
            onPress={() => handleSwipeLeft()}
            accessibilityRole="button"
            accessibilityLabel="Still struggling"
          >
            <Feather name="frown" size={14} color={CARD_MUTED} />
            <Text style={[styles.sectionBody, { fontSize: 13, color: navy }]}>
              Still struggling
            </Text>
          </Pressable>
          <Pressable
            style={[styles.feedbackBtn, styles.feedbackBtnImproving]}
            onPress={() => { void handleSwipeRight(); }}
            accessibilityRole="button"
            accessibilityLabel="Improving"
          >
            <Feather name="smile" size={14} color={SUCCESS_FG} />
            <Text
              style={[styles.sectionBody, { fontSize: 13, color: SUCCESS_FG }]}
            >
              Improving
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  // == Struggling phase: adjusted recommendation ==
  if (phase === "struggling") {
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.supportPill}>
          <Text style={styles.supportPillText}>{pillLabel}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: navy }]}>
          Let's try something adjusted
        </Text>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ADJUSTED RECOMMENDATION</Text>
          <Text style={[styles.sectionBody, { color: navy }]}>
            {alternateContent.body}
          </Text>
        </View>
        {alternateContent.helper.trim().length > 0 && (
          <>
            <View style={styles.divider} />
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>WHY IT HELPS</Text>
              <Text style={[styles.sectionBody, { color: navy }]}>
                {alternateContent.helper}
              </Text>
            </View>
          </>
        )}
        <View style={styles.divider} />
        <Text style={[styles.guardrail, { color: mutedForeground }]}>
          Viva supports between-visit care. If symptoms feel severe or urgent,
          contact your care team or seek medical help.
        </Text>
        {(offerEscalationInStruggling || liveSeverity === "severe") && status !== "escalated" && (
          <Pressable
            style={styles.careTeamBtn}
            onPress={() => void handleAskCareTeam()}
            accessibilityRole="button"
            accessibilityLabel="Ask my care team to review"
          >
            <Feather name="message-circle" size={13} color={CARD_MUTED} />
            <Text style={styles.careTeamBtnText}>Ask my care team</Text>
          </Pressable>
        )}
        {status === "escalated" && (
          <View style={styles.resolvedContainer}>
            <Feather name="check-circle" size={14} color={warning} />
            <Text style={[styles.sectionBody, { color: warning, fontSize: 12 }]}>
              Review requested. Your care team can see today's symptoms.
            </Text>
          </View>
        )}
      </Animated.View>
    );
  }

  // == Checking phase ==
  if (phase === "checking") {
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.supportPill}>
          <Text style={styles.supportPillText}>{pillLabel}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: navy }]}>{cardTitle}</Text>
        <View style={styles.checkingContainer}>
          <Feather name="clock" size={20} color={CARD_MUTED} />
          <Text
            style={[
              styles.sectionBody,
              { textAlign: "center", color: mutedForeground },
            ]}
          >
            Support is active.{"\n"}Try the step above, then let us know.
          </Text>
          <Pressable
            onPress={() => setEngagedPhase("feedback")}
            accessibilityRole="button"
          >
            <Text style={styles.checkNowLink}>I'm ready to check in →</Text>
          </Pressable>
        </View>
        <Text style={[styles.guardrail, { color: mutedForeground }]}>
          Viva supports between-visit care. If symptoms feel severe or urgent,
          contact your care team or seek medical help.
        </Text>
      </Animated.View>
    );
  }

  // == Default phase ==
  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      {/* Pill */}
      <View style={styles.supportPill}>
        <Text style={styles.supportPillText}>{pillLabel}</Text>
      </View>

      {/* Title — specific clinical headline */}
      <Text style={[styles.cardTitle, { color: navy }]}>{cardTitle}</Text>

      {/* Subtitle — one short supporting sentence */}
      {primaryContent.helper.trim().length > 0 && (
        <Text style={styles.cardSubtitle} numberOfLines={2}>
          {primaryContent.helper}
        </Text>
      )}

      {/* Hero action panel — blue-ice surface, prominent */}
      <View style={styles.heroPanel}>
        <View style={styles.heroPanelHeader}>
          <Feather
            name={categoryIcon(intervention.recommendationCategory)}
            size={13}
            color="#6B8AB5"
          />
          <Text style={styles.heroPanelLabel}>Recommended now</Text>
        </View>
        <Text style={[styles.heroBody, { color: navy }]} numberOfLines={3}>
          {primaryContent.body}
        </Text>
      </View>

      {/* Context chips — compact signal row */}
      {contextChips.length > 0 && (
        <View style={styles.chipsSection}>
          <Text style={styles.chipsSectionLabel}>WHAT VIVA NOTICED</Text>
          <View style={styles.chipsRow}>
            {contextChips.map((chip) => (
              <View key={chip} style={styles.contextChip}>
                <Text style={styles.contextChipText}>{chip}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Primary CTA */}
      <Pressable
        style={({ pressed }) => [
          styles.primaryBtn,
          { opacity: pressed ? 0.82 : 1 },
        ]}
        onPress={() => void handleCommit()}
        accessibilityRole="button"
        accessibilityLabel="Start support"
      >
        <Text style={styles.primaryBtnText}>Start support</Text>
      </Pressable>

      {/* Care team — underline link only, very secondary */}
      {(offerEscalationInStruggling || liveSeverity === "severe") && status !== "escalated" && (
        <Pressable
          style={styles.careTeamLink}
          onPress={() => void handleAskCareTeam()}
          accessibilityRole="button"
          accessibilityLabel="Ask my care team to review"
        >
          <Text style={styles.careTeamLinkText}>Ask my care team</Text>
        </Pressable>
      )}

      {status === "escalated" && (
        <View style={styles.escalatedNotice}>
          <Feather name="check-circle" size={12} color={warning} />
          <Text style={[styles.escalatedNoticeText, { color: warning }]}>
            Review requested — your care team has been notified.
          </Text>
        </View>
      )}

      {/* Guardrail */}
      <Text style={[styles.guardrail, { color: mutedForeground }]}>
        Viva supports between-visit care. If symptoms feel severe or urgent,
        contact your care team or seek medical help.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    borderTopWidth: 2,
    borderTopColor: "rgba(61,124,201,0.30)",
    ...Platform.select({
      web: {
        boxShadow: "0 2px 12px rgba(26, 46, 74, 0.07)",
      },
      default: {
        shadowColor: "#1A2E4A",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 12,
        elevation: 3,
      },
    }),
  },
  supportPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(31,79,138,0.07)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  supportPillText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.2,
    color: CARD_MUTED,
  },
  cardTitle: {
    fontSize: 22,
    fontFamily: "Montserrat_700Bold",
    lineHeight: 29,
    color: CARD_TEXT,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
    color: CARD_MUTED,
    marginBottom: 14,
  },
  // Hero action panel — very light tinted surface, integrated feel
  heroPanel: {
    backgroundColor: "rgba(61,124,201,0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    marginBottom: 14,
  },
  heroPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  heroPanelLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#6B8AB5",
  },
  heroBody: {
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 22,
    color: CARD_TEXT,
  },
  // Context chips row
  chipsSection: {
    gap: 6,
    marginBottom: 2,
  },
  chipsSectionLabel: {
    fontSize: 9,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.7,
    color: "#9BAABF",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  contextChip: {
    backgroundColor: "rgba(107,127,163,0.09)",
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  contextChipText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
    color: CARD_MUTED,
    letterSpacing: 0.05,
  },
  // Legacy kept for supporting text in other phases
  supportSection: {
    gap: 4,
    marginTop: 16,
  },
  supportMicroLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: 0.1,
    color: "#9BAABF",
  },
  supportBody: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
    color: CARD_MUTED,
  },
  // Legacy shared section styles (used by struggling/feedback phases)
  section: {
    gap: 5,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: CARD_MUTED,
  },
  sectionBody: {
    fontSize: 14,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 21,
    color: CARD_TEXT,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E8EEF5",
    marginVertical: 16,
  },
  primaryBtn: {
    backgroundColor: CARD_TEXT,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 18,
    ...Platform.select({
      web: {
        boxShadow: "0 3px 8px rgba(20, 34, 64, 0.18)",
      },
      default: {
        shadowColor: "#142240",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 7,
        elevation: 3,
      },
    }),
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: 0.2,
  },
  // Escalation — minimal underline text link only
  careTeamLink: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingVertical: 4,
  },
  careTeamLinkText: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    color: CARD_MUTED,
    textDecorationLine: "underline",
  },
  escalatedNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 12,
  },
  escalatedNoticeText: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
    color: CARD_MUTED,
    flexShrink: 1,
  },
  // Legacy — still used in struggling/checking phases
  careTeamBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
  },
  careTeamBtnText: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    color: CARD_MUTED,
  },
  checkingContainer: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  checkNowLink: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    color: "#1F4F8A",
    textDecorationLine: "underline",
  },
  feedbackPrompt: {
    fontSize: 17,
    fontFamily: "Montserrat_700Bold",
    textAlign: "center",
    color: CARD_TEXT,
    marginBottom: 4,
  },
  swipeArea: {
    position: "relative",
    height: 100,
    justifyContent: "center",
    overflow: "hidden",
    marginVertical: 8,
  },
  swipeCard: {
    position: "absolute",
    left: "15%" as any,
    right: "15%" as any,
    borderRadius: 14,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDE5F0",
    alignItems: "center",
    gap: 6,
  },
  feedbackBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  feedbackBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D5DEEA",
    alignItems: "center",
    backgroundColor: "#F5F8FC",
    gap: 6,
    flexDirection: "row",
    justifyContent: "center",
  },
  feedbackBtnImproving: {
    backgroundColor: SUCCESS_FG + "0F",
    borderColor: SUCCESS_FG + "30",
  },
  resolvedContainer: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "center",
  },
  guardrail: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    color: CARD_MUTED,
    marginTop: 12,
    fontStyle: "italic",
    opacity: 0.65,
  },
});

