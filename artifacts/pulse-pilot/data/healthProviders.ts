import { Platform } from "react-native";
import type { HealthMetrics } from "@/types";

export interface HealthDebugInfo {
  healthDataAvailable: boolean | null;
  authorizationAttempted: boolean;
  authorizationSuccess: boolean | null;
  rawAuthError: string | null;
  lastAttemptTimestamp: string | null;
}

let _debugInfo: HealthDebugInfo = {
  healthDataAvailable: null,
  authorizationAttempted: false,
  authorizationSuccess: null,
  rawAuthError: null,
  lastAttemptTimestamp: null,
};

export function getHealthDebugInfo(): HealthDebugInfo {
  return { ..._debugInfo };
}

let HK: any = null;
if (Platform.OS === "ios") {
  try {
    HK = require("@kingstinct/react-native-healthkit");
  } catch (e: any) {
    console.log("[HealthKit] Failed to load @kingstinct/react-native-healthkit:", e?.message);
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

const READ_PERMISSIONS = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierHeartRate",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKWorkoutTypeIdentifier",
];

const appleHealthProvider: HealthDataProvider = {
  id: "apple_health",
  name: "Apple Health",

  async isAvailable() {
    if (Platform.OS !== "ios") {
      _debugInfo.healthDataAvailable = false;
      return false;
    }
    if (!HK) {
      _debugInfo.healthDataAvailable = false;
      return false;
    }
    try {
      const isHealthDataAvailable = HK.isHealthDataAvailable || HK.default?.isHealthDataAvailable;
      if (typeof isHealthDataAvailable !== "function") {
        console.log("[HealthKit] isHealthDataAvailable not found on module");
        _debugInfo.healthDataAvailable = false;
        return false;
      }
      const available = await isHealthDataAvailable();
      _debugInfo.healthDataAvailable = !!available;
      console.log("[HealthKit] isHealthDataAvailable:", available);
      return !!available;
    } catch (e: any) {
      console.log("[HealthKit] isHealthDataAvailable error:", e?.message);
      _debugInfo.healthDataAvailable = false;
      return false;
    }
  },

  async requestPermissions() {
    if (!HK) {
      _debugInfo.authorizationAttempted = true;
      _debugInfo.authorizationSuccess = false;
      _debugInfo.rawAuthError = "HealthKit module not loaded";
      _debugInfo.lastAttemptTimestamp = new Date().toISOString();
      return false;
    }

    _debugInfo.authorizationAttempted = true;
    _debugInfo.lastAttemptTimestamp = new Date().toISOString();

    try {
      const requestAuthorization = HK.requestAuthorization || HK.default?.requestAuthorization;
      if (typeof requestAuthorization !== "function") {
        _debugInfo.authorizationSuccess = false;
        _debugInfo.rawAuthError = "requestAuthorization not found on module";
        console.log("[HealthKit] requestAuthorization not found");
        return false;
      }

      console.log("[HealthKit] Requesting authorization for:", READ_PERMISSIONS);
      await requestAuthorization(READ_PERMISSIONS);
      console.log("[HealthKit] Authorization granted");
      _debugInfo.authorizationSuccess = true;
      _debugInfo.rawAuthError = null;
      return true;
    } catch (e: any) {
      console.log("[HealthKit] Authorization error:", e?.message || e);
      _debugInfo.authorizationSuccess = false;
      _debugInfo.rawAuthError = e?.message || String(e);
      return false;
    }
  },

  async fetchMetrics(days: number) {
    if (!HK) return [];
    try {
      const queryStatisticsForQuantity = HK.queryStatisticsForQuantity || HK.default?.queryStatisticsForQuantity;
      const querySleepSamples = HK.querySleepSamples || HK.default?.querySleepSamples;

      const startDate = daysAgoDate(days);
      const endDate = new Date();
      const metricsMap = new Map<string, Partial<HealthMetrics>>();

      for (let i = 0; i < days; i++) {
        const d = dateStr(daysAgoDate(days - 1 - i));
        metricsMap.set(d, { date: d });
      }

      if (typeof queryStatisticsForQuantity === "function") {
        try {
          const stepsResult = await queryStatisticsForQuantity(
            "HKQuantityTypeIdentifierStepCount",
            { from: startDate, to: endDate }
          );
          if (stepsResult) {
            const d = dateStr(new Date(stepsResult.startDate || startDate));
            const entry = metricsMap.get(d);
            if (entry) entry.steps = Math.round(stepsResult.sumQuantity || 0);
          }
        } catch (e: any) {
          console.log("[HealthKit] Steps query error:", e?.message);
        }

        try {
          const caloriesResult = await queryStatisticsForQuantity(
            "HKQuantityTypeIdentifierActiveEnergyBurned",
            { from: startDate, to: endDate }
          );
          if (caloriesResult) {
            const d = dateStr(new Date(caloriesResult.startDate || startDate));
            const entry = metricsMap.get(d);
            if (entry) entry.activeCalories = Math.round(caloriesResult.sumQuantity || 0);
          }
        } catch (e: any) {
          console.log("[HealthKit] Calories query error:", e?.message);
        }
      }

      return fillDefaults(Array.from(metricsMap.values()), days);
    } catch (e: any) {
      console.log("[HealthKit] fetchMetrics error:", e?.message);
      return [];
    }
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
