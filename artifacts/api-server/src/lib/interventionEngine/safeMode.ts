// =====================================================================
// Intervention engine pilot mode (mirrors lib/coachSafeMode.ts)
// =====================================================================
// Read by lib/interventionEngine/index.ts to decide whether the
// OpenAI personalization step is allowed at all. We deliberately
// fail CLOSED in production:
//   - default in production: "fallback" (no OpenAI call ever)
//   - default elsewhere: "fallback" (HIPAA pilot posture)
//   - explicit INTERVENTION_AI_MODE wins in either case
//
// This is INDEPENDENT of COACH_PILOT_MODE -- coach is a different
// surface with a different threat model. Operators reading the env
// file must be able to flip one without affecting the other.
//
// Why an env var (and not a DB row): env vars are owned by the
// deployment surface, are immutable for the process lifetime, and
// never round-trip through user input. A DB toggle would be
// strictly weaker -- if a prod row got flipped accidentally, the
// "no PHI to OpenAI" guarantee would break silently.

export type InterventionAiMode = "fallback" | "ai_deidentified";

export function getInterventionAiMode(): InterventionAiMode {
  const raw = (process.env.INTERVENTION_AI_MODE ?? "")
    .trim()
    .toLowerCase();
  if (raw === "ai_deidentified") return "ai_deidentified";
  if (raw === "fallback") return "fallback";
  // Unset -> fallback regardless of NODE_ENV. The pilot starts in
  // fallback-only mode until at least one week of real traffic +
  // a manual audit of deidentified_ai_payload rows in RDS confirms
  // no PHI has leaked. Operators must opt in explicitly.
  return "fallback";
}

export function isInterventionAiModeEnabled(): boolean {
  return getInterventionAiMode() === "ai_deidentified";
}
