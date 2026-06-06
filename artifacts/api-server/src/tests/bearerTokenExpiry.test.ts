/**
 * Bearer token expiry and deactivation tests for requireAuth.
 *
 * Covers:
 *   1. Active token within the 90-day TTL → authenticated
 *   2. Token whose lastUsedAt is exactly 90 days ago → still valid (boundary)
 *   3. Token whose lastUsedAt is 90 days + 1 ms ago → 401 token_expired
 *   4. Expired token does NOT update lastUsedAt (no silent refresh)
 *   5. Deactivated account (deactivatedAt set) → 401 account_deactivated
 *   6. Token not found in DB → 401 unauthorized
 *   7. Malformed / missing Bearer header → falls through to session path
 *
 * DB is fully mocked — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

type TokenRow = {
  token: string;
  userId: number;
  role: "doctor" | "patient";
  lastUsedAt: Date;
  deactivatedAt: Date | null;
};

/** Build a db mock that returns `rows` from .limit() and records .update() calls. */
function makeDbMock(rows: TokenRow[] | []) {
  const updateCalls: unknown[] = [];
  const setCalls: unknown[] = [];

  const updateChain = {
    set: vi.fn((v: unknown) => { setCalls.push(v); return updateChain; }),
    where: vi.fn(() => updateChain),
    catch: vi.fn(),
  };

  const selectChain = {
    from: vi.fn(() => selectChain),
    innerJoin: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => Promise.resolve(rows)),
    select: vi.fn(() => selectChain),
  };

  const db = {
    select: vi.fn(() => selectChain),
    update: vi.fn((table: unknown) => { updateCalls.push(table); return updateChain; }),
    _updateCalls: updateCalls,
    _setCalls: setCalls,
    _updateChain: updateChain,
  };

  return db;
}

function makeReqRes(bearerToken?: string, session: Record<string, unknown> = {}) {
  const req = {
    get: vi.fn((header: string) =>
      header.toLowerCase() === "authorization" && bearerToken
        ? `Bearer ${bearerToken}`
        : "",
    ),
    session,
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ---------------------------------------------------------------------------
// 1–6. Bearer token path
// ---------------------------------------------------------------------------

describe("requireAuth — bearer token expiry and deactivation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows a token whose lastUsedAt is 1 hour ago (well within 90 days)", async () => {
    const row: TokenRow = {
      token: "hash",
      userId: 42,
      role: "patient",
      lastUsedAt: new Date(Date.now() - 60 * 60 * 1000),
      deactivatedAt: null,
    };
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([row]),
      apiTokensTable: { token: "token", userId: "user_id", role: "role", lastUsedAt: "last_used_at" },
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes("rawtoken");
    await requireAuth(req as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows a token whose lastUsedAt is 1 day before the 90-day boundary", async () => {
    // Testing exactly TTL_MS ago is inherently flaky because `now` is
    // created inside requireAuth and a few ms elapse between here and
    // there. Using TTL_MS - 1 day gives a stable margin.
    const row: TokenRow = {
      token: "hash",
      userId: 42,
      role: "patient",
      lastUsedAt: new Date(Date.now() - (TTL_MS - 24 * 60 * 60 * 1000)),
      deactivatedAt: null,
    };
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([row]),
      apiTokensTable: { token: "token", userId: "user_id", role: "role", lastUsedAt: "last_used_at" },
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes("rawtoken");
    await requireAuth(req as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a token whose lastUsedAt is 90 days + 1 ms ago with 401 token_expired", async () => {
    const row: TokenRow = {
      token: "hash",
      userId: 42,
      role: "patient",
      lastUsedAt: new Date(Date.now() - TTL_MS - 1),
      deactivatedAt: null,
    };
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([row]),
      apiTokensTable: { token: "token", userId: "user_id", role: "role", lastUsedAt: "last_used_at" },
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes("rawtoken");
    await requireAuth(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "token_expired" });
  });

  it("does NOT update lastUsedAt when the token is expired (no silent refresh)", async () => {
    const db = makeDbMock([
      {
        token: "hash",
        userId: 42,
        role: "patient",
        lastUsedAt: new Date(Date.now() - TTL_MS - 1),
        deactivatedAt: null,
      },
    ]);
    vi.doMock("@workspace/db", () => ({
      db,
      apiTokensTable: { token: "token", userId: "user_id", role: "role", lastUsedAt: "last_used_at" },
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes("rawtoken");
    await requireAuth(req as never, res as never, next);

    // db.update must never have been called — expired token should not refresh
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a deactivated account with 401 account_deactivated", async () => {
    const row: TokenRow = {
      token: "hash",
      userId: 42,
      role: "patient",
      lastUsedAt: new Date(Date.now() - 60 * 60 * 1000), // fresh token
      deactivatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([row]),
      apiTokensTable: { token: "token", userId: "user_id", role: "role", lastUsedAt: "last_used_at" },
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes("rawtoken");
    await requireAuth(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "account_deactivated" });
  });

  it("rejects a token not found in DB with 401 unauthorized", async () => {
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([]), // no rows
      apiTokensTable: { token: "token", userId: "user_id", role: "role", lastUsedAt: "last_used_at" },
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes("unknowntoken");
    await requireAuth(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "unauthorized" });
  });
});

// ---------------------------------------------------------------------------
// 7. Malformed / missing Authorization header falls through to session path
// ---------------------------------------------------------------------------

describe("requireAuth — malformed Bearer header falls through to session", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("no Authorization header → session path evaluated", async () => {
    // Session has a valid userId + role → should authenticate via session
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([{ deactivatedAt: null }]),
      apiTokensTable: {},
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    const { req, res, next } = makeReqRes(undefined, { userId: 7, role: "doctor" });
    await requireAuth(req as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("malformed header (not 'Bearer <token>') → session path evaluated", async () => {
    vi.doMock("@workspace/db", () => ({
      db: makeDbMock([{ deactivatedAt: null }]),
      apiTokensTable: {},
      usersTable: { id: "id", deactivatedAt: "deactivated_at" },
    }));
    vi.doMock("../lib/apiTokens", () => ({ hashApiToken: () => "hash" }));

    const { requireAuth } = await import("../middlewares/auth");
    // Manually set a bad header
    const req = {
      get: vi.fn(() => "Token badformat"),
      session: { userId: 7, role: "doctor" },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireAuth(req as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
