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

/**
 * Returns the current session id, generating a fresh one if no
 * session exists yet OR the previous session has been idle longer
 * than SESSION_IDLE_MS. When a fresh session is started, also fires
 * `session_start` so the funnel has the open-event row.
 *
 * Always safe to call -- never throws, never blocks the caller's UI.
 */
export async function ensureSession(): Promise<string> {
  if (cachedSessionId) {
    void touchLastActive();
    return cachedSessionId;
  }
  if (pendingSession) return pendingSession;
  pendingSession = (async () => {
    try {
      const [storedSession, storedLastActive] = await Promise.all([
        AsyncStorage.getItem(SESSION_KEY),
        AsyncStorage.getItem(LAST_ACTIVE_KEY),
      ]);
      const lastActive = storedLastActive ? Number(storedLastActive) : 0;
      const now = Date.now();
      if (storedSession && now - lastActive < SESSION_IDLE_MS) {
        cachedSessionId = storedSession;
        void touchLastActive();
        return cachedSessionId;
      }
    } catch {
      /* fall through to fresh session */
    }
    const sid = newSessionId();
    cachedSessionId = sid;
    try {
      await Promise.all([
        AsyncStorage.setItem(SESSION_KEY, sid),
        AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())),
      ]);
    } catch {
      /* fine: cachedSessionId still drives this process */
    }
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
        events: [{ eventName, sessionId, platform: platform() }],
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
