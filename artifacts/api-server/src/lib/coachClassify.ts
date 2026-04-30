// AI Coach privacy + classification helpers.
//
// PRIVACY MODEL (PILOT):
// Patient free-text and full AI responses are NOT persisted by
// default. The chat path passes every turn through these helpers to
// derive *structured metadata only* -- category + risk band +
// escalation flags + model + length -- which is what gets written to
// coach_messages and (for escalations) care_events.
//
// The classifier is intentionally a small, deterministic, keyword
// matcher rather than another LLM call -- (a) zero added latency,
// (b) easy to audit, (c) no PHI leaves the process for classification.
// False negatives are acceptable (the existing "Notify your care
// team" button is the patient's manual escape hatch); false positives
// are visible to clinicians but not catastrophic (extra needs-review
// row).
//
// The PHI redactor is ONLY used when COACH_STORE_RAW_MESSAGES=true
// (local dev / debug). It removes the most common direct identifiers
// before any text is written, so even debug rows don't leak PII.
// The default in pilot/production is to skip body persistence
// entirely (allowlist-by-omission), which is strictly safer than
// redact-then-store.

import type {
  CoachMessageCategory,
  CoachRiskCategory,
} from "@workspace/db";

// ---------------------------------------------------------------
// Category classification (allowlisted set, no free text emitted)
// ---------------------------------------------------------------

const CATEGORY_KEYWORDS: Array<{
  category: CoachMessageCategory;
  patterns: RegExp[];
}> = [
  // urgent_concern is checked first so it wins ties
  {
    category: "urgent_concern",
    patterns: [
      /\b(emergency|911|er|hospital|ambulance)\b/i,
      /\b(suicid\w*|kill\s+myself|end\s+(my\s+)?life|self[-\s]?harm)\b/i,
      /\b(chest\s+pain|can'?t\s+breathe|trouble\s+breathing|fainting|unconscious|passed\s+out)\b/i,
      /\b(allergic\s+reaction|anaphyla\w*|swelling.*throat|throat\s+closing)\b/i,
      /\b(severe|unbearable)\s+(pain|vomit\w*|bleed\w*)\b/i,
      /\b(blood\s+in\s+(stool|vomit|urine))\b/i,
      /\b(stop\w*|quit\w*|skip\w*|pausing|coming\s+off|going\s+off)\b.*\b(treatment|medication|med|meds|drug|dose|shot|injection|glp\W*1|semaglutide|tirzepatide|liraglutide|ozempic|wegovy|mounjaro|zepbound|saxenda|rybelsus)\b/i,
    ],
  },
  {
    category: "side_effect",
    patterns: [
      /\b(nausea|nauseous|vomit\w*|throw\s+up|throwing\s+up)\b/i,
      /\b(diarrhea|constipation|bloated|bloating|gas|cramp\w*|reflux|heartburn|burp\w*)\b/i,
      /\b(headache|migraine|dizzy|fatigue|tired|exhausted)\b/i,
      /\b(side[-\s]?effect|reaction|sick|unwell)\b/i,
    ],
  },
  {
    category: "medication_question",
    patterns: [
      /\b(dose|dosing|inject|injection|shot|pen|titrat\w*|refill|missed|skipped|forgot)\b/i,
      /\b(semaglutide|tirzepatide|liraglutide|ozempic|wegovy|mounjaro|zepbound|saxenda|rybelsus|glp\W*1)\b/i,
      /\b(when|how\s+often|how\s+long|should\s+i|can\s+i|is\s+it\s+ok)\b.*\b(med|medication|drug|treatment)\b/i,
    ],
  },
  {
    category: "hydration",
    patterns: [
      /\b(water|hydrat\w*|dehydrat\w*|thirst\w*|electrolyt\w*|fluids?)\b/i,
      /\b(cups?|ounces?|oz|liter|litre)\s*(of\s+)?(water|fluid)/i,
    ],
  },
  {
    category: "nutrition",
    patterns: [
      /\b(eat|eating|ate|food|meal|breakfast|lunch|dinner|snack|protein|carb\w*|fat|fiber|fibre|calor\w*|appetite|hungry|hunger|full|fullness)\b/i,
      /\b(diet|nutrition|portion|recipe|cook\w*|grocer\w*)\b/i,
    ],
  },
  {
    category: "exercise",
    patterns: [
      /\b(workout|exercise|train\w*|gym|strength|cardio|run\w*|walk\w*|hik\w*|yoga|pilates|lift\w*|weights?|steps?)\b/i,
      /\b(activity|active|movement)\b/i,
    ],
  },
  {
    category: "symptom_support",
    patterns: [
      /\b(feel\w*|feeling|mood|stress|stressed|anxious|anxiety|sleep|insomnia|focus|brain\s+fog)\b/i,
      /\b(motivat\w*|encourag\w*|struggling|hard\s+time|tough\s+day)\b/i,
    ],
  },
];

export function classifyCategory(text: string): CoachMessageCategory {
  if (!text) return "other";
  for (const { category, patterns } of CATEGORY_KEYWORDS) {
    if (patterns.some((re) => re.test(text))) return category;
  }
  return "other";
}

// ---------------------------------------------------------------
// Risk + escalation classification
// ---------------------------------------------------------------

const CRITICAL_RE =
  /\b(suicid\w*|kill\s+myself|end\s+(my\s+)?life|self[-\s]?harm|911|emergency|ambulance|chest\s+pain|can'?t\s+breathe|anaphyla\w*|throat\s+closing|unconscious|passed\s+out)\b/i;

const HIGH_RE =
  /\b(severe|unbearable|won'?t\s+stop|getting\s+worse|much\s+worse|all\s+night|days?\s+now)\b/i;

// Reuse the existing treatment-stop heuristic shape but inline here
// so the file stays self-contained.
const STOP_VERB_RE =
  /\b(stop|stopping|stopped|pause|pausing|paused|skip|skipping|skipped|quit|quitting|quitted|discontinu\w*|come\s+off|coming\s+off|get\s+off|getting\s+off|going\s+off|stop\s+taking|hold\s+off)\b/i;
const TREATMENT_ANCHOR_RE =
  /\b(treatment|medication|med|meds|drug|dose|shot|injection|glp\W*1|semaglutide|tirzepatide|liraglutide|ozempic|wegovy|mounjaro|zepbound|saxenda|rybelsus)\b/i;

export function detectTreatmentStopConcern(text: string): boolean {
  if (!text) return false;
  return STOP_VERB_RE.test(text) && TREATMENT_ANCHOR_RE.test(text);
}

export interface RiskAssessment {
  riskCategory: CoachRiskCategory;
  escalationRecommended: boolean;
  safetyFlag: boolean;
  // Coarse reason hint, allowlisted (never raw text). Used in
  // care_events.metadata so a clinician knows WHY a row was raised.
  escalationReason:
    | "safety_critical"
    | "treatment_stop_question"
    | "high_severity_symptoms"
    | null;
}

export function assessRisk(text: string): RiskAssessment {
  if (!text) {
    return {
      riskCategory: "low",
      escalationRecommended: false,
      safetyFlag: false,
      escalationReason: null,
    };
  }
  if (CRITICAL_RE.test(text)) {
    return {
      riskCategory: "critical",
      escalationRecommended: true,
      safetyFlag: true,
      escalationReason: "safety_critical",
    };
  }
  if (detectTreatmentStopConcern(text)) {
    return {
      riskCategory: "high",
      escalationRecommended: true,
      safetyFlag: false,
      escalationReason: "treatment_stop_question",
    };
  }
  if (HIGH_RE.test(text)) {
    return {
      riskCategory: "high",
      escalationRecommended: true,
      safetyFlag: false,
      escalationReason: "high_severity_symptoms",
    };
  }
  return {
    riskCategory: "low",
    escalationRecommended: false,
    safetyFlag: false,
    escalationReason: null,
  };
}

// ---------------------------------------------------------------
// PHI redactor (ONLY used when COACH_STORE_RAW_MESSAGES=true)
// ---------------------------------------------------------------
//
// Best-effort regex pass over the most common direct identifiers.
// This is a defense-in-depth layer for local debugging ONLY -- in
// pilot/production we don't store the body at all, which is the
// strictly safer guarantee. Do NOT rely on this redactor as the sole
// privacy control.

const REDACTORS: Array<{ name: string; re: RegExp; replace: string }> = [
  // Email
  {
    name: "email",
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replace: "[REDACTED_EMAIL]",
  },
  // US-ish phone numbers (10-11 digits, common separators)
  {
    name: "phone",
    re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replace: "[REDACTED_PHONE]",
  },
  // SSN-ish
  {
    name: "ssn",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    replace: "[REDACTED_SSN]",
  },
  // Dates: 1/2/2025, 01-02-2025, 2025-01-02, Jan 2 2025
  {
    name: "date_numeric",
    re: /\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g,
    replace: "[REDACTED_DATE]",
  },
  {
    name: "date_named",
    re: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?\b/gi,
    replace: "[REDACTED_DATE]",
  },
  // Street addresses (house number + street word)
  {
    name: "address",
    re: /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Pl|Place|Way)\b\.?/g,
    replace: "[REDACTED_ADDRESS]",
  },
  // ZIP
  {
    name: "zip",
    re: /\b\d{5}(?:-\d{4})?\b/g,
    replace: "[REDACTED_ZIP]",
  },
  // Insurance / Rx / member numbers (long alphanumeric runs >= 8)
  {
    name: "long_id",
    re: /\b[A-Z]{0,3}\d{8,}\b/g,
    replace: "[REDACTED_ID]",
  },
];

export function redactPHI(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { re, replace } of REDACTORS) {
    out = out.replace(re, replace);
  }
  return out;
}

// ---------------------------------------------------------------
// Config flag
// ---------------------------------------------------------------
//
// In all pilot/production environments this MUST be false. Flip to
// "true" only in local dev when actively debugging a chat issue.
// Even then, body is redacted before storage.
//
// Hard gate: production refuses to honour the flag at all, so a
// misconfigured deploy (env var leaked into prod) cannot persist
// chat bodies. This is a fail-closed guard, not a warning.
export function shouldStoreRawCoachMessages(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.COACH_STORE_RAW_MESSAGES === "true";
}
