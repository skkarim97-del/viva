// Centralized legal and clinical responsibility copy for Viva Care.
// Single source of truth — import constants from here rather than
// inlining strings in components.
//
// Tone rules: simple, clinical, premium. Not defensive, not scary,
// not repeated on every screen. One global anchor in settings plus
// small contextual notices only on higher-risk surfaces.

export const LEGAL = {
  CORE_CLINICAL_RESPONSIBILITY:
    "Viva supports between-visit care, patient visibility and provider decision-making. Viva does not replace clinical judgment, medical advice, diagnosis, treatment, prescribing or emergency care.",

  PATIENT_SUPPORT:
    "Viva supports your care between visits and helps your care team understand how you're doing.",

  EMERGENCY_NOTICE:
    "Not for emergencies. If symptoms are severe or urgent, call 911 or seek emergency care.",

  DATA_SIGNAL_NOTICE:
    "Health signal data may be incomplete, delayed or unavailable.",

  PRIVACY_NOTICE:
    "Viva protects patient data using administrative, technical and organizational safeguards designed for healthcare environments.",
} as const;
