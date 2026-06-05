/**
 * Tests for isInviteTokenExpired — the shared TTL helper consumed by the
 * activation route, invite-preview HTML page, and JSON preview API.
 *
 * Key scenarios:
 *   1. Normal tokens: expired iff issuedAt is older than 14 days
 *   2. Legacy tokens: null issuedAt is expired once past 2025-01-01 cutoff
 *   3. Edge cases: boundary values, undefined, far-future now
 */

import { describe, it, expect } from "vitest";
import {
  isInviteTokenExpired,
  INVITE_TOKEN_TTL_DAYS,
} from "../lib/inviteTokens";

const TTL_MS = INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const LEGACY_CUTOFF = new Date("2025-01-01T00:00:00Z");

// ---------------------------------------------------------------------------
// 1. Normal tokens — timestamped issuedAt
// ---------------------------------------------------------------------------

describe("isInviteTokenExpired — normal tokens (issuedAt is set)", () => {
  it("returns false for a token issued 1 hour ago", () => {
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isInviteTokenExpired(issuedAt, now)).toBe(false);
  });

  it("returns false for a token issued exactly at the TTL boundary (not yet expired)", () => {
    const now = new Date();
    const issuedAt = new Date(now.getTime() - TTL_MS);
    // Equal to TTL_MS is NOT > TTL_MS, so still valid
    expect(isInviteTokenExpired(issuedAt, now)).toBe(false);
  });

  it("returns true for a token issued 1 ms past the TTL boundary", () => {
    const now = new Date();
    const issuedAt = new Date(now.getTime() - TTL_MS - 1);
    expect(isInviteTokenExpired(issuedAt, now)).toBe(true);
  });

  it("returns true for a token issued 30 days ago", () => {
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isInviteTokenExpired(issuedAt, now)).toBe(true);
  });

  it("returns true for a token issued a year ago", () => {
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    expect(isInviteTokenExpired(issuedAt, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Legacy tokens — null / undefined issuedAt
// ---------------------------------------------------------------------------
// These rows pre-date the activationTokenIssuedAt column. The correct way to
// test this in QA is: find or create an invite row in the DB where
// activation_token_issued_at IS NULL, then hit the invite preview/activation
// endpoints and confirm they return an "expired" response.

describe("isInviteTokenExpired — legacy tokens (null / undefined issuedAt)", () => {
  it("returns true for null issuedAt when now is after the cutoff (2025-01-01)", () => {
    const afterCutoff = new Date("2026-01-01T00:00:00Z");
    expect(isInviteTokenExpired(null, afterCutoff)).toBe(true);
  });

  it("returns true for undefined issuedAt when now is after the cutoff", () => {
    const afterCutoff = new Date("2026-06-01T00:00:00Z");
    expect(isInviteTokenExpired(undefined, afterCutoff)).toBe(true);
  });

  it("returns true for null issuedAt exactly 1 ms after the cutoff", () => {
    const justAfter = new Date(LEGACY_CUTOFF.getTime() + 1);
    expect(isInviteTokenExpired(null, justAfter)).toBe(true);
  });

  it("returns false for null issuedAt when now is exactly at the cutoff (not yet past)", () => {
    // now > cutoff is false when equal, so the token is treated as valid at
    // exactly the cutoff instant — a boundary-correct behaviour.
    expect(isInviteTokenExpired(null, LEGACY_CUTOFF)).toBe(false);
  });

  it("returns false for null issuedAt when now is before the cutoff", () => {
    const beforeCutoff = new Date("2024-12-31T23:59:59Z");
    expect(isInviteTokenExpired(null, beforeCutoff)).toBe(false);
  });

  it("null and undefined issuedAt behave identically", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(isInviteTokenExpired(null, now)).toBe(
      isInviteTokenExpired(undefined, now),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Default `now` parameter uses real clock
// ---------------------------------------------------------------------------

describe("isInviteTokenExpired — default now uses real clock", () => {
  it("a freshly-issued token is not expired without providing now", () => {
    const issuedAt = new Date(); // right now
    expect(isInviteTokenExpired(issuedAt)).toBe(false);
  });

  it("a token issued 15 days ago is expired without providing now", () => {
    const issuedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    expect(isInviteTokenExpired(issuedAt)).toBe(true);
  });

  it("null issuedAt is expired without providing now (past cutoff in real time)", () => {
    // The LEGACY_TOKEN_CUTOFF is 2025-01-01. This test will always pass
    // as long as it runs after that date — which it will, since we are in 2026.
    expect(isInviteTokenExpired(null)).toBe(true);
  });
});
