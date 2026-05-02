// =====================================================================
// Intervention engine orchestrator (spec Part 5 process)
// =====================================================================
// Single entry point used by the patient API. Sequence:
//   1. Build internal context (PHI may be present -- stays internal).
//   2. Detect triggers; pick the highest-priority one not already
//      represented by an active intervention.
//   3. Build de-identified OpenAI payload.
//   4. If INTERVENTION_AI_MODE=ai_deidentified AND payload passes
//      validateNoPhi(), call OpenAI; on success use that result.
//   5. Otherwise, render from the fallback templates.
//   6. Return a fully-populated InsertPatientIntervention row + a
//      flag list of analytics events the caller should fire.
//
// The orchestrator does NOT write to the DB itself; the route handler
// owns insert + status transitions, so the engine stays pure and
// testable in isolation.

import type {
  PatientInterventionTriggerType,
  PatientInterventionRiskLevel,
  PatientInterventionRecommendationCategory,
  PatientInterventionGeneratedBy,
} from "@workspace/db";
import { logger } from "../logger";
import {
  buildPatientInterventionContext,
  type PatientInterventionContext,
} from "./context";
import {
  detectInterventionTriggers,
  detectCosignals,
  pickBestTrigger,
  type DetectedTrigger,
} from "./triggers";
import { pickTemplate } from "./templates";
import {
  buildDeidentifiedOpenAIInterventionPayload,
  validateNoPhi,
  type DeidentifiedOpenAIInterventionPayload,
} from "./deidentify";
import { isInterventionAiModeEnabled } from "./safeMode";
import { callOpenAiForIntervention } from "./openai";

// Spec Part 9 analytics event taxonomy. Persisted verbatim into
// analytics_events.eventName so the dashboard funnel can group by
// these strings without a translation table.
export type InterventionAnalyticsEvent =
  | "intervention_generated"
  | "intervention_shown"
  | "intervention_accepted"
  | "intervention_dismissed"
  | "intervention_feedback_better"
  | "intervention_feedback_same"
  | "intervention_feedback_worse"
  | "intervention_feedback_didnt_try"
  | "intervention_escalated"
  | "intervention_resolved"
  | "intervention_expired"
  | "intervention_ai_deidentified_payload_used"
  | "intervention_fallback_used"
  | "intervention_phi_guardrail_blocked_ai";

export interface GeneratedIntervention {
  // Fields ready to insert into patient_interventions. Caller does
  // the actual db.insert.
  insertRow: {
    patientUserId: number;
    doctorId: number | null;
    triggerType: PatientInterventionTriggerType;
    symptomType: string | null;
    severity: number | null;
    riskLevel: PatientInterventionRiskLevel;
    contextSummary: PatientInterventionContext;
    deidentifiedAiPayload: DeidentifiedOpenAIInterventionPayload | null;
    whatWeNoticed: string;
    recommendation: string;
    followUpQuestion: string;
    recommendationCategory: PatientInterventionRecommendationCategory | null;
    escalationReason: string | null;
    generatedBy: PatientInterventionGeneratedBy;
  };
  // Analytics events the caller should append (we don't fire them
  // here so the caller can attach req-scoped metadata like userType).
  analyticsEvents: InterventionAnalyticsEvent[];
  // True if the engine recommends this intervention should escalate
  // immediately (e.g. rapid weight change with low appetite). The
  // route handler decides whether to also write a care_event row.
  escalationRecommended: boolean;
}

// Optional inputs from the caller -- override the auto-detected
// trigger when the patient explicitly requested a review or
// specified a symptom.
export interface GenerateInterventionInput {
  patientUserId: number;
  forcedTriggerType?: PatientInterventionTriggerType;
  forcedSymptomType?: string | null;
  forcedSeverity?: number | null;
  // Sensitive substrings (patient name, doctor name, clinic name)
  // that the PHI scanner will reject if found in the de-id payload.
  // Defense-in-depth -- the builder shouldn't include them anyway.
  forbiddenSubstrings?: ReadonlyArray<string>;
}

export async function generatePersonalizedIntervention(
  input: GenerateInterventionInput,
): Promise<GeneratedIntervention | null> {
  const context = await buildPatientInterventionContext(input.patientUserId);
  const cosignals = detectCosignals(context);
  const events: InterventionAnalyticsEvent[] = [];

  // -- Pick trigger --------------------------------------------------
  let trigger: DetectedTrigger | null;
  if (input.forcedTriggerType) {
    trigger = {
      type: input.forcedTriggerType,
      symptomType: input.forcedSymptomType ?? null,
      severity: input.forcedSeverity ?? context.today.severity,
      riskLevel:
        input.forcedTriggerType === "patient_requested_review"
          ? "elevated"
          : "low",
      reason: `forced by caller: ${input.forcedTriggerType}`,
    };
  } else {
    const detected = detectInterventionTriggers(context);
    // Active trigger types we should de-dupe against. ANY trigger
    // currently shown/accepted/pending_feedback/escalated for this
    // patient is suppressed (spec Part 4 "Avoid duplicate spam").
    // We pull the distinct trigger-type set straight from context;
    // using only `lastShownTriggerType` here would let duplicates of
    // OTHER still-active trigger types slip through when a patient
    // has multiple concurrent active interventions.
    const activeTypes = context.priorInterventions.activeTriggerTypes;
    trigger = pickBestTrigger(detected, activeTypes);
  }
  if (!trigger) {
    // Nothing to do -- patient is healthy or already has an active
    // intervention. Caller should treat null as "no new intervention
    // generated" (200 with empty payload).
    return null;
  }

  // -- Build de-id payload ------------------------------------------
  const deidPayload = buildDeidentifiedOpenAIInterventionPayload({
    triggerType: trigger.type,
    riskLevel: trigger.riskLevel,
    context,
  });

  // -- Decide AI vs fallback ----------------------------------------
  const aiModeOn = isInterventionAiModeEnabled();
  const phiCheck = validateNoPhi(
    deidPayload,
    input.forbiddenSubstrings ?? [],
  );
  if (aiModeOn && !phiCheck.ok) {
    // AI was wanted, but the payload tripped the scanner. Log,
    // emit a guardrail event, and fall through to the template path.
    // We log only the structured `reason` string (no PHI in there
    // by construction).
    logger.warn(
      {
        patientUserId: input.patientUserId,
        reason: phiCheck.reason,
        triggerType: trigger.type,
      },
      "intervention_phi_guardrail_blocked_ai",
    );
    events.push("intervention_phi_guardrail_blocked_ai");
  }

  let result: {
    whatWeNoticed: string;
    recommendation: string;
    followUpQuestion: string;
    recommendationCategory:
      | PatientInterventionRecommendationCategory
      | null;
    escalationRecommended: boolean;
    riskLevel: PatientInterventionRiskLevel;
    generatedBy: PatientInterventionGeneratedBy;
    aiPayloadStored: DeidentifiedOpenAIInterventionPayload | null;
  };

  if (aiModeOn && phiCheck.ok) {
    try {
      const ai = await callOpenAiForIntervention(deidPayload);
      result = {
        whatWeNoticed: ai.whatWeNoticed,
        recommendation: ai.recommendation,
        followUpQuestion: ai.followUpQuestion,
        recommendationCategory: ai.recommendationCategory,
        escalationRecommended: ai.escalationRecommended,
        riskLevel: ai.riskLevel,
        generatedBy: "rules_ai_deidentified",
        aiPayloadStored: deidPayload,
      };
      events.push("intervention_ai_deidentified_payload_used");
    } catch (err) {
      // OpenAI failed -- fall through to template. Log structured
      // metadata only (no payload, no prompt body).
      logger.warn(
        {
          patientUserId: input.patientUserId,
          triggerType: trigger.type,
          err: err instanceof Error ? err.message : String(err),
        },
        "intervention_openai_failed_falling_back",
      );
      result = renderFromTemplate(trigger, cosignals, context);
      events.push("intervention_fallback_used");
    }
  } else {
    result = renderFromTemplate(trigger, cosignals, context);
    events.push("intervention_fallback_used");
  }

  events.push("intervention_generated");

  return {
    insertRow: {
      patientUserId: input.patientUserId,
      doctorId: context.doctorId,
      triggerType: trigger.type,
      symptomType: trigger.symptomType,
      severity: trigger.severity,
      riskLevel: result.riskLevel,
      contextSummary: context,
      deidentifiedAiPayload: result.aiPayloadStored,
      whatWeNoticed: result.whatWeNoticed,
      recommendation: result.recommendation,
      followUpQuestion: result.followUpQuestion,
      recommendationCategory: result.recommendationCategory,
      escalationReason: result.escalationRecommended ? trigger.reason : null,
      generatedBy: result.generatedBy,
    },
    analyticsEvents: events,
    escalationRecommended: result.escalationRecommended,
  };
}

function renderFromTemplate(
  trigger: DetectedTrigger,
  cosignals: ReadonlyArray<
    "low_steps" | "low_hydration" | "low_food_intake" | "post_dose" | "poor_sleep" | "low_appetite" | "elevated"
  >,
  _context: PatientInterventionContext,
): {
  whatWeNoticed: string;
  recommendation: string;
  followUpQuestion: string;
  recommendationCategory: PatientInterventionRecommendationCategory | null;
  escalationRecommended: boolean;
  riskLevel: PatientInterventionRiskLevel;
  generatedBy: PatientInterventionGeneratedBy;
  aiPayloadStored: null;
} {
  const tpl = pickTemplate(trigger.type, cosignals);
  if (!tpl) {
    // Spec invariant violated -- every trigger should have a
    // catchall. Return a safe care-team-review fallback so the
    // patient never sees an empty card.
    return {
      whatWeNoticed:
        "Viva noticed something in your recent check-ins worth a closer look.",
      recommendation:
        "Request a care team review so your care team can decide the right next step.",
      followUpQuestion: "Would you like to send this to your care team?",
      recommendationCategory: "care_team_review",
      escalationRecommended: true,
      riskLevel: "moderate",
      generatedBy: "rules_fallback",
      aiPayloadStored: null,
    };
  }
  return {
    whatWeNoticed: tpl.whatWeNoticed,
    recommendation: tpl.recommendation,
    followUpQuestion: tpl.followUpQuestion,
    recommendationCategory: tpl.recommendationCategory,
    escalationRecommended: tpl.escalationRecommended,
    // Use the template's risk level when the trigger is generic
    // ("low" by default) but keep the trigger's risk if it was set
    // higher (e.g. elevated weight change).
    riskLevel:
      trigger.riskLevel === "elevated" || tpl.riskLevel === "elevated"
        ? "elevated"
        : trigger.riskLevel === "moderate" || tpl.riskLevel === "moderate"
          ? "moderate"
          : "low",
    generatedBy: "rules_fallback",
    aiPayloadStored: null,
  };
}
