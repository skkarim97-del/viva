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

// Expired iff a stamp exists AND it is older than the TTL window.
// `null` issuedAt is intentionally treated as "no expiry" -- it
// represents legacy rows that pre-date the issuedAt column. We do
// not retroactively expire those; a follow-up backfill can stamp
// them once the column has been live for a release.
export function isInviteTokenExpired(
  issuedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!issuedAt) return false;
  return now.getTime() - issuedAt.getTime() > INVITE_TOKEN_TTL_MS;
}
