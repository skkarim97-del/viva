import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, apiTokensTable, usersTable } from "@workspace/db";
import { hashApiToken } from "../lib/apiTokens";

export interface AuthedRequest extends Request {
  auth: { userId: number; role: "doctor" | "patient" };
}

// Two auth schemes coexist: cookie-session for the browser dashboard and
// Authorization: Bearer <token> for the React Native mobile client.
// Cookies are unreliable across RN's URLSession on cold start, so the
// mobile app authenticates via a long-lived token issued at activation
// or login. Both paths resolve to the same { userId, role }.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Bearer header takes precedence over the session cookie. Without
  // this ordering a browser context that holds BOTH credentials (e.g.
  // a doctor signed in to the dashboard who calls a patient endpoint
  // via fetch with an explicit Authorization header) gets identified
  // as the doctor and the patient endpoint 403s. Explicit credentials
  // always win over ambient ones.
  const header = req.get("authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9_\-]+)$/.exec(header);
  if (m) {
    // The token column stores a SHA-256 hex digest of the raw bearer
    // (see lib/apiTokens.ts). We hash the incoming value before the
    // lookup so the raw token never leaves the request handler.
    const tokenHash = hashApiToken(m[1]!);
    const [row] = await db
      .select()
      .from(apiTokensTable)
      .where(eq(apiTokensTable.token, tokenHash))
      .limit(1);
    if (row) {
      (req as AuthedRequest).auth = { userId: row.userId, role: row.role };
      // Best-effort touch so an idle audit could later expire stale tokens.
      // row.token is already the hash, so this update keys on the same
      // value we just looked up by.
      db.update(apiTokensTable)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokensTable.token, row.token))
        .catch(() => {});
      next();
      return;
    }
    // A header was present but the token didn't match. Fail closed --
    // do NOT silently fall through to the session cookie, because that
    // would let a stale/garbage bearer header masquerade as the cookie
    // owner.
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const userId = req.session.userId;
  const role = req.session.role;
  if (userId && role) {
    (req as AuthedRequest).auth = { userId, role };
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

export function requireDoctor(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void requireAuth(req, res, () => {
    const auth = (req as AuthedRequest).auth;
    if (auth.role !== "doctor") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
}

export function requirePatient(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void requireAuth(req, res, () => {
    const auth = (req as AuthedRequest).auth;
    if (auth.role !== "patient") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
}

// requireDoctorMfa: doctor role + per-session TOTP verification (T007).
//
// Why this is a separate gate (rather than wired into requireDoctor):
// every doctor-PHI router currently uses `requireDoctor`. We want to be
// explicit at every PHI mount about WHICH gate is active so the audit
// matrix in docs/authz-audit.md stays unambiguous. Routes that only
// need doctor identity (e.g. /auth/me for a doctor) keep requireDoctor;
// routes that touch patient PHI use requireDoctorMfa.
//
// MFA is enforced via the cookie session (req.session.mfaVerified) AND
// the session must belong to the same userId we authenticated. A
// bearer-token-authed request has no session (so session.userId is
// undefined and the equality fails) -- that means a bearer-only
// request can NEVER satisfy this gate, by design. Doctors access PHI
// through the browser dashboard; the mobile bearer flow is patient-only.
//
// Failure modes are differentiated so the dashboard can route the
// doctor to the right page:
//   401 unauthorized          : no auth at all
//   403 forbidden             : not a doctor
//   403 mfa_required, enroll  : doctor authed but never enrolled
//   403 mfa_required, verify  : doctor enrolled but not verified this session
export function requireDoctorMfa(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void requireAuth(req, res, async () => {
    const result = await checkDoctorMfa(req);
    if (result.ok) {
      next();
      return;
    }
    res.status(result.status).json(result.body);
  });
}

// Inline equivalent of requireDoctorMfa for routes that have a mixed
// role policy (patient self-access AND doctor MFA-gated access). Call
// AFTER requireAuth has populated req.auth. Returns { ok: true } when
// the doctor has passed MFA this session; otherwise returns the status
// code + body the route should send. Patient callers should never hit
// this -- the calling route must branch on auth.role first.
export async function checkDoctorMfa(
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  const auth = (req as AuthedRequest).auth;
  if (!auth || auth.role !== "doctor") {
    return { ok: false, status: 403, body: { error: "forbidden" } };
  }
  // Bind mfaVerified to the authenticated user. A bearer-authed
  // request has session.userId === undefined so the equality fails
  // and we treat the request as unverified, regardless of any
  // session.mfaVerified flag that might exist on a hijacked cookie.
  // Defense-in-depth: even if someone manages to attach an unrelated
  // verified session cookie to a request authenticated as a different
  // user, MFA is re-required.
  const sessionUserMatches =
    typeof req.session.userId === "number" &&
    req.session.userId === auth.userId &&
    req.session.role === "doctor";
  if (sessionUserMatches && req.session.mfaVerified === true) {
    return { ok: true };
  }
  // Look up enrollment so the dashboard knows whether to send the
  // doctor to the enroll page or just the verify page.
  try {
    const [row] = await db
      .select({ enrolledAt: usersTable.mfaEnrolledAt })
      .from(usersTable)
      .where(eq(usersTable.id, auth.userId))
      .limit(1);
    const enrolled = !!(row && row.enrolledAt);
    return {
      ok: false,
      status: 403,
      body: { error: "mfa_required", reason: enrolled ? "verify" : "enroll" },
    };
  } catch {
    return {
      ok: false,
      status: 403,
      body: { error: "mfa_required", reason: "verify" },
    };
  }
}
