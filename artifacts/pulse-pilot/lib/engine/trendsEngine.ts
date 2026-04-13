import type { HealthMetrics, MedicationProfile, MedicationLogEntry, CompletionRecord } from "@/types";

export interface TrendCorrelation {
  title: string;
  icon: string;
  color: string;
  strength: "strong" | "moderate" | "weak";
  insight: string;
  direction: "positive" | "negative" | "neutral";
}

export interface GLP1Insight {
  text: string;
  icon: string;
  color: string;
}

export interface TrendsViewOutput {
  correlations: TrendCorrelation[];
  patterns: string[];
  keyInsights: string[];
  glp1Insights: GLP1Insight[];
  sparkData: {
    sleepWeekly: number[];
    hrvWeekly: number[];
    stepsWeekly: number[];
    recoveryWeekly: number[];
    consistencyWeekly: number[];
  };
}

export function computeCorrelation(a: number[], b: number[]): number {
  if (a.length < 3 || a.length !== b.length) return 0;
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

export function getCorrelationStrength(r: number): "strong" | "moderate" | "weak" {
  const abs = Math.abs(r);
  if (abs >= 0.6) return "strong";
  if (abs >= 0.3) return "moderate";
  return "weak";
}

export function buildCorrelations(metrics: HealthMetrics[]): TrendCorrelation[] {
  if (metrics.length < 5) return [];
  const recent = metrics.slice(-14);
  const sleep = recent.map(m => m.sleepDuration);
  const hrv = recent.map(m => m.hrv);
  const recovery = recent.map(m => m.recoveryScore);
  const steps = recent.map(m => m.steps);
  const rhr = recent.map(m => m.restingHeartRate);

  const correlations: TrendCorrelation[] = [];

  const sleepHrv = computeCorrelation(sleep, hrv);
  const sleepHrvStrength = getCorrelationStrength(sleepHrv);
  if (sleepHrvStrength !== "weak") {
    const avgSleep = +(sleep.reduce((s, v) => s + v, 0) / sleep.length).toFixed(1);
    const avgHrv = Math.round(hrv.reduce((s, v) => s + v, 0) / hrv.length);
    correlations.push({
      title: "Sleep vs HRV",
      icon: "moon",
      color: "#AF52DE",
      strength: sleepHrvStrength,
      direction: sleepHrv > 0 ? "positive" : "negative",
      insight: sleepHrv > 0
        ? `More sleep is linked to higher HRV in your data. Your average ${avgSleep} hrs of sleep correlates with an HRV of ${avgHrv} ms.`
        : `Your HRV tends to drop when you sleep more, which may indicate restless or low-quality sleep despite longer duration.`,
    });
  }

  const sleepRecovery = computeCorrelation(sleep, recovery);
  const sleepRecStrength = getCorrelationStrength(sleepRecovery);
  if (sleepRecStrength !== "weak") {
    correlations.push({
      title: "Sleep vs Recovery",
      icon: "battery-charging",
      color: "#34C759",
      strength: sleepRecStrength,
      direction: sleepRecovery > 0 ? "positive" : "negative",
      insight: sleepRecovery > 0
        ? `Better sleep consistently drives higher recovery. This is one of your strongest levers for feeling good the next day.`
        : `Recovery tends to drop when you sleep longer, possibly due to oversleeping on lower-quality nights.`,
    });
  }

  const stepsRecovery = computeCorrelation(steps, recovery);
  const stepsRecStrength = getCorrelationStrength(stepsRecovery);
  if (stepsRecStrength !== "weak") {
    const avgSteps = Math.round(steps.reduce((s, v) => s + v, 0) / steps.length);
    correlations.push({
      title: "Activity vs Recovery",
      icon: "activity",
      color: "#142240",
      strength: stepsRecStrength,
      direction: stepsRecovery > 0 ? "positive" : "negative",
      insight: stepsRecovery > 0
        ? `Higher activity days lead to better recovery the next day. Your average ${avgSteps.toLocaleString()} steps supports this pattern.`
        : `High-activity days (${avgSteps.toLocaleString()}+ steps) are followed by lower recovery. Consider spacing intense days with rest.`,
    });
  }

  const rhrRecovery = computeCorrelation(rhr, recovery);
  const rhrRecStrength = getCorrelationStrength(rhrRecovery);
  if (rhrRecStrength !== "weak") {
    correlations.push({
      title: "Resting HR vs Recovery",
      icon: "heart",
      color: "#FF6B6B",
      strength: rhrRecStrength,
      direction: rhrRecovery > 0 ? "positive" : "negative",
      insight: rhrRecovery < 0
        ? `Lower resting heart rate correlates with better recovery. This is a sign your body is adapting well to treatment.`
        : `Your resting heart rate rises with recovery, which may reflect your body working harder to bounce back on certain days.`,
    });
  }

  if (correlations.length === 0) {
    correlations.push({
      title: "Sleep vs Recovery",
      icon: "battery-charging",
      color: "#34C759",
      strength: "moderate",
      direction: "positive",
      insight: "More data is needed to detect strong patterns. Keep logging for clearer insights.",
    });
  }

  return correlations;
}

export function detectPatterns(metrics: HealthMetrics[]): string[] {
  if (metrics.length < 7) return [];
  const recent = metrics.slice(-7);
  const patterns: string[] = [];

  const avgSleep = recent.reduce((s, m) => s + m.sleepDuration, 0) / recent.length;
  const sleepTrend = recent[recent.length - 1].sleepDuration - recent[0].sleepDuration;
  if (Math.abs(sleepTrend) > 0.5) {
    patterns.push(
      sleepTrend > 0
        ? `Sleep is trending up this week. You averaged ${avgSleep.toFixed(1)} hrs, up from ${recent[0].sleepDuration.toFixed(1)} hrs.`
        : `Sleep has been declining this week. You dropped from ${recent[0].sleepDuration.toFixed(1)} hrs to ${recent[recent.length - 1].sleepDuration.toFixed(1)} hrs.`
    );
  }

  const avgHrv = recent.reduce((s, m) => s + m.hrv, 0) / recent.length;
  const hrvStdDev = Math.sqrt(recent.reduce((s, m) => s + Math.pow(m.hrv - avgHrv, 2), 0) / recent.length);
  if (hrvStdDev > 12) {
    patterns.push(`HRV is highly variable (std dev ${hrvStdDev.toFixed(0)} ms). Inconsistent sleep or stress may be driving this.`);
  } else if (hrvStdDev < 5) {
    patterns.push(`HRV is remarkably stable at ${Math.round(avgHrv)} ms. Your recovery rhythm looks consistent.`);
  }

  const lowRecoveryDays = recent.filter(m => m.recoveryScore < 60).length;
  if (lowRecoveryDays >= 3) {
    patterns.push(`${lowRecoveryDays} of the last 7 days had recovery below 60%. Rest and hydration are extra important on treatment.`);
  }

  const highStepDays = recent.filter(m => m.steps > 10000).length;
  if (highStepDays >= 5) {
    patterns.push(`You hit 10,000+ steps on ${highStepDays} of 7 days. Great for preserving muscle during treatment.`);
  }

  return patterns;
}

export function buildGLP1Insights(
  metrics: HealthMetrics[],
  medicationProfile: MedicationProfile | undefined,
  medicationLog: MedicationLogEntry[],
  completionHistory: CompletionRecord[],
): GLP1Insight[] {
  const insights: GLP1Insight[] = [];
  if (!medicationProfile) return insights;

  const recent14 = metrics.slice(-14);
  const recent7 = metrics.slice(-7);
  if (recent7.length < 5) return insights;

  const takenDoses = medicationLog.filter(e => e.status === "taken").sort((a, b) => a.date.localeCompare(b.date));

  if (takenDoses.length >= 2 && medicationProfile.frequency === "weekly") {
    const doseDates = takenDoses.map(d => d.date);
    let nearDoseRecovery: number[] = [];
    let farDoseRecovery: number[] = [];
    for (const m of recent14) {
      const closestDoseDist = Math.min(...doseDates.map(dd => Math.abs(Math.floor((new Date(m.date).getTime() - new Date(dd).getTime()) / 86400000))));
      if (closestDoseDist <= 2) nearDoseRecovery.push(m.recoveryScore);
      else farDoseRecovery.push(m.recoveryScore);
    }
    if (nearDoseRecovery.length >= 2 && farDoseRecovery.length >= 2) {
      const avgNear = nearDoseRecovery.reduce((s, v) => s + v, 0) / nearDoseRecovery.length;
      const avgFar = farDoseRecovery.reduce((s, v) => s + v, 0) / farDoseRecovery.length;
      if (avgFar - avgNear > 5) {
        insights.push({
          text: `Recovery tends to dip in the 1-2 days after dose day, then improves. This is a common pattern on ${medicationProfile.medicationBrand}.`,
          icon: "trending-down",
          color: "#AF52DE",
        });
      }
    }
  }

  if (takenDoses.length >= 2 && medicationProfile.frequency === "weekly") {
    const doseDates = takenDoses.map(d => d.date);
    let nearDoseSteps: number[] = [];
    let farDoseSteps: number[] = [];
    for (const m of recent14) {
      const closestDist = Math.min(...doseDates.map(dd => Math.abs(Math.floor((new Date(m.date).getTime() - new Date(dd).getTime()) / 86400000))));
      if (closestDist <= 1) nearDoseSteps.push(m.steps);
      else farDoseSteps.push(m.steps);
    }
    if (nearDoseSteps.length >= 2 && farDoseSteps.length >= 2) {
      const avgNear = nearDoseSteps.reduce((s, v) => s + v, 0) / nearDoseSteps.length;
      const avgFar = farDoseSteps.reduce((s, v) => s + v, 0) / farDoseSteps.length;
      if (avgFar - avgNear > 1500) {
        insights.push({
          text: `Activity tends to dip on dose day and the day after. Lighter movement around dose day may help you feel better.`,
          icon: "activity",
          color: "#FF9500",
        });
      }
    }
  }

  if (medicationProfile.recentTitration && recent14.length >= 10) {
    const firstHalf = recent14.slice(0, 7);
    const secondHalf = recent14.slice(7);
    const avgRecFirst = firstHalf.reduce((s, m) => s + m.recoveryScore, 0) / firstHalf.length;
    const avgRecSecond = secondHalf.reduce((s, m) => s + m.recoveryScore, 0) / secondHalf.length;
    if (avgRecFirst - avgRecSecond > 5) {
      insights.push({
        text: `Recovery has been lower since your recent dose increase. This usually stabilizes within 1-2 weeks as your body adjusts.`,
        icon: "battery-charging",
        color: "#FF6B6B",
      });
    } else if (avgRecSecond >= avgRecFirst) {
      insights.push({
        text: `Recovery has stayed steady since your dose change. Your body appears to be adjusting well.`,
        icon: "battery-charging",
        color: "#34C759",
      });
    }
  }

  const recent7Sleep = recent7.reduce((s, m) => s + m.sleepDuration, 0) / recent7.length;
  const lowSleepDays = recent7.filter(m => m.sleepDuration < 6.5);
  const lowSleepRecovery = lowSleepDays.length > 0 ? lowSleepDays.reduce((s, m) => s + m.recoveryScore, 0) / lowSleepDays.length : 0;
  const goodSleepDays = recent7.filter(m => m.sleepDuration >= 7);
  const goodSleepRecovery = goodSleepDays.length > 0 ? goodSleepDays.reduce((s, m) => s + m.recoveryScore, 0) / goodSleepDays.length : 0;
  if (lowSleepDays.length >= 2 && goodSleepDays.length >= 2 && goodSleepRecovery - lowSleepRecovery > 8) {
    insights.push({
      text: `Short sleep nights lead to noticeably lower recovery. On treatment, sleep is one of your strongest levers.`,
      icon: "moon",
      color: "#AF52DE",
    });
  }

  const completionMap = new Map<string, number>();
  for (const cr of completionHistory) {
    completionMap.set(cr.date.slice(0, 10), cr.completionRate);
  }
  if (completionHistory.length >= 5 && recent7.length >= 5) {
    const highCompNextDayRecovery: number[] = [];
    const lowCompNextDayRecovery: number[] = [];
    for (let i = 0; i < recent7.length - 1; i++) {
      const todayRate = completionMap.get(recent7[i].date.slice(0, 10));
      if (todayRate === undefined) continue;
      const nextDayRecovery = recent7[i + 1].recoveryScore;
      if (todayRate >= 80) highCompNextDayRecovery.push(nextDayRecovery);
      else if (todayRate < 50) lowCompNextDayRecovery.push(nextDayRecovery);
    }
    if (highCompNextDayRecovery.length >= 2 && lowCompNextDayRecovery.length >= 1) {
      const avgHigh = highCompNextDayRecovery.reduce((s, v) => s + v, 0) / highCompNextDayRecovery.length;
      const avgLow = lowCompNextDayRecovery.reduce((s, v) => s + v, 0) / lowCompNextDayRecovery.length;
      if (avgHigh - avgLow > 5) {
        insights.push({
          text: `Days when you complete more of your plan tend to be followed by better recovery. Consistency supports your body during treatment.`,
          icon: "check-circle",
          color: "#34C759",
        });
      }
    }
  }

  if (recent7.length >= 5) {
    const highStepDays = recent7.filter(m => m.steps >= 7000);
    const lowStepDays = recent7.filter(m => m.steps < 5000);
    if (highStepDays.length >= 2 && lowStepDays.length >= 2) {
      const highStepSleep = highStepDays.reduce((s, m) => s + m.sleepDuration, 0) / highStepDays.length;
      const lowStepSleep = lowStepDays.reduce((s, m) => s + m.sleepDuration, 0) / lowStepDays.length;
      if (highStepSleep - lowStepSleep > 0.3) {
        insights.push({
          text: `More active days are followed by better sleep. Gentle movement helps your body settle into better rest patterns on treatment.`,
          icon: "sunrise",
          color: "#5AC8FA",
        });
      }
    }
  }

  return insights.slice(0, 5);
}

export function buildKeyInsights(metrics: HealthMetrics[], habitStats: { weeklyPercent: number; streakDays: number; todayCompleted: number; todayTotal: number; topHabit: string | null; topHabitPercent: number }): string[] {
  const insights: string[] = [];
  if (metrics.length < 3) return insights;
  const recent = metrics.slice(-7);

  const avgSleep = recent.reduce((s, m) => s + m.sleepDuration, 0) / recent.length;
  const avgRecovery = Math.round(recent.reduce((s, m) => s + m.recoveryScore, 0) / recent.length);
  const avgSteps = Math.round(recent.reduce((s, m) => s + m.steps, 0) / recent.length);

  if (habitStats.todayCompleted > 0) {
    insights.push(`You completed ${habitStats.todayCompleted} of ${habitStats.todayTotal} actions today.`);
  }

  if (habitStats.weeklyPercent > 0 && habitStats.weeklyPercent < 50) {
    insights.push(`Consistency is at ${habitStats.weeklyPercent}% this week. Every small step matters on treatment.`);
  } else if (habitStats.weeklyPercent >= 80) {
    insights.push(`Consistency is excellent at ${habitStats.weeklyPercent}% this week. This supports your treatment.`);
  }

  if (habitStats.streakDays >= 3) {
    insights.push(`You are on a ${habitStats.streakDays}-day streak. Consistency is key during treatment.`);
  } else if (habitStats.streakDays === 0 && habitStats.weeklyPercent > 0) {
    insights.push(`Your streak was broken. Today is a fresh start.`);
  }

  if (avgSleep < 6.5) {
    insights.push(`Sleep averaged ${avgSleep.toFixed(1)} hrs this week. Better sleep helps manage side effects.`);
  } else if (avgSleep >= 7.5) {
    insights.push(`Sleep averaged ${avgSleep.toFixed(1)} hrs. Strong foundation for recovery on treatment.`);
  }

  if (avgRecovery < 55) {
    insights.push(`Recovery has been low at ${avgRecovery}%. Prioritize rest and hydration.`);
  } else if (avgRecovery >= 75) {
    insights.push(`Recovery is solid at ${avgRecovery}%. Your body is handling treatment well.`);
  }

  if (avgSteps >= 10000) {
    insights.push(`Averaging ${avgSteps.toLocaleString()} steps. Great for muscle preservation.`);
  } else if (avgSteps < 5000) {
    insights.push(`Steps averaged ${avgSteps.toLocaleString()} this week. Gentle walks after meals can help.`);
  }

  return insights.slice(0, 5);
}

export function weeklyAverages(daily: number[], weeks: number = 4): number[] {
  const result: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = daily.length - (weeks - w) * 7;
    const end = start + 7;
    const slice = daily.slice(Math.max(0, start), Math.max(0, end));
    if (slice.length > 0) {
      result.push(slice.reduce((s, v) => s + v, 0) / slice.length);
    }
  }
  return result.length > 0 ? result : [0];
}

export function computeHabitWeeklyRates(history: CompletionRecord[]): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rateMap = new Map<string, number>();
  for (const r of history) {
    rateMap.set(r.date.slice(0, 10), r.completionRate);
  }
  const result: number[] = [];
  for (let w = 0; w < 4; w++) {
    let sum = 0;
    let count = 0;
    for (let d = 0; d < 7; d++) {
      const dayOffset = (3 - w) * 7 + (6 - d);
      const dt = new Date(today);
      dt.setDate(dt.getDate() - dayOffset);
      const key = dt.toISOString().slice(0, 10);
      const rate = rateMap.get(key);
      if (rate !== undefined) {
        sum += rate;
        count++;
      }
    }
    result.push(count > 0 ? Math.round(sum / count) : 0);
  }
  return result;
}

export function generateTrendsView(
  metrics: HealthMetrics[],
  medicationProfile: MedicationProfile | undefined,
  medicationLog: MedicationLogEntry[],
  completionHistory: CompletionRecord[],
  habitStats: { weeklyPercent: number; streakDays: number; todayCompleted: number; todayTotal: number; topHabit: string | null; topHabitPercent: number },
): TrendsViewOutput {
  return {
    correlations: buildCorrelations(metrics),
    patterns: detectPatterns(metrics),
    keyInsights: buildKeyInsights(metrics, habitStats),
    glp1Insights: buildGLP1Insights(metrics, medicationProfile, medicationLog, completionHistory),
    sparkData: {
      sleepWeekly: weeklyAverages(metrics.map(m => m.sleepDuration)),
      hrvWeekly: weeklyAverages(metrics.map(m => m.hrv)),
      stepsWeekly: weeklyAverages(metrics.map(m => m.steps)),
      recoveryWeekly: weeklyAverages(metrics.map(m => m.recoveryScore)),
      consistencyWeekly: computeHabitWeeklyRates(completionHistory),
    },
  };
}
