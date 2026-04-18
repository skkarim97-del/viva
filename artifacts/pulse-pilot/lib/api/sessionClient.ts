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

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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

  // Mark a single symptom's in-app guidance as acknowledged on today's
  // check-in row. 404 means the patient hasn't submitted a check-in
  // today yet -- caller should ignore (we'll re-attempt after the
  // next saveDailyCheckIn).
  markGuidanceShown: (date: string, symptom: SymptomKind) =>
    request<{ ok: true }>("PATCH", "/me/checkins/guidance", {
      date,
      symptom,
    }),
};
