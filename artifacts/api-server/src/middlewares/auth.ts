import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, apiTokensTable } from "@workspace/db";

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
    const [row] = await db
      .select()
      .from(apiTokensTable)
      .where(eq(apiTokensTable.token, m[1]!))
      .limit(1);
    if (row) {
      (req as AuthedRequest).auth = { userId: row.userId, role: row.role };
      // Best-effort touch so an idle audit could later expire stale tokens.
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
