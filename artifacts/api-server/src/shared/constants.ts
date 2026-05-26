// =====================================================================
// Shared constants — named thresholds and configuration values.
//
// Single source of truth for values that appear (or should appear)
// across multiple modules. Changing a value here propagates everywhere
// that imports it rather than requiring a grep-and-replace across
// dozens of files.
//
// Naming convention: SCREAMING_SNAKE, grouped by concern. Each group
// has a comment explaining the product intent so a future reader can
// see WHY the number is what it is, not just WHAT it is.
// =====================================================================

// ---- Patient engagement -----------------------------------------------

// A patient whose treatment_status is "active" or "unknown" and who
// has not checked in for more than this many days is flagged as
// inactive on the doctor dashboard.
export const ACTIVITY_THRESHOLD_DAYS = 12;

// Pending invites older than this many hours surface a "stale invite"
// chip on the patient list so the doctor knows to follow up.
export const STALE_INVITE_HOURS = 48;

// How far back the escalation-SLA query looks when computing the
// "open escalations" badge on the doctor's patient list.
export const CARE_EVENT_LOOKBACK_DAYS = 30;

// ---- Risk scoring weights ---------------------------------------------
//
// Each rule contributes a fixed weight. The sum of fired rules is
// bucketed into low / medium / high. Weights are intentionally small
// and auditable: the doctor sees exactly which signals fired.

export const RISK_WEIGHT_SILENCE = 30;
export const RISK_WEIGHT_LOW_ENERGY = 20;
export const RISK_WEIGHT_SEVERE_NAUSEA = 15;
export const RISK_WEIGHT_MOOD_DECLINE = 10;

// ---- Risk score bands -------------------------------------------------
//
// score >= HIGH_THRESHOLD → "high"
// score >= MEDIUM_THRESHOLD → "medium"
// otherwise → "low"

export const RISK_BAND_HIGH_THRESHOLD = 51;
export const RISK_BAND_MEDIUM_THRESHOLD = 26;

// ---- Risk workflow action thresholds ----------------------------------

// Score at or above this value → "needs_followup" action.
export const RISK_ACTION_FOLLOWUP_SCORE = 50;

// Score at or above this value → "monitor" action.
export const RISK_ACTION_MONITOR_SCORE = 30;

// Patient silent for this many days → fires the silence_3d risk rule.
export const RISK_SILENCE_FLAG_DAYS = 3;

// Patient silent for this many days → forces "needs_followup" action
// regardless of score, because we never want a doctor to miss a patient
// who has completely disengaged.
export const RISK_SILENCE_CRITICAL_DAYS = 5;

// ---- Risk rule windows ------------------------------------------------

export const RISK_ENERGY_WINDOW_DAYS = 7;
export const RISK_NAUSEA_WINDOW_DAYS = 3;

// "Low energy" fires when this fraction of days in the energy window
// report "depleted" or "tired".
export const RISK_ENERGY_WEAK_RATIO = 0.5;

// Minimum days in window to compute a mood trend (avoid noise from
// patients who have just started and have 1-2 data points).
export const RISK_MOOD_MIN_WINDOW = 6;

// ---- Symptom look-back windows ----------------------------------------
//
// Nausea is acute and dose-correlated, so a short 3-day window is
// appropriate. Constipation and appetite are slower-moving and need a
// longer window to detect meaningful trends.

export const NAUSEA_WINDOW_DAYS = 3;
export const CONSTIPATION_WINDOW_DAYS = 5;
export const APPETITE_WINDOW_DAYS = 5;

// ---- Constipation thresholds ------------------------------------------

// Minimum consecutive "no bowel movement" days to count as objectively
// active constipation (avoids flagging normal day-to-day variation).
export const CONSTIPATION_OBJECTIVE_STREAK_MIN = 3;

// Streak length that bumps severity to "severe".
export const CONSTIPATION_SEVERE_STREAK_MIN = 5;

// Subjective "constipated" days needed to reach "moderate" severity
// without an objective streak.
export const CONSTIPATION_SUBJECTIVE_MODERATE_MIN = 3;

// ---- Low-appetite severity thresholds ---------------------------------

// Count of "very_low" appetite days in the window that triggers
// "severe" severity.
export const APPETITE_SEVERE_MIN_DAYS = 3;

// Count of "very_low" appetite days that triggers "moderate" severity.
export const APPETITE_MODERATE_MIN_DAYS = 1;

// ---- Intervention trigger signals -------------------------------------

// Step count drop vs 14-day baseline at or below this percentage fires
// the "low_steps" co-signal and the constipation+activity trigger.
export const LOW_STEPS_CHANGE_PCT = -25;

// Daily sleep below this many hours fires the "poor_sleep" co-signal
// and the low_energy+sleep trigger.
export const LOW_SLEEP_HOURS = 6;

// Dose taken within this many days fires the "post_dose" co-signal
// and the nausea+dose-timing trigger.
export const POST_DOSE_WINDOW_DAYS = 3;

// Weight drop of this many lbs or more vs ~7 days ago fires the
// rapid_weight_change trigger (stored as a negative number).
export const RAPID_WEIGHT_DROP_LBS = -3;

// Number of low-hydration days in the last 7 that fires the
// low_hydration trigger.
export const LOW_HYDRATION_SIGNAL_DAYS = 2;

// Number of constipation days in the last 7 that fires the
// repeated_symptom trigger.
export const CONSTIPATION_SIGNAL_DAYS = 2;

// Number of missed check-in days in the last 7 that fires the
// missed_checkin trigger.
export const MISSED_CHECKIN_SIGNAL_DAYS = 2;

// Maximum symptom sections in a unified intervention card. Beyond
// this, lower-priority signals are dropped to keep cards readable.
export const MAX_UNIFIED_CARD_SECTIONS = 4;
