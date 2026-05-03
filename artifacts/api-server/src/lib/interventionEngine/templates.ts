// =====================================================================
// Intervention fallback templates (spec Part 5 examples)
// =====================================================================
// In-code, version-controlled, never user-editable. Used in two
// situations:
//   1. INTERVENTION_AI_MODE=fallback (pilot default).
//   2. AI mode is enabled but OpenAI fails OR the de-identified
//      payload trips the PHI scanner.
//
// Both situations must produce a valid, non-diagnostic, patient-
// facing intervention. We pre-compute one template per (trigger
// type + likely co-signal) combination from the spec; the engine
// picks the most-specific match by (trigger, riskLevel, signals).
//
// Why in-code, not in a DB table:
//   * fail-closed: the build itself guarantees a template exists
//     for every trigger we can fire.
//   * audit: template changes ship via code review, not via a
//     back-door admin UI.
//
// Copy is verbatim from spec Part 5 fallback examples.

import type {
  PatientInterventionTriggerType,
  PatientInterventionRiskLevel,
  PatientInterventionRecommendationCategory,
} from "@workspace/db";

export interface InterventionTemplate {
  // Stable id we persist via analytics_events metadata so we can
  // group "which template fired most" without storing body. Versioned
  // by suffix when the text changes meaningfully (e.g. ".v2").
  id: string;
  triggerType: PatientInterventionTriggerType;
  // Co-signal fingerprint that distinguishes templates within the
  // same trigger (e.g. constipation+low_steps vs constipation+
  // low_hydration). Empty array means "any signals" -- the catch-all
  // for the trigger.
  cosignals: ReadonlyArray<
    | "low_steps"
    | "low_hydration"
    | "low_food_intake"
    | "post_dose"
    | "poor_sleep"
    | "low_appetite"
    | "elevated"
  >;
  riskLevel: PatientInterventionRiskLevel;
  recommendationCategory: PatientInterventionRecommendationCategory;
  whatWeNoticed: string;
  recommendation: string;
  followUpQuestion: string;
  escalationRecommended: boolean;
}

// Order matters: we pick the FIRST template whose trigger matches
// AND whose cosignals are all satisfied by the context. The
// catch-all rows (cosignals=[]) come last per trigger so the more
// specific templates win.
export const INTERVENTION_TEMPLATES: ReadonlyArray<InterventionTemplate> = [
  // -- constipation --------------------------------------------------
  {
    id: "constipation.low_steps.v2",
    triggerType: "constipation",
    cosignals: ["low_steps"],
    riskLevel: "low",
    recommendationCategory: "activity",
    whatWeNoticed:
      "You\u2019ve reported constipation 2 days in a row, and your activity has been lower than usual.",
    recommendation:
      "Walk for 10 minutes after your next meal and finish a full glass of water with it.",
    followUpQuestion:
      "After you try it, tell us if your constipation feels better, the same or worse.",
    escalationRecommended: false,
  },
  {
    id: "constipation.low_hydration.v2",
    triggerType: "constipation",
    cosignals: ["low_hydration"],
    riskLevel: "low",
    recommendationCategory: "hydration",
    whatWeNoticed:
      "You reported constipation today and your hydration has been below your usual level.",
    recommendation:
      "Drink one full glass of water now, then keep a bottle nearby and sip steadily over the next 2 hours.",
    followUpQuestion:
      "After you try it, tell us if your stomach feels better, the same or worse.",
    escalationRecommended: false,
  },
  {
    id: "constipation.catchall.v2",
    triggerType: "constipation",
    cosignals: [],
    riskLevel: "low",
    recommendationCategory: "fiber",
    whatWeNoticed:
      "You reported constipation today.",
    recommendation:
      "Add a fiber-rich food (berries, beans, oats or vegetables) to your next meal and sip water steadily through the afternoon.",
    followUpQuestion:
      "After you try it, tell us if your constipation feels better, the same or worse.",
    escalationRecommended: false,
  },

  // -- nausea --------------------------------------------------------
  {
    id: "nausea.low_food_intake.v2",
    triggerType: "nausea",
    cosignals: ["low_food_intake"],
    riskLevel: "moderate",
    recommendationCategory: "small_meal",
    whatWeNoticed:
      "You reported nausea today and your food intake has been lower than usual.",
    recommendation:
      "Try a few bites of bland protein now (yogurt, tofu, soup or a smoothie), then sip water slowly over the next 20 minutes.",
    followUpQuestion:
      "After eating, tell us if your nausea feels better, the same or worse.",
    escalationRecommended: false,
  },
  {
    id: "nausea.post_dose.v2",
    triggerType: "nausea",
    cosignals: ["post_dose"],
    riskLevel: "low",
    recommendationCategory: "small_meal",
    whatWeNoticed:
      "Your nausea showed up within a few days of your most recent dose.",
    recommendation:
      "Keep portions small for the rest of today and sip fluids slowly between bites instead of drinking a lot at once.",
    followUpQuestion:
      "Tell us if the nausea improves, stays the same or gets worse.",
    escalationRecommended: false,
  },
  {
    id: "nausea.catchall.v2",
    triggerType: "nausea",
    cosignals: [],
    riskLevel: "low",
    recommendationCategory: "small_meal",
    whatWeNoticed:
      "You reported nausea today.",
    recommendation:
      "Try a few bites of a bland snack now, then sip water or ginger tea slowly over the next hour.",
    followUpQuestion:
      "After you try it, tell us if your nausea feels better, the same or worse.",
    escalationRecommended: false,
  },

  // -- low_energy ----------------------------------------------------
  {
    id: "low_energy.poor_sleep.v2",
    triggerType: "low_energy",
    cosignals: ["poor_sleep"],
    riskLevel: "low",
    recommendationCategory: "rest",
    whatWeNoticed:
      "Your energy has been low and your sleep was shorter than usual last night.",
    recommendation:
      "Pair your next meal with a protein source (eggs, yogurt, beans or a shake) and plan a 10-minute rest after.",
    followUpQuestion:
      "After your next meal, tell us if your energy feels better, the same or worse.",
    escalationRecommended: false,
  },
  {
    id: "low_energy.catchall.v2",
    triggerType: "low_energy",
    cosignals: [],
    riskLevel: "low",
    recommendationCategory: "protein",
    whatWeNoticed:
      "Your energy has been lower than usual.",
    recommendation:
      "Add a protein source (Greek yogurt, eggs, beans, tofu or a shake) to your next meal and take a 5-minute break before the next task.",
    followUpQuestion:
      "After your next meal, tell us if your energy feels better, the same or worse.",
    escalationRecommended: false,
  },

  // -- low_hydration -------------------------------------------------
  {
    id: "low_hydration.catchall.v2",
    triggerType: "low_hydration",
    cosignals: [],
    riskLevel: "low",
    recommendationCategory: "hydration",
    whatWeNoticed:
      "Your hydration has been below your usual level for 2 days.",
    recommendation:
      "Sip water or an electrolyte drink steadily over the next 2 hours \u2014 small sips every 10 minutes is easier than gulping a bottle at once.",
    followUpQuestion:
      "Tell us if your energy or symptoms feel better afterward.",
    escalationRecommended: false,
  },

  // -- low_food_intake -----------------------------------------------
  {
    id: "low_food_intake.catchall.v2",
    triggerType: "low_food_intake",
    cosignals: [],
    riskLevel: "moderate",
    recommendationCategory: "protein",
    whatWeNoticed:
      "Your food intake has been lower than usual.",
    recommendation:
      "Add one protein-rich snack now (Greek yogurt, tofu, soup or a smoothie), then sip water or electrolytes over the next hour.",
    followUpQuestion:
      "After eating, tell us if your appetite feels better, the same or worse.",
    escalationRecommended: false,
  },

  // -- missed_checkin ------------------------------------------------
  {
    id: "missed_checkin.catchall.v2",
    triggerType: "missed_checkin",
    cosignals: [],
    riskLevel: "low",
    recommendationCategory: "tracking",
    whatWeNoticed:
      "You haven\u2019t checked in recently, so Viva may be missing important updates.",
    recommendation:
      "Take 30 seconds to check in now so your care team has a current picture of how you feel.",
    followUpQuestion:
      "After checking in, tell us if anything needs attention.",
    escalationRecommended: false,
  },

  // -- rapid_weight_change ------------------------------------------
  {
    id: "rapid_weight_change.elevated.v2",
    triggerType: "rapid_weight_change",
    cosignals: ["low_appetite"],
    riskLevel: "elevated",
    recommendationCategory: "protein",
    whatWeNoticed:
      "Your weight is dropping faster than usual this week and your appetite has been lower.",
    recommendation:
      "Add one protein-rich snack today (Greek yogurt, tofu, soup or a smoothie). Your care team can also review this if you\u2019d like.",
    followUpQuestion:
      "Would you like your care team to review this?",
    escalationRecommended: true,
  },
  {
    id: "rapid_weight_change.catchall.v2",
    triggerType: "rapid_weight_change",
    cosignals: [],
    riskLevel: "elevated",
    recommendationCategory: "care_team_review",
    whatWeNoticed:
      "Your weight is dropping faster than usual this week.",
    recommendation:
      "Request a care team review so your care team can decide the right next step.",
    followUpQuestion:
      "Would you like to send this to your care team?",
    escalationRecommended: true,
  },

  // -- worsening_symptom --------------------------------------------
  {
    id: "worsening_symptom.catchall.v2",
    triggerType: "worsening_symptom",
    cosignals: [],
    riskLevel: "moderate",
    recommendationCategory: "care_team_review",
    whatWeNoticed:
      "Your symptoms have not improved over the last few days.",
    recommendation:
      "Request a care team review so your care team can decide the right next step.",
    followUpQuestion:
      "Would you like to send this to your care team?",
    escalationRecommended: true,
  },

  // -- repeated_symptom ---------------------------------------------
  {
    id: "repeated_symptom.catchall.v2",
    triggerType: "repeated_symptom",
    cosignals: [],
    riskLevel: "moderate",
    recommendationCategory: "tracking",
    whatWeNoticed:
      "You\u2019ve reported the same symptom several days in a row.",
    recommendation:
      "Try the same support that worked before. If it doesn\u2019t help by tomorrow, we\u2019ll suggest the next step.",
    followUpQuestion:
      "Tell us if it feels better, the same or worse over the next day.",
    escalationRecommended: false,
  },

  // -- patient_requested_review -------------------------------------
  {
    id: "patient_requested_review.catchall.v1",
    triggerType: "patient_requested_review",
    cosignals: [],
    riskLevel: "elevated",
    recommendationCategory: "care_team_review",
    whatWeNoticed:
      "You asked for your care team to take a look.",
    recommendation:
      "Your request has been sent. Your care team will review your recent symptoms and follow up.",
    followUpQuestion:
      "While you wait, tell us if anything changes for better or worse.",
    escalationRecommended: true,
  },
];

// =====================================================================
// Multi-symptom synthesis (fallback path)
// =====================================================================
// When the patient reports multiple concurrent symptoms (e.g.
// nausea + low appetite + constipation) AND we are in the fallback
// path (AI mode off OR OpenAI failed OR PHI guardrail blocked AI),
// we still need to surface ONE unified Personalized check-in card.
// Strategy:
//   * Pick the highest-priority trigger as the "primary" -- its
//     template drives whatWeNoticed (the lead sentence) and the
//     followUpQuestion (asked once, not per-symptom).
//   * For every relevant trigger, pull its catchall template and
//     compose a "Symptom support" section into a single combined
//     `recommendation` string. Sections are joined with double
//     newlines so the card renderer can either render them as a
//     paragraph block or split on \n\n if it wants visible sections.
//   * The recommendationCategory comes from the primary trigger's
//     template so the analytics taxonomy stays meaningful.
//   * escalationRecommended is true if ANY trigger's template flags it.
//   * riskLevel is the max across all triggers' templates and the
//     primary trigger's own riskLevel.

export interface SynthesizedFallbackResult {
  whatWeNoticed: string;
  recommendation: string;
  followUpQuestion: string;
  recommendationCategory: PatientInterventionRecommendationCategory | null;
  riskLevel: PatientInterventionRiskLevel;
  escalationRecommended: boolean;
  templateIdsUsed: string[];
}

// Friendly labels per trigger type for the synthesized section
// headers ("Nausea support: ...", "Constipation support: ..."). Kept
// here (not in the trigger-detection module) because this is a
// presentation concern -- the engine doesn't otherwise need it.
const TRIGGER_LABEL: Record<PatientInterventionTriggerType, string> = {
  nausea: "Nausea support",
  constipation: "Constipation support",
  low_energy: "Energy support",
  low_food_intake: "Appetite support",
  low_hydration: "Hydration support",
  rapid_weight_change: "Weight check",
  worsening_symptom: "Symptom check",
  missed_checkin: "Check-in reminder",
  repeated_symptom: "Repeat-symptom note",
  patient_requested_review: "Care team review",
};

const RISK_PRIORITY_LOCAL: Record<PatientInterventionRiskLevel, number> = {
  elevated: 3,
  moderate: 2,
  low: 1,
};

function maxRisk(
  a: PatientInterventionRiskLevel,
  b: PatientInterventionRiskLevel,
): PatientInterventionRiskLevel {
  return RISK_PRIORITY_LOCAL[a] >= RISK_PRIORITY_LOCAL[b] ? a : b;
}

// Build a unified what-we-noticed lead sentence that names every
// detected symptom in plain English. Falls back to the primary
// template's whatWeNoticed when only one trigger is present so we
// don't rewrite working copy unnecessarily.
function buildLeadSentence(
  triggers: ReadonlyArray<{
    type: PatientInterventionTriggerType;
    primaryWhatWeNoticed: string;
  }>,
): string {
  if (triggers.length === 0) return "";
  if (triggers.length === 1) {
    return triggers[0]!.primaryWhatWeNoticed;
  }
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const t of triggers) {
    const phrase = (() => {
      switch (t.type) {
        case "nausea":
          return "nausea";
        case "constipation":
          return "constipation";
        case "low_energy":
          return "low energy";
        case "low_food_intake":
          return "low appetite";
        case "low_hydration":
          return "low hydration";
        case "rapid_weight_change":
          return "a faster weight drop than usual";
        default:
          return null;
      }
    })();
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      phrases.push(phrase);
    }
  }
  if (phrases.length === 0) {
    return triggers[0]!.primaryWhatWeNoticed;
  }
  const joined =
    phrases.length === 1
      ? phrases[0]!
      : phrases.length === 2
        ? `${phrases[0]} and ${phrases[1]}`
        : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  return `Viva noticed ${joined} in your check-in today.`;
}

export function renderSynthesizedFallback(
  triggers: ReadonlyArray<{
    type: PatientInterventionTriggerType;
    riskLevel: PatientInterventionRiskLevel;
  }>,
  availableCosignals: ReadonlyArray<InterventionTemplate["cosignals"][number]>,
): SynthesizedFallbackResult | null {
  if (triggers.length === 0) return null;

  // Pull the matching template for each trigger.
  type Section = {
    type: PatientInterventionTriggerType;
    template: InterventionTemplate;
    triggerRisk: PatientInterventionRiskLevel;
  };
  const sections: Section[] = [];
  for (const t of triggers) {
    const tpl = pickTemplate(t.type, availableCosignals);
    if (!tpl) continue;
    sections.push({ type: t.type, template: tpl, triggerRisk: t.riskLevel });
  }
  if (sections.length === 0) return null;

  const primary = sections[0]!;

  // Lead sentence: name every symptom for the multi-trigger case;
  // delegate to the single template otherwise.
  const lead = buildLeadSentence(
    sections.map((s) => ({
      type: s.type,
      primaryWhatWeNoticed: s.template.whatWeNoticed,
    })),
  );

  // Recommendation: one section per trigger when there are 2+
  // symptoms, joined by double newlines. With only one trigger we
  // just use the template's recommendation verbatim so the existing
  // single-symptom copy is unchanged.
  const recommendation =
    sections.length === 1
      ? primary.template.recommendation
      : sections
          .map(
            (s) =>
              `${TRIGGER_LABEL[s.type] ?? "Symptom support"}: ${s.template.recommendation}`,
          )
          .join("\n\n");

  // Follow-up: ask once. Use the primary template's follow-up so the
  // copy stays specific to the highest-priority symptom.
  const followUpQuestion = primary.template.followUpQuestion;

  // Risk: max of all triggers and all template risk levels.
  let risk: PatientInterventionRiskLevel = "low";
  for (const s of sections) {
    risk = maxRisk(risk, s.template.riskLevel);
    risk = maxRisk(risk, s.triggerRisk);
  }

  const escalationRecommended = sections.some(
    (s) => s.template.escalationRecommended,
  );

  return {
    whatWeNoticed: lead,
    recommendation,
    followUpQuestion,
    recommendationCategory: primary.template.recommendationCategory,
    riskLevel: risk,
    escalationRecommended,
    templateIdsUsed: sections.map((s) => s.template.id),
  };
}

// Pick the best template for (trigger, available cosignals).
// Returns null if no template for that trigger exists -- callers
// should treat that as a programming error (every trigger MUST have
// at least a catchall).
export function pickTemplate(
  trigger: PatientInterventionTriggerType,
  availableCosignals: ReadonlyArray<InterventionTemplate["cosignals"][number]>,
): InterventionTemplate | null {
  const candidates = INTERVENTION_TEMPLATES.filter(
    (t) => t.triggerType === trigger,
  );
  if (candidates.length === 0) return null;
  // First match where all required cosignals are present in the
  // context. The list is ordered most-specific-first, so the
  // catchall (cosignals=[]) only wins when nothing else matches.
  for (const c of candidates) {
    const allPresent = c.cosignals.every((sig) =>
      availableCosignals.includes(sig),
    );
    if (allPresent) return c;
  }
  // Defensive: spec says every trigger has a catchall, but if a
  // future edit breaks that invariant, return the last candidate
  // rather than null so callers always get a valid template.
  return candidates[candidates.length - 1] ?? null;
}
