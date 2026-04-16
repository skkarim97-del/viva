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

  // Recovery is intentionally omitted from patient-facing trend configs.
  // It is a derived internal score, not a HealthKit metric, and surfacing
  // it as a "%" confused users. Engines still use recoveryScore internally.
  const configs: { label: string; extract: (m: HealthMetrics) => number | null; unit: string }[] = [
    { label: "Weight", extract: (m) => m.weight, unit: "lbs" },
    { label: "HRV", extract: (m) => m.hrv, unit: "ms" },
    { label: "Resting HR", extract: (m) => m.restingHeartRate, unit: "bpm" },
    { label: "Sleep", extract: (m) => m.sleepDuration, unit: "hrs" },
    { label: "Steps", extract: (m) => m.steps, unit: "steps" },
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
        case "weight": value = m.weight; break;
        case "activeCalories": value = m.activeCalories ?? 0; break;
      }
      return { date: m.date, value };
    })
    .filter((d): d is { date: string; value: number } => typeof d.value === "number");

  // 28-day rolling average matches the framing on the Trends tab cards.
  const last28 = trendData.slice(-28);
  const avg28 = last28.length > 0 ? last28.reduce((s, d) => s + d.value, 0) / last28.length : 0;
  // 7-day window for short-term comparison and sleep "last night" interpretation.
  const recent = trendData.slice(-7);
  const avg = recent.length > 0 ? recent.reduce((s, d) => s + d.value, 0) / recent.length : 0;
  const current = trendData.length > 0 ? trendData[trendData.length - 1].value : 0;
  // Trend direction compares the most recent week to the prior 3 weeks so
  // the arrow reflects multi-week movement, not a single-day blip.
  const prior21 = last28.slice(0, Math.max(0, last28.length - 7));
  const prior21Avg = prior21.length > 0 ? prior21.reduce((s, d) => s + d.value, 0) / prior21.length : avg28;
  const recent7Avg = avg;
  const trendDir: "up" | "down" | "stable" =
    prior21Avg === 0
      ? "stable"
      : recent7Avg > prior21Avg * 1.03 ? "up"
      : recent7Avg < prior21Avg * 0.97 ? "down"
      : "stable";

  // Detail pages match the Trends tab framing: the hero number is the
  // 28-day rolling average, with the latest reading shown as a secondary
  // stat. Headlines and recommendations describe the recent multi-week
  // pattern, not a single-day blip.
  const details: Record<MetricKey, Omit<MetricDetail, "key" | "trend">> = {
    sleep: (() => {
      const tonight = todayMetrics.sleepDuration;
      return {
        title: "Sleep",
        headline: avg28 >= 7.5
          ? "Sleep is averaging well over the last 4 weeks."
          : avg28 >= 6.5
          ? "Sleep is in an okay range across the last 4 weeks."
          : "Sleep has been short across the last 4 weeks.",
        explanation: `4-week average: ${avg28.toFixed(1)} hrs. Last 7 days: ${avg.toFixed(1)} hrs. Last night: ${tonight.toFixed(1)} hrs.`,
        whatItMeans: "Sleep is when your body recovers and adjusts to treatment. Consistent sleep supports energy, appetite regulation, and side effect management.",
        recommendation: avg28 < 7
          ? "Aim to add 20 to 30 minutes to your nightly sleep over the next 2 weeks. Keep the room cool and dark and protect a consistent bedtime."
          : "Strong baseline. Keep your wind-down routine consistent through the week.",
        currentValue: `${avg28.toFixed(1)}`,
        unit: "hrs",
        secondaryLabel: "Last night",
        secondaryValue: `${tonight.toFixed(1)} hrs`,
      };
    })(),
    hrv: (() => {
      const h = todayMetrics.hrv;
      const hasHrv = typeof h === "number";
      const avgHrv = Math.round(avg28);
      return {
        title: "Heart Rate Variability",
        headline: avgHrv === 0
          ? "Not enough HRV history yet."
          : avgHrv >= 45
          ? "HRV has been strong over the last 4 weeks."
          : avgHrv >= 35
          ? "HRV is slightly below average over the last 4 weeks."
          : "HRV has been low over the last 4 weeks.",
        explanation: avgHrv === 0
          ? "HRV will appear here once your device captures readings overnight."
          : `4-week average: ${avgHrv} ms. Last 7 days: ${Math.round(avg)} ms.`,
        whatItMeans: "HRV reflects how well-recovered your nervous system is. Higher values mean your body is handling stress well.",
        recommendation: avgHrv === 0
          ? "Keep your device on overnight to begin tracking HRV."
          : avgHrv < 38
          ? "Prioritize hydration, sleep, and gentle movement over the next 2 weeks. Pull back on intense effort on lower-HRV days."
          : "Use HRV as a cue. Train harder on stronger days, ease back when it dips.",
        currentValue: avgHrv === 0 ? "--" : `${avgHrv}`,
        unit: "ms",
        secondaryLabel: "Today",
        secondaryValue: hasHrv ? `${h} ms` : "--",
      };
    })(),
    steps: (() => {
      const today = todayMetrics.steps;
      const avgRounded = Math.round(avg28);
      return {
        title: "Daily Steps",
        headline: avgRounded >= 7000
          ? "Movement has been consistent over the last 4 weeks."
          : avgRounded >= 4000
          ? "Movement is moderate over the last 4 weeks."
          : "Movement has been light over the last 4 weeks.",
        explanation: `4-week average: ${avgRounded.toLocaleString()} steps/day. Last 7 days: ${Math.round(avg).toLocaleString()}.`,
        whatItMeans: "Gentle daily movement supports digestion, energy, and treatment effectiveness. Walking after meals can help with nausea.",
        recommendation: avgRounded < 5000
          ? "Add a 15 to 20 minute walk after one meal each day. Small, repeatable steps compound over weeks on treatment."
          : "Strong movement baseline. Keep walks daily and add a longer one once or twice a week.",
        currentValue: avgRounded.toLocaleString(),
        unit: "/day",
        secondaryLabel: "Today",
        secondaryValue: today.toLocaleString(),
      };
    })(),
    restingHR: (() => {
      const r = todayMetrics.restingHeartRate;
      const hasR = typeof r === "number";
      const avgRHR = Math.round(avg28);
      return {
        title: "Resting Heart Rate",
        headline: avgRHR === 0
          ? "Not enough resting HR data yet."
          : avgRHR <= 60
          ? "Resting heart rate has been excellent over the last 4 weeks."
          : avgRHR <= 68
          ? "Resting heart rate has been in a normal range."
          : "Resting heart rate has been elevated over the last 4 weeks.",
        explanation: avgRHR === 0
          ? "Resting HR is captured during sleep. Wear your device overnight to begin tracking."
          : `4-week average: ${avgRHR} bpm. Last 7 days: ${Math.round(avg)} bpm.`,
        whatItMeans: "Resting heart rate reflects overall cardiovascular health and recovery status.",
        recommendation: avgRHR === 0
          ? "Wear your device overnight to capture resting HR."
          : avgRHR > 66
          ? "Elevated baseline can reflect under-recovery or under-hydration. Focus on sleep, fluids, and easy aerobic movement."
          : "In a healthy range. Keep up your routine.",
        currentValue: avgRHR === 0 ? "--" : `${avgRHR}`,
        unit: "bpm",
        secondaryLabel: "Today",
        secondaryValue: hasR ? `${r} bpm` : "--",
      };
    })(),
    activeCalories: (() => {
      const today = Math.round(todayMetrics.activeCalories || 0);
      const avgCal = Math.round(avg28);
      return {
        title: "Active Calories",
        headline: avgCal >= 400
          ? "Activity has been strong over the last 4 weeks."
          : avgCal >= 200
          ? "Activity has been moderate over the last 4 weeks."
          : "Activity has been light over the last 4 weeks.",
        explanation: `4-week average: ${avgCal} kcal/day. Last 7 days: ${Math.round(avg)} kcal/day.`,
        whatItMeans: "Active calories reflect movement beyond your resting baseline. Consistent daily activity supports energy, mood, and treatment progress.",
        recommendation: avgCal < 200
          ? "Build the habit by adding one short walk each day. Aim for 200 to 300 active calories on most days."
          : "Solid baseline. Keep movement consistent across the week.",
        currentValue: `${avgCal}`,
        unit: "kcal/day",
        secondaryLabel: "Today",
        secondaryValue: `${today} kcal`,
      };
    })(),
    weight: {
      title: "Weight",
      headline: trendDir === "down"
        ? "Weight is trending down over the last 4 weeks."
        : trendDir === "up"
        ? "Weight has been trending up over the last 4 weeks."
        : "Weight has been stable over the last 4 weeks.",
      explanation: `4-week average: ${avg28.toFixed(1)} lbs. Last 7 days: ${avg.toFixed(1)} lbs.`,
      whatItMeans: "Weight changes on GLP-1 are expected. Focus on the weekly trend, not daily fluctuations. Preserving muscle matters as much as the number.",
      recommendation: "Weigh yourself at the same time each day. Focus on protein and strength training to preserve muscle.",
      currentValue: `${avg28.toFixed(1)}`,
      unit: "lbs",
      secondaryLabel: "Today",
      secondaryValue: `${todayMetrics.weight} lbs`,
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
