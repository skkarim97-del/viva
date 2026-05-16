// Today-tab card surfaced inside the floating bottom sheet (index.tsx).
//
// Interaction phases:
//   default     -> "Start support" CTA
//   checking    -> support in progress + "Check in now"
//   feedback    -> "Still struggling" / "Helped" two-button response
//   struggling  -> round 1: adjusted step + "Try adjusted support"
//                  round 2+: care-team escalation as primary action
//   better      -> quiet resolved state (auto-closes sheet after 1.5 s)
//
// Intelligence inputs (no LLM, no medical advice generated):
//   - liveCheckin: today's check-in drives severity tier and copy
//   - doseContext: post-dose window signals a "Around dose timing" chip
//   - patientContext: shared PatientIntelligenceContext — supplies
//     planPriority, reasonSignals, and the "Why Viva suggested this"
//     learning copy line. No PHI is logged; only structured tags.
//
// Server contract:
//   - onAccept fires ONCE (shown → pending_feedback). Best-effort.
//   - onFeedback("worse") is the single escalation signal.
//   - All network calls are best-effort; errors leave the card in its
//     current state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import { buildInterventionWhyLine } from "@/lib/intelligence/learningCopy";
import type { PatientIntelligenceContext } from "@/lib/intelligence/patientContext";
import {
  selectIntervention,
  buildLibraryContext,
  categoryToSymptomTarget,
  liveSeverityToTier,
} from "@/lib/interventions/selector";
import type { StrategyType, SelectionResult } from "@/lib/interventions/types";
import {
  deriveWeights,
  recordOutcome,
  type DerivedWeights,
} from "@/lib/interventions/history";

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
        // Primary: fluids first \u2192 then 2-3 bites
        title: "Sip first, then try 2\u20133 bites",
        body: "Take 5 slow sips of water or ginger tea right now. Wait 10 minutes. Then try 2\u20133 bites of Greek yogurt, crackers, toast, or a banana.",
        helper:
          "Fluids settle the stomach first; small bland bites after are easier to tolerate than eating into active nausea.",
      },
      {
        // Alternate (adjusted step): pivot to fresh air + repositioning
        title: "Step outside for 3 minutes",
        body: "Go near fresh air or open a window. Sit upright and breathe slowly for 3 minutes. Then take 3\u20134 slow sips of water or ginger tea.",
        helper:
          "Fresh air and an upright position can ease nausea quickly before you try any food or drink.",
      },
      {
        // Variant 3: pause food, timed sip protocol
        title: "Pause food, sip every 2 minutes",
        body: "Stop solid food for 15 minutes. Sip water, Pedialyte, or peppermint tea, a few sips every 2\u20133 minutes. After 15 minutes, try one bite of toast or a cracker.",
        helper:
          "Timed small sips are easier to keep down than a full glass when nausea is active.",
      },
      {
        // Variant 4: cold fluids change
        title: "Try cold or chilled fluids",
        body: "Try ice chips or a chilled electrolyte drink like Pedialyte or LMNT. Take 3\u20134 sips every 5 minutes for 20 minutes.",
        helper:
          "Cold, plain fluids are often gentler when warm drinks or food are making nausea feel worse.",
      },
    ],
  },
  appetite: {
    variants: [
      {
        // Primary: micro-portion protein
        title: "2\u20133 bites of protein, then pause",
        body: "Eat 2\u20133 bites of Greek yogurt, tofu, eggs, or cottage cheese right now. Stop there. Wait 10 minutes, then check how your stomach feels before eating more.",
        helper:
          "Micro-portions keep nutrition coming in without overwhelming a low appetite.",
      },
      {
        // Alternate (adjusted step): pivot to liquid nutrition
        title: "Sip a smoothie instead of eating",
        body: "Make or order a simple smoothie with protein: Greek yogurt, cottage cheese, or protein powder. Sip it slowly over 10\u201315 minutes.",
        helper:
          "Liquid protein is easier to take in when chewing or strong flavors feel like too much.",
      },
      {
        // Variant 3: bland starch + protein
        title: "Crackers or toast with protein",
        body: "Try 3\u20134 crackers or a slice of toast with a small amount of Greek yogurt or soft tofu. Pause 10 minutes before deciding if you want more.",
        helper:
          "Bland starch paired with a small protein often goes down easier than a full meal when appetite is low.",
      },
      {
        // Variant 4: ultra-slow timed pacing
        title: "One bite every 5 minutes",
        body: "Set a 20-minute timer. Every 5 minutes, eat one small bite of a familiar food: Greek yogurt, banana, crackers, or soup. Stop when the timer runs out.",
        helper:
          "Ultra-slow pacing takes pressure off the stomach and often leads to more total intake than forcing a full meal.",
      },
    ],
  },
  energy: {
    variants: [
      {
        // Primary: hydrate + short movement
        title: "Drink water, then take a 3-minute walk",
        body: "Drink 8 oz of water or an electrolyte drink (Pedialyte, LMNT, or water with a pinch of salt) right now. Then take a slow 3-minute walk around the room or outside.",
        helper:
          "Even mild dehydration intensifies fatigue. A short walk after fluids often shifts energy noticeably.",
      },
      {
        // Alternate (adjusted step): pivot to environment reset + one task
        title: "Sit near bright light for 5 minutes",
        body: "Move near a window or bright light. Sit upright for 5 minutes. Then pick one small, low-effort task and do just that one thing.",
        helper:
          "Natural or bright light can reset alertness quickly without requiring physical movement.",
      },
      {
        // Variant 3: intentional rest
        title: "10-minute low-stimulation reset",
        body: "Sit or lie down in a quiet spot for 10 minutes. No phone. Breathe slowly. Then reassess whether energy feels steadier before deciding what to do next.",
        helper:
          "A short intentional rest often restores more energy than pushing through on low reserves.",
      },
      {
        // Variant 4: protein + carb refuel
        title: "Refuel with protein and a carb",
        body: "Eat a small protein-and-carb combo right now: Greek yogurt with a banana, eggs on toast, or soup with tofu. Rest for 10 minutes after.",
        helper:
          "Protein paired with a carb stabilizes blood sugar more reliably than either one alone.",
      },
    ],
  },
  constipation: {
    variants: [
      {
        // Primary: warm fluids + 5-min walk
        title: "Warm drink, then a 5-minute walk",
        body: "Drink 6\u20138 oz of warm water, ginger tea, or peppermint tea right now. Then take a slow 5-minute walk around the room or outside.",
        helper:
          "Warm fluids relax the gut; even light movement stimulates digestion in a way rest doesn\u2019t.",
      },
      {
        // Alternate (adjusted step): pivot to breathing + posture
        title: "2 minutes of slow abdominal breathing",
        body: "Sit upright. Breathe in slowly for 4 counts, then out for 6 counts. Repeat for 2 minutes. Follow with a slow 5-minute walk and 8 oz of water.",
        helper:
          "Deep abdominal breathing can stimulate bowel movement by activating the parasympathetic system.",
      },
      {
        // Variant 3: hydration + upright posture
        title: "8 oz of warm water, stay upright for 10 minutes",
        body: "Drink 8 oz of warm water right now. Stay sitting upright and avoid lying down for at least 10 minutes, then reassess discomfort.",
        helper:
          "Staying upright after fluids lets gravity support digestion and reduces discomfort.",
      },
      {
        // Variant 4: movement-first
        title: "Take a slow 5-minute walk now",
        body: "Stand up and take a slow, relaxed 5-minute walk outside or around the room. Drink 8 oz of water before or after.",
        helper:
          "Movement is one of the most reliable short-term tools for stimulating a sluggish digestive system.",
      },
    ],
  },
  hydration: {
    variants: [
      {
        // Primary: timed sip protocol
        title: "4\u20135 sips every 5 minutes for 30 minutes",
        body: "Take 4\u20135 sips of water or an electrolyte drink (Pedialyte, LMNT, or water with a pinch of salt) right now. Repeat every 5 minutes for the next 30 minutes.",
        helper:
          "Steady timed sips absorb more efficiently and are easier to keep down than drinking a large amount at once.",
      },
      {
        // Alternate (adjusted step): pivot to electrolyte type change
        title: "Switch to an electrolyte drink",
        body: "Try Pedialyte, LMNT, Liquid I.V., or water with a pinch of salt and a squeeze of lemon. Take small sips every 5 minutes.",
        helper:
          "If plain water isn\u2019t working, electrolytes give more efficient rehydration and are often easier to tolerate.",
      },
      {
        // Variant 3: warm fluids
        title: "Try warm fluids instead",
        body: "Sip warm water, ginger tea, or peppermint tea. Take a few small sips every 3\u20135 minutes for the next 20 minutes.",
        helper:
          "A temperature change often makes fluids easier to tolerate when cold water feels off.",
      },
      {
        // Variant 4: cold/ice fluids
        title: "Ice chips or chilled electrolyte drink",
        body: "Try ice chips or a chilled electrolyte drink like Pedialyte or Liquid I.V. Take small amounts every 3\u20135 minutes for 20 minutes.",
        helper:
          "Cold, small amounts are sometimes easier to tolerate when warm fluids or nausea make drinking hard.",
      },
    ],
  },
  other: {
    variants: [
      {
        // Primary: pick one action
        title: "Pick one action and do it now",
        body: "Choose ONE: take 4\u20135 sips of water, eat 2\u20133 bites of a familiar food (Greek yogurt, crackers, or a banana), or sit quietly for 5 minutes with slow breathing.",
        helper:
          "One small, completable action is more useful than trying to address everything at once.",
      },
      {
        // Alternate (adjusted step): lowest possible bar
        title: "Take one sip, then check in",
        body: "Take a single sip of water or an electrolyte drink. Wait 2 minutes. Take another sip. Repeat until you\u2019ve taken 10 sips. That\u2019s enough for now.",
        helper:
          "When everything feels like too much, the smallest possible step is the one most likely to actually happen.",
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
      title: "Pause food: sip fluids for 15 minutes",
      body:
        "Stop solid food for now. Take slow sips of water, Pedialyte, or ginger tea, a few sips every 2 minutes, for the next 15 minutes. If nausea eases, try 2\u20133 bites of crackers, toast, or a banana.",
      helper:
        "If nausea is getting worse or you can\u2019t keep fluids down, contact your care team.",
    };
  }
  if (level === "moderate") {
    return withLowAppetite
      ? {
          title: "Sip first, then try 2\u20133 bites of protein",
          body: "Take 5 slow sips of water or ginger tea now. Wait 10 minutes. Then try 2\u20133 bites of Greek yogurt, tofu, or cottage cheese.",
          helper:
            "Fluids settle the stomach first; small protein bites after are easier to keep down than eating into active nausea.",
        }
      : {
          title: "Sip first, then 2\u20133 small bites",
          body: "Take 5 slow sips of water or ginger tea now. Wait 10 minutes. Then try 2\u20133 bites of crackers, toast, Greek yogurt, or a banana.",
          helper:
            "Letting fluids settle first gives the stomach time to calm before food arrives.",
        };
  }
  return {
    title: "Keep it small and spaced",
    body: "Take 3\u20134 slow sips of water now. Wait 5 minutes, then try 2\u20133 small bites of crackers or toast. Repeat every 15 minutes if you need more.",
    helper: "Small, spaced bites prevent mild nausea from building into something harder to manage.",
  };
}

function appetiteCopy(hasNausea: boolean): RecContent {
  if (hasNausea) {
    return {
      title: "Try 2\u20133 bites of bland food",
      body:
        "Eat 2\u20133 bites of crackers, toast, rice, or a banana right now. Wait 10 minutes before trying anything else. Skip greasy or strongly flavored foods for now.",
      helper:
        "When nausea and low appetite overlap, the smallest bland portion keeps nutrition coming in without making nausea worse.",
    };
  }
  return {
    title: "2\u20133 bites of protein, then pause",
    body:
      "Eat 2\u20133 bites of Greek yogurt, tofu, eggs, or cottage cheese right now. Stop there. Wait 10 minutes, then check how your stomach feels before eating more.",
    helper:
      "Micro-portions of protein keep nutrition coming in without overwhelming a low appetite.",
  };
}

function constipationCopy(): RecContent {
  return {
    title: "Warm drink, then a 5-minute walk",
    body:
      "Drink 6\u20138 oz of warm water, ginger tea, or peppermint tea right now. Then take a slow 5-minute walk around the room or outside.",
    helper:
      "Warm fluids relax the gut; even light movement stimulates digestion in a way rest doesn\u2019t.",
  };
}

function bloatingCopy(): RecContent {
  return {
    title: "Take a 5-minute walk now",
    body:
      "Stand up and take a slow 5-minute walk around the room or outside right now. Avoid carbonated drinks and heavily seasoned food for the next few hours.",
    helper:
      "Gentle movement releases trapped gas more effectively than rest does.",
  };
}

function diarrheaCopy(): RecContent {
  return {
    title: "Small sips every 5 minutes for 30 minutes",
    body:
      "Take 4\u20135 slow sips of water or an electrolyte drink (Pedialyte, LMNT, or Liquid I.V.) every 5 minutes for the next 30 minutes. Stick to bland foods: rice, toast, or bananas.",
    helper:
      "Steady sips replace fluids without overwhelming the gut; bland foods reduce irritation.",
  };
}

function energyCopy(level: "tired" | "depleted"): RecContent {
  if (level === "depleted") {
    return {
      title: "Fluids first, then a small refuel",
      body:
        "Drink 8 oz of water or an electrolyte drink (Pedialyte, LMNT, or water with a pinch of salt) right now. Sit or lie down for 10 minutes. Then try a small protein-and-carb snack: Greek yogurt with a banana, eggs on toast, or soup with tofu.",
      helper:
        "Low hydration amplifies fatigue. Fluids first helps the refuel land better.",
    };
  }
  return {
    title: "Drink water, then take a 3-minute walk",
    body:
      "Drink 8 oz of water now. Then take a slow 3-minute walk around the room or outside. Come back and check if energy feels steadier.",
    helper:
      "Even a very short walk after fluids often shifts tired energy more than rest does.",
  };
}

function hydrationCopy(): RecContent {
  return {
    title: "4\u20135 sips every 5 minutes for 30 minutes",
    body:
      "Take 4\u20135 sips of water or an electrolyte drink (Pedialyte, LMNT, or water with a pinch of salt) right now. Repeat every 5 minutes for the next 30 minutes.",
    helper:
      "Steady timed sips absorb more efficiently and are easier to keep down than drinking a large amount at once.",
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
    parts.push(a7 >= 3 ? "appetite is very low, lower for most of this week" : "appetite is very low today");
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
  // Shared patient intelligence context. When provided, enriches the
  // "Why Viva suggested this" section and analytics payloads with
  // structured reason signals and plan priority.
  patientContext?: PatientIntelligenceContext | null;
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
  // How many times the patient has indicated they are still struggling.
  // Persisted in the parent across sheet open/close cycles.
  // 0 = haven't tried yet  1 = first step tried + still struggling
  // 2+ = both steps tried  → escalation surfaces as primary action
  initialStruggleCount?: number;
  onStruggleCountChange?: (count: number) => void;

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

function safeLog(name: string, payload?: Record<string, unknown>): void {
  try {
    void logEvent(name, payload);
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
  patientContext = null,
  onEngaged,
  initialPhase,
  onPhaseChange,
  onDone,
  initialStruggleCount,
  onStruggleCountChange,
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
  const [struggleCount, setStruggleCount] = useState(initialStruggleCount ?? 0);
  // Adaptive intervention layer — tracks which strategies have been tried
  // in this session so the selector can rotate to a meaningfully different
  // approach on the adjusted step instead of cycling within the same category.
  const [failedStrategyTypes, setFailedStrategyTypes] = useState<StrategyType[]>([]);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  // Cross-session history weights loaded from AsyncStorage on mount.
  // Null while loading; defaults to empty weights so the card renders
  // immediately without waiting for storage.
  const [historyWeights, setHistoryWeights] = useState<DerivedWeights | null>(null);
  useEffect(() => {
    void deriveWeights().then(setHistoryWeights).catch(() => {/* best-effort */});
  }, []);

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

  // Slow pulse on the clock icon while support is in progress
  const clockPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== "checking") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(clockPulse, {
          toValue: 0.3,
          duration: 900,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(clockPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, clockPulse]);

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

  // Convenience: structured tags for analytics payloads. No PHI.
  const reasonSignals = patientContext?.reasonSignals ?? [];
  const planPriority = patientContext?.planPriority ?? null;

  // Backend call guards
  const acceptFiredRef = useRef(false);
  const escalateFiredRef = useRef(false);
  const viewLoggedRef = useRef<number | null>(null);

  useEffect(() => {
    if (viewLoggedRef.current === intervention.id) return;
    viewLoggedRef.current = intervention.id;
    safeLog("intervention_viewed", {
      interventionId: intervention.id,
      triggerType: intervention.triggerType,
      severityTier: liveSeverity,
      symptomTarget: intervention.recommendationCategory ?? null,
      planPriority,
      reason_signals: reasonSignals,
    });
  }, [intervention.id, intervention.triggerType, intervention.recommendationCategory, liveSeverity]);

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

  // Adaptive selection — compute initial + adjusted in one pass so the
  // adjusted result can guarantee it differs from the initial strategy.
  const selections = useMemo<{
    initial: SelectionResult;
    adjusted: SelectionResult;
  } | null>(() => {
    if (!primary || !liveSeverity || liveSeverity === "steady") return null;
    const symptomTarget = categoryToSymptomTarget(primary.category);
    const severityTier = liveSeverityToTier(liveSeverity);
    const mergedFailedStrategies = [
      ...failedStrategyTypes,
      ...(historyWeights?.failedStrategyTypes ?? []).filter(
        (s) => !failedStrategyTypes.includes(s),
      ),
    ];
    const ctx = buildLibraryContext({
      primarySymptom: symptomTarget,
      severityTier,
      hasSevereNausea: liveCheckin?.nausea === "severe",
      hasLowAppetite:
        liveCheckin?.appetite === "low" || liveCheckin?.appetite === "very_low",
      hasVeryLowAppetite: liveCheckin?.appetite === "very_low",
      hydrationLow:
        liveCheckin?.appetite === "very_low" ||
        (wearableContext?.steps != null && wearableContext.steps < 2000),
      lowSleep:
        wearableContext?.sleepHours != null && wearableContext.sleepHours < 6,
      lowHrv: false,
      postDose:
        doseContext?.position === "dose_day" ||
        doseContext?.position === "day_1_post" ||
        doseContext?.position === "day_2_post",
      interventionId: intervention.id,
      lastEntryId,
      failedStrategyTypes: mergedFailedStrategies,
      successfulStrategyTypes: historyWeights?.successfulStrategyTypes ?? [],
      doseTier: patientContext?.medication.doseTier ?? null,
      recentDoseChange: patientContext?.medication.doseChangedRecently ?? false,
      priorFailureCount7d: historyWeights?.priorFailureCount7d ?? 0,
      priorWorseCount7d: historyWeights?.priorWorseCount7d ?? 0,
    });
    const initial = selectIntervention(ctx, "initial");
    // For adjusted: suppress the initial strategy and mark initial entry as last
    const adjustedCtx = {
      ...ctx,
      lastEntryId: initial.entry.id,
      failedStrategyTypes: [
        ...failedStrategyTypes,
        initial.entry.strategyType,
      ],
    };
    const adjusted = selectIntervention(adjustedCtx, "adjusted");
    return { initial, adjusted };
  }, [
    primary,
    liveSeverity,
    liveCheckin,
    intervention.id,
    doseContext,
    lastEntryId,
    failedStrategyTypes,
    patientContext?.medication.doseTier,
    patientContext?.medication.doseChangedRecently,
    wearableContext,
    historyWeights,
  ]);

  const primaryContent = useMemo<RecContent>(() => {
    // Library selection wins when available — richer metadata and strategy-aware
    if (selections) return selections.initial.entry.copy;
    // No live plan + no library selection → fall back to server recommendation
    if (!primary) {
      return {
        title: buildInsightTitle(livePlan, liveSeverity, intervention.triggerType),
        body: intervention.recommendation,
        helper: "",
      };
    }
    // Live override from deriveLivePlan (covers the multi-row display path)
    const override = liveOverrides[primary.key];
    if (override) return override;
    const picked = pickVariants(primary.category, intervention.id);
    if (primary.category === "other") {
      return { ...picked.primary, body: primary.section.body || picked.primary.body };
    }
    return picked.primary;
  }, [
    selections,
    primary,
    liveOverrides,
    intervention.id,
    intervention.recommendation,
    livePlan,
    liveSeverity,
    intervention.triggerType,
  ]);

  const alternateContent = useMemo<RecContent>(() => {
    // Adjusted library selection → cross-strategy (different strategyType)
    if (selections) return selections.adjusted.entry.copy;
    if (!primary) return primaryContent;
    const picked = pickVariants(primary.category, intervention.id);
    return picked.alternate;
  }, [selections, primary, primaryContent, intervention.id]);

  const contextParagraph = useMemo(
    () => buildContextParagraph(liveCheckin, doseContext, symptomCounts, wearableContext),
    [liveCheckin, doseContext, symptomCounts, wearableContext],
  );

  const contextChips = useMemo(
    () => buildContextChips(liveCheckin, doseContext, symptomCounts),
    [liveCheckin, doseContext, symptomCounts],
  );

  const interventionWhyLine = useMemo(
    () => (patientContext ? buildInterventionWhyLine(patientContext) : null),
    [patientContext],
  );

  // Swipe card background interpolates: orange (left) → white (center) → green (right)
  // Handlers
  const handleCommit = useCallback(async () => {
    tap();
    setEngagedPhase("checking");
    safeLog("intervention_started", {
      strategyType: selections?.initial.entry.strategyType ?? null,
      symptomTarget: primary?.category ?? null,
      severityTier: liveSeverity,
      wasInitialOrAdjusted: "initial",
      interventionEntryId: selections?.initial.entry.id ?? null,
      planPriority,
      reason_signals: reasonSignals,
    });
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
    safeLog("intervention_escalated", {
      strategyType: selections?.initial.entry.strategyType ?? null,
      failedStrategyTypes: failedStrategyTypes,
      severityTier: liveSeverity,
      symptomTarget: primary?.category ?? null,
      phase,
      struggleCount,
      planPriority,
      reason_signals: reasonSignals,
    });
    // Record "worse" for the active strategy so future sessions can escalate earlier
    const activeStrategy =
      failedStrategyTypes.length > 0
        ? selections?.adjusted.entry.strategyType
        : selections?.initial.entry.strategyType;
    if (activeStrategy && primary?.category) {
      void recordOutcome(
        activeStrategy,
        categoryToSymptomTarget(primary.category),
        "worse",
      );
    }
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
  }, [intervention.id, intervention.status, onAccept, onFeedback, failedStrategyTypes, selections, primary, liveSeverity, phase, struggleCount, planPriority, reasonSignals]);

  const handleFeedbackBetter = useCallback(async () => {
    tap();
    setEngagedPhase("better");
    const resolvedStrategy =
      failedStrategyTypes.length > 0
        ? selections?.adjusted.entry.strategyType ?? null
        : selections?.initial.entry.strategyType ?? null;
    const resolvedTarget = primary?.category ?? null;
    safeLog("intervention_helped", {
      strategyType: resolvedStrategy,
      wasInitialOrAdjusted: failedStrategyTypes.length > 0 ? "adjusted" : "initial",
      severityTier: liveSeverity,
      symptomTarget: resolvedTarget,
      struggleCount,
      planPriority,
      reason_signals: reasonSignals,
    });
    if (resolvedStrategy && resolvedTarget) {
      void recordOutcome(
        resolvedStrategy,
        categoryToSymptomTarget(resolvedTarget),
        "better",
      );
    }
    try {
      await onFeedback(intervention.id, "better");
    } catch {
      /* best-effort */
    }
  }, [intervention.id, onFeedback, setEngagedPhase, failedStrategyTypes, selections, primary, liveSeverity, struggleCount, planPriority, reasonSignals]);

  const handleFeedbackStruggling = useCallback(() => {
    tap();
    const newCount = struggleCount + 1;
    setStruggleCount(newCount);
    onStruggleCountChange?.(newCount);
    setEngagedPhase("struggling");
    // Record the strategy that failed so adjusted selection avoids it
    if (selections?.initial) {
      const failedStrategy = selections.initial.entry.strategyType;
      setFailedStrategyTypes((prev) =>
        prev.includes(failedStrategy) ? prev : [...prev, failedStrategy],
      );
      setLastEntryId(selections.initial.entry.id);
      const symptomTarget = primary?.category
        ? categoryToSymptomTarget(primary.category)
        : null;
      if (symptomTarget) {
        void recordOutcome(failedStrategy, symptomTarget, "same");
      }
    }
    safeLog("intervention_still_struggling", {
      strategyType: selections?.initial.entry.strategyType ?? null,
      symptomTarget: primary?.category ?? null,
      severityTier: liveSeverity,
      struggleRound: newCount,
      planPriority,
      reason_signals: reasonSignals,
    });
  }, [setEngagedPhase, struggleCount, onStruggleCountChange, selections, primary, liveSeverity, planPriority, reasonSignals]);

  // Sends the patient into a second checking loop with the alternate step.
  const handleTryAdjusted = useCallback(() => {
    tap();
    safeLog("intervention_adjusted_started", {
      adjustedStrategyType: selections?.adjusted.entry.strategyType ?? null,
      failedStrategyType: selections?.initial.entry.strategyType ?? null,
      wasInitialOrAdjusted: "adjusted",
      severityTier: liveSeverity,
    });
    setEngagedPhase("checking");
  }, [setEngagedPhase]);

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

  // == Feedback phase: two-button response ==
  if (phase === "feedback") {
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <Text style={[styles.feedbackPrompt, { color: navy }]}>
          How are you feeling now?
        </Text>
        <Text style={[styles.feedbackSub, { color: mutedForeground }]}>
          Let us know and we'll adapt your support.
        </Text>
        <View style={styles.feedbackBtnRow}>
          <Pressable
            style={({ pressed }) => [styles.feedbackBtnStruggling, { opacity: pressed ? 0.8 : 1 }]}
            onPress={handleFeedbackStruggling}
            accessibilityRole="button"
            accessibilityLabel="Still struggling"
          >
            <Feather name="refresh-cw" size={14} color="#B45309" />
            <Text style={[styles.feedbackBtnText, { color: "#B45309" }]}>Still struggling</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.feedbackBtnHelped, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => void handleFeedbackBetter()}
            accessibilityRole="button"
            accessibilityLabel="Helped"
          >
            <Feather name="check" size={14} color="#166534" />
            <Text style={[styles.feedbackBtnText, { color: "#166534" }]}>Helped</Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  // == Struggling phase ==
  // Round 1 (struggleCount === 1): adjusted step + "Try adjusted support"
  // Round 2+ (struggleCount >= 2): care-team escalation as the primary action
  if (phase === "struggling") {
    const isEscalationRound = struggleCount >= 2;
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.supportPill}>
          <Text style={styles.supportPillText}>{pillLabel}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: navy }]}>
          {isEscalationRound ? "Let's get you more support" : "Let's try something adjusted"}
        </Text>

        {!isEscalationRound && (
          <Text style={styles.adaptiveHint}>
            {selections?.adjusted.explainWhy ??
              "Adjusting your support based on your feedback."}
          </Text>
        )}

        {!isEscalationRound ? (
          <>
            <View style={styles.heroPanel}>
              <View style={styles.heroPanelHeader}>
                <Feather name="refresh-cw" size={11} color="#6B8AB5" />
                <Text style={styles.heroPanelLabel}>Adjusted step</Text>
              </View>
              <Text style={[styles.heroBody, { color: navy }]}>
                {alternateContent.body}
              </Text>
            </View>
            {alternateContent.helper.trim().length > 0 && (
              <Text style={styles.cardSubtitle}>{alternateContent.helper}</Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.82 : 1 }]}
              onPress={handleTryAdjusted}
              accessibilityRole="button"
              accessibilityLabel="Try adjusted support"
            >
              <Text style={styles.primaryBtnText}>Try adjusted support</Text>
            </Pressable>
            {status !== "escalated" && (
              <Pressable
                style={({ pressed }) => [styles.careTeamLink, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => void handleAskCareTeam()}
                accessibilityRole="button"
                accessibilityLabel="Ask care team instead"
              >
                <Feather name="message-circle" size={12} color={warning} style={{ marginRight: 5 }} />
                <Text style={[styles.careTeamLinkText, { color: warning }]}>Or ask your care team to review</Text>
              </Pressable>
            )}
            <Text style={[styles.guardrail, { color: mutedForeground }]}>
              Viva supports between-visit care. If symptoms feel severe or urgent,
              contact your care team or seek prompt medical attention.
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.sectionBody, { color: mutedForeground, textAlign: "center" }]}>
              You've tried two steps and are still struggling. It may be time for your care team to step in.
            </Text>
            {status !== "escalated" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.careTeamEscalateBtn,
                  { backgroundColor: warning, opacity: pressed ? 0.82 : 1 },
                ]}
                onPress={() => void handleAskCareTeam()}
                accessibilityRole="button"
                accessibilityLabel="Ask my care team to review"
              >
                <Feather name="message-circle" size={15} color="#FFFFFF" />
                <Text style={styles.careTeamEscalateBtnText}>Ask my care team to review</Text>
              </Pressable>
            ) : (
              <View style={[styles.resolvedContainer, { marginTop: 12 }]}>
                <Feather name="check-circle" size={14} color={warning} />
                <Text style={[styles.sectionBody, { color: warning, fontSize: 12, flexShrink: 1 }]}>
                  Review requested. Your care team can see today's symptoms.
                </Text>
              </View>
            )}
            <Text style={[styles.guardrail, { color: mutedForeground }]}>
              Viva supports between-visit care. If symptoms feel severe or urgent,
              contact your care team or seek prompt medical attention.
            </Text>
          </>
        )}
      </Animated.View>
    );
  }

  // == Checking phase ==
  if (phase === "checking") {
    const isRound2 = struggleCount >= 1;
    return (
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.supportPill}>
          <Text style={styles.supportPillText}>{pillLabel}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: navy }]}>{cardTitle}</Text>
        {isRound2 && (
          <View style={styles.heroPanel}>
            <View style={styles.heroPanelHeader}>
              <Feather name="refresh-cw" size={11} color="#6B8AB5" />
              <Text style={styles.heroPanelLabel}>Adjusted step</Text>
            </View>
            <Text style={[styles.heroBody, { color: navy }]}>
              {alternateContent.body}
            </Text>
          </View>
        )}
        <View style={styles.checkingContainer}>
          <View style={styles.checkingStatusModule}>
            <Animated.View style={{ opacity: clockPulse }}>
              <Feather name="clock" size={15} color="#1F4F8A" />
            </Animated.View>
            <Text style={styles.checkingStatusText}>Support in progress</Text>
          </View>
          <Text style={[styles.sectionBody, { textAlign: "center", color: mutedForeground }]}>
            {isRound2
              ? "Adjusted support is active. Check back in when you're ready."
              : "Try the step above, then check back in."}
          </Text>
          <Pressable
            style={styles.checkingCheckInBtn}
            onPress={() => setEngagedPhase("feedback")}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Check in now</Text>
          </Pressable>
        </View>
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
        <Text style={styles.cardSubtitle}>
          {primaryContent.helper}
        </Text>
      )}

      {/* "Why Viva suggested this" — natural-language signal summary.
          Shows as a readable sentence so the card explains itself
          based on the patient's check-in signals. */}
      {contextChips.length > 0 && (
        <View style={styles.noticedSection}>
          <Text style={styles.chipsSectionLabel}>WHY VIVA SUGGESTED THIS</Text>
          <Text style={[styles.noticedText, { color: mutedForeground }]}>
            {contextParagraph}
          </Text>
          {interventionWhyLine && (
            <Text style={[styles.noticedStrategyHint, { color: mutedForeground }]}>
              {interventionWhyLine}
            </Text>
          )}
          {selections?.initial.explainWhy && !interventionWhyLine && (
            <Text style={[styles.noticedStrategyHint, { color: mutedForeground }]}>
              {selections.initial.explainWhy}
            </Text>
          )}
          {selections?.initial.wasSuccessfulBefore && (
            <Text style={[styles.noticedStrategyHint, { color: mutedForeground }]}>
              This type of support helped last time.
            </Text>
          )}
        </View>
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
        <Text style={[styles.heroBody, { color: navy }]}>
          {primaryContent.body}
        </Text>
      </View>

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

      {/* Secondary "Ask care team" CTA — visible for moderate/severe symptoms,
          planPriority ≤ 2 (severe/GI burden), or when history signals that
          multiple interventions have not helped (shouldEscalate). */}
      {(liveSeverity === "moderate" || liveSeverity === "severe" || (planPriority !== null && planPriority <= 2) || selections?.initial.shouldEscalate) && status !== "escalated" && (
        <Pressable
          style={({ pressed }) => [styles.careTeamSecondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => void handleAskCareTeam()}
          accessibilityRole="button"
          accessibilityLabel="Ask care team"
        >
          <Feather name="message-circle" size={12} color={warning} />
          <Text style={[styles.careTeamSecondaryBtnText, { color: warning }]}>Ask care team</Text>
        </Pressable>
      )}

      {status === "escalated" && (
        <View style={styles.escalatedNotice}>
          <Feather name="check-circle" size={12} color={warning} />
          <Text style={[styles.escalatedNoticeText, { color: warning }]}>
            Review requested. Your care team has been notified.
          </Text>
        </View>
      )}

      {/* Guardrail */}
      <Text style={[styles.guardrail, { color: mutedForeground }]}>
        Viva supports between-visit care. If symptoms feel severe or urgent,
        contact your care team or seek prompt medical attention.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 36,
    backgroundColor: "transparent",
  },
  supportPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.55)",
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
    fontSize: 23,
    fontFamily: "Montserrat_700Bold",
    lineHeight: 31,
    color: CARD_TEXT,
    marginBottom: 12,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 21,
    color: CARD_MUTED,
    marginBottom: 16,
  },
  // Hero action panel — white island on the tinted sheet, creates depth
  heroPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
    marginBottom: 20,
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
    fontSize: 16,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 24,
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
    backgroundColor: "rgba(255,255,255,0.70)",
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
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 24,
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
  // Escalation — amber underline link, secondary to navy CTA
  careTeamLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingVertical: 10,
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
  careTeamEscalateBtn: {
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
  careTeamEscalateBtnText: {
    fontSize: 14,
    fontFamily: "Montserrat_700Bold",
    color: "#FFFFFF",
    letterSpacing: 0.1,
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
    gap: 20,
    paddingTop: 28,
    paddingBottom: 8,
  },
  checkingStatusModule: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#EEF3FA",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  checkingStatusText: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    color: "#1F4F8A",
  },
  checkingCheckInBtn: {
    backgroundColor: CARD_TEXT,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: "center",
    alignSelf: "stretch",
    marginTop: 4,
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
  feedbackPrompt: {
    fontSize: 22,
    fontFamily: "Montserrat_700Bold",
    textAlign: "center",
    color: CARD_TEXT,
    marginBottom: 8,
  },
  feedbackSub: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 28,
  },
  feedbackBtnRow: {
    flexDirection: "row",
    gap: 12,
  },
  feedbackBtnStruggling: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#FFF8F0",
    borderWidth: 1,
    borderColor: "#FBD5A0",
    borderRadius: 999,
    paddingVertical: 16,
  },
  feedbackBtnHelped: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#F0FBF4",
    borderWidth: 1,
    borderColor: "#BBE5CA",
    borderRadius: 999,
    paddingVertical: 16,
  },
  feedbackBtnText: {
    fontSize: 14,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: 0.1,
  },
  resolvedContainer: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "center",
  },
  adaptiveHint: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 19,
    color: "#8B6C14",
    marginBottom: 6,
    opacity: 0.85,
  },
  guardrail: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    color: CARD_MUTED,
    marginTop: 18,
    fontStyle: "italic",
    opacity: 0.65,
  },
  explainWhy: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    color: CARD_MUTED,
    marginBottom: 8,
    fontStyle: "italic",
    opacity: 0.8,
  },
  noticedSection: {
    gap: 6,
    marginBottom: 16,
  },
  noticedText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
    color: CARD_MUTED,
  },
  noticedStrategyHint: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    color: CARD_MUTED,
    fontStyle: "italic",
    opacity: 0.75,
  },
  careTeamSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
    paddingVertical: 10,
  },
  careTeamSecondaryBtnText: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.1,
  },
});

