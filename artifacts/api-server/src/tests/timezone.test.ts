/**
 * Tests for ymdInTz — the IANA-timezone-aware date helper used by
 * buildPatientInterventionContext to determine patient-local "today".
 *
 * Key scenario: a check-in submitted at 11 PM PT must count as the
 * patient's local date, not the UTC-next-day date.
 */

import { describe, it, expect } from "vitest";
import { ymdInTz } from "../lib/interventionEngine/tzUtils";

// Convenience: build a Date from a UTC ISO string.
function utc(iso: string): Date {
  return new Date(iso);
}

describe("ymdInTz", () => {
  it("returns correct PT date for 11:30 PM PT (= 7:30 AM UTC next day)", () => {
    // 2026-01-15 23:30 PT = 2026-01-16 07:30 UTC
    const d = utc("2026-01-16T07:30:00Z");
    expect(ymdInTz(d, "America/Los_Angeles")).toBe("2026-01-15");
  });

  it("returns correct ET date for 11:30 PM ET (= 4:30 AM UTC next day)", () => {
    // 2026-01-15 23:30 ET = 2026-01-16 04:30 UTC
    const d = utc("2026-01-16T04:30:00Z");
    expect(ymdInTz(d, "America/New_York")).toBe("2026-01-15");
  });

  it("returns correct PT date for noon PT (no UTC-rollover ambiguity)", () => {
    // 2026-01-15 12:00 PT = 2026-01-15 20:00 UTC
    const d = utc("2026-01-15T20:00:00Z");
    expect(ymdInTz(d, "America/Los_Angeles")).toBe("2026-01-15");
  });

  it("handles PDT (summer, UTC-7) correctly", () => {
    // 2026-07-01 23:30 PDT = 2026-07-02 06:30 UTC
    const d = utc("2026-07-02T06:30:00Z");
    expect(ymdInTz(d, "America/Los_Angeles")).toBe("2026-07-01");
  });

  it("handles Chicago (CT, UTC-6 in winter) correctly", () => {
    // 2026-01-15 23:30 CT = 2026-01-16 05:30 UTC
    const d = utc("2026-01-16T05:30:00Z");
    expect(ymdInTz(d, "America/Chicago")).toBe("2026-01-15");
  });

  it("throws on an invalid timezone string (caller catches)", () => {
    const d = utc("2026-01-15T20:00:00Z");
    expect(() => ymdInTz(d, "Not/AReal_TZ")).toThrow();
  });
});
