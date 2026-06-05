// Invite token policy. Centralised so the activation route, the
// invite-preview HTML page, and the JSON preview API all enforce the
// exact same TTL semantics. Keeping this in one file means a future
// pilot adjustment ("our average doctor sends the link 3 weeks before
// the appointment") is a one-line change instead of a hunt.

// 14 days. Long enough for "doctor sends today, patient activates at
// next week's appointment" to work for everyone, including patients
// who delay because they're not feeling well. Short enough that a
// stale link surfaced on a phone six months later is dead and cannot
// be used to claim an account that was never activated.
export const INVITE_TOKEN_TTL_DAYS = 14;
const INVITE_TOKEN_TTL_MS = INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

// Cutoff date after which legacy rows (null issuedAt) are treated as
// expired. Rows created before the issuedAt column was added pre-date
// the pilot and should no longer be claimable.
const LEGACY_TOKEN_CUTOFF = new Date("2025-01-01T00:00:00Z");

// Expired iff the token is older than the TTL window. Legacy rows with
// a null issuedAt are treated as expired once we are past LEGACY_TOKEN_CUTOFF
// so that pre-pilot invite URLs cannot be used to claim accounts.
export function isInviteTokenExpired(
  issuedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!issuedAt) return now > LEGACY_TOKEN_CUTOFF;
  return now.getTime() - issuedAt.getTime() > INVITE_TOKEN_TTL_MS;
}
