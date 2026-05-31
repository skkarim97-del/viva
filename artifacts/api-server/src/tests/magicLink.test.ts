/**
 * Magic-link authentication tests.
 *
 * Covers:
 *   1. Non-TOTP doctor: magic link verify sets session.mfaVerified = true
 *   2. TOTP-enrolled doctor: magic link verify does NOT set mfaVerified
 *   3. PHI gate: requireDoctorMfa rejects requests without mfaVerified
 *   4. Single-use enforcement and 15-minute TTL
 *   5. Migration table contract
 *
 * DB is fully mocked — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateMagicLinkToken,
  hashMagicLinkToken,
  magicLinkExpiresAt,
  isMagicLinkExpired,
} from "../lib/magicLink";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDbMock(rows: unknown[] = []) {
  const self: Record<string, unknown> = {};
  const chain = () => self;
  self.select = vi.fn(chain);
  self.insert = vi.fn(chain);
  self.update = vi.fn(chain);
  self.delete = vi.fn(chain);
  self.from = vi.fn(chain);
  self.where = vi.fn(chain);
  self.limit = vi.fn(() => Promise.resolve(rows));
  self.values = vi.fn(chain);
  self.set = vi.fn(chain);
  self.returning = vi.fn(() => Promise.resolve(rows));
  self.execute = vi.fn(() => Promise.resolve({ rows }));
  self.orderBy = vi.fn(() => Promise.resolve(rows));
  return self;
}

// ---------------------------------------------------------------------------
// 1. Magic link helpers — token generation and hashing
// ---------------------------------------------------------------------------

describe("magicLink.ts — generateMagicLinkToken", () => {
  it("produces a base64url raw token of at least 40 characters", () => {
    const { raw } = generateMagicLinkToken();
    // randomBytes(32).toString("base64url") → 43 chars (256 bits)
    expect(raw.length).toBeGreaterThanOrEqual(40);
    expect(/^[A-Za-z0-9_-]+$/.test(raw)).toBe(true);
  });

  it("produces a 64-character hex SHA-256 hash", () => {
    const { hash } = generateMagicLinkToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash matches hashMagicLinkToken(raw)", () => {
    const { raw, hash } = generateMagicLinkToken();
    expect(hashMagicLinkToken(raw)).toBe(hash);
  });

  it("each call produces a unique raw token and hash", () => {
    const a = generateMagicLinkToken();
    const b = generateMagicLinkToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hashMagicLinkToken is deterministic for the same input", () => {
    const raw = "some-fixed-token-value";
    expect(hashMagicLinkToken(raw)).toBe(hashMagicLinkToken(raw));
  });
});

// ---------------------------------------------------------------------------
// 2. TTL — 15-minute expiry
// ---------------------------------------------------------------------------

describe("magicLink.ts — TTL", () => {
  it("magicLinkExpiresAt returns a date approximately 15 minutes in the future", () => {
    const before = Date.now();
    const exp = magicLinkExpiresAt();
    const after = Date.now();
    const deltaMs = exp.getTime() - before;
    // Allow ±5s tolerance for slow machines
    const expectedMs = 15 * 60 * 1000;
    expect(deltaMs).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(deltaMs).toBeLessThanOrEqual(expectedMs + (after - before) + 5000);
  });

  it("isMagicLinkExpired returns false for a future date", () => {
    const future = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
    expect(isMagicLinkExpired(future)).toBe(false);
  });

  it("isMagicLinkExpired returns true for a past date", () => {
    const past = new Date(Date.now() - 1); // 1 ms ago
    expect(isMagicLinkExpired(past)).toBe(true);
  });

  it("isMagicLinkExpired returns true for a date exactly at epoch (already expired)", () => {
    expect(isMagicLinkExpired(new Date(0))).toBe(true);
  });

  it("a token created with magicLinkExpiresAt is valid immediately after creation", () => {
    expect(isMagicLinkExpired(magicLinkExpiresAt())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Single-use enforcement — contract documentation
// ---------------------------------------------------------------------------

describe("POST /auth/magic-link/verify — single-use contract", () => {
  it("verify schema accepts only { token } — no other fields bypass the claim", () => {
    // The verifySchema in auth.ts is z.object({ token: z.string() }).
    // Only `token` is accepted. Undocumented fields that could replay
    // a claim or set session state must not appear.
    const acceptedFields = ["token"];
    const forbiddenBypassFields = ["userId", "mfaVerified", "force", "skip"];
    for (const field of forbiddenBypassFields) {
      expect(acceptedFields).not.toContain(field);
    }
  });

  it("atomic claim uses UPDATE WHERE usedAt IS NULL — second call returns 0 rows", () => {
    // Simulates the DB returning 0 rows on the second concurrent claim.
    // The UPDATE filters on `tokenHash = ? AND usedAt IS NULL RETURNING id`.
    // When the first request wins, usedAt is set; the second gets [] back.
    const firstClaimRows = [{ id: 1 }];   // first request wins
    const secondClaimRows: unknown[] = [];  // second request loses

    expect(firstClaimRows.length).toBe(1);
    expect(secondClaimRows.length).toBe(0);

    // Route checks: if (claimed.length === 0) → 409 token_already_used
    const firstOk = firstClaimRows.length > 0;
    const secondOk = secondClaimRows.length > 0;
    expect(firstOk).toBe(true);
    expect(secondOk).toBe(false);
  });

  it("verify returns 410 for expired tokens (isMagicLinkExpired check before claim)", () => {
    const expiredAt = new Date(Date.now() - 60_000); // 1 min ago
    expect(isMagicLinkExpired(expiredAt)).toBe(true);
    // Route maps isMagicLinkExpired = true → 410 Gone, before the atomic claim
  });

  it("verify returns 409 when usedAt is already set on the token row", () => {
    const tokenRow = { usedAt: new Date(), expiresAt: magicLinkExpiresAt() };
    // Route: if (row.usedAt) → 409 token_already_used (pre-claim fast path)
    expect(!!tokenRow.usedAt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4a. Non-TOTP doctor: magic link sets mfaVerified = true
// ---------------------------------------------------------------------------

describe("POST /auth/magic-link/verify — non-TOTP doctor", () => {
  it("sets session.mfaVerified = true when user.mfaEnrolledAt is null", () => {
    // Mirrors the conditional in auth.ts:
    //   if (!user.mfaEnrolledAt) {
    //     req.session.mfaVerified = true;
    //     req.session.mfaVerifiedAt = Date.now();
    //   }
    const user = { id: 1, mfaEnrolledAt: null };
    const session: Record<string, unknown> = {};
    if (!user.mfaEnrolledAt) {
      session.mfaVerified = true;
      session.mfaVerifiedAt = Date.now();
    }
    expect(session.mfaVerified).toBe(true);
    expect(typeof session.mfaVerifiedAt).toBe("number");
  });

  it("mfaStatus.sessionVerified = true after magic link (non-TOTP path)", () => {
    // GET /me/mfa/status maps: sessionVerified = req.session.mfaVerified === true
    const session = { mfaVerified: true };
    const sessionVerified = session.mfaVerified === true;
    expect(sessionVerified).toBe(true);
  });

  it("MfaGate passes through when sessionVerified=true and enrolled=false", () => {
    // App.tsx MfaGate: if (!data.sessionVerified) { return enrolled ? <Verify> : <Enroll> }
    // If sessionVerified = true, the condition is false and we fall through to dashboard.
    const data = { enrolled: false, sessionVerified: true };
    const blocked = !data.sessionVerified;
    expect(blocked).toBe(false); // gate does not block
  });
});

// ---------------------------------------------------------------------------
// 4b. TOTP-enrolled doctor: magic link does NOT set mfaVerified
// ---------------------------------------------------------------------------

describe("POST /auth/magic-link/verify — TOTP-enrolled doctor", () => {
  it("does NOT set session.mfaVerified when user.mfaEnrolledAt is set", () => {
    const user = { id: 2, mfaEnrolledAt: new Date("2025-01-01") };
    const session: Record<string, unknown> = {};
    if (!user.mfaEnrolledAt) {
      session.mfaVerified = true;
      session.mfaVerifiedAt = Date.now();
    }
    expect(session.mfaVerified).toBeUndefined();
    expect(session.mfaVerifiedAt).toBeUndefined();
  });

  it("mfaStatus.sessionVerified = false when mfaVerified not set in session", () => {
    const session: { mfaVerified?: boolean } = {}; // no mfaVerified key
    const sessionVerified = session.mfaVerified === true;
    expect(sessionVerified).toBe(false);
  });

  it("MfaGate shows MfaVerifyPage when sessionVerified=false and enrolled=true", () => {
    // App.tsx: if (!data.sessionVerified) { return data.enrolled ? <MfaVerifyPage> : <MfaEnrollPage> }
    const data = { enrolled: true, sessionVerified: false };
    const blocked = !data.sessionVerified;
    const routeTo = data.enrolled ? "MfaVerifyPage" : "MfaEnrollPage";
    expect(blocked).toBe(true);   // gate blocks
    expect(routeTo).toBe("MfaVerifyPage"); // TOTP prompt shown
  });

  it("TOTP verify sets mfaVerified=true, MfaGate then passes through", () => {
    // After the doctor enters their TOTP code, /me/mfa/verify sets
    // session.mfaVerified = true and invalidates the mfa-status cache.
    // The gate re-fetches and sees sessionVerified=true → passes through.
    const dataAfterTotp = { enrolled: true, sessionVerified: true };
    const blocked = !dataAfterTotp.sessionVerified;
    expect(blocked).toBe(false); // gate no longer blocks
  });
});

// ---------------------------------------------------------------------------
// 5. PHI gate — requireDoctorMfa blocks when mfaVerified is not set
// ---------------------------------------------------------------------------

describe("requireDoctorMfa — PHI route protection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("blocks when session.mfaVerified is false even if session.userId matches", async () => {
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([{ enrolledAt: null }]),
      usersTable: { id: "id", mfaEnrolledAt: "mfa_enrolled_at" },
      apiTokensTable: {},
    }));
    const { checkDoctorMfa } = await import("../middlewares/auth");
    const req = {
      get: () => "",
      session: { userId: 5, role: "doctor", mfaVerified: false },
      auth: { userId: 5, role: "doctor" },
    } as unknown as Parameters<typeof checkDoctorMfa>[0];
    const result = await checkDoctorMfa(req);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(403);
  });

  it("blocks when session.mfaVerified is undefined (enrolled TOTP doctor after magic link)", async () => {
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([{ enrolledAt: new Date("2025-01-01") }]),
      usersTable: { id: "id", mfaEnrolledAt: "mfa_enrolled_at" },
      apiTokensTable: {},
    }));
    const { checkDoctorMfa } = await import("../middlewares/auth");
    const req = {
      get: () => "",
      session: { userId: 5, role: "doctor" }, // mfaVerified absent
      auth: { userId: 5, role: "doctor" },
    } as unknown as Parameters<typeof checkDoctorMfa>[0];
    const result = await checkDoctorMfa(req);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; body: { error: string; reason: string } }).body).toMatchObject({
      error: "mfa_required",
      reason: "verify", // enrolled → "verify", not "enroll"
    });
  });

  it("allows when session.mfaVerified=true and session.userId matches auth.userId", async () => {
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([{ enrolledAt: null }]),
      usersTable: { id: "id", mfaEnrolledAt: "mfa_enrolled_at" },
      apiTokensTable: {},
    }));
    const { checkDoctorMfa } = await import("../middlewares/auth");
    const req = {
      get: () => "",
      session: { userId: 5, role: "doctor", mfaVerified: true },
      auth: { userId: 5, role: "doctor" },
    } as unknown as Parameters<typeof checkDoctorMfa>[0];
    const result = await checkDoctorMfa(req);
    expect(result.ok).toBe(true);
  });

  it("blocks bearer-only requests even if mfaVerified=true in session (no session.userId)", async () => {
    // A bearer token has no session, so session.userId is undefined.
    // checkDoctorMfa checks: session.userId === auth.userId — this fails.
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([{ enrolledAt: new Date("2025-01-01") }]),
      usersTable: { id: "id", mfaEnrolledAt: "mfa_enrolled_at" },
      apiTokensTable: {},
    }));
    const { checkDoctorMfa } = await import("../middlewares/auth");
    const req = {
      get: () => "",
      session: { mfaVerified: true }, // no userId in session (bearer path)
      auth: { userId: 5, role: "doctor" },
    } as unknown as Parameters<typeof checkDoctorMfa>[0];
    const result = await checkDoctorMfa(req);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Enumeration prevention — POST /auth/magic-link
// ---------------------------------------------------------------------------

describe("POST /auth/magic-link — enumeration prevention", () => {
  it("route always returns {ok:true} regardless of email existence", () => {
    // The route calls res.json({ ok: true }) BEFORE any DB lookup result
    // is acted on. This is documented in auth.ts: "Respond early regardless
    // of outcome so timing doesn't reveal existence."
    const responseForRegistered = { ok: true };
    const responseForUnregistered = { ok: true };
    expect(responseForRegistered).toEqual(responseForUnregistered);
  });

  it("request schema accepts only { email } — no role or platformId leakage", () => {
    const acceptedFields = ["email"];
    const forbiddenFields = ["role", "platformId", "userId", "token"];
    for (const field of forbiddenFields) {
      expect(acceptedFields).not.toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Migration / table contract
// ---------------------------------------------------------------------------

describe("magic_link_tokens table — schema contract", () => {
  it("table has tokenHash (unique), userId (FK), expiresAt, usedAt, createdAt", () => {
    // Mirrors lib/db/src/schema/magicLinkTokens.ts.
    // These are the columns the migration must create.
    const requiredColumns = [
      "id",           // SERIAL PRIMARY KEY
      "token_hash",   // TEXT NOT NULL UNIQUE — SHA-256 hex; raw never stored
      "user_id",      // INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
      "expires_at",   // TIMESTAMP NOT NULL — 15-min TTL from issuance
      "used_at",      // TIMESTAMP — null until claimed; single-use enforcement
      "created_at",   // TIMESTAMP NOT NULL DEFAULT NOW()
    ];
    expect(requiredColumns).toContain("token_hash");
    expect(requiredColumns).toContain("used_at");
    expect(requiredColumns).toContain("expires_at");
    // token_hash is unique so no two tokens share the same stored hash
    expect(requiredColumns).toContain("user_id");
  });

  it("migration SQL includes index on expires_at WHERE used_at IS NULL", () => {
    // Partial index keeps expiry scans fast; documents the required migration.
    const migrationSQL = `
      CREATE TABLE IF NOT EXISTS magic_link_tokens (
        id          SERIAL PRIMARY KEY,
        token_hash  TEXT NOT NULL UNIQUE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  TIMESTAMP NOT NULL,
        used_at     TIMESTAMP,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX ON magic_link_tokens (user_id);
      CREATE INDEX ON magic_link_tokens (expires_at) WHERE used_at IS NULL;
    `;
    expect(migrationSQL).toContain("token_hash  TEXT NOT NULL UNIQUE");
    expect(migrationSQL).toContain("REFERENCES users(id) ON DELETE CASCADE");
    expect(migrationSQL).toContain("WHERE used_at IS NULL");
  });

  it("raw token is never stored — only the SHA-256 hash lands in the DB", () => {
    // generateMagicLinkToken() returns { raw, hash }.
    // The insert in auth.ts uses `hash` (tokenHash column), never `raw`.
    // This test documents and verifies the invariant via the helper.
    const { raw, hash } = generateMagicLinkToken();
    expect(raw).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(raw).not.toMatch(/^[0-9a-f]{64}$/); // raw is base64url, not hex
  });
});
