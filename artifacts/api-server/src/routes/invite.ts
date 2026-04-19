import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, patientsTable } from "@workspace/db";
import { isInviteTokenExpired } from "../lib/inviteTokens";

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
      activationTokenIssuedAt: patientsTable.activationTokenIssuedAt,
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
  if (isInviteTokenExpired(patientRow.activationTokenIssuedAt)) {
    // Same UX as already-burned: render the "no longer valid" page.
    // Calling activate with this token would 410 anyway, so we hide
    // the CTA up front rather than letting the patient set a password
    // and then bounce.
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

// Brand asset is inlined as a data URI so the invite page is a single
// self-contained HTML response with no cross-artifact asset path. The
// PNG itself is the same source file the dashboard ships in
// artifacts/viva-dashboard/public/viva-logo.png; vivaLogo.ts is a
// build-time base64 of that exact file. Re-encode it from the same
// source if the dashboard ever ships a new wordmark.
import { VIVA_LOGO_DATA_URI } from "./vivaLogo";
const VIVA_LOGO_URL = VIVA_LOGO_DATA_URI;

function renderInvalidPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Invite link no longer valid - Viva</title>
${HEAD_LINKS}
<style>${PAGE_CSS}</style>
</head>
<body>
  <main class="shell">
    <div class="brand-row">
      <img class="brand-logo" src="${VIVA_LOGO_URL}" alt="Viva" width="132" height="44" draggable="false" />
      <p class="brand-caption">Patient activation</p>
    </div>
    <section class="card">
      <h1>This invite link is no longer valid</h1>
      <p class="lede">
        The link may have already been used or replaced. Ask your clinician
        to send you a fresh invite, or open the Viva app and sign in with
        the email and password you set when you first activated your account.
      </p>
      <a class="btn btn-secondary" href="${IOS_APP_STORE_URL}">Open the Viva app</a>
    </section>
    <p class="legal">Viva is a clinician-monitored support platform.</p>
  </main>
</body>
</html>`;
}

function renderInvitePage(token: string, preview: InvitePreview): string {
  const safeToken = esc(token);
  const firstName = preview.patientName.split(" ")[0] || preview.patientName;
  const safePatient = esc(firstName);
  const safeDoctor = esc(preview.doctorName);
  const safeClinic = preview.clinicName ? esc(preview.clinicName) : "";
  const clinicMeta = safeClinic
    ? `<dl class="meta">
        <div class="meta-row"><dt>Clinician</dt><dd>${safeDoctor}</dd></div>
        <div class="meta-row"><dt>Practice</dt><dd>${safeClinic}</dd></div>
      </dl>`
    : `<dl class="meta">
        <div class="meta-row"><dt>Clinician</dt><dd>${safeDoctor}</dd></div>
      </dl>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>You're invited to Viva</title>
<meta name="apple-itunes-app" content="app-id=6762158265, app-argument=viva://invite/${safeToken}" />
${HEAD_LINKS}
<style>${PAGE_CSS}</style>
</head>
<body>
  <main class="shell">
    <div class="brand-row">
      <img class="brand-logo" src="${VIVA_LOGO_URL}" alt="Viva" width="132" height="44" draggable="false" />
      <p class="brand-caption">Patient activation</p>
    </div>

    <section class="card">
      <p class="eyebrow">You're invited</p>
      <h1>Welcome, ${safePatient}.</h1>
      <p class="lede">
        Your clinician has set up a Viva account for you. Continue on your
        phone to choose a password and start submitting daily check-ins.
      </p>

      ${clinicMeta}

      <a class="btn btn-primary" id="open-app" href="viva://invite/${safeToken}">
        Continue in the Viva app
      </a>
      <p class="hint">If the app is installed, this will open it directly.</p>
    </section>

    <section class="card card-muted">
      <p class="eyebrow">Don't have the app yet?</p>
      <p class="lede compact">
        Install Viva on your phone, then return to this page and tap
        Continue to finish setting up your account.
      </p>
      <div class="store-row">
        <a class="btn btn-store" href="${IOS_APP_STORE_URL}">
          <span class="store-platform">iPhone</span>
          <span class="store-action">App Store</span>
        </a>
        <a class="btn btn-store" href="${ANDROID_PLAY_STORE_URL}">
          <span class="store-platform">Android</span>
          <span class="store-action">Google Play</span>
        </a>
      </div>
    </section>

    <p class="legal">
      Viva is a clinician-monitored support platform. Your check-ins are
      visible only to your care team.
    </p>
  </main>
  <script>
    try { localStorage.setItem("viva.invite.token", ${JSON.stringify(token)}); } catch (e) {}

    var fired = sessionStorage.getItem("viva.invite.fired") === "1";
    if (!fired) {
      sessionStorage.setItem("viva.invite.fired", "1");
      setTimeout(function () {
        window.location.href = ${JSON.stringify(`viva://invite/${token}`)};
      }, 250);
    }
  </script>
</body>
</html>`;
}

// Montserrat is the only typeface used across the dashboard and the
// patient app. We pull the same weights the React surfaces use so the
// invite page reads as the same product, not a generic web fallback.
const HEAD_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" />
<link rel="icon" type="image/svg+xml" href="/viva-dashboard/favicon.svg" />`;

// Visual tokens are kept in lockstep with artifacts/viva-dashboard/src/
// index.css and artifacts/pulse-pilot/constants/colors.ts. If you tweak
// any value here, mirror it in those files (and vice versa).
const PAGE_CSS = `
  :root {
    --navy: #142240;
    --foreground: #142240;
    --muted-foreground: #6B7A90;
    --background: #FFFFFF;
    --card: #F5F6FA;
    --card-soft: #EEF0F6;
    --border: #E0E4EB;
    --accent: #38B6FF;
    --radius-md: 16px;
    --radius-lg: 20px;
    --radius-xl: 24px;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: "Montserrat", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--background);
    color: var(--foreground);
    letter-spacing: -0.005em;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 20px 64px;
  }
  .shell {
    width: 100%;
    max-width: 440px;
  }
  .brand-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 28px;
  }
  .brand-logo {
    width: 132px;
    height: auto;
    display: block;
  }
  .brand-caption {
    margin: 18px 0 0 0;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .card {
    background: var(--card);
    border-radius: var(--radius-lg);
    padding: 28px 24px;
    margin-bottom: 14px;
  }
  .card-muted {
    background: var(--card-soft);
  }
  .eyebrow {
    margin: 0 0 10px 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  h1 {
    font-size: 24px;
    line-height: 1.25;
    margin: 0 0 10px 0;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lede {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 15px;
    line-height: 1.55;
    font-weight: 400;
  }
  .lede.compact { font-size: 14px; line-height: 1.5; }
  .meta {
    margin: 22px 0 4px 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    margin: 0;
  }
  .meta dt {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted-foreground);
    margin: 0;
  }
  .meta dd {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--foreground);
    text-align: right;
  }
  .btn {
    display: block;
    text-align: center;
    text-decoration: none;
    font-family: inherit;
    font-size: 15px;
    font-weight: 600;
    padding: 14px 18px;
    border-radius: var(--radius-md);
    transition: opacity 0.15s ease, transform 0.05s ease;
    border: 1px solid transparent;
  }
  .btn:active { transform: scale(0.98); }
  .btn:hover { opacity: 0.92; }
  .btn-primary {
    background: var(--navy);
    color: #FFFFFF;
    margin-top: 24px;
  }
  .btn-secondary {
    background: transparent;
    color: var(--foreground);
    border-color: var(--border);
    margin-top: 24px;
  }
  .hint {
    margin: 12px 0 0 0;
    text-align: center;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 500;
  }
  .store-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 18px;
  }
  .btn-store {
    background: var(--background);
    color: var(--foreground);
    border-color: var(--border);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
  }
  .store-platform {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted-foreground);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .store-action {
    font-size: 14px;
    font-weight: 700;
    color: var(--foreground);
  }
  .legal {
    margin: 24px 4px 0 4px;
    color: var(--muted-foreground);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.55;
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
