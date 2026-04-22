// ----------------------------------------------------------------------
// Pilot analytics client (web / Viva Clinic).
//
// Mirrors the mobile client's contract: one fire-and-forget POST per
// event, session id stored in sessionStorage so it lives for the
// browser tab and dies on close. Never throws; never blocks.
// ----------------------------------------------------------------------

const SESSION_KEY = "viva.analytics.sessionId";

const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

let cachedSessionId: string | null = null;
let startedSessionThisLoad = false;

function newSessionId(): string {
  const rand = Math.random().toString(16).slice(2, 14).padStart(12, "0");
  return `${Date.now().toString(36)}-${rand}`;
}

// Best-effort IANA timezone string. Returns null in privacy-restricted
// browsers where Intl is unavailable or returns an empty zone.
function timezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function readStoredSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeStoredSession(sid: string): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, sid);
  } catch {
    /* sessionStorage blocked (privacy mode, embedded) */
  }
}

/**
 * Returns (or creates) the per-tab analytics session id. The first
 * call during a page load also fires `session_start` so the funnel
 * has the canonical open-event row -- we never want a session that
 * has events but no session_start.
 */
export function ensureSession(): string {
  if (cachedSessionId) return cachedSessionId;
  const stored = readStoredSession();
  if (stored) {
    cachedSessionId = stored;
    return stored;
  }
  const sid = newSessionId();
  cachedSessionId = sid;
  writeStoredSession(sid);
  if (!startedSessionThisLoad) {
    startedSessionThisLoad = true;
    if (import.meta.env.DEV) {
      // Lightweight visibility into when (and why) we minted a fresh
      // tab session. Dev-only -- never lands in a production console.
      // eslint-disable-next-line no-console
      console.log(`[analytics] new session minted: no_existing_session → ${sid}`);
    }
    void postEvent("session_start", sid);
  }
  return sid;
}

async function postEvent(eventName: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${BASE}/analytics/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          { eventName, sessionId, platform: "web", timezone: timezone() },
        ],
      }),
      // keepalive lets the request survive a tab-close in modern
      // browsers, so a "patient_viewed" fired from a row click that
      // navigates immediately doesn't get cancelled.
      keepalive: true,
    });
  } catch {
    /* swallow -- analytics must never affect product flows */
  }
}

/**
 * Fire one analytics event. Fire-and-forget: callers never await.
 */
export function logEvent(eventName: string): void {
  const sid = ensureSession();
  void postEvent(eventName, sid);
}
