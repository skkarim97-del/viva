import { Platform } from "react-native";
import type { HealthMetrics } from "@/types";

export interface HealthDebugInfo {
  moduleLoaded: boolean;
  initCalled: boolean;
  success: boolean | null;
  errorText: string | null;
}

let _debugInfo: HealthDebugInfo = {
  moduleLoaded: false,
  initCalled: false,
  success: null,
  errorText: null,
};

export function getHealthDebugInfo(): HealthDebugInfo {
  return { ..._debugInfo };
}

let AppleHealthKit: any = null;

if (Platform.OS === "ios") {
  try {
    const mod = require("react-native-health");
    console.log("[HealthKit] require result type:", typeof mod);
    console.log("[HealthKit] module keys:", mod ? Object.keys(mod).slice(0, 20) : "null");
    console.log("[HealthKit] typeof initHealthKit:", typeof mod?.initHealthKit);
    console.log("[HealthKit] typeof default:", typeof mod?.default);
    console.log("[HealthKit] typeof default?.initHealthKit:", typeof mod?.default?.initHealthKit);

    if (mod && typeof mod.initHealthKit === "function") {
      AppleHealthKit = mod;
      _debugInfo.moduleLoaded = true;
      console.log("[HealthKit] Using root module (initHealthKit found)");
    } else if (mod?.default && typeof mod.default.initHealthKit === "function") {
      AppleHealthKit = mod.default;
      _debugInfo.moduleLoaded = true;
      console.log("[HealthKit] Using mod.default (initHealthKit found on default)");
    } else {
      AppleHealthKit = mod;
      _debugInfo.moduleLoaded = !!mod;
      _debugInfo.errorText = "initHealthKit not found on module or module.default";
      console.log("[HealthKit] WARNING: initHealthKit not found. Module loaded but may not work.");
      console.log("[HealthKit] All root keys:", mod ? Object.keys(mod) : "null");
      if (mod?.default) {
        console.log("[HealthKit] All default keys:", Object.keys(mod.default));
      }
    }
  } catch (e: any) {
    console.log("[HealthKit] require() failed:", e?.message || e);
    _debugInfo.moduleLoaded = false;
    _debugInfo.errorText = `require failed: ${e?.message || e}`;
  }
}

export interface HealthDataProvider {
  id: string;
  name: string;
  isAvailable: () => Promise<boolean>;
  requestPermissions: () => Promise<boolean>;
  fetchMetrics: (days: number) => Promise<HealthMetrics[]>;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

const appleHealthProvider: HealthDataProvider = {
  id: "apple_health",
  name: "Apple Health",

  async isAvailable() {
    if (Platform.OS !== "ios") return false;
    if (!AppleHealthKit) return false;

    if (typeof AppleHealthKit.initHealthKit !== "function") {
      console.log("[HealthKit] isAvailable: initHealthKit not a function");
      return false;
    }

    return true;
  },

  async requestPermissions() {
    if (!AppleHealthKit || typeof AppleHealthKit.initHealthKit !== "function") {
      _debugInfo.initCalled = false;
      _debugInfo.success = false;
      _debugInfo.errorText = "initHealthKit is not a function";
      console.log("[HealthKit] Cannot init: initHealthKit not available");
      return false;
    }

    _debugInfo.initCalled = true;

    const perms = AppleHealthKit?.Constants?.Permissions;
    console.log("[HealthKit] Permissions object exists:", !!perms);

    const readPerms: any[] = [];
    if (perms) {
      if (perms.StepCount) readPerms.push(perms.StepCount);
      if (perms.HeartRate) readPerms.push(perms.HeartRate);
      if (perms.SleepAnalysis) readPerms.push(perms.SleepAnalysis);
    }

    console.log("[HealthKit] Read permissions resolved:", readPerms.length, "types");

    const options = {
      permissions: {
        read: readPerms,
        write: [],
      },
    };

    return new Promise<boolean>((resolve) => {
      try {
        console.log("[HealthKit] Calling initHealthKit...");
        AppleHealthKit.initHealthKit(options, (err: string) => {
          console.log("[HealthKit] initHealthKit callback:", err ? `error: ${err}` : "success");
          if (err) {
            _debugInfo.success = false;
            _debugInfo.errorText = `initHealthKit error: ${err}`;
            resolve(false);
          } else {
            _debugInfo.success = true;
            _debugInfo.errorText = null;
            resolve(true);
          }
        });
      } catch (e: any) {
        console.log("[HealthKit] initHealthKit threw:", e?.message || e);
        _debugInfo.success = false;
        _debugInfo.errorText = `initHealthKit threw: ${e?.message || e}`;
        resolve(false);
      }
    });
  },

  async fetchMetrics(days: number) {
    return fillDefaults([], days);
  },
};

function fillDefaults(partial: Partial<HealthMetrics>[], days: number): HealthMetrics[] {
  const result: HealthMetrics[] = [];

  for (let i = 0; i < days; i++) {
    const d = dateStr(daysAgoDate(days - 1 - i));
    const existing = partial.find((m) => m.date === d) || {};

    result.push({
      date: d,
      steps: existing.steps ?? 0,
      caloriesBurned: existing.caloriesBurned ?? 0,
      activeCalories: existing.activeCalories ?? 0,
      restingHeartRate: existing.restingHeartRate ?? 0,
      hrv: existing.hrv ?? 0,
      weight: existing.weight ?? result[result.length - 1]?.weight ?? 0,
      sleepDuration: existing.sleepDuration ?? 0,
      sleepQuality: existing.sleepQuality ?? 0,
      recoveryScore: existing.recoveryScore ?? 0,
      strain: existing.strain ?? 0,
      vo2Max: existing.vo2Max,
      distance: existing.distance,
      pace: existing.pace,
    });
  }

  return result;
}

export const healthProviders: Record<string, HealthDataProvider> = {
  apple_health: appleHealthProvider,
};

export async function connectProvider(
  id: string
): Promise<{ success: boolean; error?: string; unavailable?: boolean }> {
  const provider = healthProviders[id];
  if (!provider) return { success: false, error: "Unknown provider." };

  try {
    const available = await provider.isAvailable();
    if (!available) {
      if (id === "apple_health" && Platform.OS !== "ios") {
        return { success: false, unavailable: true, error: "Apple Health requires an iOS device with a native build." };
      }
      return { success: false, unavailable: true, error: `${provider.name} is not available on this device.` };
    }

    const permitted = await provider.requestPermissions();
    if (!permitted) {
      return { success: false, error: "Permission denied. Open Settings > Privacy > Health to grant access." };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: `Could not connect to ${provider.name}. ${e?.message || "Please try again."}` };
  }
}

export type AvailableMetricType = "steps" | "heartRate" | "hrv" | "sleep" | "calories" | "weight" | "distance";

export async function fetchHealthData(
  connectedProviders: string[],
  days: number = 28
): Promise<{ metrics: HealthMetrics[]; source: string | null; availableTypes: AvailableMetricType[] }> {
  for (const id of connectedProviders) {
    const provider = healthProviders[id];
    if (!provider) continue;

    try {
      const available = await provider.isAvailable();
      if (!available) continue;

      const permitted = await provider.requestPermissions();
      if (!permitted) continue;

      const metrics = await provider.fetchMetrics(days);
      if (metrics.length > 0) {
        const types = detectAvailableTypes(metrics);
        return { metrics, source: id, availableTypes: types };
      }
    } catch {
      continue;
    }
  }

  return { metrics: [], source: null, availableTypes: [] };
}

function detectAvailableTypes(metrics: HealthMetrics[]): AvailableMetricType[] {
  const types: AvailableMetricType[] = [];
  const hasRealData = (vals: number[]) => vals.some(v => v > 0);

  if (hasRealData(metrics.map(m => m.steps))) types.push("steps");
  if (hasRealData(metrics.map(m => m.restingHeartRate))) types.push("heartRate");
  if (hasRealData(metrics.map(m => m.hrv))) types.push("hrv");
  if (hasRealData(metrics.map(m => m.sleepDuration))) types.push("sleep");
  if (hasRealData(metrics.map(m => m.activeCalories))) types.push("calories");
  if (hasRealData(metrics.map(m => m.weight))) types.push("weight");
  if (hasRealData(metrics.map(m => m.distance ?? 0))) types.push("distance");

  return types;
}
