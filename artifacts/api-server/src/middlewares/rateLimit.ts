import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response } from "express";

// Rate limiting policy.
//
// Three tiers, all per-IP, in-memory (sufficient for the single
// api-server instance the pilot runs). The handler returns the
// same JSON shape every other route uses (`{ error: '...' }`) so
// the mobile app's existing fetch wrapper can surface it.
//
// Two reasons we tolerate the in-memory store for now:
//   1. The pilot deploys a single instance, so there is no shared
//      state to coordinate.
//   2. Even per-IP, an attacker willing to rotate IPs is not the
//      threat we are defending against here. The goal is to slow
//      down credential stuffing and brute-force enumeration of
//      activation tokens, not to stop a botnet. A Redis store can
//      slot in later via the `store` option without touching call
//      sites.
//
// `app.set('trust proxy', 1)` is already set in app.ts, so req.ip
// is the real client IP behind the Replit edge proxy. We use the
// library's bundled ipKeyGenerator to safely bucket IPv6 addresses
// (instead of leaking per-/128 addresses into separate buckets).

function jsonHandler(_req: Request, res: Response) {
  res.status(429).json({ error: "rate_limited" });
}

// Strict: credential surfaces (login, signup, activate). Burst of
// 10 in 15 minutes is more than enough for a real human (typo +
// retry + a couple of password manager attempts) but small enough
// to neuter online brute force. We DO NOT skip on success because
// successful logins are rare per IP (clinicians sign in maybe a
// few times per day) and counting them keeps a single compromised
// machine from spraying after one valid login.
export const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  handler: jsonHandler,
});

// Medium: read-heavy authenticated PHI surfaces (doctor patient
// list, patient self timeline, coach chat). 60/min is roughly two
// page loads per second sustained, which generously covers normal
// dashboard browsing. Coach chat in pilot mode runs the structured
// templated path -- 60/min is way more than a human will ever hit.
export const mediumApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  handler: jsonHandler,
});

// Lenient catch-all for endpoints that are noisy but harmless
// (health checks, well-known files). Mounted at the app root so
// nothing escapes some kind of ceiling, which limits a single IP
// from running the server out of CPU just by hammering /health.
export const lenientGlobalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  handler: jsonHandler,
});
