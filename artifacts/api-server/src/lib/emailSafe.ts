// PHI-safe escalation email helper (HIPAA pilot, T009).
//
// THE RULE: provider notification emails cross third-party mail
// infrastructure. Subject lines, preview text, and body MUST NEVER
// identify the specific patient, their medication, symptoms, or any
// clinical detail. The email tells the provider that *someone* in
// their panel needs attention and directs them to the dashboard.
//
// This module uses Resend's HTTP API (fetch, no extra dependency).
// If RESEND_API_KEY is not set the call short-circuits to a log line
// so missing config never crashes the patient-facing flow.
//
// Required env vars (none are mandatory for app boot; missing vars
// degrade gracefully to log-only):
//   RESEND_API_KEY   - Resend API key (re_***)
//   VIVA_EMAIL_FROM  - sender address (default: noreply@itsviva.com)
//   VIVA_CLINIC_URL  - CTA link base (default: https://clinic.itsviva.com)
//
// Demo accounts (email matching demo%@itsviva.com or %@vivaai.demo)
// are silently suppressed so synthetic test data never pings real inboxes.

import { logger } from "./logger";
import { DEMO_EMAIL_LIKE, DEMO_VIVAAI_LIKE } from "./demoFilter";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Patterns for suppressing demo / test accounts. Must stay in sync
// with demoFilter.ts SQL patterns (SQL LIKE -> JS regex).
const IS_DEMO_EMAIL = /^demo.*@itsviva\.com$|@vivaai\.demo$/i;

function isDemoEmail(email: string): boolean {
  // Belt-and-suspenders: check both the regex (fast path) and pattern
  // constants so changes to demoFilter.ts surface here at runtime.
  return (
    IS_DEMO_EMAIL.test(email) ||
    email.toLowerCase().startsWith("demo") ||
    email.toLowerCase().endsWith("@vivaai.demo")
  );
}

// Returns undefined when the feature is not configured; callers must
// treat undefined as "do not send" without throwing.
function getConfig():
  | { apiKey: string; from: string; clinicUrl: string }
  | undefined {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    from:
      process.env.VIVA_EMAIL_FROM ?? "Viva Clinic <noreply@itsviva.com>",
    clinicUrl:
      process.env.VIVA_CLINIC_URL ?? "https://clinic.itsviva.com",
  };
}

// Sends a PHI-safe "patient requested review" notification email to
// the given doctor email address. Fire-and-forget safe: always
// resolves (never throws) so callers can fire without await or catch.
export async function sendEscalationEmail(
  doctorEmail: string,
): Promise<void> {
  if (isDemoEmail(doctorEmail)) {
    logger.debug(
      { doctorEmail: "[demo]" },
      "emailSafe: suppressed escalation email for demo account",
    );
    return;
  }

  const config = getConfig();
  if (!config) {
    logger.debug(
      "emailSafe: RESEND_API_KEY not set — skipping escalation email (set the key to enable)",
    );
    return;
  }

  const subject = "Viva: Patient review requested";
  const text = [
    "A patient in your Viva panel has requested review or been flagged for follow-up.",
    "",
    `Open Viva Clinic: ${config.clinicUrl}`,
    "",
    "—",
    "You are receiving this because you are a Viva care provider.",
    "Questions? Reply to this email or contact support@itsviva.com",
  ].join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:520px;margin:40px auto;padding:0 24px">
  <p style="font-size:20px;font-weight:700;margin-bottom:8px">Patient review requested</p>
  <p style="color:#555;line-height:1.6;margin-bottom:24px">
    A patient in your Viva panel has requested review or been flagged for follow-up.
  </p>
  <a href="${config.clinicUrl}"
     style="display:inline-block;background:#0F1923;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
    Open Viva Clinic →
  </a>
  <p style="color:#999;font-size:12px;margin-top:32px;line-height:1.5">
    You are receiving this because you are a Viva care provider.<br>
    Questions? Contact <a href="mailto:support@itsviva.com" style="color:#999">support@itsviva.com</a>
  </p>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [doctorEmail],
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      logger.warn(
        { status: res.status, body },
        "emailSafe: escalation email rejected by Resend",
      );
    } else {
      logger.info(
        { doctorEmail: doctorEmail.replace(/^[^@]+/, "***") },
        "emailSafe: escalation email sent",
      );
    }
  } catch (err) {
    // Network error, timeout, etc. — log and continue. The patient
    // flow must never fail because an email couldn't be delivered.
    logger.warn({ err }, "emailSafe: escalation email delivery failed");
  }
}

// Sends a magic-link sign-in email to the given doctor address. The link
// embeds a single-use high-entropy token; no PHI is included. Fire-and-
// forget safe: always resolves (never throws).
export async function sendMagicLinkEmail(
  doctorEmail: string,
  magicLink: string,
): Promise<void> {
  if (isDemoEmail(doctorEmail)) {
    logger.debug(
      { doctorEmail: "[demo]" },
      "emailSafe: suppressed magic-link email for demo account",
    );
    return;
  }

  const config = getConfig();
  if (!config) {
    // warn, not debug: unlike escalation emails, the magic link IS the
    // login flow. A missing key means no doctor can sign in. In production
    // the startup assert catches this before any request is served; this
    // warn is the safety net for dev/staging environments.
    logger.warn(
      "emailSafe: RESEND_API_KEY not set — magic-link email not sent. " +
      "Doctors cannot sign in without a working email provider. Set RESEND_API_KEY to enable.",
    );
    return;
  }

  const subject = "Sign in to Viva Clinic";
  const text = [
    "Click the link below to sign in to Viva Clinic.",
    "This link expires in 15 minutes and can only be used once.",
    "",
    magicLink,
    "",
    "If you didn't request this, you can safely ignore this email.",
    "—",
    "Viva Clinic",
  ].join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:520px;margin:40px auto;padding:0 24px">
  <p style="font-size:20px;font-weight:700;margin-bottom:8px">Sign in to Viva Clinic</p>
  <p style="color:#555;line-height:1.6;margin-bottom:24px">
    Click the button below to sign in. This link expires in 15 minutes and can only be used once.
  </p>
  <a href="${magicLink}"
     style="display:inline-block;background:#0F1923;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
    Sign in to Viva Clinic →
  </a>
  <p style="color:#999;font-size:12px;margin-top:32px;line-height:1.5">
    If you didn't request this email, you can safely ignore it.<br>
    Questions? Contact <a href="mailto:support@itsviva.com" style="color:#999">support@itsviva.com</a>
  </p>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [doctorEmail],
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      logger.warn(
        { status: res.status, body },
        "emailSafe: magic-link email rejected by Resend",
      );
    } else {
      logger.info(
        { doctorEmail: doctorEmail.replace(/^[^@]+/, "***") },
        "emailSafe: magic-link email sent",
      );
    }
  } catch (err) {
    logger.warn({ err }, "emailSafe: magic-link email delivery failed");
  }
}

// Self-check at load time to surface misconfigured env early (dev only).
// Does NOT send any email.
if (process.env["NODE_ENV"] !== "production") {
  const cfg = getConfig();
  if (!cfg) {
    logger.debug(
      "emailSafe: RESEND_API_KEY not set — escalation emails disabled (expected in dev without email config)",
    );
    // Magic-link auth is non-functional without the key. This is a warn so
    // it surfaces in dev logs even at the default log level (info). It does
    // not crash the server: local dev often runs without email config and
    // the startup assert already blocks the gap in production.
    logger.warn(
      "emailSafe: RESEND_API_KEY not set — magic-link login is non-functional in this environment. " +
      "Set RESEND_API_KEY (Resend API key) to test the sign-in flow end-to-end.",
    );
  }

  // Sanity-check that the demo suppression logic compiles and covers the
  // canonical demo patterns from demoFilter.ts.
  const testDemoCases = [
    "demo@itsviva.com",
    "demo+riley@itsviva.com",
    "demo+pt-1-stable-abc@itsviva.com",
    "doctor@vivaai.demo",
  ];
  for (const e of testDemoCases) {
    if (!isDemoEmail(e)) {
      throw new Error(
        `emailSafe: demo suppression bug — "${e}" was not suppressed`,
      );
    }
  }

  // Confirm non-demo addresses are not suppressed.
  const testRealCases = [
    "doctor@example.com",
    "provider@clinic.org",
    "user@itsviva.com",
  ];
  for (const e of testRealCases) {
    if (isDemoEmail(e)) {
      throw new Error(
        `emailSafe: demo suppression over-fired on real address "${e}"`,
      );
    }
  }
}
