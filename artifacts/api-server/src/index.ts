import type { Server } from "http";
import app from "./app";
import { logger } from "./lib/logger";

// ----------------------------------------------------------------------
// Pilot production safety asserts (HIPAA pilot, T100)
//
// Fail-closed at boot if the production env is misconfigured in any way
// that could cause PHI to leak or dev surfaces to be reachable. Every
// check is "absent OR strict" so local dev is unaffected (NODE_ENV !==
// "production"). Once production is up, these guarantees are immutable
// for the process lifetime -- env vars are read once.
//
// What this prevents:
//   * Dev-login routes silently re-enabled in prod (ENABLE_DEV_LOGIN)
//   * Any AI provider key existing in prod env (no PHI to non-BAA vendors)
//   * Stale / weak / unset SESSION_SECRET (cookie forgery surface)
//   * Falling back to the local DATABASE_URL (Replit Postgres) when
//     the BAA-covered AWS_DATABASE_URL is missing
// ----------------------------------------------------------------------
function assertProductionSafety(): void {
  if (process.env.NODE_ENV !== "production") return;

  const violations: string[] = [];

  if (process.env.ENABLE_DEV_LOGIN) {
    violations.push(
      "ENABLE_DEV_LOGIN must not be set in production (would mount /api/dev/*)",
    );
  }
  for (const key of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
  ] as const) {
    if (process.env[key]) {
      violations.push(
        `${key} must not be set in production (no PHI to non-BAA AI vendors)`,
      );
    }
  }
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    violations.push(
      "SESSION_SECRET must be set and at least 32 characters in production",
    );
  }
  if (!process.env.AWS_DATABASE_URL) {
    violations.push(
      "AWS_DATABASE_URL must be set in production (BAA-covered RDS); refusing to fall back to DATABASE_URL",
    );
  }

  if (violations.length > 0) {
    logger.fatal(
      { violations },
      "production safety assert failed -- refusing to start",
    );
    process.exit(1);
  }
}

assertProductionSafety();

// ----------------------------------------------------------------------
// Pilot reliability hardening
//
// The API crashed once during pilot prep with EADDRINUSE on port 8080.
// "Stale port" is the symptom; the real cause is that the previous
// Node process was terminated without ever calling `server.close()`,
// so the OS held the listener in TIME_WAIT past the next start.
// During pilot we will not be sitting next to the workflow to restart
// by hand, so this file is responsible for three guarantees:
//
//   1. Boot is observable (single startup line with port + ISO time).
//   2. Crashes do not silently disappear (uncaughtException +
//      unhandledRejection are logged before exit).
//   3. Restarts release the port cleanly (SIGTERM/SIGINT trigger a
//      graceful server.close() so the next boot can bind immediately).
//
// Replit's workflow runner handles auto-restart-on-failure, so we do
// not need a process manager on top.
// ----------------------------------------------------------------------

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server: Server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  // Single grep-friendly startup line. Includes ISO timestamp so
  // workflow log archaeology after a crash is one search away.
  logger.info(
    { port, startedAt: new Date().toISOString(), nodeEnv: process.env.NODE_ENV ?? "development" },
    "API server listening",
  );
});

// Bind/listen failures surface here as well (the listen callback only
// runs on success on some Node versions). Catching at the server level
// guarantees EADDRINUSE and friends always produce a structured log
// line and a deterministic exit instead of a flapping workflow.
server.on("error", (err) => {
  logger.fatal({ err }, "server error");
  process.exit(1);
});

// Defensive limits. Express's defaults are generous; in pilot we want
// slow/abandoned connections to be reaped instead of pinning a worker.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// ---- Process-level error handlers -----------------------------------
//
// Without these two handlers an unhandled async throw can take down
// the entire Node process with no structured log at all -- you'd just
// see the workflow flap. Both handlers log via pino so the stack ends
// up in the same pipeline as the rest of our request logs (with the
// existing secret redaction applied).

process.on("unhandledRejection", (reason) => {
  // Fail-fast. An unhandled rejection means a promise chain reached
  // termination without anyone catching its error -- the process state
  // past that point is undefined. Continuing risks a "looks up but
  // behaves wrong" zombie that's harder to detect than a clean restart.
  // Replit's workflow runner brings us back up automatically.
  logger.fatal({ err: reason }, "unhandledRejection -- shutting down");
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  // Synchronous throws outside any try/catch leave the process in an
  // unknown state. Best practice is log + graceful close + exit so
  // the workflow restarts us into a clean state.
  logger.fatal({ err }, "uncaughtException -- shutting down");
  shutdown("uncaughtException", 1);
});

// ---- Graceful shutdown ----------------------------------------------
//
// On SIGTERM/SIGINT we close the listening socket, drain in-flight
// requests, and only then exit. This is what fixes the EADDRINUSE
// loop: when the workflow next boots the API, port 8080 is already
// free because we returned it to the OS instead of crashing on it.

let shuttingDown = false;

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutdown initiated");

  // Hard cap: if existing keep-alive connections refuse to drain, we
  // still want the next boot to succeed rather than hanging forever
  // on the SIGKILL fallback.
  const forceExit = setTimeout(() => {
    logger.warn("graceful shutdown timed out, forcing exit");
    process.exit(exitCode || 1);
  }, 8_000);
  forceExit.unref();

  server.close((closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr }, "error during server.close");
      process.exit(exitCode || 1);
      return;
    }
    logger.info("shutdown complete");
    process.exit(exitCode);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
