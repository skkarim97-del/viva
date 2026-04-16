import { Platform } from "react-native";

import { API_BASE } from "@/lib/apiConfig";

export type CoachConversationMessage = { role: "user" | "assistant"; content: string };

export interface CoachRequestArgs {
  message: string;
  healthContext?: unknown;
  conversationHistory?: CoachConversationMessage[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type CoachErrorKind =
  | "config"
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
  try {
    response = await fetch(url, {
      method: "POST",
      headers: useStream
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "application/json", "Accept": "application/json" },
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
