import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, patientsTable } from "@workspace/db";

// Public invite routes. These are intentionally mounted OUTSIDE the
// /api prefix because:
//   1. The HTML landing page at /invite/:token must live at the root of
//      the production domain so the URL the doctor shares is short and
//      memorable -- e.g. https://viva-ai.replit.app/invite/abc123.
//   2. iOS Universal Links and Android App Links pattern-match against
//      the URL the user actually opens, not against an internal proxy
//      path. Putting the page at /api/... would force the AASA file to
//      whitelist /api/invite/* which leaks the API namespace.
//
// Two surfaces:
//   GET /invite/:token         -> self-contained HTML landing page
//                                 (works on a fresh device with no app)
//   GET /api/invite/:token     -> JSON token preview, used by the page
//                                 above and by the dashboard if it ever
//                                 wants to render its own version.
//
// Token validation is strict: invalid tokens return 404 from both
// surfaces, and we deliberately do NOT leak whether the token was
// already consumed (vs never existed) to avoid enumerating active
// invites.

const HTML_ROUTER: Router = Router();
const JSON_ROUTER: Router = Router();

// iOS App Store ID for com.sullyk97.vivaai. Hard-coded because there
// is exactly one app and changing it requires a coordinated App Store
// Connect change anyway.
const IOS_APP_STORE_URL = "https://apps.apple.com/app/id6762158265";
// Android: even if the Play listing isn't live yet, the link resolves
// gracefully to a "coming soon" page rather than a hard error.
const ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.sullyk97.vivaai";

interface InvitePreview {
  patientName: string;
  doctorName: string;
  clinicName: string | null;
}

async function loadInvitePreview(token: string): Promise<InvitePreview | null> {
  if (!token || token.length < 8 || token.length > 200) return null;
  // Single round-trip: patient row -> doctor row.
  const [patientRow] = await db
    .select({
      patientUserId: patientsTable.userId,
      doctorId: patientsTable.doctorId,
      activatedAt: patientsTable.activatedAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.activationToken, token))
    .limit(1);
  if (!patientRow) return null;
  if (patientRow.activatedAt) {
    // Token was already burned. We surface this as "not valid" so the
    // page can show the right CTA (sign in instead of activate).
    return null;
  }
  const [patient] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, patientRow.patientUserId))
    .limit(1);
  const [doctor] = await db
    .select({ name: usersTable.name, clinicName: usersTable.clinicName })
    .from(usersTable)
    .where(eq(usersTable.id, patientRow.doctorId))
    .limit(1);
  if (!patient || !doctor) return null;
  return {
    patientName: patient.name,
    doctorName: doctor.name,
    clinicName: doctor.clinicName ?? null,
  };
}

JSON_ROUTER.get("/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token || "");
  const preview = await loadInvitePreview(token);
  if (!preview) {
    res.status(404).json({ error: "invalid_or_used" });
    return;
  }
  res.json(preview);
});

// Minimal HTML escaper. We only ever interpolate names and tokens,
// both of which we control or validate, but defense in depth is cheap.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInvalidPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Invite link expired - Viva</title>
<style>${PAGE_CSS}</style>
</head>
<body>
  <main class="card">
    <div class="brand">VIVA</div>
    <h1>This invite link is no longer valid</h1>
    <p class="lede">The link may have expired or already been used. Ask your clinician for a fresh invite.</p>
    <a class="btn btn-secondary" href="${IOS_APP_STORE_URL}">Already have the app? Open it and sign in</a>
  </main>
</body>
</html>`;
}

function renderInvitePage(token: string, preview: InvitePreview): string {
  const safeToken = esc(token);
  const safePatient = esc(preview.patientName.split(" ")[0] || preview.patientName);
  const safeDoctor = esc(preview.doctorName);
  const safeClinic = preview.clinicName ? esc(preview.clinicName) : "";
  const clinicLine = safeClinic ? `<div class="clinic">${safeClinic}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>You've been invited to Viva</title>
<meta name="apple-itunes-app" content="app-id=6762158265, app-argument=viva://invite/${safeToken}" />
<style>${PAGE_CSS}</style>
</head>
<body>
  <main class="card">
    <div class="brand">VIVA</div>
    <h1>Hi ${safePatient}, you've been invited to join Viva.</h1>
    <p class="lede">
      ${safeDoctor} has set up a Viva account for you so you can share daily
      check-ins from your phone.
    </p>
    ${clinicLine}

    <a class="btn btn-primary" id="open-app" href="viva://invite/${safeToken}">
      Open the Viva app
    </a>

    <div class="divider"><span>Don't have the app yet?</span></div>

    <a class="btn btn-store btn-ios" href="${IOS_APP_STORE_URL}">
      Download for iPhone
    </a>
    <a class="btn btn-store btn-android" href="${ANDROID_PLAY_STORE_URL}">
      Download for Android
    </a>

    <p class="footnote" id="resume-hint">
      After installing, return to this page and tap "Open the Viva app" to
      finish setting up your account.
    </p>
  </main>
  <script>
    // Persist the token so a returning patient (post-install) hits the
    // same activation flow even if they navigate away briefly.
    try { localStorage.setItem("viva.invite.token", ${JSON.stringify(token)}); } catch (e) {}

    // One-shot auto-redirect into the custom scheme. If the app is
    // installed, iOS/Android will switch to it; if not, the page stays
    // put and the user sees the download CTAs. We only fire this once
    // per page load so refreshes don't loop.
    var fired = sessionStorage.getItem("viva.invite.fired") === "1";
    if (!fired) {
      sessionStorage.setItem("viva.invite.fired", "1");
      // Small delay so the user perceives the page rendering before the
      // OS prompt appears. Without this, mobile Safari sometimes shows
      // the "Open in Viva?" sheet on top of a blank background.
      setTimeout(function () {
        window.location.href = ${JSON.stringify(`viva://invite/${token}`)};
      }, 250);
    }

    // Manual button: always re-fire the scheme on tap, since the auto
    // version is gated by sessionStorage.
    var btn = document.getElementById("open-app");
    if (btn) {
      btn.addEventListener("click", function (e) {
        // The href already does the right thing; we just stop double
        // navigation if the user double-taps.
        e.stopPropagation();
      });
    }
  </script>
</body>
</html>`;
}

const PAGE_CSS = `
  :root {
    --navy: #142240;
    --accent: #38B6FF;
    --bg: #F6F8FB;
    --card: #FFFFFF;
    --muted: #5A6478;
    --border: #E4E8EE;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg);
    color: var(--navy);
    -webkit-font-smoothing: antialiased;
  }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: var(--card);
    border-radius: 24px;
    padding: 32px 24px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 18px 48px rgba(20, 34, 64, 0.08);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 4px;
    color: var(--navy);
    font-size: 14px;
    margin-bottom: 24px;
  }
  h1 {
    font-size: 22px;
    line-height: 1.3;
    margin: 0 0 12px 0;
    font-weight: 700;
  }
  .lede {
    margin: 0 0 4px 0;
    color: var(--muted);
    font-size: 15px;
    line-height: 1.5;
  }
  .clinic {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 20px;
    font-style: italic;
  }
  .btn {
    display: block;
    text-align: center;
    text-decoration: none;
    padding: 14px 16px;
    border-radius: 14px;
    font-weight: 600;
    font-size: 15px;
    margin-top: 12px;
    transition: opacity 0.15s ease, transform 0.05s ease;
  }
  .btn:active { transform: scale(0.98); }
  .btn-primary {
    background: var(--navy);
    color: #fff;
    margin-top: 24px;
  }
  .btn-secondary {
    background: transparent;
    color: var(--navy);
    border: 1px solid var(--border);
    margin-top: 24px;
  }
  .btn-store {
    background: #fff;
    color: var(--navy);
    border: 1px solid var(--border);
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 28px 0 4px 0;
    color: var(--muted);
    font-size: 13px;
  }
  .divider::before, .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .footnote {
    margin-top: 24px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
  }
`;

HTML_ROUTER.get("/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token || "");
  const preview = await loadInvitePreview(token);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // No-store: invite previews are cheap and we want to make sure a
  // patient who activates and re-visits sees the "no longer valid"
  // page rather than a stale cached invite landing.
  res.setHeader("Cache-Control", "no-store");
  if (!preview) {
    res.status(404).send(renderInvalidPage());
    return;
  }
  res.status(200).send(renderInvitePage(token, preview));
});

export const inviteHtmlRouter = HTML_ROUTER;
export const inviteJsonRouter = JSON_ROUTER;
