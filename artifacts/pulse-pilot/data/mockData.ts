import {
  type UserProfile,
  type HealthMetrics,
  type TrendData,
  type WorkoutEntry,
  type IntegrationStatus,
  type MetricDetail,
  type MetricKey,
} from "@/types";

export const defaultProfile: UserProfile = {
  id: "user_1",
  name: "Sarah",
  age: 32,
  sex: "female",
  height: 65,
  weight: 195,
  goalWeight: 160,
  dietaryPreference: "balanced",
  workoutPreference: "mixed",
  injuries: "",
  availableWorkoutTime: 30,
  daysAvailableToTrain: 3,
  coachingTone: "gentle",
  goals: ["fat_loss", "stay_consistent"],
  tier: "free",
  onboardingComplete: false,
  fastingEnabled: false,
  units: "imperial",
  glp1Medication: "tirzepatide",
  glp1Reason: "weight_loss",
  glp1Duration: "1_3_months",
  proteinConfidence: "medium",
  hydrationConfidence: "medium",
  mealsPerDay: 3,
  underEatingConcern: false,
  strengthTrainingBaseline: "no",
  activityLevel: "light",
  medicationProfile: {
    medicationBrand: "Mounjaro",
    genericName: "tirzepatide",
    indication: "Weight loss",
    doseValue: 2.5,
    doseUnit: "mg",
    frequency: "weekly",
    weekOnCurrentDose: 4,
    startDate: null,
    lastInjectionDate: null,
    recentTitration: false,
    previousDoseValue: null,
    previousDoseUnit: null,
    previousFrequency: null,
    doseChangeDate: null,
    timeOnMedicationBucket: "1_3_months",
  },
};

function generateDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

export function generateMockMetrics(days: number = 30): HealthMetrics[] {
  const metrics: HealthMetrics[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const baseHrv = 42 + Math.sin(i / 7) * 8;
    const baseRhr = 62 - Math.sin(i / 10) * 3;
    const baseSleep = 7.2 + Math.sin(i / 5) * 0.8;
    const baseSteps = 6000 + Math.sin(i / 3) * 2000;
    const baseWeight = 195 - (i > 15 ? 0 : (15 - i) * 0.2);

    metrics.push({
      date: generateDateString(i),
      steps: Math.round(baseSteps + (Math.random() - 0.5) * 1000),
      caloriesBurned: Math.round(1800 + (Math.random() - 0.5) * 300),
      activeCalories: Math.round(250 + (Math.random() - 0.5) * 150),
      restingHeartRate: Math.round(baseRhr + (Math.random() - 0.5) * 4),
      hrv: Math.round(baseHrv + (Math.random() - 0.5) * 6),
      weight: Math.round((baseWeight + (Math.random() - 0.5) * 1) * 10) / 10,
      sleepDuration: Math.round((baseSleep + (Math.random() - 0.5) * 1.2) * 10) / 10,
      sleepQuality: Math.round(70 + Math.sin(i / 6) * 15 + (Math.random() - 0.5) * 10),
      recoveryScore: Math.round(65 + Math.sin(i / 5) * 15 + (Math.random() - 0.5) * 10),
      strain: Math.round(6 + Math.sin(i / 4) * 3 + (Math.random() - 0.5) * 2),
      vo2Max: 38,
    });
  }
  return metrics;
}

export function generateMockWorkouts(): WorkoutEntry[] {
  const workouts: WorkoutEntry[] = [];
  const types = ["Walking", "Strength Session", "Walking", "Gentle Stretching", "Walking", "Walking"];
  for (let i = 13; i >= 0; i--) {
    if (i % 2 === 0) {
      const type = types[i % types.length];
      workouts.push({
        id: `w_${i}`,
        date: generateDateString(i),
        type,
        duration: 20 + Math.round(Math.random() * 20),
        intensity: type === "Strength Session" ? "moderate" : type === "Gentle Stretching" ? "low" : "low",
        caloriesBurned: 100 + Math.round(Math.random() * 150),
      });
    }
  }
  return workouts;
}

export function generateTodayMetrics(): HealthMetrics {
  const all = generateMockMetrics(1);
  return all[0];
}


export function generateTrendData(): TrendData[] {
  return generateTrendDataFromMetrics(generateMockMetrics(28));
}

function computeTrend(values: number[]): "up" | "down" | "stable" {
  if (values.length < 4) return "stable";
  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const change = (avgSecond - avgFirst) / (avgFirst || 1);
  if (change > 0.03) return "up";
  if (change < -0.03) return "down";
  return "stable";
}

function trendSummary(label: string, values: number[], trend: "up" | "down" | "stable", unit: string): string {
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const latest = values[values.length - 1];
  const first = values[0];
  const change = latest - first;

  switch (label) {
    case "Weight": {
      if (Math.abs(change) < 0.5) return `Weight has held steady around ${Math.round(avg)} lbs over the last 4 weeks.`;
      return trend === "down"
        ? `Down ${Math.abs(change).toFixed(1)} lbs over the past 4 weeks. A healthy pace that helps preserve muscle on treatment.`
        : `Up ${Math.abs(change).toFixed(1)} lbs over the past 4 weeks. This can happen early in treatment and often stabilizes as your body adjusts.`;
    }
    case "HRV": {
      if (trend === "up") return `Trending up from ${first} to ${latest} ms. Your body is adapting well and recovery capacity is improving.`;
      if (trend === "down") return `Trending down from ${first} to ${latest} ms. This may reflect accumulated fatigue, stress, or treatment adjustment.`;
      return `Holding steady around ${Math.round(avg)} ms. Consistent recovery patterns support treatment response.`;
    }
    case "Resting HR": {
      if (trend === "down") return `Gradually decreasing to ${latest} bpm. A positive sign for cardiovascular adaptation on treatment.`;
      if (trend === "up") return `Trending higher to ${latest} bpm. Stress, poor sleep, or dehydration may be contributing.`;
      return `Stable around ${Math.round(avg)} bpm. Consistent resting heart rate reflects steady recovery.`;
    }
    case "Sleep": {
      if (avg >= 7.5) return `Averaging ${avg.toFixed(1)} hours. This is in the range that best supports recovery and treatment response.`;
      if (avg < 6.5) return `Averaging ${avg.toFixed(1)} hours. Under 7 hrs makes side effects feel heavier and slows recovery.`;
      return `Averaging ${avg.toFixed(1)} hours. Pushing toward 7.5+ hrs would strengthen recovery and energy.`;
    }
    case "Steps": {
      const avgK = Math.round(avg).toLocaleString();
      if (avg >= 7000) return `Averaging ${avgK} daily. This level of movement supports muscle preservation and digestion on treatment.`;
      if (avg >= 4000) return `Averaging ${avgK} daily. A 10-minute walk after meals could help boost energy and digestion.`;
      return `Averaging ${avgK} daily. Even small increases in daily walking support energy, sleep, and treatment response.`;
    }
    case "Recovery": {
      if (avg >= 70) return `Recovery averaged ${Math.round(avg)}%. Your body is responding well to your current routine and treatment.`;
      if (avg < 50) return `Recovery averaged ${Math.round(avg)}%. Better sleep and hydration are the highest-impact changes right now.`;
      return `Recovery averaged ${Math.round(avg)}%. Consistent sleep and occasional rest days will help push it higher.`;
    }
    default:
      return "";
  }
}

export function generateTrendDataFromMetrics(metrics: HealthMetrics[]): TrendData[] {
  if (!metrics || metrics.length === 0) return [];

  const configs: { label: string; extract: (m: HealthMetrics) => number | null; unit: string }[] = [
    { label: "Weight", extract: (m) => m.weight, unit: "lbs" },
    { label: "HRV", extract: (m) => m.hrv, unit: "ms" },
    { label: "Resting HR", extract: (m) => m.restingHeartRate, unit: "bpm" },
    { label: "Sleep", extract: (m) => m.sleepDuration, unit: "hrs" },
    { label: "Steps", extract: (m) => m.steps, unit: "steps" },
    { label: "Recovery", extract: (m) => m.recoveryScore, unit: "%" },
  ];

  return configs.map(({ label, extract, unit }) => {
    const data = metrics
      .map((m) => ({ date: m.date, value: extract(m) }))
      .filter((d): d is { date: string; value: number } => typeof d.value === "number");
    const values = data.map((d) => d.value);
    const trend = computeTrend(values);
    const summary = trendSummary(label, values, trend, unit);
    return { label, data, unit, trend, summary };
  });
}

export function getMetricDetail(
  key: MetricKey,
  todayMetrics: HealthMetrics,
  allMetrics: HealthMetrics[]
): MetricDetail {
  const trendData = allMetrics
    .map((m) => {
      let value: number | null = 0;
      switch (key) {
        case "sleep": value = m.sleepDuration; break;
        case "hrv": value = m.hrv; break;
        case "steps": value = m.steps; break;
        case "restingHR": value = m.restingHeartRate; break;
        case "recovery": value = m.recoveryScore; break;
        case "weight": value = m.weight; break;
      }
      return { date: m.date, value };
    })
    .filter((d): d is { date: string; value: number } => typeof d.value === "number");

  const recent = trendData.slice(-7);
  const avg = recent.length > 0 ? recent.reduce((s, d) => s + d.value, 0) / recent.length : 0;
  const current = trendData.length > 0 ? trendData[trendData.length - 1].value : 0;
  const trendDir: "up" | "down" | "stable" =
    current > avg * 1.03 ? "up" : current < avg * 0.97 ? "down" : "stable";

  const details: Record<MetricKey, Omit<MetricDetail, "key" | "trend">> = {
    sleep: {
      title: "Sleep",
      headline: todayMetrics.sleepDuration >= 7.5
        ? "You slept well."
        : todayMetrics.sleepDuration >= 6.5
        ? "Sleep was okay."
        : "Sleep was short last night.",
      explanation: `${todayMetrics.sleepDuration.toFixed(1)} hours last night. 7-day average: ${avg.toFixed(1)} hours.`,
      whatItMeans: "Sleep is when your body recovers and adjusts to treatment. Consistent sleep supports energy, appetite regulation, and side effect management.",
      recommendation: todayMetrics.sleepDuration < 7
        ? "Try winding down 30 minutes earlier tonight. Keep the room cool and dark."
        : "Keep this up. Consistent sleep supports your treatment.",
      currentValue: `${todayMetrics.sleepDuration.toFixed(1)}`,
      unit: "hrs",
    },
    hrv: (() => {
      const h = todayMetrics.hrv;
      const hasHrv = typeof h === "number";
      return {
        title: "Heart Rate Variability",
        headline: !hasHrv
          ? "No HRV data yet."
          : h >= 45
          ? "HRV looks good. Recovery is on track."
          : h >= 35
          ? "HRV is slightly below average."
          : "HRV is low. Your body needs more rest.",
        explanation: hasHrv ? `${h} ms today. 7-day average: ${Math.round(avg)} ms.` : `No readings for today. Wear your device overnight to capture HRV.`,
        whatItMeans: "HRV reflects how well-recovered your nervous system is. Higher values mean your body is handling stress well.",
        recommendation: !hasHrv
          ? "Keep your device on overnight for a reading."
          : h < 38
          ? "Take it easy. Focus on hydration, gentle movement, and rest."
          : "HRV supports activity today. Listen to your body.",
        currentValue: hasHrv ? `${h}` : "--",
        unit: "ms",
      };
    })(),
    steps: {
      title: "Daily Steps",
      headline: todayMetrics.steps >= 7000
        ? "Good movement today."
        : todayMetrics.steps >= 4000
        ? "Partway to your movement goal."
        : "Movement has been light today.",
      explanation: `${todayMetrics.steps.toLocaleString()} steps. 7-day average: ${Math.round(avg).toLocaleString()}.`,
      whatItMeans: "Gentle daily movement supports digestion, energy, and treatment effectiveness. Walking after meals can help with nausea.",
      recommendation: todayMetrics.steps < 5000
        ? "A 15-minute walk after your next meal can help with energy and digestion."
        : "On track. Keep moving throughout the day.",
      currentValue: todayMetrics.steps.toLocaleString(),
      unit: "steps",
    },
    restingHR: (() => {
      const r = todayMetrics.restingHeartRate;
      const hasR = typeof r === "number";
      return {
        title: "Resting Heart Rate",
        headline: !hasR
          ? "No resting HR yet."
          : r <= 60
          ? "Resting heart rate is excellent."
          : r <= 68
          ? "Resting heart rate is normal."
          : "Resting heart rate is elevated.",
        explanation: hasR ? `${r} bpm today. 7-day average: ${Math.round(avg)} bpm.` : "No resting HR captured today. This is measured during sleep.",
        whatItMeans: "Resting heart rate reflects overall cardiovascular health and recovery status.",
        recommendation: !hasR
          ? "Wear your device overnight to capture resting HR."
          : r > 66
          ? "Elevated resting HR may mean more recovery or hydration is needed."
          : "In a healthy range. Keep up your routine.",
        currentValue: hasR ? `${r}` : "--",
        unit: "bpm",
      };
    })(),
    recovery: (() => {
      const rec = todayMetrics.recoveryScore;
      const hasRec = typeof rec === "number";
      return {
        title: "Recovery",
        headline: !hasRec
          ? "No recovery score yet."
          : rec >= 75
          ? "Recovery is strong."
          : rec >= 50
          ? "Recovery is moderate."
          : "Recovery is low. Take it easy.",
        explanation: hasRec ? `Recovery is at ${rec}%. Based on HRV, resting heart rate, and sleep quality.` : "Recovery score will appear once HRV and sleep data are available.",
        whatItMeans: "Recovery shows how prepared your body is for activity. On GLP-1, listening to recovery signals helps you stay consistent.",
        recommendation: !hasRec
          ? "Wear your device overnight to capture the inputs for recovery."
          : rec < 50
          ? "Focus on rest, hydration, and protein today. Skip intense activity."
          : "Recovery supports activity today. Match effort to how you feel.",
        currentValue: hasRec ? `${rec}` : "--",
        unit: "%",
      };
    })(),
    weight: {
      title: "Weight",
      headline: trendDir === "down"
        ? "Weight is trending down."
        : trendDir === "up"
        ? "Weight has been trending up."
        : "Weight is stable.",
      explanation: `${todayMetrics.weight} lbs today. 7-day average: ${avg.toFixed(1)} lbs.`,
      whatItMeans: "Weight changes on GLP-1 are expected. Focus on the weekly trend, not daily fluctuations. Preserving muscle matters as much as the number.",
      recommendation: "Weigh yourself at the same time each day. Focus on protein and strength training to preserve muscle.",
      currentValue: `${todayMetrics.weight}`,
      unit: "lbs",
    },
  };

  const detail = details[key];
  return {
    key,
    ...detail,
    trend: {
      label: detail.title,
      data: trendData,
      unit: detail.unit,
      trend: trendDir,
      summary: detail.explanation,
    },
  };
}

export const integrations: IntegrationStatus[] = [
  { id: "apple_health", name: "Apple Health", icon: "heart", connected: false },
];
