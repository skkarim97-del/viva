import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/lib/apiConfig";

// Bearer token for the patient session. Stored in AsyncStorage so it
// survives cold launches; sent as Authorization: Bearer <token> on
// every authenticated request. We deliberately do NOT use cookies --
// React Native's URLSession cookie store is unreliable on iOS cold
// start and almost completely missing on Android Hermes.
const TOKEN_KEY = "@viva_session_token";

let cachedToken: string | null | undefined; // undefined = not yet read

async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    cachedToken = (await AsyncStorage.getItem(TOKEN_KEY)) ?? null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* swallow -- the cache still reflects the new value */
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Default per-request timeout. React Native's fetch has no built-in
// timeout, so a stalled connection (captive portal, broken NAT, lossy
// cell) would otherwise pin the request indefinitely and leave the
// sync queue stuck on a dead promise. 15s is generous for an MVP API
// that responds in <300ms p99 from a healthy network.
const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    // Surface AbortError as a structured timeout so the sync queue
    // can distinguish "network stalled" from "server said no".
    if ((e as { name?: string })?.name === "AbortError") {
      throw new HttpError(0, "request_timeout");
    }
    // Any other fetch-level error (DNS, TCP reset, no network) gets
    // status=0. Callers treat status>=500 || status===0 as retriable.
    throw new HttpError(0, (e as Error)?.message || "network_error");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AuthedUser {
  id: number;
  email: string;
  name: string;
  role: "doctor" | "patient";
}

export interface AuthResponse {
  token: string;
  user?: AuthedUser;
  // /auth/login returns user fields flat alongside the token.
  id?: number;
  email?: string;
  name?: string;
  role?: "doctor" | "patient";
}

export interface CheckinPayload {
  date: string; // YYYY-MM-DD
  energy: "depleted" | "tired" | "good" | "great";
  nausea: "none" | "mild" | "moderate" | "severe";
  mood: number; // 1..5
  notes?: string | null;
  // Optional symptom-management fields. The server treats absent values
  // as "unknown", not "no", so omitting these is safe.
  appetite?: "strong" | "normal" | "low" | "very_low" | null;
  digestion?: "fine" | "bloated" | "constipated" | "diarrhea" | null;
  hydration?: "hydrated" | "good" | "low" | "dehydrated" | null;
  bowelMovement?: boolean | null;
  doseTakenToday?: boolean | null;
  // Pilot analytics tag for the symptom-edit timeline. Locked to a
  // closed allowlist on the server (Zod enum) so this can never
  // smuggle free text into analytics_events.payload. Optional --
  // older builds and offline-replayed payloads omit it and the
  // server falls back to "manual_save".
  source?:
    | "today_checkin_autosave"
    | "manual_save"
    | "onboarding"
    | "demo_seed";
}

export type SymptomKind = "nausea" | "constipation" | "low_appetite";

// Pull a token out of an invite link OR accept the bare token string.
// Doctors paste the full URL most of the time, but it's polite to
// accept either form.
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /\/invite\/([A-Za-z0-9_\-]+)/.exec(trimmed);
  if (match) return match[1]!;
  if (/^[A-Za-z0-9_\-]+$/.test(trimmed) && trimmed.length >= 16) return trimmed;
  return null;
}

export const sessionApi = {
  getStoredToken: getToken,
  setStoredToken: setToken,

  activate: async (token: string, password: string): Promise<AuthedUser> => {
    const res = await request<AuthResponse>("POST", "/auth/activate", {
      token,
      password,
    });
    await setToken(res.token);
    if (!res.user) throw new HttpError(500, "missing_user");
    return res.user;
  },

  login: async (email: string, password: string): Promise<AuthedUser> => {
    const res = await request<AuthResponse>("POST", "/auth/login", {
      email,
      password,
    });
    await setToken(res.token);
    return {
      id: res.id!,
      email: res.email!,
      name: res.name!,
      role: res.role!,
    };
  },

  // Replit-preview-only dev shortcut. POSTs to /dev/login-demo-patient
  // (which only exists when NODE_ENV !== "production" or
  // ENABLE_DEV_LOGIN === "true"), stores the bearer token in
  // AsyncStorage under the same TOKEN_KEY normal login uses, and
  // returns the seeded demo patient. Surfaces a 404 verbatim when the
  // endpoint is unmounted in production so the caller can render a
  // clear "not available" message instead of a generic network error.
  devDemoLogin: async (): Promise<AuthedUser> => {
    const res = await request<AuthResponse>(
      "POST",
      "/dev/login-demo-patient",
    );
    await setToken(res.token);
    return {
      id: res.id ?? res.user?.id!,
      email: res.email ?? res.user?.email!,
      name: res.name ?? res.user?.name!,
      role: res.role ?? res.user?.role ?? "patient",
    };
  },

  logout: async (): Promise<void> => {
    await setToken(null);
  },

  me: async (): Promise<AuthedUser | null> => {
    try {
      const r = await request<AuthedUser & { needsOnboarding?: boolean }>(
        "GET",
        "/auth/me",
      );
      return { id: r.id, email: r.email, name: r.name, role: r.role };
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        await setToken(null);
        return null;
      }
      throw e;
    }
  },

  submitCheckin: (payload: CheckinPayload) =>
    request<{ id: number }>("POST", "/me/checkins", payload),

  // GET /me/checkins/today -- returns today's saved check-in row or
  // null when the patient hasn't submitted one yet (server returns
  // 204 in that case). Lets the Today screen hydrate symptom sliders
  // on cold start without forcing the patient to re-enter values.
  getTodayCheckin: async (): Promise<{
    energy: "depleted" | "tired" | "good" | "great";
    nausea: "none" | "mild" | "moderate" | "severe";
    appetite: "strong" | "normal" | "low" | "very_low" | null;
    digestion: "fine" | "bloated" | "constipated" | "diarrhea" | null;
    bowelMovement: boolean | null;
    mood: number;
  } | null> => {
    try {
      const r = await request<unknown>("GET", "/me/checkins/today");
      // 204 -> request<T>() returns undefined cast as T; treat as null.
      if (!r || typeof r !== "object") return null;
      return r as Awaited<ReturnType<typeof sessionApi.getTodayCheckin>>;
    } catch {
      return null;
    }
  },

  // Mark a single symptom's in-app guidance as acknowledged on today's
  // check-in row. 404 means the patient hasn't submitted a check-in
  // today yet -- caller should ignore (we'll re-attempt after the
  // next saveDailyCheckIn).
  markGuidanceShown: (date: string, symptom: SymptomKind) =>
    request<{ ok: true }>("PATCH", "/me/checkins/guidance", {
      date,
      symptom,
    }),

  // Day-after follow-up: patient says the symptom is better, the
  // same, or worse than yesterday. Same 404 semantics as
  // markGuidanceShown.
  submitSymptomTrend: (
    date: string,
    symptom: SymptomKind,
    response: "better" | "same" | "worse",
  ) =>
    request<{ ok: true }>("PATCH", "/me/checkins/trend", {
      date,
      symptom,
      response,
    }),

  // Patient explicitly asked the clinician to be aware. Server marks
  // the case sticky-escalated until the symptom resolves.
  requestClinicianForSymptom: (date: string, symptom: SymptomKind) =>
    request<{ ok: true }>("PATCH", "/me/checkins/escalate", {
      date,
      symptom,
    }),

  // Weekly weight log. Lives outside the daily check-in payload so
  // weight tracking has its own cadence and never adds friction to
  // the daily flow. weeklyPromptDue is server-computed (>=7 days or
  // never logged) so the client doesn't have to track its own clock.
  getLatestWeight: () =>
    request<{
      latest: { weightLbs: number; recordedAt: string } | null;
      daysSinceLast: number | null;
      weeklyPromptDue: boolean;
    }>("GET", "/me/weights/latest"),
  logWeight: (weightLbs: number) =>
    request<{ id: number; weightLbs: number; recordedAt: string }>(
      "POST",
      "/me/weights",
      { weightLbs },
    ),

  // Pilot persistence layer. All three are best-effort from the
  // mobile side: callers should swallow errors so a transient sync
  // failure never blocks the in-app flow. The server upserts by
  // (patient, date) for the daily summary and by patient_user_id for
  // the profile, so retries are idempotent.
  postHealthDailySummary: (payload: {
    summaryDate: string;
    steps?: number | null;
    sleepMinutes?: number | null;
    restingHeartRate?: number | null;
    hrv?: number | null;
    activeCalories?: number | null;
    activeDay?: boolean | null;
    weightLbs?: number | null;
    source?: string | null;
  }) => request<unknown>("POST", "/me/health/daily-summary", payload),

  postTreatmentLog: (payload: {
    medicationName: string;
    dose?: number | null;
    doseUnit?: string | null;
    frequency?: string | null;
    startedOn?: string | null;
  }) => request<unknown>("POST", "/me/treatment-log", payload),

  postProfile: (payload: {
    age?: number | null;
    sex?: "male" | "female" | "other" | null;
    heightInches?: number | null;
    weightLbs?: number | null;
    goalWeightLbs?: number | null;
    units?: "imperial" | "metric" | null;
    goals?: string[] | null;
    glp1Medication?: string | null;
    glp1Reason?: string | null;
    glp1Duration?: string | null;
  }) => request<unknown>("POST", "/me/profile", payload),

  // -------------------------------------------------------------------
  // Plan items. Server is source of truth; AsyncStorage is cache.
  // All mutations are idempotent upserts -- safe to retry / replay.
  // -------------------------------------------------------------------

  getPlanItems: (weekStart?: string) =>
    request<
      Array<{
        id: number;
        weekStart: string;
        dayIndex: number;
        date: string;
        category: "move" | "fuel" | "hydrate" | "recover" | "consistent";
        recommended: string | null;
        chosen: string | null;
        source: "auto" | "patient_override";
        completedAt: string | null;
        title: string | null;
        subtitle: string | null;
        metadata: Record<string, unknown> | null;
        createdAt: string;
        updatedAt: string;
      }>
    >("GET", weekStart ? `/me/plan-items?weekStart=${weekStart}` : "/me/plan-items"),

  upsertPlanItem: (payload: {
    weekStart: string;
    dayIndex: number;
    date: string;
    category: "move" | "fuel" | "hydrate" | "recover" | "consistent";
    recommended?: string | null;
    chosen?: string | null;
    source?: "auto" | "patient_override" | null;
    completed?: boolean | null;
    title?: string | null;
    subtitle?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => request<{ id: number }>("POST", "/me/plan-items", payload),

  patchPlanItem: (
    id: number,
    payload: { chosen?: string | null; completed?: boolean | null },
  ) => request<{ id: number }>("PATCH", `/me/plan-items/${id}`, payload),

  // -------------------------------------------------------------------
  // Patient integrations (Apple Health, future wearables). Records
  // CONNECTION INTENT -- the actual data presence is still proven
  // by patient_health_daily_summaries rows.
  // -------------------------------------------------------------------

  getIntegrations: () =>
    request<
      Array<{
        id: number;
        provider: "apple_health";
        status:
          | "unknown"
          | "connected"
          | "disconnected"
          | "declined"
          | "unavailable";
        connectedAt: string | null;
        disconnectedAt: string | null;
        lastSyncAt: string | null;
        permissions: string[] | null;
      }>
    >("GET", "/me/integrations"),

  upsertIntegration: (
    provider: "apple_health",
    payload: {
      status:
        | "unknown"
        | "connected"
        | "disconnected"
        | "declined"
        | "unavailable";
      permissions?: string[] | null;
      metadata?: Record<string, unknown> | null;
    },
  ) =>
    request<{ id: number }>(
      "PUT",
      `/me/integrations/${provider}`,
      payload,
    ),
};
