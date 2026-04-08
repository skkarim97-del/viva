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

router.get("/whoop", async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 28));

  const whoopToken = process.env.WHOOP_ACCESS_TOKEN;
  if (!whoopToken) {
    return res.status(503).json({
      error: "WHOOP not connected",
      message: "Connect your WHOOP account in Settings to sync health data.",
      setupRequired: true,
    });
  }

  try {
    const endDate = new Date().toISOString();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [cycles, recoveries, sleeps] = await Promise.all([
      whoopFetch(`/developer/v1/cycle?start=${startDate.toISOString()}&end=${endDate}`, whoopToken),
      whoopFetch(`/developer/v1/recovery?start=${startDate.toISOString()}&end=${endDate}`, whoopToken),
      whoopFetch(`/developer/v1/activity/sleep?start=${startDate.toISOString()}&end=${endDate}`, whoopToken),
    ]);

    const metrics = buildMetricsFromWhoop(cycles, recoveries, sleeps, days);
    res.json({ metrics, source: "whoop", days });
  } catch (err: any) {
    res.status(502).json({
      error: "Failed to fetch WHOOP data",
      message: err.message || "Could not reach WHOOP servers.",
    });
  }
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    providers: {
      garmin: { connected: !!process.env.GARMIN_ACCESS_TOKEN },
      whoop: { connected: !!process.env.WHOOP_ACCESS_TOKEN },
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

async function whoopFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.prod.whoop.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`WHOOP API error: ${res.status}`);
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

function buildMetricsFromWhoop(cycles: any, recoveries: any, sleeps: any, days: number) {
  const metrics: any[] = [];
  const now = new Date();
  const cycleRecords = cycles?.records || cycles || [];
  const recoveryRecords = recoveries?.records || recoveries || [];
  const sleepRecords = sleeps?.records || sleeps || [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = dateStr(d);

    const cycle = cycleRecords.find((c: any) => {
      const cDate = c.start ? dateStr(new Date(c.start)) : "";
      return cDate === date;
    });

    const recovery = recoveryRecords.find((r: any) => {
      const rDate = r.created_at ? dateStr(new Date(r.created_at)) : r.cycle_id === cycle?.id ? date : "";
      return rDate === date;
    });

    const sleep = sleepRecords.find((s: any) => {
      const sDate = s.start ? dateStr(new Date(s.start)) : "";
      return sDate === date;
    });

    const sleepDurationMs = sleep ? new Date(sleep.end).getTime() - new Date(sleep.start).getTime() : 0;

    metrics.push({
      date,
      steps: 0,
      caloriesBurned: cycle?.score?.kilojoule ? Math.round(cycle.score.kilojoule / 4.184) : 0,
      activeCalories: cycle?.score?.kilojoule ? Math.round(cycle.score.kilojoule / 4.184 * 0.4) : 0,
      restingHeartRate: recovery?.score?.resting_heart_rate ?? 65,
      hrv: recovery?.score?.hrv_rmssd_milli ? Math.round(recovery.score.hrv_rmssd_milli) : 40,
      weight: 0,
      sleepDuration: sleepDurationMs > 0 ? Math.round(sleepDurationMs / 3600000 * 10) / 10 : 0,
      sleepQuality: sleep?.score?.sleep_performance_percentage ?? 70,
      recoveryScore: recovery?.score?.recovery_score ?? 60,
      strain: cycle?.score?.strain ? Math.round(cycle.score.strain * 10) / 10 : 10,
    });
  }

  return metrics;
}

export default router;
