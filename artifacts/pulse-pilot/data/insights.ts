import type { HealthMetrics, WorkoutEntry, UserProfile, SleepIntelligence, FeelingType, EnergyLevel, StressLevel, HydrationLevel, TrainingIntent, CompletionRecord } from "@/types";

export interface CoachInsightInputs {
  feeling: FeelingType;
  energy: EnergyLevel;
  stress: StressLevel;
  hydration: HydrationLevel;
  trainingIntent: TrainingIntent;
  completionHistory: CompletionRecord[];
}

export interface DailyInsights {
  sleepDebt: { hours: number; label: string; detail: string };
  trainingLoad: { score: number; label: string; detail: string; trend: "rising" | "falling" | "stable" };
  recoveryTrend: { direction: "improving" | "declining" | "stable"; streak: number; detail: string };
  weightProjection: { weeksToGoal: number | null; rate: number; detail: string; onTrack: boolean };
  calorieBalance: { net: number; label: string; detail: string };
  hrvBaseline: { current: number | null; baseline: number; deviation: number; detail: string };
  consistencyScore: { score: number; label: string; detail: string };
  riskFlags: { flags: string[]; severity: "none" | "low" | "medium" | "high" };
  topPriority: string;
  bodyComposition: { estimatedTDEE: number; detail: string };
  weekSummary: string;
  sleepIntelligence: SleepIntelligence;
}

export function computeInsights(
  allMetrics: HealthMetrics[],
  todayMetrics: HealthMetrics,
  workouts: WorkoutEntry[],
  profile: UserProfile,
  completionHistory?: CompletionRecord[]
): DailyInsights {
  const last7 = allMetrics.slice(-7);
  const last14 = allMetrics.slice(-14);
  const last30 = allMetrics.slice(-30);

  const sleepDebt = computeSleepDebt(last7, todayMetrics);
  const trainingLoad = computeTrainingLoad(last14, workouts);
  const recoveryTrend = computeRecoveryTrend(last7);
  const weightProjection = computeWeightProjection(last30, profile);
  const calorieBalance = computeCalorieBalance(last7, todayMetrics);
  const hrvBaseline = computeHRVBaseline(last14, todayMetrics);
  const consistencyScore = computeConsistency(last14, workouts);
  const riskFlags = computeRiskFlags(todayMetrics, last7, sleepDebt, hrvBaseline, trainingLoad);
  const bodyComposition = computeTDEE(todayMetrics, profile);
  const topPriority = determineTopPriority(riskFlags, sleepDebt, recoveryTrend, trainingLoad, weightProjection);
  const habitStats = computeHabitStats(completionHistory || []);
  const weekSummary = generateWeekSummary(last7, workouts, weightProjection, sleepDebt, recoveryTrend, consistencyScore, trainingLoad, habitStats);
  const sleepIntelligence = computeSleepIntelligence(last14, last7);

  return {
    sleepDebt,
    trainingLoad,
    recoveryTrend,
    weightProjection,
    calorieBalance,
    hrvBaseline,
    consistencyScore,
    riskFlags,
    topPriority,
    bodyComposition,
    weekSummary,
    sleepIntelligence,
  };
}

function computeSleepDebt(last7: HealthMetrics[], today: HealthMetrics) {
  const target = 8.0;
  const totalDeficit = last7.reduce((sum, m) => sum + Math.max(0, target - m.sleepDuration), 0);
  const avgSleep = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;

  let label = "No debt";
  let detail = `You averaged ${avgSleep.toFixed(1)} hours over the past 7 nights. No significant sleep debt.`;

  if (totalDeficit > 7) {
    label = "High debt";
    detail = `You are ${totalDeficit.toFixed(1)} hours short of ideal sleep over the past week. This affects recovery, appetite regulation, and how well your body responds to treatment. Prioritize an extra 30-60 min tonight.`;
  } else if (totalDeficit > 3) {
    label = "Moderate debt";
    detail = `You have accumulated ${totalDeficit.toFixed(1)} hours of sleep debt this week. Going to bed 20 minutes earlier for the next few nights can help close this gap.`;
  } else if (totalDeficit > 0) {
    label = "Minor debt";
    detail = `Slight deficit of ${totalDeficit.toFixed(1)} hours. A solid night tonight will clear this. No action needed.`;
  }

  return { hours: Math.round(totalDeficit * 10) / 10, label, detail };
}

function computeTrainingLoad(last14: HealthMetrics[], workouts: WorkoutEntry[]) {
  const recentWorkouts = workouts.filter((w) => {
    const wDate = new Date(w.date).getTime();
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return wDate >= cutoff;
  });

  const intensityMap: Record<string, number> = { low: 1, moderate: 2, high: 3, very_high: 4 };
  const loadScore = recentWorkouts.reduce((sum, w) => {
    return sum + w.duration * (intensityMap[w.intensity] || 2);
  }, 0);

  // Strain is not yet derived from HealthKit. Only use it when we actually have samples;
  // otherwise describe trend from workout-load deltas and omit the exertion number entirely.
  const strainAll = last14.map(m => m.strain).filter((v): v is number => typeof v === "number");
  const strainRecent = last14.slice(-7).map(m => m.strain).filter((v): v is number => typeof v === "number");
  const strainOlder = last14.slice(0, 7).map(m => m.strain).filter((v): v is number => typeof v === "number");
  const hasStrain = strainAll.length >= 3 && strainRecent.length >= 2 && strainOlder.length >= 2;
  const avgStrain = hasStrain ? strainAll.reduce((s, v) => s + v, 0) / strainAll.length : 0;
  const recentStrain = hasStrain ? strainRecent.reduce((s, v) => s + v, 0) / strainRecent.length : 0;
  const olderStrain = hasStrain ? strainOlder.reduce((s, v) => s + v, 0) / strainOlder.length : 0;

  // Fall back to workout-count trend when strain is not available.
  const recentWorkoutCount = recentWorkouts.filter(w => {
    const wDate = new Date(w.date).getTime();
    return wDate >= Date.now() - 7 * 24 * 60 * 60 * 1000;
  }).length;
  const olderWorkoutCount = recentWorkouts.length - recentWorkoutCount;
  const trend: "rising" | "falling" | "stable" = hasStrain
    ? (recentStrain > olderStrain * 1.15 ? "rising" : recentStrain < olderStrain * 0.85 ? "falling" : "stable")
    : (recentWorkoutCount > olderWorkoutCount + 1 ? "rising" : recentWorkoutCount < olderWorkoutCount - 1 ? "falling" : "stable");

  let label = "Moderate";
  if (loadScore > 400) label = "High";
  else if (loadScore > 600) label = "Very High";
  else if (loadScore < 150) label = "Low";

  const trendWord = trend === "rising" ? "increasing" : trend === "falling" ? "decreasing" : "steady";
  const exertionLine = hasStrain ? ` Average exertion is ${avgStrain.toFixed(1)}.` : "";
  const detail = `${recentWorkouts.length} active days in the past 2 weeks.${exertionLine} Activity level is ${trendWord}. ${
    trend === "rising"
      ? "Make sure recovery keeps pace. If recovery dips below 50%, a lighter day will help."
      : trend === "falling"
      ? "A bit more movement could support your treatment. Even a daily walk helps preserve muscle."
      : "Good balance between activity and recovery. This supports treatment response."
  }`;

  return { score: loadScore, label, detail, trend };
}

function computeRecoveryTrend(last7: HealthMetrics[]) {
  // Recovery score is not yet derived on this build. If no real recovery samples exist,
  // return a neutral state with an empty detail so the UI can suppress the card.
  const recoverySeries = last7
    .map(m => (typeof m.recoveryScore === "number" ? m.recoveryScore : null));
  const realCount = recoverySeries.filter(v => v !== null).length;
  if (realCount < 3) {
    return { direction: "stable" as const, streak: 0, detail: "" };
  }

  let improving = 0;
  let declining = 0;
  for (let i = 1; i < recoverySeries.length; i++) {
    const cur = recoverySeries[i];
    const prev = recoverySeries[i - 1];
    if (cur === null || prev === null) continue;
    if (cur > prev) improving++;
    else if (cur < prev) declining++;
  }

  const direction: "improving" | "declining" | "stable" =
    improving >= declining + 2 ? "improving" : declining >= improving + 2 ? "declining" : "stable";

  const nonNull = recoverySeries.filter((v): v is number => v !== null);
  const avg = nonNull.reduce((s, v) => s + v, 0) / nonNull.length;

  let streak = 0;
  for (let i = recoverySeries.length - 1; i > 0; i--) {
    const cur = recoverySeries[i];
    const prev = recoverySeries[i - 1];
    if (cur === null || prev === null) break;
    if (direction === "improving" && cur >= prev) streak++;
    else if (direction === "declining" && cur <= prev) streak++;
    else break;
  }

  const detail =
    direction === "improving"
      ? `Recovery has been improving for ${streak} days, averaging around ${Math.round(avg)}%. Your body is adapting well to your current routine.`
      : direction === "declining"
      ? `Recovery has been declining for ${streak} days, averaging around ${Math.round(avg)}%. A lighter day with better sleep tonight will help your body catch up.`
      : `Recovery is holding steady around ${Math.round(avg)}%. Consistent inputs are producing consistent results.`;

  return { direction, streak, detail };
}

function computeWeightProjection(last30: HealthMetrics[], profile: UserProfile) {
  if (last30.length < 7) {
    return { weeksToGoal: null, rate: 0, detail: "Not enough data to project weight trends yet.", onTrack: false };
  }

  // Pairwise non-null: an unlogged weight day must not drag the average to zero.
  const first7Weights = last30.slice(0, 7).map(m => m.weight).filter((v): v is number => typeof v === "number");
  const last7Weights = last30.slice(-7).map(m => m.weight).filter((v): v is number => typeof v === "number");
  if (first7Weights.length < 3 || last7Weights.length < 3) {
    return { weeksToGoal: null, rate: 0, detail: "Log weight regularly to project trends.", onTrack: false };
  }
  const first7Avg = first7Weights.reduce((s, v) => s + v, 0) / first7Weights.length;
  const last7Avg = last7Weights.reduce((s, v) => s + v, 0) / last7Weights.length;
  const weeklyRate = ((last7Avg - first7Avg) / (last30.length / 7));
  const remaining = last7Avg - profile.goalWeight;

  let weeksToGoal: number | null = null;
  let onTrack = false;

  if (profile.goalWeight < last7Avg && weeklyRate < 0) {
    weeksToGoal = Math.round(remaining / Math.abs(weeklyRate));
    onTrack = Math.abs(weeklyRate) >= 0.3 && Math.abs(weeklyRate) <= 1.5;
  } else if (profile.goalWeight > last7Avg && weeklyRate > 0) {
    weeksToGoal = Math.round(Math.abs(remaining) / weeklyRate);
    onTrack = weeklyRate >= 0.2 && weeklyRate <= 1.0;
  } else if (Math.abs(remaining) < 2) {
    onTrack = true;
  }

  const rateStr = Math.abs(weeklyRate).toFixed(1);
  let detail = "";

  if (Math.abs(remaining) < 2) {
    detail = `You are within 2 lbs of your goal weight. Focus on maintaining. Daily fluctuations are normal.`;
  } else if (weeksToGoal !== null && onTrack) {
    detail = `At your current rate of ${rateStr} lbs/week, you will reach your goal of ${profile.goalWeight} lbs in approximately ${weeksToGoal} weeks. This is a healthy pace.`;
  } else if (weeklyRate > 0 && profile.goalWeight < last7Avg) {
    detail = `Your weight is trending up (${rateStr} lbs/week) while your goal is to lose weight. Review your protein intake and meal timing to support your treatment goals.`;
  } else if (weeksToGoal !== null) {
    detail = `Projected ${weeksToGoal} weeks to goal at ${rateStr} lbs/week. ${Math.abs(weeklyRate) > 1.5 ? "This rate is faster than recommended. Slower loss preserves muscle, which is especially important on GLP-1." : "Consistent effort will get you there."}`;
  } else {
    detail = `Weight is relatively stable. If your goal is to change weight, focusing on protein intake and meal consistency can help support your treatment.`;
  }

  return { weeksToGoal, rate: Math.round(weeklyRate * 10) / 10, detail, onTrack };
}

function computeCalorieBalance(last7: HealthMetrics[], today: HealthMetrics) {
  const avgBurn = last7.reduce((s, m) => s + m.caloriesBurned, 0) / last7.length;
  const estimatedIntake = 2100;
  const net = Math.round(today.caloriesBurned - estimatedIntake);

  let label = "Balanced";
  if (net > 300) label = "High burn";
  else if (net < -300) label = "Low burn";

  const detail = `You are burning an average of ${Math.round(avgBurn).toLocaleString()} calories per day. Today: ${today.caloriesBurned.toLocaleString()} burned, with ${today.activeCalories} from activity. ${
    net > 200
      ? "Active day. Make sure you are eating enough protein to support muscle preservation."
      : "Make sure your intake supports your energy and recovery needs on treatment."
  }`;

  return { net, label, detail };
}

function computeHRVBaseline(last14: HealthMetrics[], today: HealthMetrics) {
  // Filter to only real HRV readings so missing nights never get treated as 0 ms, which
  // would create a false "low HRV" signal.
  const hrvSamples = last14.map(m => m.hrv).filter((v): v is number => typeof v === "number");
  if (hrvSamples.length < 5 || typeof today.hrv !== "number") {
    return { current: today.hrv, baseline: 0, deviation: 0, detail: "" };
  }
  const baseline = hrvSamples.reduce((s, v) => s + v, 0) / hrvSamples.length;
  const deviation = today.hrv - baseline;
  const deviationPct = baseline > 0 ? (deviation / baseline) * 100 : 0;

  let detail = "";
  if (deviationPct > 10) {
    detail = `Your HRV is ${Math.round(deviationPct)}% above your 14-day baseline of ${Math.round(baseline)} ms. Your nervous system is well-recovered. A good day to make the most of your energy.`;
  } else if (deviationPct < -10) {
    detail = `Your HRV is ${Math.round(Math.abs(deviationPct))}% below your 14-day baseline of ${Math.round(baseline)} ms. Your autonomic nervous system is under more stress than usual. A lighter day with good hydration will help.`;
  } else {
    detail = `Your HRV of ${today.hrv} ms is close to your 14-day baseline of ${Math.round(baseline)} ms. Normal variation. Proceed as planned.`;
  }

  return { current: today.hrv, baseline: Math.round(baseline), deviation: Math.round(deviation), detail };
}

function computeConsistency(last14: HealthMetrics[], workouts: WorkoutEntry[]) {
  const recentWorkouts = workouts.filter((w) => {
    const wDate = new Date(w.date).getTime();
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return wDate >= cutoff;
  });

  const sleepConsistency = last14.filter((m) => m.sleepDuration >= 7).length / last14.length;
  const stepConsistency = last14.filter((m) => m.steps >= 7000).length / last14.length;
  const activityConsistency = Math.min(recentWorkouts.length / 8, 1);

  const score = Math.round((sleepConsistency * 0.35 + stepConsistency * 0.3 + activityConsistency * 0.35) * 100);

  let label = "Excellent";
  if (score < 50) label = "Needs work";
  else if (score < 70) label = "Fair";
  else if (score < 85) label = "Good";

  const parts: string[] = [];
  if (sleepConsistency < 0.7) parts.push("sleep regularity");
  if (stepConsistency < 0.6) parts.push("daily movement");
  if (activityConsistency < 0.5) parts.push("regular activity");

  const detail = parts.length > 0
    ? `Areas to improve: ${parts.join(", ")}. Consistency is the strongest predictor of long-term success on treatment.`
    : `You are showing strong consistency across sleep, movement, and daily habits. This supports your treatment.`;

  return { score, label, detail };
}

function computeRiskFlags(
  today: HealthMetrics,
  last7: HealthMetrics[],
  sleepDebt: { hours: number },
  hrv: { deviation: number },
  load: { trend: string }
) {
  const flags: string[] = [];

  if (sleepDebt.hours > 7) flags.push(`High sleep debt (${sleepDebt.hours.toFixed(1)} hrs). Recovery, appetite, and energy are all affected.`);
  if (hrv.deviation < -8) flags.push(`HRV is ${Math.abs(hrv.deviation)} ms below your baseline. This suggests accumulated stress or incomplete recovery.`);
  if (today.restingHeartRate !== null && today.restingHeartRate > 70) flags.push(`Resting heart rate is elevated at ${today.restingHeartRate} bpm. Stress, dehydration, or poor sleep may be a factor.`);
  if (load.trend === "rising" && hrv.deviation < -3) flags.push("Activity is increasing while recovery is dropping. A lighter day would help your body catch up.");
  if (today.sleepDuration < 6) flags.push(`Slept ${today.sleepDuration.toFixed(1)} hours. Energy, appetite, and recovery will all be affected today.`);

  const consecutivePoorRecovery = last7.slice(-3).every((m) => typeof m.recoveryScore === "number" && m.recoveryScore < 50);
  if (consecutivePoorRecovery) flags.push("Three consecutive days of recovery below 50%. A rest day is strongly recommended.");

  let severity: "none" | "low" | "medium" | "high" = "none";
  if (flags.length >= 3) severity = "high";
  else if (flags.length === 2) severity = "medium";
  else if (flags.length === 1) severity = "low";

  return { flags, severity };
}

function computeTDEE(today: HealthMetrics, profile: UserProfile) {
  let bmr: number;
  if (profile.sex === "male") {
    bmr = 10 * (profile.weight / 2.205) + 6.25 * (profile.height * 2.54) - 5 * profile.age + 5;
  } else {
    bmr = 10 * (profile.weight / 2.205) + 6.25 * (profile.height * 2.54) - 5 * profile.age - 161;
  }

  const activityMultiplier = today.steps > 10000 ? 1.55 : today.steps > 7500 ? 1.45 : today.steps > 5000 ? 1.35 : 1.25;
  const tdee = Math.round(bmr * activityMultiplier);

  const detail = `Estimated daily energy needs: ${tdee.toLocaleString()} calories based on today's activity level. On GLP-1 treatment, eating enough is just as important as what you eat. Aim for 100-120g protein daily and do not skip meals, even when appetite is suppressed.`;

  return { estimatedTDEE: tdee, detail };
}

function determineTopPriority(
  risks: { flags: string[]; severity: string },
  sleep: { hours: number; label: string },
  recovery: { direction: string },
  load: { trend: string },
  weight: { onTrack: boolean }
) {
  if (risks.severity === "high") return "Multiple stress signals today. Prioritize sleep, hydration, and rest. Skip intense activity.";
  if (sleep.hours > 7) return "Sleep debt is your biggest limiter. Going to bed 30 minutes earlier tonight is the single highest-impact change.";
  if (recovery.direction === "declining") return "Recovery is trending down. A lighter day with good sleep tonight will help your body reset.";
  if (load.trend === "rising") return "Activity has been increasing. Watch for fatigue over the next 2-3 days. If recovery drops below 50%, take a rest day.";
  if (!weight.onTrack) return "Weight trend is not matching your goal. Review protein intake and meal timing. Consistent fueling matters more than restriction.";
  return "You are on track. Consistency is your biggest advantage right now. Keep this rhythm going.";
}

export interface HabitStats {
  weeklyPercent: number;
  streakDays: number;
  todayCompleted: number;
  todayTotal: number;
  topHabit: string | null;
  topHabitPercent: number;
}

export function computeHabitStats(history: CompletionRecord[]): HabitStats {
  const todayDate = new Date().toISOString().split("T")[0];
  const todayRecord = history.find(r => r.date === todayDate);
  const todayCompleted = todayRecord ? todayRecord.actions.filter(a => a.completed).length : 0;
  const todayTotal = todayRecord ? todayRecord.actions.length : 5;

  const last7 = history.filter(r => {
    const d = new Date(r.date);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return d >= cutoff;
  });
  const weeklyPercent = last7.length > 0
    ? Math.round(last7.reduce((sum, r) => sum + r.completionRate, 0) / last7.length)
    : 0;

  let streakDays = 0;
  if (history.length > 0) {
    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    for (let i = 0; i < sorted.length; i++) {
      const checkDate = new Date();
      checkDate.setDate(checkDate.getDate() - i);
      const expected = checkDate.toISOString().split("T")[0];
      const record = sorted.find(r => r.date === expected);
      if (record && record.completionRate >= 40) {
        streakDays++;
      } else if (expected === todayDate) {
        continue;
      } else {
        break;
      }
    }
  }

  const categoryCount: Record<string, { done: number; total: number }> = {};
  for (const record of last7) {
    for (const a of record.actions) {
      if (!categoryCount[a.category]) categoryCount[a.category] = { done: 0, total: 0 };
      categoryCount[a.category].total++;
      if (a.completed) categoryCount[a.category].done++;
    }
  }
  let topHabit: string | null = null;
  let topHabitPercent = 0;
  for (const [cat, counts] of Object.entries(categoryCount)) {
    const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    if (pct > topHabitPercent) {
      topHabitPercent = pct;
      topHabit = cat;
    }
  }

  return { weeklyPercent, streakDays, todayCompleted, todayTotal, topHabit, topHabitPercent };
}

function generateWeekSummary(
  last7: HealthMetrics[],
  workouts: WorkoutEntry[],
  weight: { rate: number; onTrack: boolean },
  sleep: { hours: number; label: string },
  recovery: { direction: "improving" | "declining" | "stable"; streak: number },
  consistency: { score: number; label: string },
  training: { trend: "rising" | "falling" | "stable" },
  habits: HabitStats
) {
  const avgSleep = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;
  const avgSteps = Math.round(last7.reduce((s, m) => s + m.steps, 0) / last7.length);
  // Only compute an avgRecovery when we actually have recovery samples; otherwise sentinel -1
  // means "suppress any recovery-gated phrasing below".
  const recoverySamples = last7.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const hasRecovery = recoverySamples.length >= 3;
  const avgRecovery = hasRecovery ? Math.round(recoverySamples.reduce((s, v) => s + v, 0) / recoverySamples.length) : -1;
  const recentWorkouts = workouts.filter((w) => {
    const wDate = new Date(w.date).getTime();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return wDate >= cutoff;
  });

  const parts: string[] = [];

  if (hasRecovery && avgSleep >= 7.5 && avgRecovery >= 65 && avgSteps >= 7000) {
    parts.push("Strong week overall. Your sleep, recovery, and daily movement have all been in a good range. This is exactly the foundation that supports your treatment.");
  } else if (hasRecovery && avgSleep >= 7 && avgRecovery >= 55) {
    parts.push("A solid week. Sleep and recovery have held steady, giving your body a stable foundation during treatment.");
  } else if (hasRecovery && avgSleep < 6.5 && avgRecovery < 50) {
    parts.push("A tough week for your body. Sleep has been short and recovery has not had a chance to bounce back. This can make side effects feel heavier.");
  } else if (avgSleep >= 7.5 && avgSteps >= 7000) {
    parts.push("Strong week overall. Your sleep and daily movement have both been in a good range, which gives your body a stable foundation during treatment.");
  } else if (avgSleep < 7) {
    parts.push("Sleep was a bit thin this week, averaging " + avgSleep.toFixed(1) + " hours. That puts extra pressure on energy, which matters more on treatment.");
  } else {
    parts.push("A mixed week. Some areas are strong while others have room to improve.");
  }

  if (hasRecovery && recovery.direction === "improving") {
    parts.push("Recovery has been trending up, which means your body is adapting well to your current routine and treatment.");
  } else if (hasRecovery && recovery.direction === "declining") {
    parts.push("Recovery has been sliding down. A lighter pace with more rest and hydration would help your body catch up.");
  }

  if (recentWorkouts.length >= 4 && avgSteps >= 7000) {
    parts.push("You stayed active with " + recentWorkouts.length + " active days and solid daily movement. Regular activity helps preserve muscle and supports how you feel on treatment.");
  } else if (recentWorkouts.length >= 3) {
    parts.push("You had " + recentWorkouts.length + " active days this week. Regular movement helps regulate appetite, energy, and sleep during treatment.");
  } else if (recentWorkouts.length <= 1 && avgSteps < 5000) {
    parts.push("Activity was light this week. Even small increases like a daily walk or gentle stretching can make a noticeable difference in energy and how your body handles treatment.");
  }

  // Sleep quality is not derived yet. Skip the block entirely unless we have real samples.
  const sleepQualitySamples = last7.map(m => m.sleepQuality).filter((v): v is number => typeof v === "number");
  if (sleepQualitySamples.length >= 3) {
    const avgSleepQuality = sleepQualitySamples.reduce((s, v) => s + v, 0) / sleepQualitySamples.length;
    if (avgSleepQuality >= 80 && avgSleep >= 7) {
      parts.push("Sleep quality has been strong. Good rest is one of the most powerful things supporting your treatment right now.");
    } else if (avgSleepQuality < 60) {
      parts.push("Sleep quality has been low even when you have been in bed. Better wind-down habits or a cooler room might help you get deeper rest.");
    } else if (avgSleepQuality < 70 && avgSleep >= 7) {
      parts.push("You are getting enough sleep hours, but the quality could be better. Small changes to your evening routine can make a real difference.");
    }
  }

  if (hasRecovery && training.trend === "rising" && recovery.direction !== "improving") {
    parts.push("Activity has been increasing, but recovery has not kept up yet. Watch for fatigue over the next few days.");
  }

  if (hasRecovery && sleep.hours > 5 && recovery.direction === "declining" && recentWorkouts.length >= 3) {
    parts.push("You have been putting in the effort, but your body is asking for more recovery time. Extra rest will help you stay consistent.");
  }

  if (habits.weeklyPercent >= 80) {
    parts.push(`Habit completion has been strong at ${habits.weeklyPercent}% this week. That consistency is what drives lasting results on treatment.`);
  } else if (habits.weeklyPercent > 0 && habits.weeklyPercent < 50) {
    parts.push(`Habit completion was ${habits.weeklyPercent}% this week. Getting back to a rhythm with the basics (movement, protein, hydration, sleep) is the priority.`);
  } else if (habits.weeklyPercent >= 50 && habits.weeklyPercent < 80) {
    parts.push(`You completed ${habits.weeklyPercent}% of your habits this week. Solid effort, but there is room to be more consistent.`);
  }

  if (habits.streakDays >= 3 && habits.weeklyPercent >= 60) {
    parts.push(`You are on a ${habits.streakDays}-day streak. Momentum like that compounds over time.`);
  }

  if (weight.onTrack && Math.abs(weight.rate) > 0.1) {
    parts.push("Weight is trending in the right direction at a healthy pace.");
  } else if (!weight.onTrack && Math.abs(weight.rate) > 0.3) {
    parts.push("Weight is not moving toward your goal yet. Reviewing protein intake and meal timing could help.");
  }

  if (parts.length <= 2) {
    parts.push("Keep building on this foundation heading into next week. Small, consistent improvements in sleep, protein, hydration, and movement add up.");
  }

  return parts.slice(0, 4).join("\n\n");
}

function computeSleepIntelligence(last14: HealthMetrics[], last7: HealthMetrics[]): SleepIntelligence {
  const avgDuration = last14.reduce((s, m) => s + m.sleepDuration, 0) / last14.length;

  const sleepTimes = last14.map((m) => {
    const hours = m.sleepDuration;
    return 23 - (hours - 7) * 0.5;
  });
  const avgBedtime = sleepTimes.reduce((s, t) => s + t, 0) / sleepTimes.length;
  const bedtimeVariance = sleepTimes.reduce((s, t) => s + Math.pow(t - avgBedtime, 2), 0) / sleepTimes.length;
  const bedtimeStdDev = Math.sqrt(bedtimeVariance);

  let bedtimeConsistency: "consistent" | "somewhat_consistent" | "inconsistent" = "consistent";
  if (bedtimeStdDev > 1.0) bedtimeConsistency = "inconsistent";
  else if (bedtimeStdDev > 0.5) bedtimeConsistency = "somewhat_consistent";

  const recentAvg = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;
  const olderAvg = last14.slice(0, 7).reduce((s, m) => s + m.sleepDuration, 0) / Math.min(7, last14.slice(0, 7).length);
  let sleepTrend: "improving" | "declining" | "stable" = "stable";
  if (recentAvg > olderAvg + 0.2) sleepTrend = "improving";
  else if (recentAvg < olderAvg - 0.2) sleepTrend = "declining";

  // Sleep quality trend only meaningful when samples exist. Otherwise stable (neutral).
  const recentQualitySamples = last7.map(m => m.sleepQuality).filter((v): v is number => typeof v === "number");
  const olderQualitySamples = last14.slice(0, 7).map(m => m.sleepQuality).filter((v): v is number => typeof v === "number");
  const qualityTrending: "declining" | "improving" | "stable" =
    recentQualitySamples.length >= 3 && olderQualitySamples.length >= 3
      ? (() => {
          const recentQualityAvg = recentQualitySamples.reduce((s, v) => s + v, 0) / recentQualitySamples.length;
          const olderQualityAvg = olderQualitySamples.reduce((s, v) => s + v, 0) / olderQualitySamples.length;
          return recentQualityAvg < olderQualityAvg - 5 ? "declining" : recentQualityAvg > olderQualityAvg + 5 ? "improving" : "stable";
        })()
      : "stable";

  let insight = "";
  if (bedtimeConsistency === "inconsistent") {
    insight = "Your sleep schedule is inconsistent. Irregular bedtimes make it harder for your body to optimize recovery.";
  } else if (sleepTrend === "improving") {
    insight = "Sleep duration is improving over the past week. Your recovery should benefit within a few days.";
  } else if (sleepTrend === "declining") {
    insight = "Sleep duration has been declining. This will start affecting recovery and energy if it continues.";
  } else if (qualityTrending === "declining") {
    insight = "Sleep quality is declining even though duration is stable. Consider adjusting your wind-down routine.";
  } else if (avgDuration < 7) {
    insight = "You are averaging under 7 hours. Most adults need 7-9 hours for optimal recovery and cognitive function.";
  } else {
    insight = "Sleep is consistent and adequate. This is one of the strongest contributors to how well your body responds to treatment.";
  }

  let recommendation = "";
  if (bedtimeConsistency === "inconsistent") {
    recommendation = "Stabilize your bedtime. Pick a consistent time and stick to it within 30 minutes, even on weekends.";
  } else if (avgDuration < 7) {
    recommendation = "Increase time in bed by 20-30 minutes. Set a bedtime alarm to build the habit.";
  } else if (qualityTrending === "declining") {
    recommendation = "Adjust your wind-down habits. Reduce screens, dim lights, and avoid caffeine after 2pm.";
  } else if (sleepTrend === "declining") {
    recommendation = "Your sleep has been shortening. Prioritize getting to bed on time for the next few nights.";
  } else {
    recommendation = "Keep your current routine. Consistent sleep is the foundation of everything else.";
  }

  return {
    avgDuration: Math.round(avgDuration * 10) / 10,
    bedtimeConsistency,
    sleepTrend,
    insight,
    recommendation,
  };
}

type DayType = "push" | "maintain" | "recover" | "rest";

interface SignalProfile {
  sleepLast: number;
  sleepTrend: "down" | "up" | "steady";
  sleepConsistent: boolean;
  recoveryLevel: "strong" | "moderate" | "low";
  recoveryVsNormal: "above" | "below" | "normal";
  recoveryStreak: number;
  recoveryStreakDir: "improving" | "declining" | "stable";
  activityLevel: "active" | "moderate" | "low";
  activityVsSleep: "mismatch" | "balanced";
  feelingPositive: boolean;
  feelingNegative: boolean;
  energyHigh: boolean;
  energyLow: boolean;
  stressHigh: boolean;
  hydrationLow: boolean;
  completionRate: number;
  completionConsistent: boolean;
  movementStrong: boolean;
  recoveryHabitWeak: boolean;
  dayType: DayType;
}

function buildSignalProfile(
  todayMetrics: HealthMetrics,
  allMetrics: HealthMetrics[],
  userInputs: CoachInsightInputs
): SignalProfile {
  const last7 = allMetrics.slice(-7);
  const last14 = allMetrics.slice(-14);

  const avgSleep7 = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;
  const sleepLast = todayMetrics.sleepDuration;
  const sleepTrend: "down" | "up" | "steady" =
    avgSleep7 > sleepLast + 0.3 ? "down" : sleepLast > avgSleep7 + 0.3 ? "up" : "steady";
  const sleepVariance = last7.reduce((s, m) => s + Math.abs(m.sleepDuration - avgSleep7), 0) / last7.length;
  const sleepConsistent = sleepVariance < 0.6;

  // Only build HRV baseline from real samples; missing HRV cannot be treated as 0 ms.
  const hrvSamples14 = last14.map(m => m.hrv).filter((v): v is number => typeof v === "number");
  const hasHrv = hrvSamples14.length >= 5 && typeof todayMetrics.hrv === "number";
  const hrvBaseline = hasHrv ? hrvSamples14.reduce((s, v) => s + v, 0) / hrvSamples14.length : 0;
  const todayHrv = typeof todayMetrics.hrv === "number" ? todayMetrics.hrv : 0;
  const hrvDev = hasHrv && hrvBaseline > 0 ? ((todayHrv - hrvBaseline) / hrvBaseline) * 100 : 0;

  // Recovery is not implemented yet — when absent, default to "moderate" neutral so no coaching
  // path that looks for "low" or "strong" fires on fake-zero data.
  const recoverySamples14 = last14.map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  const hasRecovery = recoverySamples14.length >= 3 && typeof todayMetrics.recoveryScore === "number";
  const todayRecovery = hasRecovery ? (todayMetrics.recoveryScore as number) : 60;
  const recoveryLevel: "strong" | "moderate" | "low" = hasRecovery
    ? (todayRecovery >= 70 ? "strong" : todayRecovery >= 50 ? "moderate" : "low")
    : "moderate";

  const avgRecovery14 = hasRecovery ? recoverySamples14.reduce((s, v) => s + v, 0) / recoverySamples14.length : 60;
  const recoveryVsNormal: "above" | "below" | "normal" = hasRecovery
    ? (todayRecovery > avgRecovery14 + 8 ? "above" : todayRecovery < avgRecovery14 - 8 ? "below" : "normal")
    : "normal";

  let recoveryStreak = 0;
  let recoveryStreakDir: "improving" | "declining" | "stable" = "stable";
  for (let i = hasRecovery ? last7.length - 1 : 0; i > 0; i--) {
    const curRaw = last7[i].recoveryScore;
    const prevRaw = last7[i - 1].recoveryScore;
    if (typeof curRaw !== "number" || typeof prevRaw !== "number") break;
    const cur = curRaw;
    const prev = prevRaw;
    if (cur > prev + 3) {
      if (recoveryStreakDir === "stable" || recoveryStreakDir === "improving") {
        recoveryStreakDir = "improving";
        recoveryStreak++;
      } else break;
    } else if (cur < prev - 3) {
      if (recoveryStreakDir === "stable" || recoveryStreakDir === "declining") {
        recoveryStreakDir = "declining";
        recoveryStreak++;
      } else break;
    } else break;
  }

  const avgSteps7 = last7.reduce((s, m) => s + m.steps, 0) / last7.length;
  const activityLevel: "active" | "moderate" | "low" =
    avgSteps7 >= 8000 ? "active" : avgSteps7 >= 5000 ? "moderate" : "low";

  const activityVsSleep: "mismatch" | "balanced" =
    (activityLevel === "active" && sleepTrend === "down") ? "mismatch" : "balanced";

  const { feeling, energy, stress, hydration, completionHistory } = userInputs;
  const feelingPositive = feeling === "great";
  const feelingNegative = feeling === "tired" || feeling === "stressed";
  const energyHigh = energy === "excellent" || energy === "high";
  const energyLow = energy === "low";
  const stressHigh = stress === "very_high" || stress === "high";
  const hydrationLow = hydration === "dehydrated" || hydration === "low";

  const recentHistory = completionHistory.slice(-7);
  const completionRate = recentHistory.length > 0
    ? Math.round(recentHistory.reduce((sum, r) => sum + r.completionRate, 0) / recentHistory.length)
    : -1;

  const completionDays = recentHistory.filter(r => r.completionRate >= 60).length;
  const completionConsistent = recentHistory.length >= 3 && completionDays >= Math.ceil(recentHistory.length * 0.6);

  const movementActions = recentHistory.flatMap(r => r.actions.filter(a => a.category === "move"));
  const recoveryActions = recentHistory.flatMap(r => r.actions.filter(a => a.category === "recover"));
  const movementStrong = movementActions.length > 0 && movementActions.filter(a => a.completed).length / movementActions.length >= 0.7;
  const recoveryHabitWeak = recoveryActions.length > 0 && recoveryActions.filter(a => a.completed).length / recoveryActions.length < 0.4;

  let dayType: DayType;
  const negativeSignals =
    (recoveryLevel === "low" ? 2 : recoveryLevel === "moderate" ? 1 : 0) +
    (sleepLast < 6 ? 2 : sleepLast < 7 ? 1 : 0) +
    (stressHigh ? 1 : 0) +
    (hrvDev < -8 ? 1 : 0) +
    (feelingNegative ? 1 : 0) +
    (energyLow ? 1 : 0);

  const positiveSignals =
    (recoveryLevel === "strong" ? 2 : 0) +
    (sleepLast >= 7.5 ? 1 : 0) +
    (hrvDev > 8 ? 1 : 0) +
    (feelingPositive ? 1 : 0) +
    (energyHigh ? 1 : 0);

  if (negativeSignals >= 4) dayType = "rest";
  else if (negativeSignals >= 2) dayType = "recover";
  else if (positiveSignals >= 3) dayType = "push";
  else dayType = "maintain";

  return {
    sleepLast, sleepTrend, sleepConsistent,
    recoveryLevel, recoveryVsNormal, recoveryStreak, recoveryStreakDir,
    activityLevel, activityVsSleep,
    feelingPositive, feelingNegative, energyHigh, energyLow,
    stressHigh, hydrationLow,
    completionRate, completionConsistent, movementStrong, recoveryHabitWeak,
    dayType,
  };
}

export function generateCoachInsight(
  todayMetrics: HealthMetrics,
  allMetrics: HealthMetrics[],
  userInputs: CoachInsightInputs
): string {
  if (allMetrics.length === 0) return "";

  const p = buildSignalProfile(todayMetrics, allMetrics, userInputs);

  const insight = selectInsight(p);

  if (p.hydrationLow && !insight.includes("water") && !insight.includes("hydrat")) {
    return insight + " Also, your water intake is low. sipping throughout the day will help everything else work better.";
  }

  return insight;
}

function selectInsight(p: SignalProfile): string {

  if (p.dayType === "rest" && p.sleepTrend === "down" && p.recoveryStreakDir === "declining") {
    return "Your recovery has been dropping for " + (p.recoveryStreak || "a few") + " days while sleep keeps getting shorter. These two things feed each other. less sleep means slower recovery, which affects your energy, mood, and even appetite. Today is about rest. Eat nourishing meals, drink plenty of water, and get to bed early tonight.";
  }

  if (p.stressHigh && p.sleepLast < 6.5 && p.recoveryLevel !== "strong") {
    return "High stress on a short night of sleep puts pressure on everything. your energy, focus, digestion, and mood. When both stack up, pushing through usually makes things worse. Focus on three things today: eat nourishing foods, drink water steadily, and get to bed early. A gentle walk outside will help more than anything intense.";
  }

  if (p.stressHigh && p.recoveryLevel === "low") {
    return "Stress is high and your body is feeling it. recovery is lower than usual. When stress takes hold, it affects sleep quality, appetite, and how well your body restores itself. Today, focus on calming your nervous system. Try 10 minutes of breathing, eat warm whole foods, and skip anything intense. Protecting your energy now means a better tomorrow.";
  }

  if (p.stressHigh && p.hydrationLow) {
    return "Stress and dehydration are a tough combination. Stress increases your body's demand for water, and being low on fluids makes stress feel worse. it affects concentration, mood, and energy. Start sipping water now and keep it steady throughout the day. Pair that with some breathing or a short walk to help your system settle.";
  }

  if (p.stressHigh && p.activityLevel === "active" && p.sleepTrend !== "up") {
    return "You have been staying active while stress has been high. That takes real effort, but without enough recovery, it can wear you down. Consider a gentler day today. stretching, a nature walk, or light yoga. Pair that with good nutrition and an earlier bedtime. your body will thank you.";
  }

  if (p.feelingNegative && p.recoveryLevel === "strong" && !p.energyLow) {
    return "You are not feeling your best mentally, but physically your body is in good shape. recovery is strong. This is likely more about mental energy than physical fatigue. A change of scenery or a walk outside could shift things. Nourish yourself well today and do not put too much pressure on being productive.";
  }

  if (p.energyLow && p.sleepTrend === "down" && p.hydrationLow) {
    return "Low energy, less sleep than usual, and low water intake. these three together explain why today feels harder. The good news is that two of those are fixable right now. Start drinking water, eat something nourishing with complex carbs and protein, and plan for an earlier bedtime. Small fixes in nutrition and hydration make a surprisingly fast difference.";
  }

  if (p.energyLow && p.hydrationLow) {
    return "Low energy combined with low hydration is more connected than most people realize. Even mild dehydration can drain your focus, mood, and motivation. Before you reach for caffeine, try water first. a big glass now and steady sipping through the day. Pair that with a balanced meal and see how you feel in an hour.";
  }

  if (p.energyLow && p.sleepTrend === "down") {
    return "Your energy is low, and shorter sleep this week is the likely reason. When sleep dips even a little over several days, it compounds. affecting your mood, appetite, and ability to handle stress. A lighter day with nourishing food, steady hydration, and an earlier bedtime is the fastest way to bounce back.";
  }

  if (p.feelingNegative && p.sleepLast < 6.5) {
    return "Last night's sleep was short, and that's showing up in how you feel today. Less than six and a half hours affects more than energy. it impacts mood, hunger signals, and stress tolerance. Keep today's expectations realistic. Focus on eating well, staying hydrated, and getting a good night's sleep tonight.";
  }

  if (p.activityVsSleep === "mismatch") {
    return "You've been active this week, but your sleep has been getting shorter. High activity with declining sleep is a pattern that catches up in every area. energy, mood, stress tolerance, and even appetite control. Keep your movement going, but make winding down earlier tonight your top priority. Your body needs both sides of the equation.";
  }

  if (!p.sleepConsistent && p.activityLevel === "active") {
    return "Your activity has been strong, but your sleep schedule has been up and down. Inconsistent sleep makes it harder for your body to recover, regulate appetite, and maintain steady energy. Try going to bed within the same 30-minute window each night. Consistent sleep is one of the most powerful habits for supporting your treatment.";
  }

  if (p.movementStrong && p.recoveryHabitWeak) {
    return "You have been great about staying active, but recovery habits like stretching, good nutrition, hydration, and wind-down time have been falling behind. Movement is only half the picture. Without recovery, your body cannot fully benefit from the effort. Try adding one restorative action today: a stretch, a nourishing meal, or 10 minutes of quiet time.";
  }

  if (p.completionRate >= 0 && p.completionRate < 35 && p.recoveryLevel !== "low") {
    return "You've completed less of your daily plan this week. That usually means the plan is too ambitious, not that you're falling short. Your body is in decent shape, so the fix is about simplifying. Pick two or three things that matter most today. maybe a walk, a good meal, and getting to bed on time. and let the rest go.";
  }

  if (p.completionConsistent && p.recoveryLevel === "strong" && p.sleepTrend !== "down") {
    return "You have been showing up consistently across all areas. movement, nutrition, sleep, and recovery. Your routine is working and your body is responding well. This kind of steady effort is what creates lasting results on treatment. Keep doing what you are doing.";
  }

  if (p.feelingPositive && p.recoveryLevel === "strong" && p.energyHigh) {
    return "Everything is aligned today. body, energy, and recovery. When you feel this good and recovery backs it up, it is a great day to make the most of it. Use this energy for a strength session if you can, focus on good protein intake, and set up the rest of your week.";
  }

  if (p.feelingPositive && p.recoveryVsNormal === "below") {
    return "You're feeling good today, but your recovery is a bit lower than usual. That can mean your body is still catching up from recent days. Go ahead with your plans, but keep things moderate and make sure you're eating well and staying hydrated. Check in with yourself halfway through the day.";
  }

  if (p.energyHigh && p.recoveryLevel === "moderate") {
    return "Your energy is high, which is great. But recovery is only moderate, so there's a tradeoff. pushing hard today could mean feeling it tomorrow. A solid moderate effort is the sweet spot. Complement your activity with good nutrition and plan for a restful evening.";
  }

  if (p.energyHigh && p.activityLevel === "active" && p.sleepTrend === "steady") {
    return "You have been consistently active, energy is up, and sleep is steady. Your routine is working well across the board. Today is about sustaining this balance. Consistency in movement, nutrition, sleep, and recovery is what drives lasting results on treatment.";
  }

  if (p.recoveryStreakDir === "improving" && p.recoveryStreak >= 2) {
    return "Your recovery has been improving for " + p.recoveryStreak + " days in a row. That's a great sign. your body is responding well to your recent habits. Whatever you've been doing with sleep, nutrition, and stress management is working. Lean into your plan today with confidence.";
  }

  if (p.recoveryStreakDir === "declining" && p.recoveryStreak >= 2) {
    return "Recovery has been trending down for " + p.recoveryStreak + " days. When recovery drops over multiple days, it usually means your body needs a break from accumulated stress. Scale back today, eat nourishing foods, hydrate well, and prioritize a solid night of sleep. You will bounce back faster by easing off now.";
  }

  if (p.stressHigh && p.recoveryLevel === "strong") {
    return "Stress is high today, but your body is holding up well. recovery looks solid. That means you have some buffer, but don't spend it all. A moderate day with some dedicated stress relief. breathing, a walk outside, or journaling. will help you manage the stress without draining your reserves.";
  }

  if (p.dayType === "push") {
    return "Your sleep, recovery, and energy are all in a good place today. When everything lines up like this, it is a great day to make progress. Try a strength session to preserve muscle, focus on your protein targets, and plan a good wind-down tonight.";
  }

  if (p.dayType === "recover") {
    return "A few signals suggest your body could use a lighter day. That does not mean doing nothing. It means being smart about where you spend your energy. Gentle movement, nourishing food, plenty of water, and good rest will set you up well for tomorrow.";
  }

  if (p.dayType === "maintain") {
    return "Things look steady today. No major flags, no big green lights. This is a good day to follow your plan and stay consistent: eat well, stay hydrated, move your body, and protect your sleep tonight. Steady days like this are the foundation of lasting results on treatment.";
  }

  return "Your sleep, recovery, and energy are in a balanced range today. Stay consistent with your plan. Eat nourishing food, drink enough water, move your body, and prioritize rest. Small, steady effort across all areas is what supports your treatment best.";
}
