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
  hrvBaseline: { current: number; baseline: number; deviation: number; detail: string };
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
  profile: UserProfile
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
  const weekSummary = generateWeekSummary(last7, workouts, weightProjection, sleepDebt);
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
    detail = `You are ${totalDeficit.toFixed(1)} hours short of ideal sleep over the past week. This affects recovery, decision-making, and appetite regulation. Prioritize an extra 30 minutes tonight.`;
  } else if (totalDeficit > 3) {
    label = "Moderate debt";
    detail = `You have accumulated ${totalDeficit.toFixed(1)} hours of sleep debt this week. Try to go to bed 20 minutes earlier for the next few nights.`;
  } else if (totalDeficit > 0) {
    label = "Minor debt";
    detail = `Slight deficit of ${totalDeficit.toFixed(1)} hours. Nothing to worry about if you sleep well tonight.`;
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

  const avgStrain = last14.reduce((s, m) => s + m.strain, 0) / last14.length;
  const recentStrain = last14.slice(-7).reduce((s, m) => s + m.strain, 0) / Math.min(7, last14.slice(-7).length);
  const olderStrain = last14.slice(0, 7).reduce((s, m) => s + m.strain, 0) / Math.min(7, last14.slice(0, 7).length);

  const trend: "rising" | "falling" | "stable" =
    recentStrain > olderStrain * 1.15 ? "rising" : recentStrain < olderStrain * 0.85 ? "falling" : "stable";

  let label = "Moderate";
  if (loadScore > 400) label = "High";
  else if (loadScore > 600) label = "Very High";
  else if (loadScore < 150) label = "Low";

  const trendWord = trend === "rising" ? "increasing" : trend === "falling" ? "decreasing" : "steady";
  const detail = `${recentWorkouts.length} workouts in the past 2 weeks. Average strain is ${avgStrain.toFixed(1)}. Training load is ${trendWord}. ${
    trend === "rising"
      ? "Make sure recovery keeps pace. Consider a lighter session if fatigue builds."
      : trend === "falling"
      ? "You have room to push a little harder if recovery allows."
      : "Good balance between training and recovery."
  }`;

  return { score: loadScore, label, detail, trend };
}

function computeRecoveryTrend(last7: HealthMetrics[]) {
  let improving = 0;
  let declining = 0;

  for (let i = 1; i < last7.length; i++) {
    if (last7[i].recoveryScore > last7[i - 1].recoveryScore) improving++;
    else if (last7[i].recoveryScore < last7[i - 1].recoveryScore) declining++;
  }

  const direction: "improving" | "declining" | "stable" =
    improving >= declining + 2 ? "improving" : declining >= improving + 2 ? "declining" : "stable";

  const avg = last7.reduce((s, m) => s + m.recoveryScore, 0) / last7.length;

  let streak = 0;
  for (let i = last7.length - 1; i > 0; i--) {
    if (direction === "improving" && last7[i].recoveryScore >= last7[i - 1].recoveryScore) streak++;
    else if (direction === "declining" && last7[i].recoveryScore <= last7[i - 1].recoveryScore) streak++;
    else break;
  }

  const detail =
    direction === "improving"
      ? `Recovery has been improving for ${streak} days. Average score: ${Math.round(avg)}%. Your body is adapting well.`
      : direction === "declining"
      ? `Recovery has been declining for ${streak} days. Average: ${Math.round(avg)}%. Consider reducing training intensity or improving sleep.`
      : `Recovery is holding steady at an average of ${Math.round(avg)}%. Consistent inputs are producing consistent results.`;

  return { direction, streak, detail };
}

function computeWeightProjection(last30: HealthMetrics[], profile: UserProfile) {
  if (last30.length < 7) {
    return { weeksToGoal: null, rate: 0, detail: "Not enough data to project weight trends yet.", onTrack: false };
  }

  const first7Avg = last30.slice(0, 7).reduce((s, m) => s + m.weight, 0) / 7;
  const last7Avg = last30.slice(-7).reduce((s, m) => s + m.weight, 0) / 7;
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
    detail = `Your weight is trending up (${rateStr} lbs/week) while your goal is to lose weight. Review your calorie intake and make sure you are in a slight deficit.`;
  } else if (weeksToGoal !== null) {
    detail = `Projected ${weeksToGoal} weeks to goal at ${rateStr} lbs/week. ${Math.abs(weeklyRate) > 1.5 ? "This rate is faster than recommended. Slower loss preserves muscle." : "Consistent effort will get you there."}`;
  } else {
    detail = `Weight is relatively stable. If your goal is to change weight, a small calorie adjustment of 200-300 calories may help.`;
  }

  return { weeksToGoal, rate: Math.round(weeklyRate * 10) / 10, detail, onTrack };
}

function computeCalorieBalance(last7: HealthMetrics[], today: HealthMetrics) {
  const avgBurn = last7.reduce((s, m) => s + m.caloriesBurned, 0) / last7.length;
  const estimatedIntake = 2100;
  const net = Math.round(today.caloriesBurned - estimatedIntake);

  let label = "Balanced";
  if (net > 300) label = "Surplus burn";
  else if (net < -300) label = "Deficit";

  const detail = `You are burning an average of ${Math.round(avgBurn).toLocaleString()} calories per day. Today: ${today.caloriesBurned.toLocaleString()} burned, with ${today.activeCalories} from exercise. ${
    net > 200
      ? "Good activity level for fat loss goals."
      : "Make sure your intake supports your training."
  }`;

  return { net, label, detail };
}

function computeHRVBaseline(last14: HealthMetrics[], today: HealthMetrics) {
  const baseline = last14.reduce((s, m) => s + m.hrv, 0) / last14.length;
  const deviation = today.hrv - baseline;
  const deviationPct = (deviation / baseline) * 100;

  let detail = "";
  if (deviationPct > 10) {
    detail = `Your HRV is ${Math.round(deviationPct)}% above your 14-day baseline of ${Math.round(baseline)} ms. Your nervous system is well-recovered. A good day for challenging work.`;
  } else if (deviationPct < -10) {
    detail = `Your HRV is ${Math.round(Math.abs(deviationPct))}% below your 14-day baseline of ${Math.round(baseline)} ms. Your autonomic nervous system is under more stress than usual. Consider lighter training.`;
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
  const workoutConsistency = Math.min(recentWorkouts.length / 8, 1);

  const score = Math.round((sleepConsistency * 0.35 + stepConsistency * 0.3 + workoutConsistency * 0.35) * 100);

  let label = "Excellent";
  if (score < 50) label = "Needs work";
  else if (score < 70) label = "Fair";
  else if (score < 85) label = "Good";

  const parts: string[] = [];
  if (sleepConsistency < 0.7) parts.push("sleep regularity");
  if (stepConsistency < 0.6) parts.push("daily movement");
  if (workoutConsistency < 0.5) parts.push("workout frequency");

  const detail = parts.length > 0
    ? `Score: ${score}/100. Areas to improve: ${parts.join(", ")}. Consistency drives long-term results more than intensity.`
    : `Score: ${score}/100. You are showing strong consistency across sleep, movement, and training. Keep it up.`;

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

  if (sleepDebt.hours > 7) flags.push("High sleep debt — recovery and performance are compromised");
  if (hrv.deviation < -8) flags.push("HRV is significantly below baseline — signs of accumulated stress");
  if (today.restingHeartRate > 70) flags.push("Elevated resting heart rate — possible stress or incomplete recovery");
  if (load.trend === "rising" && hrv.deviation < -3) flags.push("Training load is rising while recovery is dropping — risk of overreaching");
  if (today.sleepDuration < 6) flags.push("Slept under 6 hours — cognitive and physical performance will be reduced");

  const consecutivePoorRecovery = last7.slice(-3).every((m) => m.recoveryScore < 50);
  if (consecutivePoorRecovery) flags.push("Three consecutive days of low recovery — take a rest day");

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

  const detail = `Estimated BMR: ${Math.round(bmr)} cal. With today's activity level, your estimated total daily expenditure is ${tdee.toLocaleString()} calories. ${
    profile.goals.includes("fat_loss")
      ? `For fat loss, aim for ${Math.round(tdee * 0.85)}-${Math.round(tdee * 0.9)} calories.`
      : profile.goals.includes("muscle_gain")
      ? `For muscle gain, aim for ${Math.round(tdee * 1.1)}-${Math.round(tdee * 1.15)} calories.`
      : `To maintain, eat around ${tdee} calories.`
  }`;

  return { estimatedTDEE: tdee, detail };
}

function determineTopPriority(
  risks: { flags: string[]; severity: string },
  sleep: { hours: number; label: string },
  recovery: { direction: string },
  load: { trend: string },
  weight: { onTrack: boolean }
) {
  if (risks.severity === "high") return "Your body is showing multiple stress signals. Take it easy today. Prioritize sleep and light movement only.";
  if (sleep.hours > 7) return "Sleep debt is your biggest limiter right now. Going to bed 30 minutes earlier tonight is the single most impactful thing you can do.";
  if (recovery.direction === "declining") return "Recovery is trending down. Reduce training intensity until your HRV and recovery scores stabilize.";
  if (load.trend === "rising") return "Training load is building. Watch for fatigue over the next 2-3 days and take a rest day if recovery dips.";
  if (!weight.onTrack) return "Weight trend is not matching your goal. Review your nutrition — a small calorie adjustment may be needed.";
  return "You are on track. Keep doing what you are doing. Consistency is your biggest advantage right now.";
}

function generateWeekSummary(
  last7: HealthMetrics[],
  workouts: WorkoutEntry[],
  weight: { rate: number },
  sleep: { hours: number }
) {
  const avgSleep = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;
  const avgSteps = Math.round(last7.reduce((s, m) => s + m.steps, 0) / last7.length);
  const avgRecovery = Math.round(last7.reduce((s, m) => s + m.recoveryScore, 0) / last7.length);
  const recentWorkouts = workouts.filter((w) => {
    const wDate = new Date(w.date).getTime();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return wDate >= cutoff;
  });

  return `This week: ${avgSleep.toFixed(1)}h avg sleep, ${avgSteps.toLocaleString()} avg steps, ${avgRecovery}% avg recovery, ${recentWorkouts.length} workouts. Weight change: ${weight.rate >= 0 ? "+" : ""}${weight.rate} lbs/week.`;
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

  const recentQualityAvg = last7.reduce((s, m) => s + m.sleepQuality, 0) / last7.length;
  const olderQualityAvg = last14.slice(0, 7).reduce((s, m) => s + m.sleepQuality, 0) / Math.min(7, last14.slice(0, 7).length);
  const qualityTrending = recentQualityAvg < olderQualityAvg - 5 ? "declining" : recentQualityAvg > olderQualityAvg + 5 ? "improving" : "stable";

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
    insight = "Sleep is consistent and adequate. This is one of the strongest contributors to your overall wellness.";
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

  const hrvBaseline = last14.reduce((s, m) => s + m.hrv, 0) / last14.length;
  const hrvDev = ((todayMetrics.hrv - hrvBaseline) / hrvBaseline) * 100;

  const recoveryLevel: "strong" | "moderate" | "low" =
    todayMetrics.recoveryScore >= 70 ? "strong" : todayMetrics.recoveryScore >= 50 ? "moderate" : "low";

  const avgRecovery14 = last14.reduce((s, m) => s + m.recoveryScore, 0) / last14.length;
  const recoveryVsNormal: "above" | "below" | "normal" =
    todayMetrics.recoveryScore > avgRecovery14 + 8 ? "above" :
    todayMetrics.recoveryScore < avgRecovery14 - 8 ? "below" : "normal";

  let recoveryStreak = 0;
  let recoveryStreakDir: "improving" | "declining" | "stable" = "stable";
  for (let i = last7.length - 1; i > 0; i--) {
    if (last7[i].recoveryScore > last7[i - 1].recoveryScore + 3) {
      if (recoveryStreakDir === "stable" || recoveryStreakDir === "improving") {
        recoveryStreakDir = "improving";
        recoveryStreak++;
      } else break;
    } else if (last7[i].recoveryScore < last7[i - 1].recoveryScore - 3) {
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
    return insight + " Also, your water intake is low — sipping throughout the day will help everything else work better.";
  }

  return insight;
}

function selectInsight(p: SignalProfile): string {

  if (p.dayType === "rest" && p.sleepTrend === "down" && p.recoveryStreakDir === "declining") {
    return "Your recovery has been dropping for " + (p.recoveryStreak || "a few") + " days while sleep keeps getting shorter. These two things feed each other — less sleep means slower recovery, which makes everything harder. Today is a rest day. Keep it light and get to bed early tonight.";
  }

  if (p.stressHigh && p.sleepLast < 6.5 && p.recoveryLevel !== "strong") {
    return "High stress on a short night of sleep is putting extra pressure on your body. When both stack up, energy and focus drop faster than either one alone. Focus on one thing today: getting to bed early. A walk and some water will carry you through the rest.";
  }

  if (p.stressHigh && p.recoveryLevel === "low") {
    return "Stress is high and your body is showing it — recovery is lower than usual. That combination means pushing hard today would cost more than it's worth. A short walk or some breathing exercises will do more good than a tough workout. Protect your energy for later in the week.";
  }

  if (p.stressHigh && p.activityLevel === "active" && p.sleepTrend !== "up") {
    return "You've been staying active while stress has been high. That effort is admirable, but without enough recovery time, it can wear you down. Consider a lighter session today so your body can catch up. You'll get more out of tomorrow's effort.";
  }

  if (p.feelingNegative && p.recoveryLevel === "strong" && !p.energyLow) {
    return "You're not feeling your best, but your body is actually in good shape — recovery is strong and your recent sleep supports that. This is likely more mental fatigue than physical. A moderate workout or a change of scenery could shift your energy. Don't push too hard, but don't write the day off either.";
  }

  if (p.energyLow && p.sleepTrend === "down" && p.hydrationLow) {
    return "Low energy, less sleep than usual, and low water intake — these three together explain why today feels harder. The good news is that two of those are fixable right now. Start drinking water and plan for an earlier bedtime. You should feel a difference by this afternoon.";
  }

  if (p.energyLow && p.sleepTrend === "down") {
    return "Your energy is low, and shorter sleep this week is the likely reason. When sleep dips even a little over several days, it adds up. A lighter day today and an earlier bedtime tonight is the fastest way to bounce back.";
  }

  if (p.feelingNegative && p.sleepLast < 6.5) {
    return "Last night's sleep was short, and that's showing up in how you feel today. Less than six and a half hours doesn't give your body enough time to fully recharge. Keep today's expectations realistic and prioritize sleep tonight — you'll feel like a different person tomorrow.";
  }

  if (p.activityVsSleep === "mismatch") {
    return "You've been active this week, but your sleep has been getting shorter. High activity with declining sleep is a pattern that catches up quickly — energy, mood, and performance all take a hit. Keep your movement going, but make winding down earlier tonight your top priority.";
  }

  if (!p.sleepConsistent && p.activityLevel === "active") {
    return "Your activity has been strong, but your sleep schedule has been up and down. Inconsistent sleep makes it harder for your body to recover from workouts, even when the total hours look okay. Try to go to bed within the same 30-minute window each night this week.";
  }

  if (p.movementStrong && p.recoveryHabitWeak) {
    return "You've been great about staying active — your movement consistency is strong. But recovery habits like stretching, rest, and wind-down time have been falling behind. Without recovery, the benefits of movement plateau. Try adding one recovery action to your day today.";
  }

  if (p.completionRate >= 0 && p.completionRate < 35 && p.recoveryLevel !== "low") {
    return "You've completed less of your daily plan this week. That usually means the plan is too ambitious, not that you're falling short. Your body is actually in decent shape, so the fix is about simplifying. Pick two or three things that matter most today and focus there.";
  }

  if (p.completionConsistent && p.recoveryLevel === "strong" && p.sleepTrend !== "down") {
    return "You've been showing up consistently and it's paying off — recovery is strong and your routine is solid. This kind of steady effort is what creates lasting results. Keep doing what you're doing and trust the process.";
  }

  if (p.feelingPositive && p.recoveryLevel === "strong" && p.energyHigh) {
    return "Everything is aligned today. You're feeling good, your body is well-recovered, and energy is high. This is one of those days where you can challenge yourself — push a little harder in your workout or tackle something demanding. Make the most of it.";
  }

  if (p.feelingPositive && p.recoveryVsNormal === "below") {
    return "You're feeling good today, but your recovery is a bit lower than your usual. That can mean your body is still catching up from recent days. Go ahead with your plans, but keep things moderate. Check in with how you feel halfway through and adjust if needed.";
  }

  if (p.energyHigh && p.recoveryLevel === "moderate") {
    return "Your energy is high, which is great. But recovery is only moderate, so there's a tradeoff — pushing hard today could mean feeling it tomorrow. A solid moderate effort is the sweet spot. You'll get a good session in without borrowing from tomorrow's energy.";
  }

  if (p.energyHigh && p.activityLevel === "active" && p.sleepTrend === "steady") {
    return "You've been consistently active, energy is up, and sleep is steady. Your routine is working well. Today is about sustaining this momentum rather than ramping up. Consistency at this level will bring better results than occasional big efforts.";
  }

  if (p.recoveryStreakDir === "improving" && p.recoveryStreak >= 2) {
    return "Your recovery has been improving for " + p.recoveryStreak + " days in a row. That's a great sign — your body is responding well to your recent choices. Today you can lean into your plan with confidence. If you've been holding back, now is a good time to step it up slightly.";
  }

  if (p.recoveryStreakDir === "declining" && p.recoveryStreak >= 2) {
    return "Recovery has been trending down for " + p.recoveryStreak + " days. When recovery drops over multiple days, it usually means your body needs a break from the current pace. Scale back today and focus on sleep and nutrition. You'll recover faster by easing off now.";
  }

  if (p.stressHigh && p.recoveryLevel === "strong") {
    return "Stress is high today, but your body is actually holding up well — recovery looks solid. That means you have some buffer, but don't spend it all. A moderate day will let you manage the stress without draining your reserves. Save the hard efforts for when stress settles.";
  }

  if (p.dayType === "push") {
    return "Your sleep, recovery, and energy are all in a good place today. When everything lines up like this, it's a window to push a little harder than usual. Challenge yourself with your workout or tackle something you've been putting off. Days like this are worth making the most of.";
  }

  if (p.dayType === "recover") {
    return "A few signals suggest your body could use a lighter day. That doesn't mean doing nothing — it means being smart about where you spend your energy. A moderate pace with some extra attention to hydration and rest will set you up well for tomorrow.";
  }

  if (p.dayType === "maintain") {
    return "Things look steady today. No major flags, no big green lights. This is a good day to follow your plan as-is and stay consistent. Steady days like this are the foundation that makes the big days possible.";
  }

  return "Your sleep, recovery, and activity are in a balanced range today. Stay consistent with your plan and keep building on your routine. Small, steady effort is what creates lasting change.";
}
