import { Platform } from "react-native";

// The ONLY URL that native production iOS/Android builds should ever resolve
// to. This is a compile-time constant baked into the bundle, so nothing that
// happens at build time (EAS secrets, CI env, stray .env files, editor env
// injection) can change it on a shipped build.
const PRODUCTION_API_URL = "https://api.itsviva.com/api";

const EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || "";
const EXPO_PUBLIC_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "";
const IS_DEV = typeof __DEV__ !== "undefined" && __DEV__;

// Explicit rejection list of host substrings that have been seen leaking into
// production builds. Any candidate URL containing one of these is discarded
// and we fall back to PRODUCTION_API_URL with a loud warning, so a bad EAS
// secret can never ship again.
const PLACEHOLDER_MARKERS = [
  "yourdeployeddomain",
  "your-domain",
  "your-deployed",
  "example.com",
  "example.org",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "changeme",
  "todo",
];

function looksLikePlaceholder(raw: string): boolean {
  const s = raw.toLowerCase();
  if (!s) return true;
  if (PLACEHOLDER_MARKERS.some(m => s.includes(m))) return true;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (!u.hostname || !u.hostname.includes(".")) return true;
  } catch {
    return true;
  }
  return false;
}

function normalizeApiBase(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

function resolveApiBase(): string {
  // Web: in production the Expo web build is served from the same origin
  // as the API server, so `/api` resolves correctly. In the Replit
  // workspace preview, however, the Expo dev server is served from the
  // *Expo* subdomain (`*.expo.spock.replit.dev`) while the API server
  // lives on the sibling *spock* subdomain (`*.spock.replit.dev/api`).
  // A plain `/api` request from the iframe lands on Metro, which has no
  // /api routes -> "could not reach server". Detect that case at runtime
  // and rewrite the host so requests reach the API server through the
  // workspace proxy.
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host.includes(".expo.spock.replit.dev")) {
        const apiHost = host.replace(".expo.spock.replit.dev", ".spock.replit.dev");
        return `${window.location.protocol}//${apiHost}/api`;
      }
    }
    return "/api";
  }

  // Hard rule: NATIVE PRODUCTION BUILDS ALWAYS USE THE HARDCODED CONSTANT.
  // No environment variable is allowed to redirect a shipped iOS/Android
  // build. This eliminates the class of bug where a placeholder env value
  // (set by an EAS secret, CI env, or a stray .env) gets baked into the
  // production bundle and sent to real users.
  if (!IS_DEV) {
    return PRODUCTION_API_URL;
  }

  // Below this line we are in a dev build (Expo Go / dev client / Metro).
  // Overrides are honored ONLY here and are still validated so a typo or
  // placeholder doesn't silently break the device↔workspace bridge.

  if (EXPO_PUBLIC_API_URL) {
    if (looksLikePlaceholder(EXPO_PUBLIC_API_URL)) {
      console.warn(
        "[API_BASE] Ignoring EXPO_PUBLIC_API_URL because it looks like a placeholder:",
        EXPO_PUBLIC_API_URL,
      );
    } else {
      return normalizeApiBase(EXPO_PUBLIC_API_URL);
    }
  }

  if (EXPO_PUBLIC_DOMAIN && !looksLikePlaceholder(EXPO_PUBLIC_DOMAIN)) {
    return `https://${EXPO_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/api`;
  }

  // Dev with no override — fall back to production so the app still works
  // when running on a real device without a tunnel.
  return PRODUCTION_API_URL;
}

export const API_BASE = resolveApiBase();

// Diagnostic logs gated behind __DEV__: in a shipped pilot bundle
// the user shouldn't see API_BASE diagnostics in any console attached
// to the device. The production sanity assertion below stays
// unconditional -- a misconfigured prod build SHOULD shout.
if (IS_DEV) {
  console.log("[API_BASE] Resolved to:", API_BASE);
  console.log("[API_BASE] EXPO_PUBLIC_API_URL:", EXPO_PUBLIC_API_URL || "(not set)");
  console.log("[API_BASE] EXPO_PUBLIC_DOMAIN:", EXPO_PUBLIC_DOMAIN || "(not set)");
  console.log("[API_BASE] Platform:", Platform.OS, "IS_DEV:", IS_DEV);
}

// Production-side sanity assertion: in a shipped bundle, API_BASE MUST equal
// PRODUCTION_API_URL. If it doesn't, something has gone very wrong (e.g. a
// future refactor reintroduces an env override) and we want to shout about
// it in device logs rather than silently point at the wrong host.
if (Platform.OS !== "web" && !IS_DEV && API_BASE !== PRODUCTION_API_URL) {
  console.error(
    "[API_BASE] CRITICAL: production build resolved to a non-canonical URL.",
    { resolved: API_BASE, expected: PRODUCTION_API_URL },
  );
}

if (Platform.OS !== "web" && !API_BASE.startsWith("https://")) {
  console.warn("[API_BASE] WARNING: Non-HTTPS API URL on native. iOS will block HTTP requests.", API_BASE);
}
