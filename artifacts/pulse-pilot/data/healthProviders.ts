import { Platform } from "react-native";
import type { HealthMetrics } from "@/types";

export interface HealthDebugInfo {
  buttonPressed: number;
  moduleLoaded: boolean;
  initFunctionExists: boolean;
  initCalled: boolean;
  callbackReached: boolean;
  initSucceeded: boolean | null;
  rawErrorText: string | null;
}

let _debugInfo: HealthDebugInfo = {
  buttonPressed: 0,
  moduleLoaded: false,
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
  notifyDebug();
  console.log("[HealthKit] Button pressed, count:", _debugInfo.buttonPressed);

  if (Platform.OS !== "ios") {
    _debugInfo.rawErrorText = "Not iOS";
    notifyDebug();
    return { success: false, error: "Apple Health requires an iOS device." };
  }

  let AppleHealthKit: any = null;
  try {
    console.log("[HealthKit] Calling require('react-native-health')...");
    AppleHealthKit = require("react-native-health");
    _debugInfo.moduleLoaded = !!AppleHealthKit;
    console.log("[HealthKit] require result:", typeof AppleHealthKit);
    console.log("[HealthKit] keys:", AppleHealthKit ? Object.keys(AppleHealthKit).slice(0, 25) : "null");
    notifyDebug();
  } catch (e: any) {
    _debugInfo.moduleLoaded = false;
    _debugInfo.initFunctionExists = false;
    _debugInfo.rawErrorText = `require failed: ${e?.message || e}`;
    console.log("[HealthKit] require failed:", e?.message || e);
    notifyDebug();
    return { success: false, error: _debugInfo.rawErrorText };
  }

  _debugInfo.initFunctionExists = typeof AppleHealthKit?.initHealthKit === "function";
  console.log("[HealthKit] typeof initHealthKit:", typeof AppleHealthKit?.initHealthKit);
  notifyDebug();

  if (!_debugInfo.initFunctionExists) {
    _debugInfo.rawErrorText = `initHealthKit is ${typeof AppleHealthKit?.initHealthKit}, not function. Keys: ${AppleHealthKit ? Object.keys(AppleHealthKit).join(", ") : "null"}`;
    console.log("[HealthKit] FAIL:", _debugInfo.rawErrorText);
    notifyDebug();
    return { success: false, error: _debugInfo.rawErrorText };
  }

  const perms = AppleHealthKit?.Constants?.Permissions;
  const readPerms: any[] = [];
  if (perms) {
    if (perms.StepCount) readPerms.push(perms.StepCount);
    if (perms.HeartRate) readPerms.push(perms.HeartRate);
    if (perms.SleepAnalysis) readPerms.push(perms.SleepAnalysis);
  }
  console.log("[HealthKit] Permissions resolved:", readPerms.length, "read types");

  const options = {
    permissions: {
      read: readPerms,
      write: [],
    },
  };

  _debugInfo.initCalled = true;
  notifyDebug();
  console.log("[HealthKit] Calling initHealthKit NOW...");

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    try {
      AppleHealthKit.initHealthKit(options, (err: string) => {
        _debugInfo.callbackReached = true;
        console.log("[HealthKit] initHealthKit callback reached. err:", err || "none");

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
    } catch (e: any) {
      _debugInfo.callbackReached = false;
      _debugInfo.initSucceeded = false;
      _debugInfo.rawErrorText = `initHealthKit threw: ${e?.message || e}`;
      console.log("[HealthKit] initHealthKit threw:", e?.message || e);
      notifyDebug();
      resolve({ success: false, error: _debugInfo.rawErrorText });
    }
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
