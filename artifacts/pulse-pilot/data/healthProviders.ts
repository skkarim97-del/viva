import { Platform } from "react-native";
import type { HealthMetrics } from "@/types";

export interface HealthDebugInfo {
  buttonPressed: number;
  moduleKeysRoot: string;
  moduleKeysDefault: string;
  usingDefaultExport: boolean | null;
  initFunctionExists: boolean;
  initCalled: boolean;
  callbackReached: boolean;
  initSucceeded: boolean | null;
  rawErrorText: string | null;
}

let _debugInfo: HealthDebugInfo = {
  buttonPressed: 0,
  moduleKeysRoot: "",
  moduleKeysDefault: "",
  usingDefaultExport: null,
  initFunctionExists: false,
  initCalled: false,
  callbackReached: false,
  initSucceeded: null,
  rawErrorText: null,
};

let _debugListeners: Array<() => void> = [];

export function getHealthDebugInfo(): HealthDebugInfo {
  return { ..._debugInfo };
}

export function onDebugUpdate(fn: () => void) {
  _debugListeners.push(fn);
  return () => {
    _debugListeners = _debugListeners.filter((l) => l !== fn);
  };
}

function notifyDebug() {
  _debugListeners.forEach((fn) => fn());
}

export async function connectAppleHealth(): Promise<{ success: boolean; error?: string }> {
  _debugInfo.buttonPressed++;
  _debugInfo.initCalled = false;
  _debugInfo.callbackReached = false;
  _debugInfo.initSucceeded = null;
  _debugInfo.rawErrorText = null;
  _debugInfo.usingDefaultExport = null;
  _debugInfo.initFunctionExists = false;
  notifyDebug();
  console.log("[HealthKit] Button pressed, count:", _debugInfo.buttonPressed);

  if (Platform.OS !== "ios") {
    _debugInfo.rawErrorText = "Not iOS";
    notifyDebug();
    return { success: false, error: "Apple Health requires an iOS device." };
  }

  const mod = require("react-native-health");

  const rootKeys = mod ? Object.keys(mod) : [];
  const defaultKeys = mod?.default ? Object.keys(mod.default) : [];
  _debugInfo.moduleKeysRoot = rootKeys.slice(0, 15).join(", ");
  _debugInfo.moduleKeysDefault = defaultKeys.length > 0 ? defaultKeys.slice(0, 15).join(", ") : "(no default)";

  console.log("[HealthKit] root keys:", rootKeys);
  console.log("[HealthKit] default keys:", defaultKeys);
  console.log("[HealthKit] typeof mod.initHealthKit:", typeof mod?.initHealthKit);
  console.log("[HealthKit] typeof mod.default?.initHealthKit:", typeof mod?.default?.initHealthKit);

  const AppleHealthKit =
    mod && typeof mod.initHealthKit === "function"
      ? mod
      : mod?.default && typeof mod.default.initHealthKit === "function"
      ? mod.default
      : null;

  _debugInfo.usingDefaultExport = AppleHealthKit === mod?.default && AppleHealthKit !== null;
  _debugInfo.initFunctionExists = AppleHealthKit !== null && typeof AppleHealthKit.initHealthKit === "function";
  notifyDebug();

  console.log("[HealthKit] resolved AppleHealthKit:", AppleHealthKit ? "found" : "NULL");
  console.log("[HealthKit] usingDefaultExport:", _debugInfo.usingDefaultExport);
  console.log("[HealthKit] initFunctionExists:", _debugInfo.initFunctionExists);

  if (!AppleHealthKit) {
    _debugInfo.rawErrorText = "initHealthKit missing on both root and default export";
    notifyDebug();
    console.log("[HealthKit] FATAL:", _debugInfo.rawErrorText);
    return { success: false, error: _debugInfo.rawErrorText };
  }

  const options = {
    permissions: {
      read: [
        AppleHealthKit?.Constants?.Permissions?.StepCount,
        AppleHealthKit?.Constants?.Permissions?.HeartRate,
        AppleHealthKit?.Constants?.Permissions?.SleepAnalysis,
        AppleHealthKit?.Constants?.Permissions?.DistanceWalkingRunning,
      ].filter(Boolean),
      write: [],
    },
  };

  _debugInfo.initCalled = true;
  notifyDebug();
  console.log("[HealthKit] Calling initHealthKit NOW with options:", JSON.stringify(options));

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    AppleHealthKit.initHealthKit(options, (err: string, results: any) => {
      _debugInfo.callbackReached = true;
      console.log("[HealthKit] initHealthKit callback. err:", err || "none", "results:", results);

      if (err) {
        _debugInfo.initSucceeded = false;
        _debugInfo.rawErrorText = `callback error: ${err}`;
      } else {
        _debugInfo.initSucceeded = true;
        _debugInfo.rawErrorText = null;
      }
      notifyDebug();
      resolve(err ? { success: false, error: `initHealthKit: ${err}` } : { success: true });
    });
  });
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

const appleHealthProvider: HealthDataProvider = {
  id: "apple_health",
  name: "Apple Health",
  async isAvailable() {
    return Platform.OS === "ios";
  },
  async requestPermissions() {
    const result = await connectAppleHealth();
    return result.success;
  },
  async fetchMetrics(days: number) {
    return fillDefaults([], days);
  },
};

export const healthProviders: Record<string, HealthDataProvider> = {
  apple_health: appleHealthProvider,
};

export async function connectProvider(
  id: string
): Promise<{ success: boolean; error?: string; unavailable?: boolean }> {
  if (id === "apple_health") {
    if (Platform.OS !== "ios") {
      return { success: false, unavailable: true, error: "Apple Health requires an iOS device with a native build." };
    }
    const result = await connectAppleHealth();
    return result;
  }

  const provider = healthProviders[id];
  if (!provider) return { success: false, error: "Unknown provider." };
  return { success: false, error: "Provider not supported." };
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
  const hasRealData = (vals: number[]) => vals.some((v) => v > 0);
  if (hasRealData(metrics.map((m) => m.steps))) types.push("steps");
  if (hasRealData(metrics.map((m) => m.restingHeartRate))) types.push("heartRate");
  if (hasRealData(metrics.map((m) => m.hrv))) types.push("hrv");
  if (hasRealData(metrics.map((m) => m.sleepDuration))) types.push("sleep");
  if (hasRealData(metrics.map((m) => m.activeCalories))) types.push("calories");
  if (hasRealData(metrics.map((m) => m.weight))) types.push("weight");
  if (hasRealData(metrics.map((m) => m.distance ?? 0))) types.push("distance");
  return types;
}
