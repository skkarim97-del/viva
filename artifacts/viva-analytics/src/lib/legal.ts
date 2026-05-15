// Centralized legal and clinical responsibility copy for Viva Analytics.
// Single source of truth — import constants from here rather than
// inlining strings in components.
//
// Tone rules: enterprise, operational, precise. Avoid implying clinical
// outcome claims. One global anchor in the shell footer.

export const LEGAL = {
  ANALYTICS_GLOBAL:
    "Viva supports operational insight and care visibility. Metrics should be interpreted with clinical, operational and population context.",

  ANALYTICS_NOTICE:
    "Metrics are intended to evaluate engagement, workflow visibility and operational signals. They are not clinical outcomes claims unless independently validated.",

  RETENTION_NOTICE:
    "Retention and engagement insights are directional unless validated through controlled analysis.",

  PRIVACY_NOTICE:
    "Viva protects patient data using administrative, technical and organizational safeguards designed for healthcare environments.",
} as const;
