import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/lib/apiConfig";
import { sessionApi } from "@/lib/api/sessionClient";

// ----------------------------------------------------------------------
// Pilot analytics client (mobile).
//
// Goals:
//   * Generate a session_id when the app opens; reuse it across
//     foreground/background transitions unless the app has been idle
//     long enough that the session is stale.
//   * Fire-and-forget POST to /analytics/events. Never throw, never
//     block a render.
//   * No queueing, no retries, no batching -- pilot grade. We only
//     need rough numbers.
// ----------------------------------------------------------------------

const SESSION_KEY = "@viva_analytics_session";
const LAST_ACTIVE_KEY = "@viva_analytics_last_active_at";
// 30 minutes of background = new session. Matches the convention used
// by GA / Amplitude defaults so reports cross-reference cleanly.
const SESSION_IDLE_MS = 30 * 60 * 1000;

let cachedSessionId: string | null = null;
// Single-flight: if two callers race ensureSession() before the first
// AsyncStorage round-trip resolves, both must observe the SAME pending
// promise so we don't mint two session ids and emit two session_start
// events for what's really one session.
let pendingSession: Promise<string> | null = null;

function newSessionId(): string {
  // Random enough for pilot bucketing. 12 hex chars + ms timestamp
  // collides only if two patients launch the app in the same ms with
  // colliding random bytes, which we can live with.
  const rand = Math.random().toString(16).slice(2, 14).padStart(12, "0");
  return `${Date.now().toString(36)}-${rand}`;
}

function platform(): "ios" | "android" | "web" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "web") return "web";
  return "unknown";
}

// Best-effort IANA timezone capture. Hermes/JSC both ship Intl now,
// but a stripped-down OS or a privacy-restricted device can still throw
// or return undefined -- we'd rather log a null timezone than crash a
// fire-and-forget analytics call.
function timezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Returns the current session id, generating a fresh one if no
 * session exists yet OR the previous session has been idle longer
 * than SESSION_IDLE_MS. When a fresh session is started, also fires
 * `session_start` so the funnel has the open-event row.
 *
 * Always safe to call -- never throws, never blocks the caller's UI.
 */
// In-memory mirror of the persisted last-active timestamp. We keep this
// alongside the cached id so an app that lives in the background for an
// hour without being evicted from memory still expires its session on
// the next foreground call (the previous version reused cachedSessionId
// indefinitely once warm, missing the idle-timeout case).
let cachedLastActive = 0;

type MintReason = "no_existing_session" | "idle_timeout" | "cold_start";

function logMint(reason: MintReason, sid: string) {
  // Console-only, dev-friendly. Never surfaces in product UI.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[analytics] new session minted: ${reason} → ${sid}`);
  }
}

export async function ensureSession(): Promise<string> {
  const now = Date.now();
  // Warm path: reuse the cached session unless it has gone idle in
  // memory (e.g. backgrounded for >30 min without OS eviction). This
  // is the fix for the "warm idle" case -- previously cachedSessionId
  // was reused forever once set.
  if (cachedSessionId) {
    if (now - cachedLastActive < SESSION_IDLE_MS) {
      cachedLastActive = now;
      void touchLastActive();
      return cachedSessionId;
    }
    // In-memory session has gone stale. Drop it and fall through to
    // mint a fresh one with the idle_timeout reason.
    cachedSessionId = null;
  }
  if (pendingSession) return pendingSession;
  pendingSession = (async () => {
    let reason: MintReason = "no_existing_session";
    try {
      const [storedSession, storedLastActive] = await Promise.all([
        AsyncStorage.getItem(SESSION_KEY),
        AsyncStorage.getItem(LAST_ACTIVE_KEY),
      ]);
      const lastActive = storedLastActive ? Number(storedLastActive) : 0;
      if (storedSession) {
        if (Date.now() - lastActive < SESSION_IDLE_MS) {
          // Within the idle window -- cold-start resume. Reuse.
          cachedSessionId = storedSession;
          cachedLastActive = Date.now();
          void touchLastActive();
          return cachedSessionId;
        }
        // Stored session exists but went idle while the app was killed.
        reason = "cold_start";
      } else {
        // Nothing on disk -- truly fresh.
        reason = "no_existing_session";
      }
    } catch {
      /* fall through to fresh session */
    }
    // If we got here via the warm-idle branch above, the cached path
    // already reset cachedSessionId. Override the reason to reflect
    // that this was an in-memory idle expiry, not a cold start.
    if (cachedLastActive && Date.now() - cachedLastActive >= SESSION_IDLE_MS) {
      reason = "idle_timeout";
    }
    const sid = newSessionId();
    cachedSessionId = sid;
    cachedLastActive = Date.now();
    try {
      await Promise.all([
        AsyncStorage.setItem(SESSION_KEY, sid),
        AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())),
      ]);
    } catch {
      /* fine: cachedSessionId still drives this process */
    }
    logMint(reason, sid);
    // Fire the session_start row for this brand-new session. We do NOT
    // await it -- the session id is already valid for downstream events.
    void postEvent("session_start", sid);
    return sid;
  })();
  try {
    return await pendingSession;
  } finally {
    // Release the single-flight slot once the in-flight resolution is
    // done so a subsequent stale-session reset can re-mint cleanly.
    pendingSession = null;
  }
}

async function touchLastActive(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

async function postEvent(eventName: string, sessionId: string): Promise<void> {
  try {
    const token = await sessionApi.getStoredToken();
    if (!token) return; // anonymous launches don't have a user id yet
    await fetch(`${API_BASE}/analytics/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        events: [
          {
            eventName,
            sessionId,
            platform: platform(),
            timezone: timezone(),
          },
        ],
      }),
    });
  } catch {
    /* swallow -- analytics must never affect product flows */
  }
}

/**
 * Log a single analytics event. Resolves to nothing -- callers
 * deliberately don't await; this is fire-and-forget.
 */
export async function logEvent(eventName: string): Promise<void> {
  const sid = await ensureSession();
  void postEvent(eventName, sid);
}
