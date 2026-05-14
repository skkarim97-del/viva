// Centralized legal and clinical responsibility copy for Viva Clinic.
// Single source of truth — import constants from here rather than
// inlining strings in components.
//
// Tone rules: enterprise-grade, clinical, calm. One global anchor in
// the footer plus small contextual notices on higher-risk surfaces only.

export const LEGAL = {
  CORE_CLINICAL_RESPONSIBILITY:
    "Viva supports between-visit care, patient visibility and provider decision-making. Viva does not replace clinical judgment, medical advice, diagnosis, treatment, prescribing or emergency care.",

  PROVIDER_DECISION_SUPPORT:
    "Viva supports provider decision-making. Clinical decisions remain the responsibility of the treating provider.",

  PATIENT_INSIGHTS_NOTICE:
    "Patient insights are based on check-ins, care activity and available health signals.",

  GENERATED_SUMMARY_NOTICE:
    "Review for accuracy before using in clinical documentation or decision-making.",

  ESCALATION_NOTICE:
    "Patient-submitted requests are routed for care team review and are not intended for emergency response.",

  RISK_REVIEW_NOTICE:
    "Review patient history and clinical context before taking action.",

  PRIVACY_NOTICE:
    "Viva protects patient data using administrative, technical and organizational safeguards designed for healthcare environments.",
} as const;
