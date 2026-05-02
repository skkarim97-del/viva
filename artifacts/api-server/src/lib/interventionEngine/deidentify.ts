// =====================================================================
// PHI guardrail for the OpenAI personalization step (spec Part 1)
// =====================================================================
// Two responsibilities:
//   1. buildDeidentifiedOpenAIInterventionPayload(context) -- accepts
//      the full internal context object and returns ONLY the safe
//      enum/bucket fields the OpenAI prompt is allowed to see.
//   2. validateNoPhi(payload) -- runtime scanner that re-serializes
//      whatever the builder returned and rejects it if any value
//      looks like PHI (email, phone, ISO date, long digit strings,
//      or a known sensitive substring like the patient's name).
//
// The build step is the FIRST line of defense (whitelist; only the
// listed enum fields are copied). The validator is the SECOND line
// (defense in depth; catches a future regression where an engineer
// accidentally pipes through a PHI-bearing field). On any guardrail
// failure the engine MUST fall back to a deterministic template
// and emit `intervention_phi_guardrail_blocked_ai`.
//
// PRIVACY MODEL:
//   * Inputs: full PatientInterventionContext, may contain PHI.
//   * Outputs: a fixed-shape struct of literal/enum values only.
//   * Free-text fields are not parameters and not output.
//   * The validator failure-closes -- if it CAN'T tell, it rejects.

import type {
  PatientInterventionTriggerType,
  PatientInterventionRiskLevel,
  PatientInterventionRecommendationCategory,
} from "@workspace/db";
import type { PatientInterventionContext } from "./context";

// The de-id payload that crosses the OpenAI boundary. Every field is
// either an enum string or a coarse bucket label. No raw numbers
// (steps go to "down 35% vs baseline", not 4200), no exact dates,
// no identifiers.
export interface DeidentifiedOpenAIInterventionPayload {
  trigger: {
    type: PatientInterventionTriggerType;
    severityBucket: "mild" | "moderate" | "severe" | "unknown";
    riskLevel: PatientInterventionRiskLevel;
  };
  recentPattern: {
    symptomPattern: string; // e.g. "reported 2 days in a row"
    hydrationTrend: "low" | "below_usual" | "near_baseline" | "unknown";
    activityTrend: "down_significant" | "down_some" | "near_baseline" | "unknown";
    sleepTrend: "below_baseline" | "near_baseline" | "unknown";
    weightTrend: "stable" | "down_fast" | "down_slow" | "unknown";
    doseTiming:
      | "within_post_dose_window"
      | "outside_post_dose_window"
      | "unknown";
  };
  priorInterventionFeedback: {
    lastRelevantFeedback:
      | "better"
      | "same"
      | "worse"
      | "didnt_try"
      | "none";
    unresolvedSimilarIntervention: boolean;
  };
  allowedActionCategories: ReadonlyArray<PatientInterventionRecommendationCategory>;
}

// Fixed allowlist of recommendation categories. The OpenAI prompt
// is constrained to choose one of these; we send this list as part
// of the payload so the model can't hallucinate categories outside
// our taxonomy.
const ALLOWED_ACTION_CATEGORIES: ReadonlyArray<PatientInterventionRecommendationCategory> =
  [
    "hydration",
    "activity",
    "protein",
    "fiber",
    "small_meal",
    "rest",
    "tracking",
    "care_team_review",
  ];

// Map raw numeric severity (1..5) to an enum bucket. This is the
// only place severity numbers get translated; the OpenAI payload
// never sees the integer.
function severityBucket(
  severity: number | null | undefined,
): "mild" | "moderate" | "severe" | "unknown" {
  if (severity == null) return "unknown";
  if (severity <= 2) return "mild";
  if (severity <= 3) return "moderate";
  return "severe";
}

function activityTrendBucket(
  pct: number | null | undefined,
): "down_significant" | "down_some" | "near_baseline" | "unknown" {
  if (pct == null) return "unknown";
  if (pct <= -25) return "down_significant";
  if (pct <= -10) return "down_some";
  return "near_baseline";
}

function weightTrendBucket(
  changeLbs: number | null | undefined,
): "stable" | "down_fast" | "down_slow" | "unknown" {
  if (changeLbs == null) return "unknown";
  // Down >3 lbs in a week is the rapid-loss threshold the trigger
  // engine uses; any down at all is "down_slow", otherwise "stable".
  if (changeLbs <= -3) return "down_fast";
  if (changeLbs <= -0.5) return "down_slow";
  return "stable";
}

function symptomPatternLabel(
  triggerType: PatientInterventionTriggerType,
  context: PatientInterventionContext,
): string {
  const days7 = context.last7Days;
  const repeatedDays =
    triggerType === "constipation"
      ? days7.constipationDays
      : triggerType === "nausea"
        ? days7.nauseaDays
        : triggerType === "low_energy"
          ? days7.lowEnergyDays
          : 0;
  if (repeatedDays >= 2) {
    return `reported ${repeatedDays} days in last 7`;
  }
  if (triggerType === "missed_checkin" && days7.missedCheckins >= 2) {
    return `${days7.missedCheckins} missed check-ins in last 7`;
  }
  return "reported today";
}

export function buildDeidentifiedOpenAIInterventionPayload(args: {
  triggerType: PatientInterventionTriggerType;
  riskLevel: PatientInterventionRiskLevel;
  context: PatientInterventionContext;
}): DeidentifiedOpenAIInterventionPayload {
  const { triggerType, riskLevel, context } = args;
  const today = context.today;
  const last7 = context.last7Days;

  // Hydration trend: latest reading vs. 7-day pattern.
  let hydrationTrend: DeidentifiedOpenAIInterventionPayload["recentPattern"]["hydrationTrend"] =
    "unknown";
  if (today.hydration === "low" || today.hydration === "dehydrated") {
    hydrationTrend = "low";
  } else if (today.hydration === "good" || today.hydration === "hydrated") {
    hydrationTrend = "near_baseline";
  } else if (last7.lowHydrationDays >= 2) {
    hydrationTrend = "below_usual";
  }

  // Sleep trend: today's hours vs. baseline (~7 hours adults).
  let sleepTrend: DeidentifiedOpenAIInterventionPayload["recentPattern"]["sleepTrend"] =
    "unknown";
  if (today.sleepHours != null) {
    sleepTrend = today.sleepHours < 6 ? "below_baseline" : "near_baseline";
  }

  // Dose timing: 0..3 days post-dose is the "post-dose window" per
  // spec Part 4 trigger #5.
  let doseTiming: DeidentifiedOpenAIInterventionPayload["recentPattern"]["doseTiming"] =
    "unknown";
  if (context.treatment.daysSinceLastDose != null) {
    doseTiming =
      context.treatment.daysSinceLastDose <= 3
        ? "within_post_dose_window"
        : "outside_post_dose_window";
  }

  return {
    trigger: {
      type: triggerType,
      severityBucket: severityBucket(today.severity),
      riskLevel,
    },
    recentPattern: {
      symptomPattern: symptomPatternLabel(triggerType, context),
      hydrationTrend,
      activityTrend: activityTrendBucket(last7.stepsChangePct),
      sleepTrend,
      weightTrend: weightTrendBucket(last7.weightChangeLbs),
      doseTiming,
    },
    priorInterventionFeedback: {
      lastRelevantFeedback: context.priorInterventions.lastFeedback ?? "none",
      unresolvedSimilarIntervention:
        context.priorInterventions.repeatedUnresolved,
    },
    allowedActionCategories: ALLOWED_ACTION_CATEGORIES,
  };
}

// =====================================================================
// PHI scanner. Runtime defense-in-depth.
// =====================================================================

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// Phone: 10+ consecutive digits (with optional spaces/dashes/parens).
const PHONE_RE = /(?:\+?\d[\s.\-()]*){10,}/;
// ISO-8601 date or datetime ("2024-09-15", "2024-09-15T10:30:00Z").
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/;
// Long digit string -- catches user IDs, raw timestamps, MRN-style
// identifiers. The de-id payload should never carry numbers > 4 digits;
// even step counts have been bucketed.
const LONG_DIGIT_RE = /\d{5,}/;
// SSN-style.
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

export interface PhiScanResult {
  ok: boolean;
  // Reason is intentionally vague (no PHI in the reason itself) so
  // it's safe to include in logs and analytics events.
  reason?:
    | "email_pattern"
    | "phone_pattern"
    | "iso_date_pattern"
    | "long_digit_pattern"
    | "ssn_pattern"
    | "sensitive_substring"
    | "value_too_long"
    | "non_serializable";
}

export function validateNoPhi(
  payload: unknown,
  forbiddenSubstrings: ReadonlyArray<string> = [],
): PhiScanResult {
  // Fail closed: if we cannot serialize, reject.
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { ok: false, reason: "non_serializable" };
  }
  if (serialized.length > 8 * 1024) {
    // Anything > 8KB is suspicious for our payload shape; reject.
    return { ok: false, reason: "value_too_long" };
  }
  if (EMAIL_RE.test(serialized)) {
    return { ok: false, reason: "email_pattern" };
  }
  if (SSN_RE.test(serialized)) {
    return { ok: false, reason: "ssn_pattern" };
  }
  if (PHONE_RE.test(serialized)) {
    return { ok: false, reason: "phone_pattern" };
  }
  if (ISO_DATE_RE.test(serialized)) {
    return { ok: false, reason: "iso_date_pattern" };
  }
  if (LONG_DIGIT_RE.test(serialized)) {
    return { ok: false, reason: "long_digit_pattern" };
  }
  // Sensitive-substring check: caller passes in known patient/clinic/
  // doctor names so a regression that splices them into the payload
  // is caught here. Comparison is case-insensitive but exact-substring
  // (no leetspeak heuristics; that's not the threat we defend against).
  const lower = serialized.toLowerCase();
  for (const s of forbiddenSubstrings) {
    if (!s) continue;
    if (s.length < 2) continue; // skip single chars, too noisy
    if (lower.includes(s.toLowerCase())) {
      return { ok: false, reason: "sensitive_substring" };
    }
  }
  return { ok: true };
}
