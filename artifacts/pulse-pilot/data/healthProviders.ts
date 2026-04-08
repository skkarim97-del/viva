import { Platform } from "react-native";
import type { HealthMetrics } from "@/types";

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
    try {
      const AppleHealthKit = (await import("react-native-health")).default;
      if (!AppleHealthKit) return false;
      return new Promise<boolean>((resolve) => {
        if (typeof AppleHealthKit.isAvailable === "function") {
          AppleHealthKit.isAvailable((err: any, available: boolean) => {
            resolve(!err && !!available);
          });
        } else {
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  },

  async requestPermissions() {
    try {
      const AppleHealthKit = (await import("react-native-health")).default;
      const permissions = {
        permissions: {
          read: [
            AppleHealthKit.Constants.Permissions.StepCount,
            AppleHealthKit.Constants.Permissions.HeartRate,
            AppleHealthKit.Constants.Permissions.RestingHeartRate,
            AppleHealthKit.Constants.Permissions.HeartRateVariabilitySDNN,
            AppleHealthKit.Constants.Permissions.SleepAnalysis,
            AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
            AppleHealthKit.Constants.Permissions.BasalEnergyBurned,
            AppleHealthKit.Constants.Permissions.Weight,
            AppleHealthKit.Constants.Permissions.DistanceWalkingRunning,
          ],
          write: [],
        },
      };
      return new Promise<boolean>((resolve) => {
        AppleHealthKit.initHealthKit(permissions, (err: string) => {
          resolve(!err);
        });
      });
    } catch {
      return false;
    }
  },

  async fetchMetrics(days: number) {
    try {
      const AppleHealthKit = (await import("react-native-health")).default;
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

const garminProvider: HealthDataProvider = {
  id: "garmin",
  name: "Garmin",

  async isAvailable() {
    return true;
  },

  async requestPermissions() {
    return true;
  },

  async fetchMetrics(days: number) {
    try {
      const API_BASE = Platform.OS === "web"
        ? "/api"
        : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

      const res = await fetch(`${API_BASE}/health/garmin?days=${days}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return fillDefaults(data.metrics || [], days);
    } catch {
      return [];
    }
  },
};

const healthConnectProvider: HealthDataProvider = {
  id: "health_connect",
  name: "Health Connect",

  async isAvailable() {
    if (Platform.OS !== "android") return false;
    try {
      const { getSdkStatus, SdkAvailabilityStatus } = await import("react-native-health-connect");
      const status = await getSdkStatus();
      return status === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch {
      return false;
    }
  },

  async requestPermissions() {
    try {
      const { initialize, requestPermission } = await import("react-native-health-connect");
      await initialize();
      const granted = await requestPermission([
        { accessType: "read", recordType: "Steps" },
        { accessType: "read", recordType: "HeartRate" },
        { accessType: "read", recordType: "RestingHeartRate" },
        { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
        { accessType: "read", recordType: "SleepSession" },
        { accessType: "read", recordType: "ActiveCaloriesBurned" },
        { accessType: "read", recordType: "TotalCaloriesBurned" },
        { accessType: "read", recordType: "Weight" },
        { accessType: "read", recordType: "ExerciseSession" },
      ]);
      return granted.length > 0;
    } catch {
      return false;
    }
  },

  async fetchMetrics(days: number) {
    try {
      const { initialize, readRecords } = await import("react-native-health-connect");
      await initialize();
      const startTime = daysAgoDate(days).toISOString();
      const endTime = new Date().toISOString();
      const timeRange = { operator: "between" as const, startTime, endTime };

      const [stepsData, hrData, rhrData, hrvData, sleepData, activeCalData, totalCalData, weightData] =
        await Promise.all([
          readRecords("Steps", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("HeartRate", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("RestingHeartRate", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("HeartRateVariabilityRmssd", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("SleepSession", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("ActiveCaloriesBurned", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("TotalCaloriesBurned", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
          readRecords("Weight", { timeRangeFilter: timeRange }).catch(() => ({ records: [] })),
        ]);

      const metricsMap = new Map<string, Partial<HealthMetrics>>();
      for (let i = 0; i < days; i++) {
        const d = dateStr(daysAgoDate(days - 1 - i));
        metricsMap.set(d, { date: d });
      }

      for (const r of stepsData.records as any[]) {
        const d = dateStr(new Date(r.startTime));
        const entry = metricsMap.get(d);
        if (entry) entry.steps = (entry.steps || 0) + Math.round(r.count || 0);
      }

      for (const r of hrData.records as any[]) {
        const d = dateStr(new Date(r.startTime));
        const entry = metricsMap.get(d);
        if (entry && r.samples?.length > 0) {
          const avg = r.samples.reduce((s: number, sample: any) => s + (sample.beatsPerMinute || 0), 0) / r.samples.length;
          if (!entry.restingHeartRate) entry.restingHeartRate = Math.round(avg);
        }
      }

      for (const r of rhrData.records as any[]) {
        const d = dateStr(new Date(r.time));
        const entry = metricsMap.get(d);
        if (entry) entry.restingHeartRate = Math.round(r.beatsPerMinute || 0);
      }

      for (const r of hrvData.records as any[]) {
        const d = dateStr(new Date(r.time));
        const entry = metricsMap.get(d);
        if (entry) entry.hrv = Math.round(r.heartRateVariabilityMillis || 0);
      }

      for (const r of sleepData.records as any[]) {
        const d = dateStr(new Date(r.startTime));
        const entry = metricsMap.get(d);
        if (entry) {
          const hours = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 3600000;
          entry.sleepDuration = Math.round(hours * 10) / 10;
          entry.sleepQuality = hours >= 7 ? 85 : hours >= 6 ? 70 : 55;
        }
      }

      for (const r of activeCalData.records as any[]) {
        const d = dateStr(new Date(r.startTime));
        const entry = metricsMap.get(d);
        if (entry) entry.activeCalories = (entry.activeCalories || 0) + Math.round(r.energy?.inKilocalories || 0);
      }

      for (const r of totalCalData.records as any[]) {
        const d = dateStr(new Date(r.startTime));
        const entry = metricsMap.get(d);
        if (entry) entry.caloriesBurned = Math.round(r.energy?.inKilocalories || 0);
      }

      for (const r of weightData.records as any[]) {
        const d = dateStr(new Date(r.time));
        const entry = metricsMap.get(d);
        if (entry) entry.weight = Math.round((r.weight?.inPounds || r.weight?.inKilograms * 2.205 || 0) * 10) / 10;
      }

      return fillDefaults(Array.from(metricsMap.values()), days);
    } catch {
      return [];
    }
  },
};

const samsungHealthProvider: HealthDataProvider = {
  id: "samsung_health",
  name: "Samsung Health",

  async isAvailable() {
    if (Platform.OS !== "android") return false;
    return healthConnectProvider.isAvailable();
  },

  async requestPermissions() {
    return healthConnectProvider.requestPermissions();
  },

  async fetchMetrics(days: number) {
    return healthConnectProvider.fetchMetrics(days);
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
      restingHeartRate: existing.restingHeartRate ?? 65,
      hrv: existing.hrv ?? 40,
      weight: existing.weight ?? result[result.length - 1]?.weight ?? 180,
      sleepDuration: existing.sleepDuration ?? 7,
      sleepQuality: existing.sleepQuality ?? 70,
      recoveryScore: existing.recoveryScore ?? 60,
      strain: existing.strain ?? 10,
      vo2Max: existing.vo2Max,
      distance: existing.distance,
      pace: existing.pace,
    });
  }

  return result;
}

export const healthProviders: Record<string, HealthDataProvider> = {
  apple_health: appleHealthProvider,
  health_connect: healthConnectProvider,
  garmin: garminProvider,
  samsung_health: samsungHealthProvider,
};

export async function fetchHealthData(
  connectedProviders: string[],
  days: number = 28
): Promise<{ metrics: HealthMetrics[]; source: string | null }> {
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
        return { metrics, source: id };
      }
    } catch {
      continue;
    }
  }

  return { metrics: [], source: null };
}
