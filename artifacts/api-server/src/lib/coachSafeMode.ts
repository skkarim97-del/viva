// =====================================================================
// Coach pilot safe mode (T006)
// =====================================================================
// Read by the /coach router to decide whether free-text chat is
// allowed at all. We deliberately fail CLOSED in production:
//   - default in production: "safe" (free-text disabled)
//   - default elsewhere: "open" (legacy free-text behavior preserved
//     so dev can keep iterating on the OpenAI-backed flow)
//   - explicit COACH_PILOT_MODE wins in either case
//
// Why an env var (and not a DB row): env vars are owned by the
// deployment surface, are immutable for the process lifetime, and
// never round-trip through user input. A DB toggle would be
// strictly weaker -- if a prod row got flipped accidentally, the
// "no PHI to OpenAI" guarantee would break silently.

export type CoachPilotMode = "safe" | "open";

export function getCoachPilotMode(): CoachPilotMode {
  const raw = (process.env.COACH_PILOT_MODE ?? "").trim().toLowerCase();
  if (raw === "safe") return "safe";
  if (raw === "open") return "open";
  // Unset -> production defaults to safe (HIPAA pilot posture);
  // dev/test default to open so existing OpenAI tests keep working.
  return process.env.NODE_ENV === "production" ? "safe" : "open";
}

export function isCoachSafeModeActive(): boolean {
  return getCoachPilotMode() === "safe";
}
