// Today-tab card that surfaces an AI-personalized micro-intervention.
//
// Patient-facing UX (clinical micro-protocol rework):
//   Title:    "Today's next steps"
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
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

// Enable LayoutAnimation on Android. iOS has it on by default; web is a
// no-op. We only need this once per JS runtime.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type FeedbackResult,
  type PatientIntervention,
} from "@/lib/api/interventionsClient";
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
        title: "Settle nausea without skipping nutrition",
        body: "Try 3 to 5 bites of yogurt, tofu, soup or a smoothie. Then sip water slowly for 20 to 30 minutes.",
        helper:
          "This may help nausea while keeping protein and fluids in your system.",
      },
      {
        title: "Start with slow hydration",
        body: "Sip water or an electrolyte drink slowly for 20 to 30 minutes before trying food. Small sips, not gulps.",
        helper:
          "Steady fluids first can settle the stomach before you reintroduce food.",
      },
      {
        title: "Try something even gentler",
        body: "Try crackers, ginger tea or a few bites of soup. Keep portions small and pause if nausea increases.",
        helper: "Small amounts are often easier to tolerate than a full meal.",
      },
      {
        title: "Rest briefly before eating",
        body: "Sit or lie down quietly for 5 to 10 minutes, then try a small bite of bland protein like yogurt or tofu.",
        helper: "A short rest before food can reduce the urge to skip the meal.",
      },
    ],
  },
  appetite: {
    variants: [
      {
        title: "Protect your protein intake",
        body: "Aim for a small protein serving every few hours today, even if it is only Greek yogurt, tofu, soup or a smoothie.",
        helper:
          "This can help prevent low intake from turning into low energy or missed nutrition.",
      },
      {
        title: "Keep it light today",
        body: "Aim for a small, easy-to-tolerate meal instead of forcing a full one. Consistency matters more than volume.",
        helper: "Smaller, more frequent bites are usually easier when appetite is low.",
      },
      {
        title: "Use liquid nutrition if solid food feels hard",
        body: "Try a smoothie, protein shake or soup instead of a full meal. Take it slowly over 20 to 30 minutes.",
        helper: "Liquid options can be easier when appetite is low.",
      },
      {
        title: "Pick bland, low-friction foods",
        body: "Try toast, rice, oatmeal or crackers with a small protein on the side. Skip greasy or strongly flavored foods today.",
        helper: "Bland foods are less likely to worsen nausea or appetite loss.",
      },
    ],
  },
  energy: {
    variants: [
      {
        title: "Support energy without forcing a meal",
        body: "Try a small protein plus carb option like yogurt with fruit, soup with tofu or a smoothie, then rest for 10 minutes.",
        helper: "This gives your body fuel without requiring a large meal.",
      },
      {
        title: "Take a lighter day",
        body: "Plan rest blocks today and add protein with your next meal. Save bigger tasks for tomorrow.",
        helper: "Pacing yourself helps your energy hold up across the day.",
      },
      {
        title: "Reset with fluids and a short break",
        body: "Take small sips of water, sit or lie down for 10 minutes, then try a small snack if you feel ready.",
        helper: "Low intake and dehydration can make fatigue worse.",
      },
      {
        title: "Add protein with your next meal",
        body: "Pair your next bite with a protein source like Greek yogurt, eggs, beans or a smoothie with protein powder.",
        helper: "Protein steadies energy more reliably than carbs alone.",
      },
    ],
  },
  constipation: {
    variants: [
      {
        title: "Reduce constipation risk today",
        body: "Add fiber gradually with foods like berries, chia, beans or vegetables. Keep sipping fluids and take a short walk if you can tolerate it.",
        helper: "Fiber works best when paired with fluids and movement.",
      },
      {
        title: "Keep fluids steady today",
        body: "Sip water or warm fluids over the next few hours. Warm liquids in the morning can help things move.",
        helper: "Steady hydration is one of the simplest ways to support digestion.",
      },
      {
        title: "Try a short walk if you feel up for it",
        body: "Even 5 to 10 minutes of gentle movement can help. Pair it with fluids before and after.",
        helper: "Light movement can help digestion without taxing your energy.",
      },
      {
        title: "Use a gentler bowel-support step",
        body: "Try warm fluids, a short walk or a fiber-rich snack. Avoid suddenly adding a large amount of fiber at once.",
        helper: "Gradual changes are less likely to worsen bloating.",
      },
    ],
  },
  hydration: {
    variants: [
      {
        title: "Rehydrate without upsetting your stomach",
        body: "Take a few small sips every 5 to 10 minutes for the next hour. If plain water feels hard, try an electrolyte drink or diluted beverage.",
        helper: "Small, steady sips are usually easier than drinking a lot at once.",
      },
      {
        title: "Sip steadily over the next hour or two",
        body: "Aim for small sips every 10 minutes instead of drinking a lot at once. Steady is easier than fast.",
        helper: "Steady fluids tend to absorb better and feel gentler on your stomach.",
      },
      {
        title: "Try fluids that are easier to tolerate",
        body: "Try ice chips, warm tea, diluted juice or an electrolyte drink. Keep the amount small and steady.",
        helper: "The goal is steady fluids without triggering nausea.",
      },
      {
        title: "Pair fluids with a bland snack",
        body: "A few crackers or a small piece of toast alongside slow sips of water can be gentler than fluids alone.",
        helper: "A small bland snack can settle the stomach while you rehydrate.",
      },
    ],
  },
  other: {
    variants: [
      {
        title: "Try a small step that feels manageable",
        body: "Choose one small action you can take right now -- a few sips of water, a few bites of a familiar food, or a brief rest in a quiet spot.",
        helper: "Small, low-effort steps add up across the day.",
      },
      {
        title: "Try a different small step",
        body: "Pick something even simpler -- a few sips of fluid, slow breathing for a minute, or sitting somewhere comfortable.",
        helper: "Lowering the barrier can make it easier to follow through.",
      },
    ],
  },
};

// Patient-friendly noun for each category, used in the
// "More support for today" subtitle, e.g. "2 more supports for
// appetite and digestion". Distinct from NOTICED_PHRASE which uses
// symptom-style language like "low appetite" / "nausea".
const CATEGORY_NOUN: Record<RecCategory, string> = {
  nausea: "nausea",
  appetite: "appetite",
  energy: "energy",
  constipation: "digestion",
  hydration: "hydration",
  other: "support",
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

// Plain-language fragment used to compose the "What we noticed"
// sentence. Joined with commas + "and" before the last item.
const NOTICED_PHRASE: Record<RecCategory, string> = {
  nausea: "nausea",
  appetite: "low appetite",
  energy: "low energy",
  constipation: "constipation",
  hydration: "low hydration",
  other: "some symptoms",
};

// Short clinical reasoning appended to "What we noticed" when there
// is more than one symptom -- explains in one phrase WHY the primary
// category is starting first.
const REASON_FOR_PRIMARY: Record<RecCategory, string> = {
  nausea: "because it can make eating and hydration harder",
  appetite:
    "because keeping protein steady can support your energy and recovery",
  energy: "because small, supportive steps can help your energy through the day",
  constipation: "because addressing it early helps prevent it from worsening",
  hydration: "because steady hydration can make most other symptoms easier",
  other: "",
};

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
// Visual tokens. Light, fixed surface so contrast stays correct in
// dark mode (the theme's `cardBg`/`navy` would produce light-on-light).
// =====================================================================
const FEATURED_TINT = "#E8F1FB";
const FEATURED_BORDER = "#BFD7F0";
const STEADY_TINT = "#EAF6EE";
const STEADY_BORDER = "#BFE0CB";
const FEATURED_BADGE_BG = "#DCE9F7";
const FEATURED_BADGE_FG = "#1F4F8A";
const FEATURED_TEXT = "#142240";
const FEATURED_MUTED = "#5A6A82";
// Primary action card surface (white, soft shadow) reads as the most
// important next step without screaming.
const PRIMARY_SURFACE = "#FFFFFF";
const PRIMARY_BORDER = "#7FB0E8";
// Secondary row: compact, muted; less surface area = less clutter.
const SECONDARY_SURFACE = "#F5F8FC";
const SECONDARY_BORDER = "#D5E1F0";
const START_HERE_BG = "#1F4F8A";
const START_HERE_FG = "#FFFFFF";
const SUCCESS_FG = "#1F8A3F";

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
//   steady   -> nausea is "none" AND energy is at least "good"
//               AND no other field is negative
//
// We require BOTH nausea=none AND energy>=good before flipping to
// "steady" so a partially-filled check-in doesn't prematurely
// downgrade an intervention the server generated for real symptoms.
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
  const noNegatives = max === 0;
  const allGood =
    noNegatives &&
    c.nausea === "none" &&
    (c.energy === "good" || c.energy === "great");
  if (allGood) return "steady";
  if (max >= 3 || heavyCount >= 3) return "severe";
  if (max >= 2) return "moderate";
  if (max >= 1) return "mild";
  return null;
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
      title: "Settle nausea first",
      body:
        "Start with small sips of water and a few bites of bland food (toast, crackers, yogurt or tofu) if you can tolerate it. Pause if nausea increases.",
      helper:
        "If nausea feels hard to manage, is getting worse, or you can't keep fluids down, ask your care team to review.",
    };
  }
  if (level === "moderate") {
    return {
      title: "Settle nausea without skipping nutrition",
      body: withLowAppetite
        ? "Try a few bites of a bland, protein-forward snack -- yogurt, tofu, soup or a smoothie -- and sip water slowly for 20 to 30 minutes."
        : "Try a small bland snack like yogurt, tofu, soup or a smoothie, and sip water slowly for 20 to 30 minutes.",
      helper:
        "Small bland portions are usually easier to tolerate while keeping protein and fluids in.",
    };
  }
  return {
    title: "Stay ahead of nausea",
    body: "Keep meals smaller today and sip water steadily.",
    helper: "Light, preventive support so it does not build later in the day.",
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
    title: "Protect your protein intake",
    body:
      "Aim for a small protein serving every few hours -- Greek yogurt, tofu, soup or a smoothie all count. Consistency matters more than volume.",
    helper:
      "This can help prevent low intake from turning into low energy or missed nutrition.",
  };
}

function constipationCopy(): RecContent {
  return {
    title: "Help things move gently",
    body:
      "Sip warm fluids over the next few hours and add fiber gradually with foods like berries, chia, beans or vegetables. A short walk if you feel up for it can help too.",
    helper: "Fiber works best paired with steady fluids and gentle movement.",
  };
}

function bloatingCopy(): RecContent {
  return {
    title: "Ease bloating gently",
    body:
      "Try a short walk, smaller portions and avoid overeating. Skip carbonated drinks and heavily seasoned foods today.",
    helper:
      "Gentle movement and smaller meals usually help more than added fiber when bloating is the main signal.",
  };
}

function diarrheaCopy(): RecContent {
  return {
    title: "Steady fluids and bland foods",
    body:
      "Sip water or an electrolyte drink slowly and stick to bland foods like rice, toast or bananas. Skip greasy or high-fiber foods today.",
    helper: "Steady hydration and gentle foods support recovery.",
  };
}

function energyCopy(level: "tired" | "depleted"): RecContent {
  if (level === "depleted") {
    return {
      title: "Reset with fluids and a short break",
      body:
        "Take small sips of water, sit or lie down for 10 minutes, then try a small protein-plus-carb snack if you feel ready.",
      helper: "Low intake and dehydration can deepen fatigue.",
    };
  }
  return {
    title: "Take a lighter day",
    body:
      "Plan rest blocks today and pair your next meal with a protein source. Save bigger tasks for tomorrow.",
    helper: "Pacing keeps your energy steadier across the day.",
  };
}

function hydrationCopy(): RecContent {
  return {
    title: "Sip steadily over the next hour",
    body:
      "Take a few small sips every 5 to 10 minutes. If plain water feels hard, try an electrolyte drink or warm tea.",
    helper: "Steady fluids absorb better than drinking a lot at once.",
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
  // Live snapshot of the patient's current check-in selections.
  // When provided, the card derives a severity tier and adapts:
  // severe states surface a care-team CTA; mild states soften copy;
  // an all-good state swaps to a maintenance layout entirely.
  liveCheckin?: LiveCheckin | null;

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

export function InterventionCard({
  intervention,
  // Theme `navy` / `mutedForeground` / `background` are intentionally
  // shadowed because the featured card uses a fixed light blue
  // surface in BOTH light and dark mode.
  navy: _themeNavy,
  accent,
  cardBg: _cardBg,
  background: _themeBackground,
  mutedForeground: _themeMuted,
  warning,
  hasHealthData = false,
  liveCheckin = null,
  onAccept,
  onDismiss,
  onFeedback,
  onEscalate,
}: InterventionCardProps) {
  // Severity is recomputed every render off the (cheap) prop. No
  // need for useMemo -- the cost is trivial and React's diff handles
  // the rerender efficiently.
  const liveSeverity = deriveLiveSeverity(liveCheckin);
  // Pure derivation off the live check-in. Recomputes within React's
  // normal render cycle whenever a chip in the check-in row changes,
  // so the displayed title / body / supports adapt within the spec's
  // 1-2s budget without any /generate round-trip.
  const livePlan = useMemo(
    () => deriveLivePlan(liveCheckin, liveSeverity),
    [liveCheckin, liveSeverity],
  );
  const navy = FEATURED_TEXT;
  const mutedForeground = FEATURED_MUTED;
  const background = FEATURED_BORDER;
  const [busy, setBusy] = useState<
    null | "accept" | "dismiss" | "feedback" | "escalate"
  >(null);

  const status = intervention.status;
  const icon = useMemo(
    () => categoryIcon(intervention.recommendationCategory),
    [intervention.recommendationCategory],
  );

  // -- Section parsing + sorting ------------------------------------
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

  // When the patient's live check-in produces a derivable plan, swap
  // the server-built rows for a client-derived set whose title, body
  // and category mix react to the chip selectors. The server-built
  // rows still drive intervention id, status, accept / feedback wiring
  // and persistence -- only the displayed copy + ordering change.
  // Synthesized keys are namespaced ("live:<id>:<cat>:<i>") so they
  // never collide with the server section keys; AsyncStorage will
  // simply hold a parallel set of entries for any user-touched rows.
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

  // Lookup table from synthesized row key -> override RecContent.
  // Passed through PrimaryActionCard / SecondaryActionRow so they can
  // bypass pickVariants and render the matrix-derived title/body/helper.
  const liveOverrides = useMemo<Record<string, RecContent>>(() => {
    if (!livePlan) return {};
    const m: Record<string, RecContent> = {};
    livePlan.rows.forEach((r, i) => {
      m[`live:${intervention.id}:${r.category}:${i}`] = r.copy;
    });
    return m;
  }, [livePlan, intervention.id]);

  // -- Per-row local state ------------------------------------------
  const [sectionStatus, setSectionStatus] = useState<
    Record<string, SectionStatus>
  >({});
  const [sectionAlt, setSectionAlt] = useState<Record<string, boolean>>({});
  // Per-row "Check again later" flag. When true for a key, the row's
  // no_change branch collapses from the two-button "try again before
  // escalating" panel down to a quiet ack with a Change-response
  // link. Memory-only -- a fresh app launch resurfaces the panel.
  const [noChangeAck, setNoChangeAck] = useState<Record<string, boolean>>({});
  // Whether the "More support for today" section is expanded. The
  // spec asks for it to be COLLAPSED by default so the patient sees
  // exactly one next step on first open.
  const [secondaryExpanded, setSecondaryExpanded] = useState(false);

  // Race-safety for AsyncStorage:
  //   (a) Hydration race -- multiGet may resolve AFTER a user tap.
  //       Hydration only fills keys the user hasn't touched.
  //   (b) Rapid-tap write race -- writes are serialized per key via
  //       a promise chain so the LAST tap's value is always what
  //       ends up persisted.
  const touchedKeysRef = useRef<Set<string>>(new Set());
  const writeChainRef = useRef<Record<string, Promise<unknown>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pairs = await AsyncStorage.multiGet(sectionKeys);
        if (cancelled) return;
        setSectionStatus((prev) => {
          const next = { ...prev };
          for (const [k, v] of pairs) {
            if (touchedKeysRef.current.has(k)) continue;
            if (k in next) continue;
            const coerced = coercePersistedStatus(v);
            if (coerced != null) next[k] = coerced;
          }
          return next;
        });
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionKeys]);

  // Tracks whether we've already issued the server `accept` call for
  // this card during this session. First commit transitions the
  // intervention server-side from "shown" -> "pending_feedback".
  const acceptFiredRef = useRef(false);
  // Card-level "fired worse to server" tracker. Independent of the
  // per-row state machine.
  const escalateFiredRef = useRef(false);
  // Fire `intervention_plan_viewed` once per intervention id.
  const viewLoggedRef = useRef<number | null>(null);
  useEffect(() => {
    if (viewLoggedRef.current === intervention.id) return;
    viewLoggedRef.current = intervention.id;
    safeLog("intervention_plan_viewed");
  }, [intervention.id]);

  const setRowStatus = useCallback(
    async (key: string, value: SectionStatus | null) => {
      // Mark the key as user-touched so a late hydration won't
      // clobber it with the persisted snapshot.
      touchedKeysRef.current.add(key);
      // Apply in-memory state immediately.
      setSectionStatus((prev) => {
        const next = { ...prev };
        if (value == null) delete next[key];
        else next[key] = value;
        return next;
      });
      // Serialize the persistence write behind any prior in-flight
      // write on the same key so out-of-order setItem awaits don't
      // leave stale data on disk.
      const prior = writeChainRef.current[key] ?? Promise.resolve();
      const next = prior
        .catch(() => undefined)
        .then(async () => {
          try {
            if (value == null) await AsyncStorage.removeItem(key);
            else await AsyncStorage.setItem(key, value);
          } catch {
            /* best-effort persistence */
          }
        });
      writeChainRef.current[key] = next;
      await next;
    },
    [],
  );

  // Subtle entrance animation. Declared BEFORE any conditional early
  // return so the hook count stays stable when status transitions.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: 60,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [enter]);
  const animatedStyle = {
    opacity: enter,
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  // -- Per-row action handlers --------------------------------------
  const handleRowCommit = useCallback(
    async (key: string) => {
      void setRowStatus(key, "committed");
      safeLog("intervention_started");
      if (acceptFiredRef.current) return;
      if (intervention.status !== "shown") {
        acceptFiredRef.current = true;
        return;
      }
      acceptFiredRef.current = true;
      try {
        await onAccept(intervention.id);
      } catch {
        // If the call FAILS and the server is still "shown", clear
        // the guard so a later commit (or the worse-panel pre-accept
        // path) can retry.
        if (intervention.status === "shown") {
          acceptFiredRef.current = false;
        }
      }
    },
    [setRowStatus, intervention.id, intervention.status, onAccept],
  );

  const handleRowOutcome = useCallback(
    (
      key: string,
      outcome: "better" | "no_change" | "worse" | "didnt_try",
    ) => {
      void setRowStatus(key, outcome);
      if (outcome === "better") safeLog("intervention_feedback_better");
      else if (outcome === "no_change") safeLog("intervention_feedback_no_change");
      else if (outcome === "didnt_try") safeLog("intervention_feedback_didnt_try");
      else safeLog("intervention_feedback_worse");
    },
    [setRowStatus],
  );

  const handleRowReset = useCallback(
    (key: string) => {
      void setRowStatus(key, null);
      // Clear the "check again later" ack so the patient gets the
      // full no_change panel again next time they go through the
      // outcome flow.
      setNoChangeAck((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [setRowStatus],
  );

  const handleRowDismissNoChange = useCallback((key: string) => {
    safeLog("intervention_check_again_later");
    setNoChangeAck((prev) => ({ ...prev, [key]: true }));
  }, []);

  const handleRowToggleAlternate = useCallback(
    (key: string) => {
      setSectionAlt((prev) => {
        const wasShowing = !!prev[key];
        if (!wasShowing) safeLog("intervention_alternative_requested");
        return { ...prev, [key]: !wasShowing };
      });
      // Reset the row to default so the patient can tap "I'll try
      // this" on the alternate copy. Also clear the no_change ack
      // since we're effectively starting a fresh attempt.
      void setRowStatus(key, null);
      setNoChangeAck((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [setRowStatus],
  );

  const handleRowAskCareTeam = useCallback(
    async (_key: string) => {
      if (intervention.status === "escalated") return;
      if (escalateFiredRef.current) return;
      escalateFiredRef.current = true;
      safeLog("care_team_escalation_requested");
      try {
        // /feedback's status guard requires accepted/pending_feedback.
        // If the card is still "shown", pre-accept first so the
        // /feedback below doesn't 409.
        if (intervention.status === "shown") {
          acceptFiredRef.current = true;
          try {
            await onAccept(intervention.id);
          } catch {
            /* /feedback below will surface the real error */
          }
        }
        await onFeedback(intervention.id, "worse");
      } catch {
        escalateFiredRef.current = false;
      }
    },
    [intervention.id, intervention.status, onAccept, onFeedback],
  );

  // "What we noticed" -- short plain-language sentence built from the
  // categories present in this intervention. Falls back to the
  // server's text only when we couldn't resolve any rows.
  // NOTE: declared BEFORE any conditional early return so the hook
  // count stays stable across renders (status transitions to
  // resolved/expired/dismissed return null below).
  const noticedSentence = useMemo(() => {
    if (orderedRows.length === 0) {
      return (intervention.whatWeNoticed ?? "").trim();
    }
    // De-dupe categories (a category should only appear once in the
    // sentence even if the synthesizer surfaced two rows for it).
    const phrases: string[] = [];
    const seen = new Set<RecCategory>();
    for (const r of orderedRows) {
      if (seen.has(r.category)) continue;
      seen.add(r.category);
      phrases.push(NOTICED_PHRASE[r.category]);
    }
    let sentence = `You reported ${joinList(phrases)} today.`;
    // When more than one symptom is present, briefly explain WHY
    // we're starting with the chosen primary. This makes the order
    // feel intentional ("nausea first because it can make eating
    // harder") instead of arbitrary.
    const primaryCat = orderedRows[0]!.category;
    const reason = REASON_FOR_PRIMARY[primaryCat];
    const primaryPhrase = NOTICED_PHRASE[primaryCat];
    if (phrases.length > 1 && reason.length > 0) {
      sentence += ` We'll start with ${primaryPhrase} ${reason}.`;
    }
    return sentence;
  }, [orderedRows, intervention.whatWeNoticed]);

  // Reference unused legacy props/state so TS stays quiet.
  void onDismiss;
  void onEscalate;
  void busy;
  void setBusy;

  if (status === "resolved" || status === "expired" || status === "dismissed") {
    return null;
  }

  // Steady-mode swap: when the live check-in reads as all-good, hide
  // the symptom-rescue intervention and show a calm maintenance card
  // instead. Skipped while the card is escalated so we don't appear
  // to "downgrade" an active care-team flag the patient just sent.
  if (liveSeverity === "steady" && status !== "escalated") {
    return (
      <Animated.View
        style={[
          styles.card,
          styles.cardFeatured,
          {
            backgroundColor: STEADY_TINT,
            borderColor: STEADY_BORDER,
          },
          animatedStyle,
        ]}
      >
        <View style={styles.headerRow}>
          <View
            style={[styles.iconWrap, { backgroundColor: SUCCESS_FG + "1F" }]}
          >
            <Feather name="check-circle" size={18} color={SUCCESS_FG} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: SUCCESS_FG + "1A" },
                ]}
              >
                <Feather name="check" size={10} color={SUCCESS_FG} />
                <Text style={[styles.badgeText, { color: SUCCESS_FG }]}>
                  Going well today
                </Text>
              </View>
            </View>
            <Text style={[styles.title, { color: navy }]}>
              Stay steady today
            </Text>
            <Text style={[styles.subtitle, { color: mutedForeground }]}>
              Your inputs look steady today
            </Text>
          </View>
        </View>

        <Text style={[styles.steadyBody, { color: navy }]}>
          Keep following your plan and check in again if anything changes.
        </Text>

        <View style={styles.signalChipsRow}>
          {["Hydration", "Protein", "Routine"].map((label) => (
            <View
              key={label}
              style={[
                styles.supportChip,
                {
                  backgroundColor: SUCCESS_FG + "14",
                  borderColor: SUCCESS_FG + "33",
                },
              ]}
            >
              <Text
                style={[styles.supportChipText, { color: SUCCESS_FG }]}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>
    );
  }

  // -- Derived view-model -------------------------------------------
  const primary = displayRows[0];
  const secondaries = displayRows.slice(1);

  // Badge label/tone reflects the most urgent signal we currently
  // know about. Escalated state always wins; otherwise severe live
  // symptoms surface as "Heavier today" so the patient understands
  // we noticed without us auto-escalating.
  const badgeLabel =
    status === "escalated"
      ? "Care team notified"
      : liveSeverity === "severe"
        ? "Heavier today"
        : "For you today";
  const useWarningTone =
    status === "escalated" || liveSeverity === "severe";

  // Patient-friendly nouns for the symptoms we're targeting today.
  // Used by both the top "Today:" signal chip and the "More support"
  // mini-chips. We always exclude the primary category from the
  // secondary list so a category never appears twice.
  const allCategoryNouns: string[] = [];
  {
    const seen = new Set<RecCategory>();
    for (const r of displayRows) {
      if (seen.has(r.category)) continue;
      seen.add(r.category);
      allCategoryNouns.push(CATEGORY_NOUN[r.category]);
    }
  }
  const secondaryCategoryNouns: string[] = [];
  {
    const seen = new Set<RecCategory>();
    if (primary) seen.add(primary.category);
    for (const r of secondaries) {
      if (seen.has(r.category)) continue;
      seen.add(r.category);
      secondaryCategoryNouns.push(CATEGORY_NOUN[r.category]);
    }
  }
  // Cap the "Today:" chip label at three nouns so it never wraps.
  // Anything beyond three is conveyed by "More support" chips below.
  const todayChipLabel =
    allCategoryNouns.length > 0
      ? `Today: ${joinList(allCategoryNouns.slice(0, 3))}`
      : null;

  // The verbose "What we noticed" sentence is now superseded by the
  // signal chips. Keep the useMemo result reachable so the var isn't
  // marked as dead, but it's no longer rendered.
  void noticedSentence;

  return (
    <Animated.View
      style={[
        styles.card,
        styles.cardFeatured,
        {
          backgroundColor: FEATURED_TINT,
          // Outer border stays the calm featured-blue regardless of
          // severity. The severe state still reads clearly via the
          // "Heavier today" badge + signal chip + the explicit
          // care-team CTA below; flooding the whole card edge with
          // orange made the page feel alarming and competed with
          // the in-card escalation button.
          borderColor: FEATURED_BORDER,
        },
        animatedStyle,
      ]}
    >
      {/* -- Header ------------------------------------------------- */}
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
          <Feather name={icon} size={18} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: useWarningTone
                    ? warning + "22"
                    : FEATURED_BADGE_BG,
                },
              ]}
            >
              <Feather
                name={useWarningTone ? "alert-circle" : "star"}
                size={10}
                color={useWarningTone ? warning : FEATURED_BADGE_FG}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: useWarningTone ? warning : FEATURED_BADGE_FG },
                ]}
              >
                {badgeLabel}
              </Text>
            </View>
          </View>
          <Text style={[styles.title, { color: navy }]}>
            Today&apos;s next steps
          </Text>
          <Text style={[styles.subtitle, { color: mutedForeground }]}>
            {hasHealthData
              ? "Based on your check-in, recent symptoms and Apple Health trends"
              : "Based on your check-in and recent symptoms"}
          </Text>
          {/* Dev-only matrix probe. Lets us confirm at a glance that
              the displayed plan is recalculating from the chip
              selectors (concern shifts, severity flips, support set
              changes). __DEV__ is false in production builds so it
              never ships to patients. */}
          {__DEV__ && livePlan && (
            <Text
              style={{
                marginTop: 6,
                fontSize: 10,
                lineHeight: 14,
                color: mutedForeground,
                fontFamily: "Montserrat_600SemiBold",
                opacity: 0.7,
              }}
            >
              [debug] concern={livePlan.primaryConcern} sev=
              {livePlan.severity} supports=
              {livePlan.rows.map((r) => r.reason).join(",")} | {livePlan.signature}
            </Text>
          )}
        </View>
      </View>

      {/* -- Signal summary chips ----------------------------------
            Compact, data-driven row that replaces the long "What we
            noticed" sentence. Goal: communicate "this is built from
            your real data" in under a second of glance time. */}
      {/* The data-source fallback chip ("Apple Health" / "Recent
          symptoms") always renders, so the row is always non-empty
          while we have at least the patient's own check-in. */}
      <View style={styles.signalChipsRow}>
          {todayChipLabel && (
            <View
              style={[
                styles.signalChip,
                {
                  backgroundColor: accent + "14",
                  borderColor: accent + "33",
                },
              ]}
            >
              <Feather name="activity" size={11} color={accent} />
              <Text
                style={[styles.signalChipText, { color: accent }]}
                numberOfLines={1}
              >
                {todayChipLabel}
              </Text>
            </View>
          )}
          {hasHealthData ? (
            <View
              style={[
                styles.signalChip,
                {
                  backgroundColor: "rgba(31, 79, 138, 0.06)",
                  borderColor: "rgba(31, 79, 138, 0.12)",
                },
              ]}
            >
              <Feather name="heart" size={11} color={navy} />
              <Text
                style={[styles.signalChipText, { color: navy }]}
                numberOfLines={1}
              >
                Apple Health
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.signalChip,
                {
                  backgroundColor: "rgba(31, 79, 138, 0.06)",
                  borderColor: "rgba(31, 79, 138, 0.12)",
                },
              ]}
            >
              <Feather name="clipboard" size={11} color={navy} />
              <Text
                style={[styles.signalChipText, { color: navy }]}
                numberOfLines={1}
              >
                Recent symptoms
              </Text>
            </View>
          )}
          {liveSeverity === "severe" && (
            <View
              style={[
                styles.signalChip,
                {
                  backgroundColor: warning + "1A",
                  borderColor: warning + "44",
                },
              ]}
            >
              <Feather name="alert-triangle" size={11} color={warning} />
              <Text
                style={[styles.signalChipText, { color: warning }]}
                numberOfLines={1}
              >
                Heavier today
              </Text>
            </View>
          )}
          {liveSeverity === "mild" && (
            <View
              style={[
                styles.signalChip,
                {
                  backgroundColor: SUCCESS_FG + "14",
                  borderColor: SUCCESS_FG + "33",
                },
              ]}
            >
              <Feather name="sun" size={11} color={SUCCESS_FG} />
              <Text
                style={[styles.signalChipText, { color: SUCCESS_FG }]}
                numberOfLines={1}
              >
                Stay ahead today
              </Text>
            </View>
          )}
        </View>

      {/* -- Primary action ---------------------------------------- */}
      {primary && (
        <PrimaryActionCard
          category={primary.category}
          interventionId={intervention.id}
          originalBody={primary.section.body}
          liveOverride={liveOverrides[primary.key] ?? null}
          showingAlternate={!!sectionAlt[primary.key]}
          status={sectionStatus[primary.key] ?? null}
          noChangeDismissed={!!noChangeAck[primary.key]}
          navy={navy}
          mutedForeground={mutedForeground}
          border={background}
          accent={accent}
          warning={warning}
          onCommit={() => handleRowCommit(primary.key)}
          onToggleAlternate={() => handleRowToggleAlternate(primary.key)}
          onOutcome={(outcome) => handleRowOutcome(primary.key, outcome)}
          onReset={() => handleRowReset(primary.key)}
          onDismissNoChange={() => handleRowDismissNoChange(primary.key)}
          onAskCareTeam={() => handleRowAskCareTeam(primary.key)}
        />
      )}

      {/* -- Severe-mode escalation shortcut ----------------------- */}
      {/* Patient self-reported severe symptoms. We surface a       */}
      {/* prominent care-team CTA so the option isn't buried in     */}
      {/* the worse-feedback panel. Still requires an explicit tap  */}
      {/* -- no auto-escalation -- which preserves the worse-only   */}
      {/* guardrail (multiple buttons may fire onFeedback("worse"), */}
      {/* what matters is the patient initiates it).                */}
      {liveSeverity === "severe" && status !== "escalated" && (
        <Pressable
          onPress={async () => {
            tap();
            try {
              await onFeedback(intervention.id, "worse");
            } catch {
              /* parent surfaces errors; swallow here so the UI doesn't crash */
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Ask my care team to review"
          style={({ pressed }) => [
            styles.severeCta,
            {
              backgroundColor: warning,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="message-circle" size={14} color="#FFFFFF" />
          <Text style={styles.severeCtaText}>
            Ask my care team to review
          </Text>
        </Pressable>
      )}

      {/* -- More support for today (collapsed by default) -------- */}
      {secondaries.length > 0 && (
        <View style={styles.section}>
          <Pressable
            onPress={() => {
              tap();
              // Subtle expand/collapse animation. easeInEaseOut keeps
              // the motion calm and Apple-like; we avoid spring so the
              // section doesn't overshoot. Web is a no-op.
              if (Platform.OS !== "web") {
                LayoutAnimation.configureNext(
                  LayoutAnimation.create(
                    220,
                    LayoutAnimation.Types.easeInEaseOut,
                    LayoutAnimation.Properties.opacity,
                  ),
                );
              }
              setSecondaryExpanded((v) => !v);
              if (!secondaryExpanded) safeLog("intervention_secondary_expanded");
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: secondaryExpanded }}
            accessibilityLabel={
              secondaryExpanded
                ? `Hide ${secondaries.length} more support options`
                : `Show ${secondaries.length} more support options`
            }
            style={({ pressed }) => [
              styles.moreSupportHeader,
              { borderColor: background, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={[styles.moreSupportTitle, { color: navy }]}>
                More support
              </Text>
              {/* Mini category chips -- shows the patient at a glance
                  WHAT the additional supports cover, not just "N more
                  things". Tapping the row still expands. */}
              {secondaryCategoryNouns.length > 0 && (
                <View style={styles.supportChipsRow}>
                  {secondaryCategoryNouns.map((noun) => (
                    <View
                      key={noun}
                      style={[
                        styles.supportChip,
                        {
                          backgroundColor: "rgba(31, 79, 138, 0.07)",
                          borderColor: "rgba(31, 79, 138, 0.10)",
                        },
                      ]}
                    >
                      <Text
                        style={[styles.supportChipText, { color: navy }]}
                      >
                        {noun.charAt(0).toUpperCase() + noun.slice(1)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={styles.moreSupportMeta}>
              <Text
                style={[styles.moreSupportCount, { color: mutedForeground }]}
              >
                {secondaries.length}
              </Text>
              <Feather
                name={secondaryExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={mutedForeground}
              />
            </View>
          </Pressable>
          {secondaryExpanded && (
            <View style={styles.rowsWrap}>
              {secondaries.map((r) => (
                <SecondaryActionRow
                  key={r.key}
                  category={r.category}
                  interventionId={intervention.id}
                  originalBody={r.section.body}
                  liveOverride={liveOverrides[r.key] ?? null}
                  showingAlternate={!!sectionAlt[r.key]}
                  status={sectionStatus[r.key] ?? null}
                  noChangeDismissed={!!noChangeAck[r.key]}
                  navy={navy}
                  mutedForeground={mutedForeground}
                  border={background}
                  accent={accent}
                  warning={warning}
                  onCommit={() => handleRowCommit(r.key)}
                  onToggleAlternate={() => handleRowToggleAlternate(r.key)}
                  onOutcome={(outcome) => handleRowOutcome(r.key, outcome)}
                  onReset={() => handleRowReset(r.key)}
                  onDismissNoChange={() => handleRowDismissNoChange(r.key)}
                  onAskCareTeam={() => handleRowAskCareTeam(r.key)}
                />
              ))}
            </View>
          )}
        </View>
      )}

      {status === "escalated" && (
        <View style={styles.escalatedRow}>
          <Feather name="alert-circle" size={14} color={warning} />
          <Text style={[styles.escalatedText, { color: warning }]}>
            Your care team will follow up.
          </Text>
        </View>
      )}

      {/* -- Subtle clinical guardrail footer ---------------------- */}
      <Text style={[styles.guardrail, { color: mutedForeground }]}>
        Viva supports between-visit care. If symptoms feel severe or
        urgent, contact your care team or seek medical help.
      </Text>
    </Animated.View>
  );
}

// =====================================================================
// PrimaryActionCard -- the prominent "Start here" card.
// =====================================================================
interface ActionRowProps {
  category: RecCategory;
  // Stable id of the parent intervention. Used by pickVariants() to
  // deterministically rotate which variant of the recommendation we
  // show for this category, so the same patient doesn't see the
  // identical "snack" suggestion every day.
  interventionId: number;
  // Server-provided body. Only used as a fallback for the "other"
  // category where we don't have a canned clinical micro-protocol.
  // For the five known symptom categories, the body comes from the
  // picked variant in RECOMMENDATIONS[category].variants.
  originalBody: string;
  showingAlternate: boolean;
  status: SectionStatus | null;
  // Legacy: used to live with a 2-button no_change panel. The current
  // UX collapses no_change to a single ack so this prop is no longer
  // read, but it's kept on the interface to keep call sites stable.
  noChangeDismissed: boolean;
  navy: string;
  mutedForeground: string;
  border: string;
  accent: string;
  warning: string;
  onCommit: () => void;
  onToggleAlternate: () => void;
  onOutcome: (
    outcome: "better" | "no_change" | "worse" | "didnt_try",
  ) => void;
  onReset: () => void;
  // Legacy: see noChangeDismissed above.
  onDismissNoChange: () => void;
  onAskCareTeam: () => void;
  // When the parent has derived a live plan from the patient's check-in
  // selectors, it passes the override here. Present -> bypass
  // pickVariants / showingAlternate and render this copy directly.
  // Absent -> fall back to the server-driven RECOMMENDATIONS variant.
  liveOverride?: RecContent | null;
}

function tap(): void {
  try {
    Haptics.selectionAsync();
  } catch {
    /* best-effort */
  }
}

function PrimaryActionCard({
  category,
  interventionId,
  originalBody,
  showingAlternate,
  status,
  noChangeDismissed: _noChangeDismissed,
  navy,
  mutedForeground,
  border,
  accent,
  warning,
  onCommit,
  onToggleAlternate,
  onOutcome,
  onReset,
  onDismissNoChange: _onDismissNoChange,
  onAskCareTeam,
  liveOverride,
}: ActionRowProps) {
  const picked = useMemo(
    () => pickVariants(category, interventionId),
    [category, interventionId],
  );
  // When the parent derived a live plan from the check-in selectors,
  // its copy wins -- the deterministic per-intervention variant from
  // pickVariants is replaced by symptom-tuned title/body/helper, and
  // showingAlternate becomes a no-op (one canonical override per
  // signal). Otherwise we fall back to the canned clinical variant.
  const variant: RecContent =
    liveOverride ?? (showingAlternate ? picked.alternate : picked.primary);
  const title = variant.title;
  const helper = variant.helper;
  // For "other" we don't have category-specific clinical copy, so fall
  // back to the server's body when not showing the alternate. Known
  // categories always use the canned clinical micro-protocol. The
  // liveOverride path bypasses both branches.
  const body = liveOverride
    ? liveOverride.body
    : category === "other" && !showingAlternate
      ? originalBody || variant.body
      : variant.body;
  const titleA11y = title.toLowerCase();
  const offerEscalation = shouldOfferEscalation(category, status);

  return (
    <View
      style={[
        styles.primaryCard,
        { borderColor: PRIMARY_BORDER, backgroundColor: PRIMARY_SURFACE },
      ]}
    >
      <View style={styles.startHerePillRow}>
        <View style={[styles.startHerePill, { backgroundColor: START_HERE_BG }]}>
          <Feather name="zap" size={10} color={START_HERE_FG} />
          <Text style={[styles.startHerePillText, { color: START_HERE_FG }]}>
            Start here
          </Text>
        </View>
      </View>

      <Text style={[styles.primaryTitle, { color: navy }]}>{title}</Text>
      <Text style={[styles.primaryBody, { color: navy }]}>{body}</Text>

      {/* "Why this helps" -- only on the default state. Once the
          patient has acted, the row becomes a feedback prompt and
          we keep the surface uncluttered. The labeled treatment
          (small caps label + accent dot + helper sentence) reads as
          a clinical justification rather than fine print. */}
      {status == null && helper.trim().length > 0 && (
        <View style={styles.whyRow}>
          <View style={[styles.whyDot, { backgroundColor: accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.whyLabel, { color: mutedForeground }]}>
              Why this helps
            </Text>
            <Text style={[styles.whyText, { color: navy }]}>{helper}</Text>
          </View>
        </View>
      )}

      {/* -- Default: I'll try this / Show me another option (or Back) -- */}
      {status == null && (
        <View style={styles.btnRow}>
          <Pressable
            onPress={() => {
              tap();
              onCommit();
            }}
            accessibilityRole="button"
            accessibilityLabel={`I will try this: ${titleA11y}`}
            style={({ pressed }) => [
              styles.btnPrimary,
              {
                borderColor: accent,
                backgroundColor: accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="check" size={13} color="#FFFFFF" />
            <Text style={[styles.btnText, { color: "#FFFFFF", fontFamily: "Montserrat_700Bold", fontWeight: "700" }]}>
              I&apos;ll try this
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tap();
              onToggleAlternate();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              showingAlternate
                ? `Go back to original suggestion for ${titleA11y}`
                : `Show me another option for ${titleA11y}`
            }
            style={({ pressed }) => [
              styles.btnSecondary,
              { borderColor: border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={[styles.btnText, { color: mutedForeground, fontFamily: "Montserrat_600SemiBold", fontWeight: "600" }]}>
              {showingAlternate ? "Back" : "Another option"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* -- Committed: outcome prompt ----------------------------- */}
      {status === "committed" && (
        <View style={styles.outcomeWrap}>
          <Text style={[styles.outcomePrompt, { color: navy }]}>
            Did this help?
          </Text>
          <View style={styles.outcomeRow}>
            <OutcomeButton
              label="Better"
              icon="smile"
              tint={SUCCESS_FG}
              border={border}
              onPress={() => {
                tap();
                onOutcome("better");
              }}
              accessibilityLabel={`Feeling better after ${titleA11y}`}
            />
            <OutcomeButton
              label="Same"
              icon="meh"
              tint={mutedForeground}
              border={border}
              onPress={() => {
                tap();
                onOutcome("no_change");
              }}
              accessibilityLabel={`About the same after ${titleA11y}`}
            />
            <OutcomeButton
              label="Worse"
              icon="frown"
              tint={warning}
              border={border}
              onPress={() => {
                tap();
                onOutcome("worse");
              }}
              accessibilityLabel={`Worse after ${titleA11y}`}
            />
          </View>
        </View>
      )}

      {/* -- Better -- quiet acknowledgement ----------------------- */}
      {status === "better" && (
        <AcknowledgeRow
          icon="smile"
          tint={SUCCESS_FG}
          text="Got it. Viva will remember this helped."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {/* -- Same: quiet ack. Per the redesign spec we no longer
            front-load a "try a different step before escalating"
            panel here -- the patient can still tap "Change response"
            in the ack to revisit, and the escalation path lives on
            the Worse branch. */}
      {status === "no_change" && (
        <AcknowledgeRow
          icon="meh"
          tint={mutedForeground}
          text="Thanks. We'll adjust future recommendations."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {/* -- Didn't try: quiet ack so the row doesn't penalize the
            patient for skipping. Resetting reopens the outcome
            prompt if they later want to log a real outcome. */}
      {status === "didnt_try" && (
        <AcknowledgeRow
          icon="minus-circle"
          tint={mutedForeground}
          text="Got it. We won't count that one."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {/* -- Worse: escalation panel (only path to care team) ------ */}
      {status === "worse" && offerEscalation && (
        <View style={styles.escalateWrap}>
          <Text style={[styles.escalateCopy, { color: navy }]}>
            This should be reviewed. You can ask your care team to take a
            look.
          </Text>
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => {
                tap();
                onToggleAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Try another option for ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnSecondary,
                { borderColor: border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Feather name="refresh-cw" size={12} color={mutedForeground} />
              <Text style={[styles.btnText, { color: mutedForeground, fontFamily: "Montserrat_600SemiBold", fontWeight: "600" }]}>
                Another option
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onAskCareTeam();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ask my care team about ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnPrimary,
                {
                  borderColor: warning,
                  backgroundColor: warning,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="message-circle" size={13} color="#FFFFFF" />
              <Text style={[styles.btnText, { color: "#FFFFFF", fontFamily: "Montserrat_700Bold", fontWeight: "700" }]}>
                Ask my care team
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// =====================================================================
// SecondaryActionRow -- compact row for "More support for today".
// Same state machine, much lighter visual treatment. Sources its
// content from the same RECOMMENDATIONS map as the primary card.
// =====================================================================
function SecondaryActionRow({
  category,
  interventionId,
  originalBody,
  showingAlternate,
  status,
  noChangeDismissed: _noChangeDismissed,
  navy,
  mutedForeground,
  border,
  accent,
  warning,
  onCommit,
  onToggleAlternate,
  onOutcome,
  onReset,
  onDismissNoChange: _onDismissNoChange,
  onAskCareTeam,
  liveOverride,
}: ActionRowProps) {
  const picked = useMemo(
    () => pickVariants(category, interventionId),
    [category, interventionId],
  );
  // See PrimaryActionCard for the liveOverride contract.
  const variant: RecContent =
    liveOverride ?? (showingAlternate ? picked.alternate : picked.primary);
  const title = variant.title;
  const body = liveOverride
    ? liveOverride.body
    : category === "other" && !showingAlternate
      ? originalBody || variant.body
      : variant.body;
  const titleA11y = title.toLowerCase();
  const offerEscalation = shouldOfferEscalation(category, status);

  return (
    <View
      style={[
        styles.secondaryRow,
        { borderColor: SECONDARY_BORDER, backgroundColor: SECONDARY_SURFACE },
      ]}
    >
      <Text style={[styles.secondaryTitle, { color: navy }]}>{title}</Text>
      <Text style={[styles.secondaryBody, { color: mutedForeground }]}>
        {body}
      </Text>

      {/* -- Default: single small "Try this" button --------------- */}
      {status == null && (
        <Pressable
          onPress={() => {
            tap();
            onCommit();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Try this: ${titleA11y}`}
          style={({ pressed }) => [
            styles.smallBtn,
            {
              borderColor: accent,
              backgroundColor: "#FFFFFF",
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Feather name="check" size={12} color={accent} />
          <Text style={[styles.smallBtnText, { color: accent }]}>
            Try this
          </Text>
        </Pressable>
      )}

      {/* -- Committed: outcome prompt ----------------------------- */}
      {status === "committed" && (
        <View style={styles.outcomeWrap}>
          <Text style={[styles.outcomePromptSmall, { color: navy }]}>
            Did this help?
          </Text>
          <View style={styles.outcomeRow}>
            <OutcomeButton
              label="Better"
              icon="smile"
              tint={SUCCESS_FG}
              border={border}
              onPress={() => {
                tap();
                onOutcome("better");
              }}
              accessibilityLabel={`Feeling better after ${titleA11y}`}
            />
            <OutcomeButton
              label="Same"
              icon="meh"
              tint={mutedForeground}
              border={border}
              onPress={() => {
                tap();
                onOutcome("no_change");
              }}
              accessibilityLabel={`About the same after ${titleA11y}`}
            />
            <OutcomeButton
              label="Worse"
              icon="frown"
              tint={warning}
              border={border}
              onPress={() => {
                tap();
                onOutcome("worse");
              }}
              accessibilityLabel={`Worse after ${titleA11y}`}
            />
          </View>
        </View>
      )}

      {status === "better" && (
        <AcknowledgeRow
          icon="smile"
          tint={SUCCESS_FG}
          text="Got it. Viva will remember this helped."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {status === "no_change" && (
        <AcknowledgeRow
          icon="meh"
          tint={mutedForeground}
          text="Thanks. We'll adjust future recommendations."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {status === "didnt_try" && (
        <AcknowledgeRow
          icon="minus-circle"
          tint={mutedForeground}
          text="Got it. We won't count that one."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {status === "worse" && offerEscalation && (
        <View style={styles.escalateWrap}>
          <Text style={[styles.escalateCopy, { color: navy }]}>
            This should be reviewed. You can ask your care team to take a
            look.
          </Text>
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => {
                tap();
                onToggleAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Try another option for ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnSecondary,
                { borderColor: border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Feather name="refresh-cw" size={12} color={mutedForeground} />
              <Text style={[styles.btnText, { color: mutedForeground, fontFamily: "Montserrat_600SemiBold", fontWeight: "600" }]}>
                Another option
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onAskCareTeam();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ask my care team about ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnPrimary,
                {
                  borderColor: warning,
                  backgroundColor: warning,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="message-circle" size={13} color="#FFFFFF" />
              <Text style={[styles.btnText, { color: "#FFFFFF", fontFamily: "Montserrat_700Bold", fontWeight: "700" }]}>
                Ask my care team
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// =====================================================================
// Small helpers
// =====================================================================
interface AcknowledgeRowProps {
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  text: string;
  onReset: () => void;
  mutedForeground: string;
  a11y: string;
}

function AcknowledgeRow({
  icon,
  tint,
  text,
  onReset,
  mutedForeground,
  a11y,
}: AcknowledgeRowProps) {
  return (
    <View style={styles.ackRow}>
      <View style={styles.ackTextRow}>
        <Feather name={icon} size={13} color={tint} />
        <Text style={[styles.ackText, { color: tint }]}>{text}</Text>
      </View>
      <Pressable
        onPress={() => {
          tap();
          onReset();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Change response for ${a11y}`}
        style={({ pressed }) => [
          styles.changeLink,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.changeLinkText, { color: mutedForeground }]}>
          Change response
        </Text>
      </Pressable>
    </View>
  );
}

interface OutcomeButtonProps {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  border: string;
  onPress: () => void;
  accessibilityLabel: string;
}

function OutcomeButton({
  label,
  icon,
  tint,
  border,
  onPress,
  accessibilityLabel,
}: OutcomeButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.outcomeBtn,
        { borderColor: border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Feather name={icon} size={13} color={tint} />
      <Text
        style={[styles.outcomeBtnText, { color: tint }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 20,
    gap: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // -- Signal summary chips ----------------------------------------
  signalChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  signalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  signalChipText: {
    fontSize: 11.5,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  // -- More support: mini category chips ---------------------------
  supportChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  steadyBody: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Montserrat_500Medium",
    fontWeight: "500",
  },
  severeCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  severeCtaText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
  },
  supportChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  supportChipText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  // -- Primary card "Why this helps" --------------------------------
  whyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(31, 79, 138, 0.10)",
  },
  whyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  whyLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  whyText: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  cardFeatured: {
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      web: {
        boxShadow: "0 10px 32px rgba(31, 79, 138, 0.08)",
      },
      default: {
        shadowColor: "#1F4F8A",
        shadowOpacity: 0.08,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      },
    }),
  },
  // -- Header -------------------------------------------------------
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  title: {
    fontSize: 18,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    fontWeight: "500",
    marginTop: 3,
    lineHeight: 17,
  },
  // -- Sections -----------------------------------------------------
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  sectionBody: {
    fontFamily: "Montserrat_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  // -- More support for today (collapsible secondary header) -------
  // Less boxy: no hard border, slightly tinted surface only.
  moreSupportHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
  moreSupportTitle: {
    fontSize: 13,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
  },
  moreSupportSubtitle: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
    fontWeight: "500",
    marginTop: 2,
    lineHeight: 16,
  },
  moreSupportMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  moreSupportCount: {
    fontSize: 12,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  // -- Primary action card ------------------------------------------
  // Softer, less boxy: hairline border + subtle long-radius shadow.
  primaryCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
    ...Platform.select({
      web: {
        boxShadow: "0 4px 16px rgba(31, 79, 138, 0.06)",
      },
      default: {
        shadowColor: "#1F4F8A",
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      },
    }),
  },
  startHerePillRow: {
    flexDirection: "row",
  },
  startHerePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  startHerePillText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  primaryTitle: {
    fontSize: 19,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
    lineHeight: 25,
    marginTop: 2,
  },
  primaryBody: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Montserrat_400Regular",
    fontWeight: "400",
  },
  helperLine: {
    fontFamily: "Montserrat_400Regular",
    fontSize: 12,
    lineHeight: 16,
    fontStyle: "italic",
  },
  // -- Secondary rows -----------------------------------------------
  rowsWrap: {
    gap: 6,
  },
  secondaryRow: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  secondaryTitle: {
    fontSize: 14,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
    lineHeight: 18,
  },
  secondaryBody: {
    fontFamily: "Montserrat_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
  smallBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  smallBtnText: {
    fontSize: 12,
    fontFamily: "Montserrat_700Bold",
    fontWeight: "700",
  },
  // -- Buttons (shared) --------------------------------------------
  btnRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#FFFFFF",
  },
  btnText: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 13,
  },
  // -- Outcome ------------------------------------------------------
  outcomeWrap: {
    gap: 6,
    marginTop: 2,
  },
  outcomePrompt: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
  },
  outcomePromptSmall: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
  },
  outcomeRow: {
    flexDirection: "row",
    gap: 8,
  },
  outcomeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  outcomeBtnText: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
  },
  // -- Acknowledgement (better / no_change) -------------------------
  ackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    gap: 8,
  },
  ackTextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  ackText: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
  },
  changeLink: {
    paddingVertical: 2,
  },
  changeLinkText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  // -- Worse / escalation panel -------------------------------------
  escalateWrap: {
    gap: 8,
    marginTop: 2,
  },
  escalateCopy: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 13,
    lineHeight: 18,
  },
  // -- Card-level escalation banner ---------------------------------
  escalatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  escalatedText: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    fontWeight: "600",
  },
  // -- Clinical guardrail footer ------------------------------------
  // Intentionally subtle: present but not visually competing with the
  // primary action. Smaller text + Regular weight + extra top margin
  // pushes it away from the action area, and a reduced opacity gives
  // it a lighter visual presence than the muted-foreground color
  // alone would.
  guardrail: {
    fontFamily: "Montserrat_400Regular",
    fontSize: 9,
    lineHeight: 13,
    marginTop: 14,
    fontStyle: "italic",
    opacity: 0.65,
  },
});
