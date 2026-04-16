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
  fetchCalled: boolean;
  fetchSucceeded: boolean | null;
  fetchErrorText: string | null;
  sampleCounts: string;
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
  fetchCalled: false,
  fetchSucceeded: null,
  fetchErrorText: null,
  sampleCounts: "",
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

let _AppleHealthKit: any = null;

function resolveAppleHealthKit(): any {
  if (_AppleHealthKit) return _AppleHealthKit;
  if (Platform.OS !== "ios") return null;
  try {
    const mod = require("react-native-health");
    const resolved =
      mod && typeof mod.initHealthKit === "function"
        ? mod
        : mod?.default && typeof mod.default.initHealthKit === "function"
        ? mod.default
        : null;
    if (resolved) _AppleHealthKit = resolved;
    return resolved;
  } catch {
    return null;
  }
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

  const AppleHealthKit =
    mod && typeof mod.initHealthKit === "function"
      ? mod
      : mod?.default && typeof mod.default.initHealthKit === "function"
      ? mod.default
      : null;

  _debugInfo.usingDefaultExport = AppleHealthKit === mod?.default && AppleHealthKit !== null;
  _debugInfo.initFunctionExists = AppleHealthKit !== null && typeof AppleHealthKit.initHealthKit === "function";
  notifyDebug();

  if (!AppleHealthKit) {
    _debugInfo.rawErrorText = "initHealthKit missing on both root and default export";
    notifyDebug();
    return { success: false, error: _debugInfo.rawErrorText };
  }

  _AppleHealthKit = AppleHealthKit;

  const P = AppleHealthKit?.Constants?.Permissions ?? {};
  const options = {
    permissions: {
      read: [
        P.StepCount,
        P.HeartRate,
        P.RestingHeartRate,
        P.HeartRateVariability,
        P.SleepAnalysis,
        P.DistanceWalkingRunning,
        P.ActiveEnergyBurned,
        P.BasalEnergyBurned,
      ].filter(Boolean),
      write: [],
    },
  };

  _debugInfo.initCalled = true;
  notifyDebug();
  console.log("[HealthKit] Calling initHealthKit with permissions:", options.permissions.read);

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    AppleHealthKit.initHealthKit(options, (err: string) => {
      _debugInfo.callbackReached = true;
      console.log("[HealthKit] initHealthKit callback. err:", err || "none");

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

type Sample = { startDate: string; endDate: string; value: number | string };

function promisify<T>(fn: (opts: any, cb: (err: any, res: T) => void) => void, opts: any): Promise<T> {
  return new Promise((resolve) => {
    try {
      fn(opts, (err, res) => {
        if (err) {
          console.log("[HealthKit fetch] error:", err);
          resolve([] as unknown as T);
        } else {
          resolve(res);
        }
      });
    } catch (e) {
      console.log("[HealthKit fetch] threw:", e);
      resolve([] as unknown as T);
    }
  });
}

function bucketByDate<T extends { startDate: string; value: any }>(samples: T[]): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const s of samples || []) {
    const d = s.startDate?.split("T")[0];
    if (!d) continue;
    if (!map[d]) map[d] = [];
    map[d].push(s);
  }
  return map;
}

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sum(vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0);
}

async function fetchAppleHealthMetrics(days: number): Promise<HealthMetrics[]> {
  const AHK = resolveAppleHealthKit();
  if (!AHK) {
    _debugInfo.fetchErrorText = "AppleHealthKit not resolved";
    _debugInfo.fetchSucceeded = false;
    notifyDebug();
    return [];
  }

  _debugInfo.fetchCalled = true;
  _debugInfo.fetchErrorText = null;
  _debugInfo.fetchSucceeded = null;
  notifyDebug();

  const startDate = daysAgoDate(days - 1).toISOString();
  const endDate = new Date().toISOString();
  const baseOpts = { startDate, endDate };
  const withLimit = { ...baseOpts, limit: 10000 };

  console.log("[HealthKit fetch] window:", startDate, "to", endDate);

  try {
    const [
      stepsRaw,
      distanceRaw,
      hrRaw,
      restingHrRaw,
      hrvRaw,
      sleepRaw,
      activeCalRaw,
      basalCalRaw,
    ] = await Promise.all([
      promisify<Sample[]>(AHK.getDailyStepCountSamples?.bind(AHK) ?? (() => {}), baseOpts),
      promisify<Sample[]>(AHK.getDailyDistanceWalkingRunningSamples?.bind(AHK) ?? (() => {}), baseOpts),
      promisify<Sample[]>(AHK.getHeartRateSamples?.bind(AHK) ?? (() => {}), withLimit),
      promisify<Sample[]>(AHK.getRestingHeartRateSamples?.bind(AHK) ?? (() => {}), withLimit),
      promisify<Sample[]>(AHK.getHeartRateVariabilitySamples?.bind(AHK) ?? (() => {}), withLimit),
      promisify<Sample[]>(AHK.getSleepSamples?.bind(AHK) ?? (() => {}), withLimit),
      promisify<Sample[]>(AHK.getActiveEnergyBurned?.bind(AHK) ?? (() => {}), withLimit),
      promisify<Sample[]>(AHK.getBasalEnergyBurned?.bind(AHK) ?? (() => {}), withLimit),
    ]);

    const counts = {
      steps: stepsRaw?.length ?? 0,
      distance: distanceRaw?.length ?? 0,
      hr: hrRaw?.length ?? 0,
      restingHr: restingHrRaw?.length ?? 0,
      hrv: hrvRaw?.length ?? 0,
      sleep: sleepRaw?.length ?? 0,
      activeCal: activeCalRaw?.length ?? 0,
      basalCal: basalCalRaw?.length ?? 0,
    };
    _debugInfo.sampleCounts = `steps:${counts.steps} dist:${counts.distance} hr:${counts.hr} rhr:${counts.restingHr} hrv:${counts.hrv} sleep:${counts.sleep} aCal:${counts.activeCal} bCal:${counts.basalCal}`;
    console.log("[HealthKit fetch] sample counts:", counts);

    const stepsByDate = bucketByDate(stepsRaw || []);
    const distanceByDate = bucketByDate(distanceRaw || []);
    const hrByDate = bucketByDate(hrRaw || []);
    const restingHrByDate = bucketByDate(restingHrRaw || []);
    const hrvByDate = bucketByDate(hrvRaw || []);
    const activeCalByDate = bucketByDate(activeCalRaw || []);
    const basalCalByDate = bucketByDate(basalCalRaw || []);

    // Sleep aggregation.
    // Apple Health returns sleep samples with per-stage values. We count CORE+DEEP+REM as actual sleep.
    // If only ASLEEP is present (older iOS), we count that. We exclude INBED and AWAKE to avoid
    // double counting (INBED typically overlaps with all stage samples).
    // Unit: hours (converted from ms via /3_600_000).
    const sleepDurationByDate: Record<string, number> = {};
    const sleepStageCountsByDate: Record<string, Record<string, number>> = {};
    let hasStageData = false;
    for (const s of sleepRaw || []) {
      const v = typeof s.value === "string" ? s.value.toUpperCase() : "";
      if (v === "CORE" || v === "DEEP" || v === "REM") { hasStageData = true; break; }
    }
    for (const s of sleepRaw || []) {
      if (!s.startDate || !s.endDate) continue;
      const v = typeof s.value === "string" ? s.value.toUpperCase() : "";
      const dayKey = s.startDate.split("T")[0];
      if (!sleepStageCountsByDate[dayKey]) sleepStageCountsByDate[dayKey] = {};
      sleepStageCountsByDate[dayKey][v] = (sleepStageCountsByDate[dayKey][v] || 0) + 1;

      const isSleepStage = hasStageData
        ? (v === "CORE" || v === "DEEP" || v === "REM")
        : (v === "ASLEEP" || v === "ASLEEPUNSPECIFIED");
      if (!isSleepStage) continue;

      const hours = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 3_600_000;
      if (hours <= 0 || hours > 16) continue;
      sleepDurationByDate[dayKey] = (sleepDurationByDate[dayKey] || 0) + hours;
    }
    console.log("[HealthKit fetch] sleep: hasStageData=", hasStageData, " mode=", hasStageData ? "CORE+DEEP+REM" : "ASLEEP");
    const sleepDays = Object.keys(sleepDurationByDate).sort();
    if (sleepDays.length > 0) {
      const exampleDay = sleepDays[sleepDays.length - 1];
      console.log("[HealthKit fetch] sleep sample day:", exampleDay, "stages:", sleepStageCountsByDate[exampleDay], "total hours:", sleepDurationByDate[exampleDay]);
    }

    const result: HealthMetrics[] = [];
    for (let i = 0; i < days; i++) {
      const d = dateStr(daysAgoDate(days - 1 - i));
      const stepsVal = sum((stepsByDate[d] || []).map((s) => Number(s.value) || 0));
      const distanceVal = sum((distanceByDate[d] || []).map((s) => Number(s.value) || 0));
      const hrSamples = (hrByDate[d] || []).map((s) => Number(s.value) || 0).filter((v) => v > 0);
      const restingHrSamples = (restingHrByDate[d] || []).map((s) => Number(s.value) || 0).filter((v) => v > 0);
      const hrvSamples = (hrvByDate[d] || []).map((s) => Number(s.value) || 0).filter((v) => v > 0);
      const activeCalVal = sum((activeCalByDate[d] || []).map((s) => Number(s.value) || 0));
      const basalCalVal = sum((basalCalByDate[d] || []).map((s) => Number(s.value) || 0));

      // Null = metric not measured that day. Never fall back resting HR to avg HR.
      result.push({
        date: d,
        steps: Math.round(stepsVal),
        caloriesBurned: Math.round(activeCalVal + basalCalVal),
        activeCalories: Math.round(activeCalVal),
        sleepDuration: Math.round((sleepDurationByDate[d] || 0) * 10) / 10,
        restingHeartRate: restingHrSamples.length > 0 ? Math.round(avg(restingHrSamples)) : null,
        hrv: hrvSamples.length > 0 ? Math.round(avg(hrvSamples)) : null,
        weight: null, // not yet fetched from HealthKit
        sleepQuality: null, // derived, not computed
        recoveryScore: null, // derived, not computed
        strain: null, // derived, not computed
        distance: distanceVal > 0 ? Math.round(distanceVal) : undefined,
      });
    }

    _debugInfo.fetchSucceeded = true;
    notifyDebug();
    console.log("[HealthKit fetch] units: steps=count, distance=meters, HR=bpm, HRV=ms, calories=kcal, sleep=hours");
    console.log("[HealthKit fetch] FINAL metrics last 3 days:", JSON.stringify(result.slice(-3), null, 2));
    if (result.length > 0) {
      const example = result[result.length - 1];
      console.log("[HealthKit fetch] NORMALIZED SCHEMA example day", example.date, ":", {
        date: `"${example.date}" (string, YYYY-MM-DD)`,
        steps: `${example.steps} (number, count)`,
        caloriesBurned: `${example.caloriesBurned} (number, kcal)`,
        activeCalories: `${example.activeCalories} (number, kcal)`,
        sleepDuration: `${example.sleepDuration} (number, hours)`,
        restingHeartRate: `${example.restingHeartRate} (number|null, bpm)`,
        hrv: `${example.hrv} (number|null, ms)`,
        weight: `${example.weight} (number|null, lbs)`,
        sleepQuality: `${example.sleepQuality} (number|null, 0-100)`,
        recoveryScore: `${example.recoveryScore} (number|null, 0-100)`,
        strain: `${example.strain} (number|null, 0-21)`,
        distance: `${example.distance} (number|undefined, meters)`,
      });
    }
    return result;
  } catch (e: any) {
    _debugInfo.fetchSucceeded = false;
    _debugInfo.fetchErrorText = `fetch exception: ${e?.message ?? String(e)}`;
    notifyDebug();
    console.log("[HealthKit fetch] exception:", e);
    return [];
  }
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
    return fetchAppleHealthMetrics(days);
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

export type AvailableMetricType =
  | "steps"
  | "heartRate"
  | "restingHeartRate"
  | "hrv"
  | "sleep"
  | "activeCalories"
  | "totalCalories"
  | "distance"
  | "weight"
  | "calories"
  | "recovery";

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
  // Each metric has its own availability key. null means "not measured"; 0 is only counted for
  // counters where 0 is a legitimate value (steps, calories, sleep — a real 0-step day exists).
  const anyPositive = (vals: (number | null | undefined)[]) =>
    vals.some((v) => typeof v === "number" && v > 0);
  const anyNonNull = (vals: (number | null | undefined)[]) =>
    vals.some((v) => typeof v === "number");

  if (anyPositive(metrics.map((m) => m.steps))) types.push("steps");
  if (anyNonNull(metrics.map((m) => m.restingHeartRate))) types.push("restingHeartRate");
  // "heartRate" is reserved for avg HR availability; we do not currently persist avg HR per day,
  // but we keep the key for consumers that want to check it separately from resting HR.
  if (anyNonNull(metrics.map((m) => m.hrv))) types.push("hrv");
  if (anyPositive(metrics.map((m) => m.sleepDuration))) types.push("sleep");
  if (anyPositive(metrics.map((m) => m.activeCalories))) types.push("activeCalories");
  if (anyPositive(metrics.map((m) => m.caloriesBurned))) types.push("totalCalories");
  if (anyPositive(metrics.map((m) => m.distance ?? 0))) types.push("distance");
  if (anyNonNull(metrics.map((m) => m.weight))) types.push("weight");
  if (anyNonNull(metrics.map((m) => m.recoveryScore))) types.push("recovery");
  // Legacy alias kept for back-compat with any code still checking "calories".
  if (anyPositive(metrics.map((m) => m.activeCalories))) types.push("calories");
  return types;
}

// Null-safe helpers for downstream engines.
export function filterNonNull(vals: (number | null | undefined)[]): number[] {
  return vals.filter((v): v is number => typeof v === "number");
}
export function avgNonNull(vals: (number | null | undefined)[]): number {
  const f = filterNonNull(vals);
  return f.length === 0 ? 0 : f.reduce((s, v) => s + v, 0) / f.length;
}
