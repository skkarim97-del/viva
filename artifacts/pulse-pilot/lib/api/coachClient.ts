import { Platform } from "react-native";

import { API_BASE } from "@/lib/apiConfig";
import { sessionApi } from "@/lib/api/sessionClient";

export type CoachConversationMessage = { role: "user" | "assistant"; content: string };

export interface CoachRequestArgs {
  message: string;
  healthContext?: unknown;
  conversationHistory?: CoachConversationMessage[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

// T006 -- pilot mode discovery + structured-coach types.
export type CoachPilotMode = "safe" | "open";

export type CoachCategory =
  | "symptom_support"
  | "side_effect"
  | "medication_question"
  | "nutrition"
  | "hydration"
  | "exercise"
  | "urgent_concern"
  | "other";

export type CoachSeverity = "mild" | "moderate" | "severe";

export type CoachContextTag =
  | "started_recently"
  | "after_dose_change"
  | "morning"
  | "evening"
  | "after_meal"
  | "with_food"
  | "ongoing"
  | "recurring";

export interface CoachModeInfo {
  mode: CoachPilotMode;
  safeMode: boolean;
  categories: readonly CoachCategory[];
  severities: readonly CoachSeverity[];
  structuredEndpoint: string;
}

export interface StructuredCoachArgs {
  category: CoachCategory;
  severity: CoachSeverity;
  contextTags?: CoachContextTag[];
}

export interface StructuredCoachResponse {
  content: string;
  templateId: string;
  category: CoachCategory;
  severity: CoachSeverity;
  riskCategory: "low" | "medium" | "high" | "critical";
  escalated: boolean;
}

export type CoachErrorKind =
  | "config"
  | "safe_mode"
  | "timeout"
  | "network"
  | "http"
  | "parse"
  | "empty"
  | "serialize"
  | "unknown";

export class CoachRequestError extends Error {
  kind: CoachErrorKind;
  status?: number;
  body?: string;
  url?: string;
  cause?: unknown;
  constructor(kind: CoachErrorKind, message: string, extra?: { status?: number; body?: string; url?: string; cause?: unknown }) {
    super(message);
    this.name = "CoachRequestError";
    this.kind = kind;
    this.status = extra?.status;
    this.body = extra?.body;
    this.url = extra?.url;
    this.cause = extra?.cause;
  }
}

function dlog(...args: unknown[]) {
  // Always log in both dev and production. On TestFlight/App Store builds these
  // are visible in Xcode's Console app or the device's system logs, which is
  // essential for diagnosing coach failures that never reach the server.
  console.log("[CoachClient]", ...args);
}

/**
 * Single source of truth for coach chat requests.
 * - Same URL, method, headers, and payload contract for every surface.
 * - Native uses non-streaming JSON (RN fetch cannot consume SSE reliably).
 * - Web uses streaming SSE.
 * - Throws CoachRequestError with a concrete `kind` so callers can render
 *   a precise message instead of the generic "Network error".
 */
export async function sendCoachMessage(args: CoachRequestArgs): Promise<{ content: string; durationMs: number; url: string }> {
  const useStream = Platform.OS === "web";
  const url = useStream ? `${API_BASE}/coach/chat` : `${API_BASE}/coach/chat?stream=false`;

  if (Platform.OS !== "web" && !API_BASE.startsWith("https://")) {
    throw new CoachRequestError(
      "config",
      `API URL is not HTTPS (resolved to "${API_BASE}"). Build the app with EXPO_PUBLIC_API_URL pointing to your deployed server.`,
      { url },
    );
  }

  let body: string;
  try {
    body = JSON.stringify({
      message: args.message,
      healthContext: args.healthContext,
      conversationHistory: args.conversationHistory ?? [],
    });
  } catch (e: any) {
    throw new CoachRequestError("serialize", `Could not serialize request payload: ${e?.message || String(e)}`, { url, cause: e });
  }

  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? 60_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  args.signal?.addEventListener?.("abort", onParentAbort);

  const startedAt = Date.now();
  dlog("Request", { url, useStream, platform: Platform.OS, msgLen: args.message.length, historyLen: args.conversationHistory?.length ?? 0, hasContext: !!args.healthContext, bodyBytes: body.length });

  let response: Response;
  // Pull the patient bearer so the server can persist coach_messages
  // and fire treatment-stop care_events against the correct patient.
  // Best-effort: if the token lookup fails or returns null, the chat
  // still works (server-side persistence simply skips), so we never
  // let token retrieval block or break the request.
  let bearer: string | null = null;
  try {
    bearer = await sessionApi.getStoredToken();
  } catch {
    bearer = null;
  }
  const baseHeaders: Record<string, string> = useStream
    ? { "Content-Type": "application/json" }
    : { "Content-Type": "application/json", "Accept": "application/json" };
  if (bearer) baseHeaders["Authorization"] = `Bearer ${bearer}`;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      body,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    args.signal?.removeEventListener?.("abort", onParentAbort);
    if (e?.name === "AbortError") {
      throw new CoachRequestError("timeout", `Request timed out after ${Math.round(timeoutMs / 1000)}s.`, { url, cause: e });
    }
    throw new CoachRequestError("network", `Cannot reach the server at ${API_BASE}. ${e?.message || ""}`.trim(), { url, cause: e });
  }

  dlog("Response", { status: response.status, url });

  if (!response.ok) {
    let errorBody = "";
    try { errorBody = await response.text(); } catch {}
    clearTimeout(timeoutId);
    args.signal?.removeEventListener?.("abort", onParentAbort);
    // T006 -- safe-mode 403. The server returns this exact shape when
    // free-text chat is disabled for the pilot. We surface it as a
    // `safe_mode` kind so the UI can switch composers without showing
    // the patient an error bubble.
    if (response.status === 403 && errorBody.includes("free_text_disabled")) {
      throw new CoachRequestError(
        "safe_mode",
        "Free-text coach chat is disabled. Use the structured composer instead.",
        { url, status: 403, body: errorBody.slice(0, 500) },
      );
    }
    throw new CoachRequestError("http", `Server returned ${response.status}.`, { url, status: response.status, body: errorBody.slice(0, 500) });
  }

  try {
    if (useStream && response.body && typeof (response.body as any).getReader === "function") {
      const reader = (response.body as any).getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (typeof data?.content === "string") fullText += data.content;
              if (data?.done) {
                clearTimeout(timeoutId);
                args.signal?.removeEventListener?.("abort", onParentAbort);
                if (!fullText) throw new CoachRequestError("empty", "Empty response from server.", { url });
                return { content: fullText, durationMs: Date.now() - startedAt, url };
              }
            } catch {}
          }
        }
      }
      clearTimeout(timeoutId);
      args.signal?.removeEventListener?.("abort", onParentAbort);
      if (!fullText) throw new CoachRequestError("empty", "Empty stream from server.", { url });
      return { content: fullText, durationMs: Date.now() - startedAt, url };
    }

    const data = await response.json().catch((e) => {
      throw new CoachRequestError("parse", `Could not parse JSON response: ${e?.message || String(e)}`, { url, cause: e });
    });
    clearTimeout(timeoutId);
    args.signal?.removeEventListener?.("abort", onParentAbort);
    const text = typeof data?.content === "string" ? data.content : "";
    if (!text) {
      throw new CoachRequestError("empty", "Server returned no content.", { url, body: JSON.stringify(data).slice(0, 300) });
    }
    return { content: text, durationMs: Date.now() - startedAt, url };
  } catch (e) {
    clearTimeout(timeoutId);
    args.signal?.removeEventListener?.("abort", onParentAbort);
    if (e instanceof CoachRequestError) throw e;
    throw new CoachRequestError("unknown", `Unexpected error: ${(e as any)?.message || String(e)}`, { url, cause: e });
  }
}

function diagSuffix(err: CoachRequestError): string {
  // Append a compact diagnostic tag so production users can screenshot the
  // error bubble and we can see exactly which URL/kind/status was involved.
  const parts: string[] = [];
  parts.push(`kind=${err.kind}`);
  if (typeof err.status === "number") parts.push(`status=${err.status}`);
  if (err.url) parts.push(`url=${err.url}`);
  return `\n\n[${parts.join(" ")}]`;
}

export function describeCoachError(err: CoachRequestError): string {
  let body: string;
  switch (err.kind) {
    case "config":
      body = err.message;
      break;
    case "safe_mode":
      // Friendly text for the rare case the UI doesn't catch the
      // safe_mode kind itself and falls back to the generic error
      // bubble. Should normally not be shown -- the screen swaps
      // composers on first detection.
      body = "The coach is in safe mode. Pick a category and severity from the picker -- free-text chat is paused for the pilot.";
      break;
    case "timeout":
      body = `${err.message} The server may be slow or unreachable. Tap retry below.`;
      break;
    case "network":
      body = `${err.message} Check your connection or confirm the API server is deployed. Tap retry below.`;
      break;
    case "http": {
      if (err.status === 404) body = `Coach endpoint not found at ${err.url}. The API server may not be deployed yet.`;
      else if (err.status === 401 || err.status === 403) body = "AI service is not configured (auth error). Check the OpenAI key on the server.";
      else if (err.status === 429) body = "Rate limited. Wait a moment and try again.";
      else if (err.status === 500) body = `Server error. ${err.body || "The AI service may be temporarily unavailable."} Tap retry below.`;
      else body = `Server returned ${err.status}. ${err.body || ""} Tap retry below.`;
      break;
    }
    case "parse":
      body = "Got a response but couldn't read it. Tap retry below.";
      break;
    case "empty":
      body = "The coach didn't send a reply. Tap retry below.";
      break;
    case "serialize":
      body = `Could not prepare the request: ${err.message}`;
      break;
    default:
      body = err.message || "Something went wrong. Try again in a moment.";
  }
  return `${body}${diagSuffix(err)}`;
}

// ---------------------------------------------------------------------
// T006 -- pilot mode discovery + structured chat
// ---------------------------------------------------------------------

// Cached mode lookup: the value is set by the deployment env so it
// can't change at runtime, but the cache is opt-in (caller can pass
// {force: true}) for testing. Module-scoped so a tab switch doesn't
// re-hit the network.
let _cachedMode: CoachModeInfo | null = null;
let _cachedModeAt = 0;
const MODE_TTL_MS = 60_000;

export async function getCoachMode(opts?: { force?: boolean }): Promise<CoachModeInfo> {
  const now = Date.now();
  if (!opts?.force && _cachedMode && now - _cachedModeAt < MODE_TTL_MS) {
    return _cachedMode;
  }
  const url = `${API_BASE}/coach/mode`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (e: any) {
    throw new CoachRequestError(
      "network",
      `Cannot reach the server at ${API_BASE}. ${e?.message || ""}`.trim(),
      { url, cause: e },
    );
  }
  if (!response.ok) {
    let errorBody = "";
    try { errorBody = await response.text(); } catch {}
    throw new CoachRequestError("http", `Server returned ${response.status}.`, {
      url,
      status: response.status,
      body: errorBody.slice(0, 500),
    });
  }
  const data = (await response.json().catch(() => ({}))) as Partial<CoachModeInfo>;
  // Defense in depth: if the server sends a malformed mode, treat
  // it as 'safe'. Erring on the safe side never harms the patient.
  const mode: CoachPilotMode = data.mode === "open" ? "open" : "safe";
  const info: CoachModeInfo = {
    mode,
    safeMode: mode === "safe",
    categories: Array.isArray(data.categories) && data.categories.length > 0
      ? (data.categories as CoachCategory[])
      : ([
          "symptom_support",
          "side_effect",
          "medication_question",
          "nutrition",
          "hydration",
          "exercise",
          "urgent_concern",
          "other",
        ] as const),
    severities: Array.isArray(data.severities) && data.severities.length > 0
      ? (data.severities as CoachSeverity[])
      : (["mild", "moderate", "severe"] as const),
    structuredEndpoint:
      typeof data.structuredEndpoint === "string"
        ? data.structuredEndpoint
        : "/api/coach/structured",
  };
  _cachedMode = info;
  _cachedModeAt = now;
  return info;
}

export interface StructuredCoachResult extends StructuredCoachResponse {
  durationMs: number;
  url: string;
}

export async function sendStructuredCoachMessage(
  args: StructuredCoachArgs,
): Promise<StructuredCoachResult> {
  const url = `${API_BASE}/coach/structured`;
  const startedAt = Date.now();
  let bearer: string | null = null;
  try {
    bearer = await sessionApi.getStoredToken();
  } catch {
    bearer = null;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

  let body: string;
  try {
    body = JSON.stringify({
      category: args.category,
      severity: args.severity,
      contextTags: args.contextTags ?? [],
    });
  } catch (e: any) {
    throw new CoachRequestError(
      "serialize",
      `Could not serialize structured payload: ${e?.message || String(e)}`,
      { url, cause: e },
    );
  }

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body });
  } catch (e: any) {
    throw new CoachRequestError(
      "network",
      `Cannot reach the server at ${API_BASE}. ${e?.message || ""}`.trim(),
      { url, cause: e },
    );
  }

  if (!response.ok) {
    let errorBody = "";
    try { errorBody = await response.text(); } catch {}
    throw new CoachRequestError("http", `Server returned ${response.status}.`, {
      url,
      status: response.status,
      body: errorBody.slice(0, 500),
    });
  }

  const data = (await response.json().catch((e) => {
    throw new CoachRequestError(
      "parse",
      `Could not parse JSON response: ${e?.message || String(e)}`,
      { url, cause: e },
    );
  })) as Partial<StructuredCoachResponse>;

  if (typeof data?.content !== "string" || !data.content) {
    throw new CoachRequestError("empty", "Server returned no content.", {
      url,
      body: JSON.stringify(data).slice(0, 300),
    });
  }

  return {
    content: data.content,
    templateId: typeof data.templateId === "string" ? data.templateId : "unknown",
    category: (data.category as CoachCategory) ?? args.category,
    severity: (data.severity as CoachSeverity) ?? args.severity,
    riskCategory:
      (data.riskCategory as StructuredCoachResponse["riskCategory"]) ?? "low",
    escalated: Boolean(data.escalated),
    durationMs: Date.now() - startedAt,
    url,
  };
}
