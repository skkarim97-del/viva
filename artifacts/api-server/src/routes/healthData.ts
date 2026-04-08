import { Router, type Request, type Response } from "express";

const router = Router();

router.get("/garmin", async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 28));

  const garminToken = process.env.GARMIN_ACCESS_TOKEN;
  if (!garminToken) {
    return res.status(503).json({
      error: "Garmin not connected",
      message: "Connect your Garmin account in Settings to sync health data.",
      setupRequired: true,
    });
  }

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [dailies, sleepData, heartRate] = await Promise.all([
      garminFetch(`/wellness-api/rest/dailies?uploadStartTimeInSeconds=${Math.floor(startDate.getTime() / 1000)}&uploadEndTimeInSeconds=${Math.floor(endDate.getTime() / 1000)}`, garminToken),
      garminFetch(`/wellness-api/rest/epochs?uploadStartTimeInSeconds=${Math.floor(startDate.getTime() / 1000)}&uploadEndTimeInSeconds=${Math.floor(endDate.getTime() / 1000)}`, garminToken),
      garminFetch(`/wellness-api/rest/heartRates?uploadStartTimeInSeconds=${Math.floor(startDate.getTime() / 1000)}&uploadEndTimeInSeconds=${Math.floor(endDate.getTime() / 1000)}`, garminToken),
    ]);

    const metrics = buildMetricsFromGarmin(dailies, sleepData, heartRate, days);
    res.json({ metrics, source: "garmin", days });
  } catch (err: any) {
    res.status(502).json({
      error: "Failed to fetch Garmin data",
      message: err.message || "Could not reach Garmin servers.",
    });
  }
});

router.get("/samsung", async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 28));

  const samsungToken = process.env.SAMSUNG_HEALTH_ACCESS_TOKEN;
  if (!samsungToken) {
    return res.status(503).json({
      error: "Samsung Health not connected",
      message: "Connect your Samsung Health account in Settings to sync health data.",
      setupRequired: true,
    });
  }

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [dailies, sleepData, heartRate, exercise] = await Promise.all([
      samsungFetch("/v1/daily-summary", samsungToken, startDate, endDate),
      samsungFetch("/v1/sleep", samsungToken, startDate, endDate),
      samsungFetch("/v1/heart-rate", samsungToken, startDate, endDate),
      samsungFetch("/v1/exercise", samsungToken, startDate, endDate),
    ]);

    const metrics = buildMetricsFromSamsung(dailies, sleepData, heartRate, exercise, days);
    res.json({ metrics, source: "samsung_health", days });
  } catch (err: any) {
    res.status(502).json({
      error: "Failed to fetch Samsung Health data",
      message: err.message || "Could not reach Samsung Health servers.",
    });
  }
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    providers: {
      garmin: { connected: !!process.env.GARMIN_ACCESS_TOKEN },
      samsung_health: { connected: !!process.env.SAMSUNG_HEALTH_ACCESS_TOKEN },
      apple_health: { connected: false, note: "Apple Health connects directly on-device via HealthKit" },
    },
  });
});

async function garminFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`https://apis.garmin.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Garmin API error: ${res.status}`);
  return res.json();
}

async function samsungFetch(path: string, token: string, startDate: Date, endDate: Date): Promise<any> {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });
  const res = await fetch(`https://api.shealth.samsung.com${path}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Samsung Health API error: ${res.status}`);
  return res.json();
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function buildMetricsFromGarmin(dailies: any[], _sleep: any[], heartRates: any[], days: number) {
  const metrics: any[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = dateStr(d);

    const daily = (dailies || []).find((entry: any) => {
      const entryDate = new Date(entry.calendarDate || entry.startTimeInSeconds * 1000);
      return dateStr(entryDate) === date;
    });

    const hr = (heartRates || []).find((entry: any) => {
      const entryDate = new Date(entry.calendarDate || entry.startTimeInSeconds * 1000);
      return dateStr(entryDate) === date;
    });

    metrics.push({
      date,
      steps: daily?.totalSteps ?? daily?.steps ?? 0,
      caloriesBurned: daily?.totalKilocalories ?? daily?.activeKilocalories ?? 0,
      activeCalories: daily?.activeKilocalories ?? 0,
      restingHeartRate: hr?.restingHeartRateInBeatsPerMinute ?? daily?.restingHeartRate ?? 65,
      hrv: daily?.averageStressLevel ? Math.max(20, 100 - daily.averageStressLevel) : 40,
      weight: daily?.weightInGrams ? daily.weightInGrams / 1000 * 2.205 : 0,
      sleepDuration: daily?.totalSleepTimeInSeconds ? daily.totalSleepTimeInSeconds / 3600 : 0,
      sleepQuality: daily?.totalSleepTimeInSeconds && daily.totalSleepTimeInSeconds > 25200 ? 80 : 60,
      recoveryScore: daily?.bodyBatteryChargedValue ?? 60,
      strain: daily?.averageStressLevel ?? 10,
    });
  }

  return metrics;
}

function buildMetricsFromSamsung(dailies: any, sleepData: any, heartRate: any, exercise: any, days: number) {
  const metrics: any[] = [];
  const now = new Date();
  const dailyRecords = dailies?.data || dailies || [];
  const sleepRecords = sleepData?.data || sleepData || [];
  const hrRecords = heartRate?.data || heartRate || [];
  const exerciseRecords = exercise?.data || exercise || [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = dateStr(d);

    const daily = dailyRecords.find((r: any) => {
      const rDate = r.date || (r.created_at ? dateStr(new Date(r.created_at)) : "");
      return rDate === date;
    });

    const sleep = sleepRecords.find((s: any) => {
      const sDate = s.date || (s.start_time ? dateStr(new Date(s.start_time)) : "");
      return sDate === date;
    });

    const hr = hrRecords.find((h: any) => {
      const hDate = h.date || (h.start_time ? dateStr(new Date(h.start_time)) : "");
      return hDate === date;
    });

    const dayExercises = exerciseRecords.filter((e: any) => {
      const eDate = e.date || (e.start_time ? dateStr(new Date(e.start_time)) : "");
      return eDate === date;
    });

    const sleepDurationMs = sleep?.duration_ms || (sleep?.end_time && sleep?.start_time
      ? new Date(sleep.end_time).getTime() - new Date(sleep.start_time).getTime()
      : 0);

    const totalExerciseCal = dayExercises.reduce((sum: number, e: any) => sum + (e.calories || 0), 0);

    metrics.push({
      date,
      steps: daily?.steps ?? daily?.step_count ?? 0,
      caloriesBurned: (daily?.calories ?? daily?.total_calories ?? 0) + totalExerciseCal,
      activeCalories: daily?.active_calories ?? totalExerciseCal,
      restingHeartRate: hr?.resting_heart_rate ?? hr?.min ?? 65,
      hrv: hr?.hrv ?? hr?.sdnn ?? 40,
      weight: daily?.weight ?? 0,
      sleepDuration: sleepDurationMs > 0 ? Math.round(sleepDurationMs / 3600000 * 10) / 10 : 0,
      sleepQuality: sleep?.efficiency ?? sleep?.score ?? 70,
      recoveryScore: daily?.stress_score ? Math.max(20, 100 - daily.stress_score) : 60,
      strain: daily?.stress_score ?? 10,
    });
  }

  return metrics;
}

export default router;
