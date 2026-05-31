// Pure timezone helpers — no DB imports, safe to unit-test directly.

// Convert a UTC Date to YYYY-MM-DD in a specific IANA timezone using the
// built-in Intl API (no third-party library). The en-CA locale produces
// YYYY-MM-DD format natively.
export function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// UTC-8 (Pacific Standard) fallback used when no IANA timezone is available
// for the patient. Conservative: at worst we fetch one extra day of data for
// patients east of Pacific time.
//
// TODO: Replace this fallback once patient timezone is persisted at activation.
// Best location: patientProfilesTable.timezone (text, IANA format).
// The analytics_events table already captures the IANA string per event; a
// one-time migration or the next activation flow can seed the profile column.
export const PILOT_TZ_FALLBACK = "America/Los_Angeles";

export function ymdPilotFallback(d: Date): string {
  return ymdInTz(d, PILOT_TZ_FALLBACK);
}
