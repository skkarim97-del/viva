// =====================================================================
// Coach safe-mode response templates (T006)
// =====================================================================
// In-code, version-controlled, never user-editable. The patient picks
// (category, severity) on the mobile UI; the server returns the
// matching template's content verbatim. No OpenAI call. No PHI ever
// leaves the device for these turns -- the server only sees the
// (category, severity) pair plus the patient id.
//
// Why in-code, not in a DB table:
//  * fail-closed: if the table were missing/empty, the route would
//    have to either return nothing or fall back to OpenAI -- both
//    bad. With in-code templates the build itself guarantees a
//    response exists for every (category, severity) cell.
//  * audit: template changes ship via code review, not via a back-
//    door admin UI.
//  * persistence: we still store a `responseTemplateId` on the
//    coach_messages row, so analytics can answer "which template
//    fired most" without us keeping the body text.
//
// Severity language is calibrated for a non-clinical audience:
//   mild    = "noticeable but tolerable"
//   moderate = "interfering with my day"
//   severe   = "affecting my ability to function or feels alarming"
// The mobile picker copies these descriptions verbatim.

import type {
  CoachMessageCategory,
  CoachRiskCategory,
} from "@workspace/db";

export const COACH_SEVERITIES = ["mild", "moderate", "severe"] as const;
export type CoachSeverity = (typeof COACH_SEVERITIES)[number];

export type CoachTemplate = {
  // Stable id we persist on coach_messages.response_template_id so
  // we can group analytics by template without storing the body.
  // Format: `${category}.${severity}` -- versioned by changing the
  // suffix when a template's text changes meaningfully (e.g. ".v2").
  id: string;
  category: CoachMessageCategory;
  severity: CoachSeverity;
  // Server-derived risk band that we mirror onto coach_messages so
  // doctor dashboards can filter by risk without re-running the
  // free-text classifier (which doesn't run in safe mode).
  riskCategory: CoachRiskCategory;
  // True -> we additionally insert a care_events row of type
  // 'escalation_requested' so the doctor sees this in their queue
  // immediately. Independent of the per-doctor notification fan-out.
  escalate: boolean;
  // Patient-facing reply text. PHI-free by construction (no patient
  // identifiers, no biometrics, no medication names beyond generic
  // "GLP-1" framing).
  content: string;
};

const ESCALATION_FOOTER =
  "\n\nBecause this sounds like it warrants a clinician's eyes, your care team has been notified and someone will reach out. If you feel like you need help sooner than that, call your provider's office or, if this is an emergency, call 911.";

const STANDARD_FOOTER =
  "\n\nIf this changes or gets worse, log a check-in or message your care team -- we'd rather hear from you early.";

const SAFETY_FOOTER =
  "\n\nIf you're having chest pain, trouble breathing, fainting, severe dehydration, signs of a serious allergic reaction, or thoughts of harming yourself, stop and call 911 or your local emergency number now.";

// One row per (category, severity). Editing this table is the entire
// "how does the safe-mode coach respond" surface area.
const TEMPLATES: CoachTemplate[] = [
  // ----- symptom_support -------------------------------------------
  {
    id: "symptom_support.mild",
    category: "symptom_support",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "Mild symptoms are common, especially in the first few weeks of GLP-1 treatment or after a dose change. The usual playbook helps a lot: eat small, slow, low-fat meals; sip water steadily through the day; and avoid lying down right after eating. Most people see this settle within 1-2 weeks." +
      STANDARD_FOOTER,
  },
  {
    id: "symptom_support.moderate",
    category: "symptom_support",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "Symptoms that interfere with your day are worth tracking carefully. Try the standard supports (small meals, steady fluids, avoiding heavy or greasy food) and log a daily check-in so your care team can see the pattern. If this doesn't improve in a few days -- or if it gets worse -- it's time to message your care team about a possible adjustment." +
      STANDARD_FOOTER,
  },
  {
    id: "symptom_support.severe",
    category: "symptom_support",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Severe symptoms -- the kind that stop you from doing your normal day -- are not something to push through alone." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- medication_question ---------------------------------------
  {
    id: "medication_question.mild",
    category: "medication_question",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "General medication questions are best answered by the clinician who prescribed it -- they have your full history. For day-to-day timing and storage questions, your treatment plan in the app has the basics. If your question is about whether to take or skip a dose, please don't decide alone -- message your care team." +
      STANDARD_FOOTER,
  },
  {
    id: "medication_question.moderate",
    category: "medication_question",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "When a medication question is starting to affect how you take your treatment, it's time to involve your care team. Don't change your dose, skip a week, or stop without checking first -- GLP-1 protocols are sensitive to gaps. Send your care team a message describing what you're seeing and they can guide the next step." +
      STANDARD_FOOTER,
  },
  {
    id: "medication_question.severe",
    category: "medication_question",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Urgent questions about your medication -- especially anything involving stopping, changing dose, or a reaction -- need clinician input the same day." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- side_effect -----------------------------------------------
  {
    id: "side_effect.mild",
    category: "side_effect",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "Mild side effects are extremely common in the first weeks of GLP-1 treatment, especially nausea, mild stomach upset, and lower appetite. The standard supports help most people: small frequent meals, steady fluids, and avoiding heavy or greasy food. It usually fades within 1-2 weeks." +
      STANDARD_FOOTER,
  },
  {
    id: "side_effect.moderate",
    category: "side_effect",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "Side effects that are interfering with your day are worth a closer look. Keep logging your daily check-in so your care team can see the trend, stay well hydrated, and try smaller meals. If this hasn't eased in a few days, message your care team -- there are often small adjustments that help a lot." +
      STANDARD_FOOTER,
  },
  {
    id: "side_effect.severe",
    category: "side_effect",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Severe side effects -- repeated vomiting, signs of dehydration, severe abdominal pain, or anything that feels alarming -- are not normal and need to be evaluated." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- nutrition --------------------------------------------------
  {
    id: "nutrition.mild",
    category: "nutrition",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "On a GLP-1, most people do best with small, protein-forward meals (a palm-sized portion of protein with each meal), slow eating, and avoiding heavy or greasy foods that often trigger nausea. The Today screen tracks your protein and hydration so you can see your patterns." +
      STANDARD_FOOTER,
  },
  {
    id: "nutrition.moderate",
    category: "nutrition",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "If meals are becoming a struggle -- low appetite, food aversions, hard to hit your protein -- you're not alone. Try liquid protein (shakes, broths, Greek yogurt), smaller more frequent portions, and don't force foods that turn your stomach. If you're losing weight faster than your plan or skipping meals consistently, message your care team." +
      STANDARD_FOOTER,
  },
  {
    id: "nutrition.severe",
    category: "nutrition",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Not being able to eat or drink, severe food aversion, or rapid unintended weight loss are real concerns on GLP-1 therapy and need clinician attention." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- hydration --------------------------------------------------
  {
    id: "hydration.mild",
    category: "hydration",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "GLP-1 medications can dull thirst, so steady sipping beats waiting until you're thirsty. A reasonable target is around half your body weight in ounces per day, more if you're active or it's hot. Adding electrolytes (a pinch of salt, an electrolyte mix, or broth) helps if plain water isn't sticking." +
      STANDARD_FOOTER,
  },
  {
    id: "hydration.moderate",
    category: "hydration",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "Mild signs of dehydration (headache, dark urine, dizziness when standing) can pile up quickly on GLP-1 therapy. Prioritize fluids with electrolytes, take a break from caffeine and alcohol for the day, and rest. If symptoms aren't easing in a few hours of steady fluids, message your care team." +
      STANDARD_FOOTER,
  },
  {
    id: "hydration.severe",
    category: "hydration",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Severe dehydration -- lightheadedness, very little urine output, persistent vomiting that prevents you from keeping fluids down -- is not something to manage alone." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- exercise ---------------------------------------------------
  {
    id: "exercise.mild",
    category: "exercise",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "On GLP-1 therapy, gentle, consistent movement (walking, light strength work, easy bike rides) tends to feel best. Lower appetite means you have less fuel on board, so back off intensity if you feel unusually drained, and prioritize protein and fluids around training." +
      STANDARD_FOOTER,
  },
  {
    id: "exercise.moderate",
    category: "exercise",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "If exercise is feeling noticeably harder than it should -- low energy, dizziness on exertion, harder recovery -- that's worth taking seriously. Drop intensity for a few days, focus on fueling around workouts (a small protein/carb snack ~1 hour before), and log how you're feeling. If it's not bouncing back, message your care team." +
      STANDARD_FOOTER,
  },
  {
    id: "exercise.severe",
    category: "exercise",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Chest pain, severe shortness of breath, fainting, or feeling 'wrong' during or after exercise are not things to push through." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- urgent_concern (always escalates) -------------------------
  {
    id: "urgent_concern.mild",
    category: "urgent_concern",
    severity: "mild",
    riskCategory: "medium",
    escalate: true,
    content:
      "Thanks for flagging this. Even when something feels manageable, when you label it 'urgent' we want a clinician to see it." +
      ESCALATION_FOOTER,
  },
  {
    id: "urgent_concern.moderate",
    category: "urgent_concern",
    severity: "moderate",
    riskCategory: "high",
    escalate: true,
    content:
      "We're treating this as an urgent concern and routing it to your care team now." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  {
    id: "urgent_concern.severe",
    category: "urgent_concern",
    severity: "severe",
    riskCategory: "critical",
    escalate: true,
    content:
      "We're treating this as a critical concern. Please don't wait for a callback if your situation is unsafe right now." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
  // ----- other ------------------------------------------------------
  {
    id: "other.mild",
    category: "other",
    severity: "mild",
    riskCategory: "low",
    escalate: false,
    content:
      "Thanks for the update. While we're in pilot mode, the coach is working from a structured set of categories so we can guarantee your privacy and safety. If your question doesn't fit one of the categories above, please send your care team a direct message and they'll get back to you." +
      STANDARD_FOOTER,
  },
  {
    id: "other.moderate",
    category: "other",
    severity: "moderate",
    riskCategory: "medium",
    escalate: false,
    content:
      "Thanks for letting us know this is affecting your day. While the pilot coach is structured-only, your care team can answer free-text questions directly -- please send them a message describing what's going on." +
      STANDARD_FOOTER,
  },
  {
    id: "other.severe",
    category: "other",
    severity: "severe",
    riskCategory: "high",
    escalate: true,
    content:
      "Even when something doesn't fit a standard category, 'severe' is enough for us to bring a clinician in." +
      SAFETY_FOOTER +
      ESCALATION_FOOTER,
  },
];

// Build a (category, severity) -> template lookup once at module load.
const TEMPLATE_INDEX: Map<string, CoachTemplate> = new Map(
  TEMPLATES.map((t) => [`${t.category}::${t.severity}`, t]),
);

export function getCoachTemplate(
  category: CoachMessageCategory,
  severity: CoachSeverity,
): CoachTemplate {
  const hit = TEMPLATE_INDEX.get(`${category}::${severity}`);
  if (hit) return hit;
  // Defense in depth: fall back to other.severe (the most cautious
  // template) if a future category lands without templates. This
  // should be unreachable given the validation in /coach/structured.
  const fallback = TEMPLATE_INDEX.get("other::severe");
  if (!fallback) {
    throw new Error("coach templates table is empty");
  }
  return fallback;
}

export function listCoachCategories(): readonly CoachMessageCategory[] {
  // Re-exported indirectly so the mobile UI can build the picker
  // from a single source of truth. Returns the keys we actually
  // have templates for, in display order.
  return [
    "symptom_support",
    "side_effect",
    "medication_question",
    "nutrition",
    "hydration",
    "exercise",
    "urgent_concern",
    "other",
  ] as const;
}
