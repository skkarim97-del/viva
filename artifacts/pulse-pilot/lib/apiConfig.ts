import { Platform } from "react-native";

const PRODUCTION_API_URL = "https://viva-ai.replit.app/api";

const EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || "";
const EXPO_PUBLIC_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "";
const IS_DEV = typeof __DEV__ !== "undefined" && __DEV__;

function normalizeApiBase(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

function resolveApiBase(): string {
  if (Platform.OS === "web") {
    return "/api";
  }

  // EXPO_PUBLIC_API_URL is an explicit override and always wins.
  if (EXPO_PUBLIC_API_URL) {
    return normalizeApiBase(EXPO_PUBLIC_API_URL);
  }

  // EXPO_PUBLIC_DOMAIN is set by the local dev script to the Replit dev
  // domain so the device can reach the in-workspace server. It must NOT
  // be honored for shipped (production) iOS builds, otherwise the bundle
  // points at an unreachable workspace URL and every coach call fails
  // with a network error. Only use it when running in dev mode.
  if (IS_DEV && EXPO_PUBLIC_DOMAIN) {
    return `https://${EXPO_PUBLIC_DOMAIN}/api`;
  }

  return PRODUCTION_API_URL;
}

export const API_BASE = resolveApiBase();

console.log("[API_BASE] Resolved to:", API_BASE);
console.log("[API_BASE] EXPO_PUBLIC_API_URL:", EXPO_PUBLIC_API_URL || "(not set)");
console.log("[API_BASE] EXPO_PUBLIC_DOMAIN:", EXPO_PUBLIC_DOMAIN || "(not set)");
console.log("[API_BASE] Platform:", Platform.OS, "IS_DEV:", IS_DEV);

if (Platform.OS !== "web" && !API_BASE.startsWith("https://")) {
  console.warn("[API_BASE] WARNING: Non-HTTPS API URL on native. iOS will block HTTP requests.", API_BASE);
}
