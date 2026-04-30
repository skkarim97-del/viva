import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Pino redact paths. Defense-in-depth: route handlers should already
// avoid logging PHI, but if anything ever accidentally serialises a
// req object, request body, OpenAI response data, MFA/OTP code, or a
// raw bearer token, the redactor scrubs it before it reaches the
// log sink. Pino path syntax supports wildcards (`*.foo`) which
// catches arbitrary log-context keys named after sensitive fields.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      // Auth + cookies (existing)
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      // Request body wholesale -- no route should ever log it,
      // but if one does (e.g. err handler with { req }), kill it.
      "req.body",
      "*.body",
      // Specific PHI / secret field names that may appear as
      // top-level log-context keys (e.g. `req.log.info({ message,
      // conversationHistory }, 'foo')`).
      "*.message",
      "*.conversationHistory",
      "*.healthContext",
      "*.token",
      "*.password",
      "*.passwordHash",
      "*.mfaSecret",
      "*.otp",
      "*.passcode",
      "*.secret",
      // OpenAI / upstream error payloads frequently echo the prompt
      // back inside `error.response.data`. Scrub it.
      "*.response.data",
      "err.response.data",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
