import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { db, phiAccessLogsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import type { AuthedRequest } from "./auth";

// PHI access audit middleware.
//
// Mounts at the router level on PHI-bearing route groups and writes
// one row to phi_access_logs per response. Three guarantees:
//
//   1. The write is BEST EFFORT and asynchronous to the response. We
//      attach to `res.on("finish")` so the audit row carries the real
//      status code, but we never delay the client's response on it
//      and we never let an audit failure 500 the actual request.
//
//   2. We NEVER capture the request body, query string, response
//      body, or any value from the underlying PHI rows. Only metadata
//      (who, what verb, which path, what status, when, hashed client
//      identity).
//
//   3. IP and User-Agent are hashed (SHA-256 hex). The raw values
//      are quasi-identifiers we don't need in cleartext; hashing
//      still allows "same client" grouping in audit reports.
//
// Two configurations supported:
//   * Authenticated routes: actor is read from req.auth (set by
//     requireAuth/requireDoctor/requirePatient).
//   * Operator routes: caller passes `{ actorRole: "operator" }`.
//     actor_user_id stays NULL because operator access has no user
//     row today (deferred per pilot decision).

type ActorOverride = {
  actorRole?: "operator" | "system";
};

type AuditConfig = {
  // Returns the patient ID whose PHI is being touched, or null when
  // the route is not patient-scoped (e.g. operator aggregates).
  // May be async to support routes that resolve the patient via a
  // bearer-token lookup (e.g. /coach/chat); the audit insert waits
  // on the resolution before persisting the row.
  getPatientId?: (req: Request) => number | null | Promise<number | null>;
  // Returns the platform/clinic ID for operator audits where there
  // is no specific patient id.
  getPlatformId?: (req: Request) => number | null;
  // For operator routes that do not use requireAuth.
  actor?: ActorOverride;
  // Optional async actor resolver for routes that don't rely on
  // requireAuth/requirePatient (e.g. the legacy /coach/chat which
  // accepts an optional bearer). Returns null when no actor can be
  // attributed; in that case the audit row is skipped (we never
  // persist actor-less PHI rows from authenticated routes).
  getActor?: (
    req: Request,
  ) =>
    | { userId: number | null; role: string }
    | null
    | Promise<{ userId: number | null; role: string } | null>;
};

function deriveAction(method: string): "read" | "write" | "delete" {
  if (method === "DELETE") return "delete";
  if (method === "GET" || method === "HEAD") return "read";
  return "write";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Strip query string before audit: search terms can carry PHI
// (a patient name, a date), and we deliberately do not want them
// in the audit log either.
function pathOnly(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export function phiAudit(config: AuditConfig = {}) {
  return function phiAuditMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Capture request shape up front -- the request object is
    // re-used for the response, so reading `originalUrl` after
    // `finish` is fine, but reading body/headers after the route
    // handler may have mutated them is not.
    const startedAt = Date.now();
    const route = pathOnly(req.originalUrl || req.url || "");
    const method = req.method;
    const ipHash = sha256Hex(req.ip ?? "");
    const uaHash = sha256Hex(req.get("user-agent") ?? "");

    res.on("finish", () => {
      // The whole insert path runs inside an async IIFE so we can
      // await the (possibly async) getPatientId / getActor resolvers
      // without making the 'finish' callback itself async (Node's
      // EventEmitter swallows promise rejections from listeners).
      void (async () => {
        try {
          const auth = (req as AuthedRequest).auth;
          const actorOverride = config.actor;
          let actorUserId: number | null = auth?.userId ?? null;
          let actorRole: string =
            actorOverride?.actorRole ?? auth?.role ?? "system";

          // Async actor resolver runs only when neither requireAuth
          // nor an actor override populated the actor. Used by
          // /coach/chat which accepts an optional bearer.
          if (!auth && !actorOverride && config.getActor) {
            const resolved = await config.getActor(req);
            if (resolved) {
              actorUserId = resolved.userId;
              actorRole = resolved.role;
            }
          }

          // Skip writing for unauthenticated PHI requests that 401'd
          // before we knew who they were, AND for routes whose
          // optional bearer was missing/invalid. The auth attempt
          // itself is already logged by pino-http; persisting an
          // actor-less row here would just inflate the table.
          const haveActor =
            !!auth ||
            !!actorOverride ||
            (!!config.getActor && actorUserId !== null);
          if (!haveActor) {
            return;
          }

          const action = deriveAction(method);
          const targetPatientId = config.getPatientId
            ? await config.getPatientId(req)
            : null;
          const targetPlatformId = config.getPlatformId
            ? config.getPlatformId(req)
            : null;
          const statusCode = res.statusCode;

          // Append-only insert. Awaited (so a slow DB shows up in
          // the unhandled-rejection logs rather than getting
          // silently dropped), but the listener's outer try/catch
          // means an audit failure never crashes the process.
          await db.insert(phiAccessLogsTable).values({
            actorUserId,
            actorRole,
            action,
            targetPatientId,
            targetPlatformId,
            route,
            method,
            statusCode,
            ipHash,
            uaHash,
          });
        } catch (err) {
          logger.warn(
            { err, route, method, statusCode: res.statusCode },
            "phi audit insert failed",
          );
        }
        // Reference startedAt so future versions can populate a
        // duration_ms column without re-walking the timing path.
        void startedAt;
      })();
    });

    next();
  };
}

// Convenience: pull a positive integer from req.params, or null.
// Most patients/me routes parameterize on an `id` (the patient user
// id), so the helper hides the parseInt boilerplate at the call site.
export function paramAsInt(name: string) {
  return (req: Request): number | null => {
    const raw = req.params?.[name];
    if (typeof raw !== "string") return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
}
