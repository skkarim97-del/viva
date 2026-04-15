import { Platform } from "react-native";
import type { HealthMetrics } from "@/types";

let AppleHealthKit: any = null;
if (Platform.OS === "ios") {
  try {
    const mod = require("react-native-health");
    console.log("[HealthKit] Raw require result type:", typeof mod);
    console.log("[HealthKit] Raw require keys:", mod ? Object.keys(mod).slice(0, 20) : "null");
    console.log("[HealthKit] Raw mod.default type:", typeof mod?.default);
    console.log("[HealthKit] Raw mod.isAvailable type:", typeof mod?.isAvailable);
    console.log("[HealthKit] Raw mod.initHealthKit type:", typeof mod?.initHealthKit);
    console.log("[HealthKit] Raw mod.Constants type:", typeof mod?.Constants);

    if (typeof mod?.isAvailable === "function" || typeof mod?.initHealthKit === "function") {
      AppleHealthKit = mod;
      console.log("[HealthKit] Using raw module (methods found on root)");
    } else if (mod?.default && (typeof mod.default.isAvailable === "function" || typeof mod.default.initHealthKit === "function")) {
      AppleHealthKit = mod.default;
      console.log("[HealthKit] Using mod.default (methods found on default export)");
    } else {
      AppleHealthKit = mod;
      console.log("[HealthKit] Using raw module (fallback, methods not found yet)");
      console.log("[HealthKit] All keys on module:", mod ? Object.keys(mod) : "null");
      if (mod?.default) {
        console.log("[HealthKit] All keys on mod.default:", Object.keys(mod.default));
      }
    }

    console.log("[HealthKit] Final AppleHealthKit exists:", !!AppleHealthKit);
    console.log("[HealthKit] Final isAvailable type:", typeof AppleHealthKit?.isAvailable);
    console.log("[HealthKit] Final initHealthKit type:", typeof AppleHealthKit?.initHealthKit);
    console.log("[HealthKit] Final Constants:", !!AppleHealthKit?.Constants);
    if (AppleHealthKit?.Constants?.Permissions) {
      console.log("[HealthKit] Permissions keys:", Object.keys(AppleHealthKit.Constants.Permissions).slice(0, 10));
    }
  } catch (e: any) {
    console.log("[HealthKit] require() failed:", e?.message || e);
    console.log("[HealthKit] require() error stack:", e?.stack?.slice(0, 300));
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
    if (Platform.OS !== "ios") {
      console.log("[HealthKit] Not iOS, skipping");
      return false;
    }

    if (!AppleHealthKit) {
      console.log("[HealthKit] Module not loaded (require failed at init)");
      return false;
    }

    try {
      if (typeof AppleHealthKit.isAvailable === "function") {
        return new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            console.log("[HealthKit] isAvailable timed out after 5s, assuming available");
            resolve(true);
          }, 5000);
          try {
            AppleHealthKit.isAvailable((err: any, available: boolean) => {
              clearTimeout(timeout);
              console.log("[HealthKit] isAvailable callback:", { err, available });
              resolve(!err && !!available);
            });
          } catch (callErr: any) {
            clearTimeout(timeout);
            console.log("[HealthKit] isAvailable call threw:", callErr?.message || callErr);
            resolve(true);
          }
        });
      }

      if (typeof AppleHealthKit.initHealthKit === "function") {
        console.log("[HealthKit] isAvailable not found, but initHealthKit exists. Assuming available.");
        return true;
      }

      console.log("[HealthKit] Neither isAvailable nor initHealthKit found on module");
      console.log("[HealthKit] Current module keys:", AppleHealthKit ? Object.keys(AppleHealthKit) : "null");
      return false;
    } catch (e: any) {
      console.log("[HealthKit] isAvailable threw:", e?.message || e);
      return false;
    }
  },

  async requestPermissions() {
    if (!AppleHealthKit) {
      console.log("[HealthKit] Module not loaded, cannot request permissions");
      return false;
    }

    try {
      const perms = AppleHealthKit?.Constants?.Permissions;
      console.log("[HealthKit] Permissions object exists:", !!perms);

      const readPerms: any[] = [];
      if (perms) {
        if (perms.StepCount) readPerms.push(perms.StepCount);
        if (perms.SleepAnalysis) readPerms.push(perms.SleepAnalysis);
        if (perms.HeartRate) readPerms.push(perms.HeartRate);
        if (perms.ActiveEnergyBurned) readPerms.push(perms.ActiveEnergyBurned);
        if (perms.DistanceWalkingRunning) readPerms.push(perms.DistanceWalkingRunning);
        if (perms.RestingHeartRate) readPerms.push(perms.RestingHeartRate);
        if (perms.HeartRateVariabilitySDNN) readPerms.push(perms.HeartRateVariabilitySDNN);
        if (perms.BasalEnergyBurned) readPerms.push(perms.BasalEnergyBurned);
        if (perms.Weight) readPerms.push(perms.Weight);
        if (perms.Workout) readPerms.push(perms.Workout);
      }

      console.log("[HealthKit] Read permissions resolved:", readPerms.length, "types");

      const permissions = {
        permissions: {
          read: readPerms,
          write: [],
        },
      };

      if (typeof AppleHealthKit.initHealthKit !== "function") {
        console.log("[HealthKit] initHealthKit is not a function, type:", typeof AppleHealthKit.initHealthKit);
        return false;
      }

      console.log("[HealthKit] Calling initHealthKit with", readPerms.length, "read permissions");
      return new Promise<boolean>((resolve) => {
        try {
          AppleHealthKit.initHealthKit(permissions, (err: string) => {
            console.log("[HealthKit] initHealthKit result:", err || "success");
            resolve(!err);
          });
        } catch (callErr: any) {
          console.log("[HealthKit] initHealthKit call threw:", callErr?.message || callErr);
          resolve(false);
        }
      });
    } catch (e: any) {
      console.log("[HealthKit] requestPermissions threw:", e?.message || e);
      return false;
    }
  },

  async fetchMetrics(days: number) {
    if (!AppleHealthKit) return [];
    try {
      const startDate = daysAgoDate(days).toISOString();
      const endDate = new Date().toISOString();
      const options = { startDate, endDate };

      const [steps, heartRate, restingHR, hrv, sleep, activeEnergy, basalEnergy, weight, distance] =
        await Promise.all([
          hkQuery(AppleHealthKit, "getDailyStepCountSamples", options),
          hkQuery(AppleHealthKit, "getHeartRateSamples", options),
          hkQuery(AppleHealthKit, "getRestingHeartRateSamples", options),
          hkQuery(AppleHealthKit, "getHeartRateVariabilitySamples", options),
          hkQuery(AppleHealthKit, "getSleepSamples", options),
          hkQuery(AppleHealthKit, "getActiveEnergyBurned", options),
          hkQuery(AppleHealthKit, "getBasalEnergyBurned", options),
          hkQuery(AppleHealthKit, "getWeightSamples", options),
          hkQuery(AppleHealthKit, "getDistanceWalkingRunning", options),
        ]);

      const metricsMap = new Map<string, Partial<HealthMetrics>>();

      for (let i = 0; i < days; i++) {
        const d = dateStr(daysAgoDate(days - 1 - i));
        metricsMap.set(d, { date: d });
      }

      for (const s of steps as any[]) {
        const d = dateStr(new Date(s.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.steps = (entry.steps || 0) + Math.round(s.value);
      }

      for (const h of heartRate as any[]) {
        const d = dateStr(new Date(h.startDate));
        const entry = metricsMap.get(d);
        if (entry && !entry.restingHeartRate) entry.restingHeartRate = Math.round(h.value);
      }

      for (const r of restingHR as any[]) {
        const d = dateStr(new Date(r.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.restingHeartRate = Math.round(r.value);
      }

      for (const h of hrv as any[]) {
        const d = dateStr(new Date(h.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.hrv = Math.round(h.value);
      }

      for (const s of sleep as any[]) {
        const d = dateStr(new Date(s.startDate));
        const entry = metricsMap.get(d);
        if (entry) {
          const hours = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 3600000;
          entry.sleepDuration = Math.round(hours * 10) / 10;
          entry.sleepQuality = s.value === "ASLEEP" ? 80 : s.value === "INBED" ? 60 : 70;
        }
      }

      for (const a of activeEnergy as any[]) {
        const d = dateStr(new Date(a.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.activeCalories = Math.round(a.value);
      }

      for (const b of basalEnergy as any[]) {
        const d = dateStr(new Date(b.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.caloriesBurned = Math.round(b.value + (entry.activeCalories || 0));
      }

      for (const w of weight as any[]) {
        const d = dateStr(new Date(w.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.weight = Math.round(w.value * 10) / 10;
      }

      for (const dist of distance as any[]) {
        const d = dateStr(new Date(dist.startDate));
        const entry = metricsMap.get(d);
        if (entry) entry.distance = Math.round(dist.value * 100) / 100;
      }

      return fillDefaults(Array.from(metricsMap.values()), days);
    } catch {
      return [];
    }
  },
};

function hkQuery(kit: any, method: string, options: any): Promise<any[]> {
  return new Promise((resolve) => {
    if (typeof kit[method] === "function") {
      kit[method](options, (err: any, results: any[]) => {
        resolve(err ? [] : results || []);
      });
    } else {
      resolve([]);
    }
  });
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

export const healthProviders: Record<string, HealthDataProvider> = {
  apple_health: appleHealthProvider,
};

export async function connectProvider(
  id: string
): Promise<{ success: boolean; error?: string; unavailable?: boolean }> {
  const provider = healthProviders[id];
  if (!provider) return { success: false, error: "Unknown provider." };

  try {
    console.log(`[connectProvider] Starting connection for ${id}`);
    console.log(`[connectProvider] AppleHealthKit module exists:`, !!AppleHealthKit);
    console.log(`[connectProvider] AppleHealthKit keys:`, AppleHealthKit ? Object.keys(AppleHealthKit).slice(0, 15) : "null");
    console.log(`[connectProvider] isAvailable type:`, typeof AppleHealthKit?.isAvailable);
    console.log(`[connectProvider] initHealthKit type:`, typeof AppleHealthKit?.initHealthKit);
    console.log(`[connectProvider] Constants type:`, typeof AppleHealthKit?.Constants);

    const available = await provider.isAvailable();
    console.log(`[connectProvider] isAvailable result for ${id}:`, available);

    if (!available) {
      if (id === "apple_health" && Platform.OS !== "ios") {
        return { success: false, unavailable: true, error: "Apple Health requires an iOS device with a native build." };
      }
      return { success: false, unavailable: true, error: `${provider.name} is not available on this device.` };
    }

    const permitted = await provider.requestPermissions();
    console.log(`[connectProvider] requestPermissions result for ${id}:`, permitted);
    if (!permitted) {
      return { success: false, error: `Permission denied. Open Settings > Privacy > Health to grant access.` };
    }

    return { success: true };
  } catch (e: any) {
    console.log(`[connectProvider] Error for ${id}:`, e?.message || e);
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
