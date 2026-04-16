import type { HealthMetrics, MedicationProfile, MedicationLogEntry, CompletionRecord } from "@/types";
import { buildTitrationContext, type TitrationContext } from "./titrationHelper";

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
  adaptiveWeekNote?: string | null;
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

function pairwiseNonNull(a: (number | null | undefined)[], b: (number | null | undefined)[]): { a: number[]; b: number[] } {
  const resA: number[] = [];
  const resB: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (typeof a[i] === "number" && typeof b[i] === "number") {
      resA.push(a[i] as number);
      resB.push(b[i] as number);
    }
  }
  return { a: resA, b: resB };
}

export function buildCorrelations(metrics: HealthMetrics[]): TrendCorrelation[] {
  if (metrics.length < 5) return [];
  const recent = metrics.slice(-14);
  const sleep = recent.map(m => m.sleepDuration);
  const hrvRaw = recent.map(m => m.hrv);
  const recoveryRaw = recent.map(m => m.recoveryScore);
  const steps = recent.map(m => m.steps);
  const rhrRaw = recent.map(m => m.restingHeartRate);

  const correlations: TrendCorrelation[] = [];

  const sleepHrvPair = pairwiseNonNull(sleep, hrvRaw);
  const sleepHrv = computeCorrelation(sleepHrvPair.a, sleepHrvPair.b);
  const sleepHrvStrength = getCorrelationStrength(sleepHrv);
  if (sleepHrvStrength !== "weak" && sleepHrvPair.a.length > 0) {
    const avgSleep = +(sleepHrvPair.a.reduce((s, v) => s + v, 0) / sleepHrvPair.a.length).toFixed(1);
    const avgHrv = Math.round(sleepHrvPair.b.reduce((s, v) => s + v, 0) / sleepHrvPair.b.length);
    correlations.push({
      title: "Sleep vs HRV",
      icon: "moon",
      color: "#AF52DE",
      strength: sleepHrvStrength,
      direction: sleepHrv > 0 ? "positive" : "negative",
      insight: sleepHrv > 0
        ? `More sleep drives higher HRV in your data. At ${avgSleep} hrs average, your HRV averages ${avgHrv} ms. Aiming for 7.5+ hrs could push it higher.`
        : `Your HRV tends to drop on longer-sleep nights, which may indicate restless or fragmented sleep despite more time in bed.`,
    });
  }

  const sleepRecPair = pairwiseNonNull(sleep, recoveryRaw);
  const sleepRecovery = computeCorrelation(sleepRecPair.a, sleepRecPair.b);
  const sleepRecStrength = getCorrelationStrength(sleepRecovery);
  if (sleepRecStrength !== "weak") {
    correlations.push({
      title: "Sleep vs Recovery",
      icon: "battery-charging",
      color: "#34C759",
      strength: sleepRecStrength,
      direction: sleepRecovery > 0 ? "positive" : "negative",
      insight: sleepRecovery > 0
        ? `Better sleep consistently drives higher recovery in your data. Sleep is one of your strongest levers for next-day energy and treatment response.`
        : `Recovery tends to drop on longer-sleep nights. This may reflect lower-quality sleep on nights when your body needs more rest.`,
    });
  }

  const stepsRecPair = pairwiseNonNull(steps, recoveryRaw);
  const stepsRecovery = computeCorrelation(stepsRecPair.a, stepsRecPair.b);
  const stepsRecStrength = getCorrelationStrength(stepsRecovery);
  if (stepsRecStrength !== "weak" && stepsRecPair.a.length > 0) {
    const avgSteps = Math.round(stepsRecPair.a.reduce((s, v) => s + v, 0) / stepsRecPair.a.length);
    correlations.push({
      title: "Activity vs Recovery",
      icon: "activity",
      color: "#142240",
      strength: stepsRecStrength,
      direction: stepsRecovery > 0 ? "positive" : "negative",
      insight: stepsRecovery > 0
        ? `Higher activity days correlate with better recovery the next day. At ${avgSteps.toLocaleString()} average steps, your body responds well to movement.`
        : `Days above ${avgSteps.toLocaleString()} steps correlate with lower next-day recovery. Spacing intense days with rest may help.`,
    });
  }

  const rhrRecPair = pairwiseNonNull(rhrRaw, recoveryRaw);
  const rhrRecovery = computeCorrelation(rhrRecPair.a, rhrRecPair.b);
  const rhrRecStrength = getCorrelationStrength(rhrRecovery);
  if (rhrRecStrength !== "weak") {
    correlations.push({
      title: "Resting HR vs Recovery",
      icon: "heart",
      color: "#FF6B6B",
      strength: rhrRecStrength,
      direction: rhrRecovery > 0 ? "positive" : "negative",
      insight: rhrRecovery < 0
        ? `Lower resting heart rate correlates with better recovery in your data. A declining RHR over time is a positive sign of cardiovascular adaptation on treatment.`
        : `Your resting heart rate rises on higher-recovery days. This may reflect your body working harder to bounce back after intense days.`,
    });
  }

  if (correlations.length === 0) {
    correlations.push({
      title: "Sleep vs Recovery",
      icon: "battery-charging",
      color: "#34C759",
      strength: "moderate",
      direction: "positive",
      insight: "Not enough data to detect strong patterns yet. Keep logging daily and correlations will appear within 1-2 weeks.",
    });
  }

  return correlations;
}

export function detectPatterns(metrics: HealthMetrics[], availableMetricTypes: string[] = []): string[] {
  if (metrics.length < 7) return [];
  const recent = metrics.slice(-7);
  const patterns: string[] = [];
  const hasSleep = availableMetricTypes.includes("sleep");
  const hasHrv = availableMetricTypes.includes("hrv");
  const hasRecovery = availableMetricTypes.includes("recovery");
  const hasSteps = availableMetricTypes.includes("steps");

  if (hasSleep) {
    const avgSleep = recent.reduce((s, m) => s + m.sleepDuration, 0) / recent.length;
    const sleepTrend = recent[recent.length - 1].sleepDuration - recent[0].sleepDuration;
    if (Math.abs(sleepTrend) > 0.5) {
      patterns.push(
        sleepTrend > 0
          ? `Sleep is trending up this week. You averaged ${avgSleep.toFixed(1)} hrs, up from ${recent[0].sleepDuration.toFixed(1)} hrs.`
          : `Sleep has been declining this week. You dropped from ${recent[0].sleepDuration.toFixed(1)} hrs to ${recent[recent.length - 1].sleepDuration.toFixed(1)} hrs.`
      );
    }
  }

  if (hasHrv) {
    const hrvVals = recent.map(m => m.hrv).filter((v): v is number => typeof v === "number");
    if (hrvVals.length >= 3) {
      const avgHrv = hrvVals.reduce((s, v) => s + v, 0) / hrvVals.length;
      const hrvStdDev = Math.sqrt(hrvVals.reduce((s, v) => s + Math.pow(v - avgHrv, 2), 0) / hrvVals.length);
      if (hrvStdDev > 12) {
        patterns.push(`HRV variability is high (${hrvStdDev.toFixed(0)} ms std dev). Inconsistent sleep timing or elevated stress may be the driver.`);
      } else if (hrvStdDev < 5 && avgHrv > 0) {
        patterns.push(`HRV is very stable at ${Math.round(avgHrv)} ms. Your recovery rhythm is consistent, which supports treatment response.`);
      }
    }
  }

  if (hasRecovery) {
    const lowRecoveryDays = recent.filter(m => typeof m.recoveryScore === "number" && m.recoveryScore < 60).length;
    if (lowRecoveryDays >= 3) {
      patterns.push(`${lowRecoveryDays} of the last 7 days had recovery below 60%. Prioritize sleep and hydration. On treatment, low recovery compounds faster.`);
    }
  }

  if (hasSteps) {
    const highStepDays = recent.filter(m => m.steps > 10000).length;
    if (highStepDays >= 5) {
      patterns.push(`You hit 10,000+ steps on ${highStepDays} of 7 days. This level of daily movement is one of the best ways to preserve muscle on treatment.`);
    }
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
      if (typeof m.recoveryScore !== "number") continue;
      if (closestDoseDist <= 2) nearDoseRecovery.push(m.recoveryScore);
      else farDoseRecovery.push(m.recoveryScore);
    }
    if (nearDoseRecovery.length >= 2 && farDoseRecovery.length >= 2) {
      const avgNear = nearDoseRecovery.reduce((s, v) => s + v, 0) / nearDoseRecovery.length;
      const avgFar = farDoseRecovery.reduce((s, v) => s + v, 0) / farDoseRecovery.length;
      if (avgFar - avgNear > 5) {
        insights.push({
          text: `Recovery dips by ${Math.round(avgFar - avgNear)}% in the 1-2 days after your dose, then rebounds. This is a common pattern on ${medicationProfile.medicationBrand}. Plan lighter days around dose day.`,
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
          text: `Activity drops by about ${Math.round(avgFar - avgNear).toLocaleString()} steps around dose day. Planning lighter movement on dose day and the day after can help.`,
          icon: "activity",
          color: "#FF9500",
        });
      }
    }
  }

  // Gate any recovery-score correlation on actual availability. recoveryScore is not yet derived,
  // so without real samples these blocks would emit misleading "no change" conclusions.
  const recoverySamples14 = recent14.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const hasRecoveryTrend = recoverySamples14.length >= 6;
  const recoverySamples7 = recent7.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const hasRecoveryWeek = recoverySamples7.length >= 4;

  const titration = buildTitrationContext(medicationProfile);
  if (titration.isWithinTitrationWindow && recent14.length >= 5) {
    const daysSince = titration.daysSinceDoseChange ?? 0;
    if (daysSince <= 3) {
      insights.push({
        text: `Your dose changed ${daysSince === 0 ? "today" : daysSince === 1 ? "yesterday" : `${daysSince} days ago`}. Side effects often peak in the first few days. Give your body time to adjust.`,
        icon: "clock",
        color: "#FF9500",
      });
    }

    const firstHalf = recent14.slice(0, Math.floor(recent14.length / 2));
    const secondHalf = recent14.slice(Math.floor(recent14.length / 2));
    const firstRec = firstHalf.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
    const secondRec = secondHalf.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
    if (hasRecoveryTrend && firstRec.length >= 2 && secondRec.length >= 2) {
      const avgRecFirst = firstRec.reduce((s, v) => s + v, 0) / firstRec.length;
      const avgRecSecond = secondRec.reduce((s, v) => s + v, 0) / secondRec.length;
      if (avgRecFirst - avgRecSecond > 5) {
        insights.push({
          text: `Recovery appears to have dipped since your recent dose increase. This may be related to the adjustment period and usually stabilizes within 1-2 weeks.`,
          icon: "battery-charging",
          color: "#FF6B6B",
        });
      } else if (avgRecSecond >= avgRecFirst) {
        insights.push({
          text: `Recovery has held steady since your dose change. Your body appears to be adjusting well to the new level.`,
          icon: "battery-charging",
          color: "#34C759",
        });
      }
    }

    const avgSleepRecent = recent7.reduce((s, m) => s + m.sleepDuration, 0) / recent7.length;
    if (avgSleepRecent < 6.5) {
      insights.push({
        text: `Sleep has been shorter recently. This may line up with your dose change. Prioritizing rest during the adjustment window can help.`,
        icon: "moon",
        color: "#AF52DE",
      });
    }
  } else if (medicationProfile.recentTitration && recent14.length >= 10 && hasRecoveryTrend) {
    const firstHalf = recent14.slice(0, 7);
    const secondHalf = recent14.slice(7);
    const firstRec = firstHalf.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
    const secondRec = secondHalf.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
    if (firstRec.length < 3 || secondRec.length < 3) { /* insufficient samples */ }
    else {
    const avgRecFirst = firstRec.reduce((s, v) => s + v, 0) / firstRec.length;
    const avgRecSecond = secondRec.reduce((s, v) => s + v, 0) / secondRec.length;
    if (avgRecFirst - avgRecSecond > 5) {
      insights.push({
        text: `Recovery dropped by ${Math.round(avgRecFirst - avgRecSecond)}% since your recent dose increase. This usually stabilizes within 1-2 weeks as your body adjusts.`,
        icon: "battery-charging",
        color: "#FF6B6B",
      });
    } else if (avgRecSecond >= avgRecFirst) {
      insights.push({
        text: `Recovery has held steady since your dose change. Your body appears to be adjusting well to the new level.`,
        icon: "battery-charging",
        color: "#34C759",
      });
    }
    }
  }

  // Sleep-vs-recovery correlation: require real recovery samples in both buckets.
  const lowSleepDays = recent7.filter(m => m.sleepDuration < 6.5);
  const goodSleepDays = recent7.filter(m => m.sleepDuration >= 7);
  const lowSleepRecSamples = lowSleepDays.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const goodSleepRecSamples = goodSleepDays.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const lowSleepRecovery = lowSleepRecSamples.length > 0 ? lowSleepRecSamples.reduce((s, v) => s + v, 0) / lowSleepRecSamples.length : 0;
  const goodSleepRecovery = goodSleepRecSamples.length > 0 ? goodSleepRecSamples.reduce((s, v) => s + v, 0) / goodSleepRecSamples.length : 0;
  if (hasRecoveryWeek && lowSleepRecSamples.length >= 2 && goodSleepRecSamples.length >= 2 && goodSleepRecovery - lowSleepRecovery > 8) {
    insights.push({
      text: `Nights under 6.5 hrs drop your recovery by ${Math.round(goodSleepRecovery - lowSleepRecovery)}% compared to 7+ hr nights. On treatment, sleep is one of your strongest levers.`,
      icon: "moon",
      color: "#AF52DE",
    });
  }

  const completionMap = new Map<string, number>();
  for (const cr of completionHistory) {
    completionMap.set(cr.date.slice(0, 10), cr.completionRate);
  }
  if (hasRecoveryWeek && completionHistory.length >= 5 && recent7.length >= 5) {
    const highCompNextDayRecovery: number[] = [];
    const lowCompNextDayRecovery: number[] = [];
    for (let i = 0; i < recent7.length - 1; i++) {
      const todayRate = completionMap.get(recent7[i].date.slice(0, 10));
      if (todayRate === undefined) continue;
      const nextDayRecovery = recent7[i + 1].recoveryScore;
      if (typeof nextDayRecovery !== "number") continue;
      if (todayRate >= 80) highCompNextDayRecovery.push(nextDayRecovery);
      else if (todayRate < 50) lowCompNextDayRecovery.push(nextDayRecovery);
    }
    if (highCompNextDayRecovery.length >= 2 && lowCompNextDayRecovery.length >= 1) {
      const avgHigh = highCompNextDayRecovery.reduce((s, v) => s + v, 0) / highCompNextDayRecovery.length;
      const avgLow = lowCompNextDayRecovery.reduce((s, v) => s + v, 0) / lowCompNextDayRecovery.length;
      if (avgHigh - avgLow > 5) {
        insights.push({
          text: `Days when you complete 80%+ of your plan correlate with ${Math.round(avgHigh - avgLow)}% higher next-day recovery. Consistency directly supports your body during treatment.`,
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
          text: `Days with 7,000+ steps correlate with ${(highStepSleep - lowStepSleep).toFixed(1)} hrs more sleep. Gentle daily movement helps your body settle into better rest patterns on treatment.`,
          icon: "sunrise",
          color: "#5AC8FA",
        });
      }
    }
  }

  return insights.slice(0, 5);
}

export function buildKeyInsights(
  metrics: HealthMetrics[],
  habitStats: { weeklyPercent: number; streakDays: number; todayCompleted: number; todayTotal: number; topHabit: string | null; topHabitPercent: number },
  availableMetricTypes: string[] = []
): string[] {
  const insights: string[] = [];
  if (metrics.length < 3) return insights;
  const recent = metrics.slice(-7);

  const hasSleep = availableMetricTypes.includes("sleep");
  const hasRecovery = availableMetricTypes.includes("recovery");
  const hasSteps = availableMetricTypes.includes("steps");

  const sleepVals = recent.map(m => m.sleepDuration).filter((v): v is number => typeof v === "number");
  const recoveryVals = recent.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const stepsVals = recent.map(m => m.steps).filter((v): v is number => typeof v === "number");
  const avgSleep = sleepVals.length ? sleepVals.reduce((s, v) => s + v, 0) / sleepVals.length : 0;
  const avgRecovery = recoveryVals.length ? Math.round(recoveryVals.reduce((s, v) => s + v, 0) / recoveryVals.length) : 0;
  const avgSteps = stepsVals.length ? Math.round(stepsVals.reduce((s, v) => s + v, 0) / stepsVals.length) : 0;

  if (habitStats.todayCompleted > 0) {
    insights.push(`${habitStats.todayCompleted} of ${habitStats.todayTotal} actions done today.`);
  }

  if (habitStats.weeklyPercent > 0 && habitStats.weeklyPercent < 50) {
    insights.push(`Plan completion is at ${habitStats.weeklyPercent}% this week. Even completing 2-3 actions daily builds momentum on treatment.`);
  } else if (habitStats.weeklyPercent >= 80) {
    insights.push(`Plan completion is strong at ${habitStats.weeklyPercent}% this week. This level of consistency supports treatment results.`);
  }

  if (habitStats.streakDays >= 3) {
    insights.push(`${habitStats.streakDays}-day streak. Consistency compounds. Each day builds on the last.`);
  } else if (habitStats.streakDays === 0 && habitStats.weeklyPercent > 0) {
    insights.push(`Streak was broken. Today is a fresh start. One completed action gets you back on track.`);
  }

  if (hasSleep) {
    if (avgSleep < 6.5) {
      insights.push(`Sleep averaged ${avgSleep.toFixed(1)} hrs this week. Under 7 hrs makes side effects feel heavier and recovery slower.`);
    } else if (avgSleep >= 7.5) {
      insights.push(`Sleep averaged ${avgSleep.toFixed(1)} hrs this week. This is a strong foundation for recovery and treatment response.`);
    }
  }

  if (hasRecovery) {
    if (avgRecovery < 55) {
      insights.push(`Recovery averaged ${avgRecovery}% this week. Prioritize sleep, hydration, and lighter activity days.`);
    } else if (avgRecovery >= 75) {
      insights.push(`Recovery averaged ${avgRecovery}% this week. Your body is handling treatment well.`);
    }
  }

  if (hasSteps) {
    if (avgSteps >= 10000) {
      insights.push(`Averaging ${avgSteps.toLocaleString()} daily steps. This level of movement is excellent for muscle preservation on treatment.`);
    } else if (avgSteps < 5000) {
      insights.push(`Steps averaged ${avgSteps.toLocaleString()} this week. A 10-minute walk after meals can boost digestion and energy.`);
    }
  }

  return insights.slice(0, 5);
}

export function weeklyAverages(daily: (number | null | undefined)[], weeks: number = 4): number[] {
  const result: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = daily.length - (weeks - w) * 7;
    const end = start + 7;
    const slice = daily.slice(Math.max(0, start), Math.max(0, end))
      .filter((v): v is number => typeof v === "number");
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
  adaptiveWeekNote?: string | null,
): TrendsViewOutput {
  return {
    correlations: buildCorrelations(metrics),
    patterns: detectPatterns(metrics, []),
    keyInsights: buildKeyInsights(metrics, habitStats, []),
    glp1Insights: buildGLP1Insights(metrics, medicationProfile, medicationLog, completionHistory),
    sparkData: {
      sleepWeekly: weeklyAverages(metrics.map(m => m.sleepDuration)),
      hrvWeekly: weeklyAverages(metrics.map(m => m.hrv)),
      stepsWeekly: weeklyAverages(metrics.map(m => m.steps)),
      recoveryWeekly: weeklyAverages(metrics.map(m => m.recoveryScore)),
      consistencyWeekly: computeHabitWeeklyRates(completionHistory),
    },
    adaptiveWeekNote: adaptiveWeekNote ?? null,
  };
}
