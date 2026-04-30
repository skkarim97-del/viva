import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// IP allowlist gate for the operator (/api/internal) surface.
//
// Why per-route, not global:
//   The static operator code (`Viva2026!`) is shared and travels in
//   plaintext over Authorization headers. Anyone who learns it can
//   call /api/internal/* from anywhere on the internet. A second
//   factor based on network location (i.e. the operator must be on
//   a known IP) limits blast radius from a code leak until we do
//   the bigger refactor of moving the operator into a real user
//   account with TOTP (deferred per pilot decision).
//
// Configuration:
//   INTERNAL_IP_ALLOWLIST = comma-separated list of exact IPv4 or
//                           IPv6 addresses (no CIDR for the pilot --
//                           keep it boring and auditable).
//   If the env var is unset OR empty, the gate is OPEN (logged at
//   warn) so dev environments and ad-hoc operator audits keep
//   working. Production deployments should set this.
//
// We compare against `req.ip`, which respects `app.set('trust
// proxy', 1)` in app.ts and yields the real client IP behind the
// Replit edge proxy.

let warned = false;

function parseAllowlist(): Set<string> | null {
  const raw = (process.env.INTERNAL_IP_ALLOWLIST || "").trim();
  if (!raw) return null;
  const ips = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ips.length > 0 ? new Set(ips) : null;
}

export function operatorIpAllowlist(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const allowed = parseAllowlist();
  if (!allowed) {
    if (!warned) {
      logger.warn(
        "[operatorIpAllowlist] INTERNAL_IP_ALLOWLIST is unset; operator endpoints accept any IP. Set this in production.",
      );
      warned = true;
    }
    next();
    return;
  }
  const ip = req.ip ?? "";
  if (!allowed.has(ip)) {
    // Log at warn (not error) -- a probe from an unexpected IP is
    // expected noise on a public endpoint, not a system fault.
    logger.warn(
      { method: req.method, path: req.originalUrl },
      "operator endpoint rejected: ip not in allowlist",
    );
    res.status(403).json({ error: "forbidden_ip" });
    return;
  }
  next();
}
