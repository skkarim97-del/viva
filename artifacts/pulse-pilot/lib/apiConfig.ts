import { Platform } from "react-native";

const EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || "";
const EXPO_PUBLIC_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "";

function resolveApiBase(): string {
  if (Platform.OS === "web") {
    return "/api";
  }

  if (EXPO_PUBLIC_API_URL) {
    const base = EXPO_PUBLIC_API_URL.replace(/\/+$/, "");
    return base.endsWith("/api") ? base : `${base}/api`;
  }

  if (EXPO_PUBLIC_DOMAIN) {
    return `https://${EXPO_PUBLIC_DOMAIN}/api`;
  }

  return "/api";
}

export const API_BASE = resolveApiBase();

if (__DEV__) {
  console.log("[API_BASE] Resolved to:", API_BASE);
  console.log("[API_BASE] EXPO_PUBLIC_API_URL:", EXPO_PUBLIC_API_URL || "(not set)");
  console.log("[API_BASE] EXPO_PUBLIC_DOMAIN:", EXPO_PUBLIC_DOMAIN || "(not set)");
  console.log("[API_BASE] Platform:", Platform.OS);
} else {
  console.log("[API_BASE]", API_BASE, "| Platform:", Platform.OS);
}

if (Platform.OS !== "web" && !API_BASE.startsWith("https://")) {
  console.warn("[API_BASE] WARNING: Non-HTTPS API URL on native. iOS will block HTTP requests.", API_BASE);
}
