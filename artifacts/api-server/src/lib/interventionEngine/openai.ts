// =====================================================================
// OpenAI personalization step (spec Part 5)
// =====================================================================
// Called ONLY when:
//   * INTERVENTION_AI_MODE=ai_deidentified, AND
//   * the de-identified payload passed validateNoPhi(), AND
//   * the OpenAI client is configured (env or integration).
//
// On any error or schema mismatch we throw, and the orchestrator
// falls back to a deterministic template. We never log the raw
// prompt or raw response body -- only structured metadata (model,
// generated_by, recommendation_category) and the de-id payload
// itself, which by construction contains no PHI.
//
// Output schema is constrained to the same shape templates use, so
// the downstream lifecycle code does not branch on AI vs fallback.

import { openai } from "@workspace/integrations-openai-ai-server";
import type {
  PatientInterventionRiskLevel,
  PatientInterventionRecommendationCategory,
} from "@workspace/db";
import type { DeidentifiedOpenAIInterventionPayload } from "./deidentify";

export interface AiInterventionResult {
  whatWeNoticed: string;
  recommendation: string;
  followUpQuestion: string;
  riskLevel: PatientInterventionRiskLevel;
  recommendationCategory: PatientInterventionRecommendationCategory;
  escalationRecommended: boolean;
  escalationReason: string | null;
}

const SYSTEM_PROMPT = `You generate short, safe, patient-facing micro-interventions for a GLP-1 telehealth support app. You are not a doctor and must not diagnose, prescribe, change medication or provide emergency care instructions. Use the de-identified patient pattern to personalize the message. Keep the reading level simple. Be direct, supportive and concise. Return JSON only.

The patient may report MULTIPLE concurrent symptoms in a single check-in. The input field "triggers" is the full list of currently relevant symptoms; "trigger" is the highest-priority one. You must produce ONE unified intervention that addresses every entry in "triggers".

The output MUST be a single JSON object with these keys:
- whatWeNoticed: one sentence that names every symptom present in "triggers" (e.g. "Viva noticed nausea, low appetite and constipation in your check-in today.") and refers to the recent pattern
- recommendation: one supportive paragraph. When "triggers" has 2 or more entries, format it as ONE short section per trigger separated by a blank line (\\n\\n), each prefixed with a label like "Nausea support: <one clear action>". When "triggers" has exactly one entry, return one sentence with one clear action and no label.
- followUpQuestion: one sentence asking for feedback after the patient tries the suggestions
- recommendationCategory: one of [hydration, activity, protein, fiber, small_meal, rest, tracking, care_team_review] -- pick the category that best matches the highest-priority trigger
- riskLevel: one of [low, moderate, elevated] -- the maximum across all triggers
- escalationRecommended: boolean -- true if any trigger has riskLevel "elevated"
- escalationReason: string or null

Rules:
- Do not diagnose
- Do not mention medication changes
- Do not mention dose changes
- Do not claim causality
- Use "may," "could," "Viva noticed," "your care team should review" where needed
- Keep each per-symptom section to one sentence with one clear action
- Use only the listed recommendation categories
- Return JSON only, no preamble, no markdown fence`;

const ALLOWED_RECOMMENDATION_CATEGORIES = [
  "hydration",
  "activity",
  "protein",
  "fiber",
  "small_meal",
  "rest",
  "tracking",
  "care_team_review",
] as const;
const ALLOWED_RISK_LEVELS = ["low", "moderate", "elevated"] as const;

function validateAiResult(raw: unknown): AiInterventionResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("ai_invalid_shape");
  }
  const r = raw as Record<string, unknown>;
  const whatWeNoticed = r.whatWeNoticed;
  const recommendation = r.recommendation;
  const followUpQuestion = r.followUpQuestion;
  const recommendationCategory = r.recommendationCategory;
  const riskLevel = r.riskLevel;
  const escalationRecommended = r.escalationRecommended;
  const escalationReason = r.escalationReason;
  if (
    typeof whatWeNoticed !== "string" ||
    whatWeNoticed.length < 10 ||
    whatWeNoticed.length > 280
  ) {
    throw new Error("ai_invalid_whatWeNoticed");
  }
  if (
    typeof recommendation !== "string" ||
    recommendation.length < 10 ||
    // Multi-symptom synthesis can produce up to ~3-4 short sections;
    // raise the cap from the original single-sentence 280 to 1200 so
    // a 4-trigger combined output (e.g. nausea + appetite +
    // constipation + low energy) still fits without truncation.
    recommendation.length > 1200
  ) {
    throw new Error("ai_invalid_recommendation");
  }
  if (
    typeof followUpQuestion !== "string" ||
    followUpQuestion.length < 10 ||
    followUpQuestion.length > 280
  ) {
    throw new Error("ai_invalid_followUpQuestion");
  }
  if (
    typeof recommendationCategory !== "string" ||
    !(ALLOWED_RECOMMENDATION_CATEGORIES as readonly string[]).includes(
      recommendationCategory,
    )
  ) {
    throw new Error("ai_invalid_recommendationCategory");
  }
  if (
    typeof riskLevel !== "string" ||
    !(ALLOWED_RISK_LEVELS as readonly string[]).includes(riskLevel)
  ) {
    throw new Error("ai_invalid_riskLevel");
  }
  if (typeof escalationRecommended !== "boolean") {
    throw new Error("ai_invalid_escalationRecommended");
  }
  if (
    escalationReason != null &&
    (typeof escalationReason !== "string" ||
      escalationReason.length > 200)
  ) {
    throw new Error("ai_invalid_escalationReason");
  }
  return {
    whatWeNoticed,
    recommendation,
    followUpQuestion,
    recommendationCategory:
      recommendationCategory as PatientInterventionRecommendationCategory,
    riskLevel: riskLevel as PatientInterventionRiskLevel,
    escalationRecommended,
    escalationReason: (escalationReason as string | null) ?? null,
  };
}

export async function callOpenAiForIntervention(
  payload: DeidentifiedOpenAIInterventionPayload,
): Promise<AiInterventionResult> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    // Headroom for multi-section output: one labeled sentence per
    // trigger plus the lead/follow-up. 700 keeps cost low while
    // safely accommodating the worst-case 4-symptom synthesis.
    max_completion_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("ai_empty_response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("ai_unparseable_response");
  }
  return validateAiResult(parsed);
}
