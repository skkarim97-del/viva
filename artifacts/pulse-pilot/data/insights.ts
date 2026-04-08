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
  const weekSummary = generateWeekSummary(last7, workouts, weightProjection, sleepDebt, recoveryTrend, consistencyScore, trainingLoad);
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
  weight: { rate: number; onTrack: boolean },
  sleep: { hours: number; label: string },
  recovery: { direction: "improving" | "declining" | "stable"; streak: number },
  consistency: { score: number; label: string },
  training: { trend: "rising" | "falling" | "stable" }
) {
  const avgSleep = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;
  const avgSteps = Math.round(last7.reduce((s, m) => s + m.steps, 0) / last7.length);
  const avgRecovery = Math.round(last7.reduce((s, m) => s + m.recoveryScore, 0) / last7.length);
  const recentWorkouts = workouts.filter((w) => {
    const wDate = new Date(w.date).getTime();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return wDate >= cutoff;
  });

  const parts: string[] = [];

  if (avgSleep >= 7.5 && avgRecovery >= 65 && avgSteps >= 7000) {
    parts.push("Strong week overall. Your sleep, recovery, and activity have all been in a good range.");
  } else if (avgSleep >= 7 && avgRecovery >= 55) {
    parts.push("A solid week. Sleep and recovery have held steady, giving your body a stable foundation.");
  } else if (avgSleep < 6.5 && avgRecovery < 50) {
    parts.push("A tough week for your body. Sleep has been short and recovery hasn't had a chance to bounce back.");
  } else if (avgSleep < 7) {
    parts.push("Sleep was a bit thin this week, averaging " + avgSleep.toFixed(1) + " hours. That puts extra pressure on recovery and energy.");
  } else {
    parts.push("A mixed week. Some areas are strong while others have room to improve.");
  }

  if (recovery.direction === "improving") {
    parts.push("Recovery has been trending up, which means your body is responding well to your routine.");
  } else if (recovery.direction === "declining") {
    parts.push("Recovery has been sliding down, which usually means the pace has been a bit much. Dialing back slightly would help.");
  }

  if (recentWorkouts.length >= 4 && avgSteps >= 7000) {
    parts.push("You stayed active with " + recentWorkouts.length + " workouts and solid daily movement — that supports everything from stress management to sleep quality.");
  } else if (recentWorkouts.length >= 3) {
    parts.push("You got in " + recentWorkouts.length + " workouts this week — good consistency. Regular movement helps regulate mood, appetite, and energy.");
  } else if (recentWorkouts.length <= 1 && avgSteps < 5000) {
    parts.push("Activity was light this week. Even small increases — a daily walk, some stretching — can make a noticeable difference in energy, stress, and sleep.");
  }

  const avgSleepQuality = last7.reduce((s, m) => s + m.sleepQuality, 0) / last7.length;
  if (avgSleepQuality >= 80 && avgSleep >= 7) {
    parts.push("Sleep quality has been strong — you're not just getting enough hours, you're getting good rest.");
  } else if (avgSleepQuality < 60) {
    parts.push("Even though you've been in bed, sleep quality has been low. Better wind-down habits or a cooler room might help you get deeper rest.");
  } else if (avgSleepQuality < 70 && avgSleep >= 7) {
    parts.push("You're getting enough sleep hours, but the quality could be better. Small changes to your evening routine can make a real difference.");
  }

  if (training.trend === "rising" && recovery.direction !== "improving") {
    parts.push("Your training load is increasing, but recovery isn't keeping up yet. Watch for fatigue over the next few days.");
  }

  if (sleep.hours > 5 && recovery.direction === "declining" && recentWorkouts.length >= 3) {
    parts.push("You've been putting in the effort, but your body is asking for more recovery time between sessions.");
  }

  if (consistency.score >= 80) {
    parts.push("Consistency has been excellent across your habits — that steady, holistic effort is what drives lasting wellness.");
  } else if (consistency.score < 50) {
    parts.push("Consistency dipped this week. Getting back to a rhythm with the basics — movement, nutrition, hydration, sleep — is the priority.");
  }

  if (weight.onTrack && Math.abs(weight.rate) > 0.1) {
    parts.push("Weight is trending in the right direction at a healthy pace.");
  } else if (!weight.onTrack && Math.abs(weight.rate) > 0.3) {
    parts.push("Weight isn't moving toward your goal yet. A small nutrition adjustment — more whole foods, consistent meal timing — could help.");
  }

  if (parts.length <= 2) {
    parts.push("Keep building on this foundation heading into next week. Small, consistent improvements in sleep, nutrition, and stress management add up.");
  }

  return parts.slice(0, 3).join("\n\n");
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
    return "Your recovery has been dropping for " + (p.recoveryStreak || "a few") + " days while sleep keeps getting shorter. These two things feed each other — less sleep means slower recovery, which affects your energy, mood, and even appetite. Today is about rest. Eat nourishing meals, drink plenty of water, and get to bed early tonight.";
  }

  if (p.stressHigh && p.sleepLast < 6.5 && p.recoveryLevel !== "strong") {
    return "High stress on a short night of sleep puts pressure on everything — your energy, focus, digestion, and mood. When both stack up, pushing through usually makes things worse. Focus on three things today: eat whole, calming foods, drink water steadily, and get to bed early. A gentle walk outside will help more than a hard workout.";
  }

  if (p.stressHigh && p.recoveryLevel === "low") {
    return "Stress is high and your body is feeling it — recovery is lower than usual. When stress takes hold, it affects sleep quality, appetite, and how well your body restores itself. Today, focus on calming your nervous system. Try 10 minutes of breathing, eat warm whole foods, and skip anything intense. Protecting your energy now means a better tomorrow.";
  }

  if (p.stressHigh && p.hydrationLow) {
    return "Stress and dehydration are a tough combination. Stress increases your body's demand for water, and being low on fluids makes stress feel worse — it affects concentration, mood, and energy. Start sipping water now and keep it steady throughout the day. Pair that with some breathing or a short walk to help your system settle.";
  }

  if (p.stressHigh && p.activityLevel === "active" && p.sleepTrend !== "up") {
    return "You've been staying active while stress has been high. That takes real effort, but without enough recovery, it can wear you down instead of building you up. Consider trading today's intense session for yoga, stretching, or a nature walk. Pair that with good nutrition and an earlier bedtime — your body will thank you.";
  }

  if (p.feelingNegative && p.recoveryLevel === "strong" && !p.energyLow) {
    return "You're not feeling your best mentally, but physically your body is in good shape — recovery is strong. This is likely more about mental energy than physical fatigue. A change of scenery, a walk outside without your phone, or a short meditation could shift things. Nourish yourself well today and don't put too much pressure on being productive.";
  }

  if (p.energyLow && p.sleepTrend === "down" && p.hydrationLow) {
    return "Low energy, less sleep than usual, and low water intake — these three together explain why today feels harder. The good news is that two of those are fixable right now. Start drinking water, eat something nourishing with complex carbs and protein, and plan for an earlier bedtime. Small fixes in nutrition and hydration make a surprisingly fast difference.";
  }

  if (p.energyLow && p.hydrationLow) {
    return "Low energy combined with low hydration is more connected than most people realize. Even mild dehydration can drain your focus, mood, and motivation. Before you reach for caffeine, try water first — a big glass now and steady sipping through the day. Pair that with a balanced meal and see how you feel in an hour.";
  }

  if (p.energyLow && p.sleepTrend === "down") {
    return "Your energy is low, and shorter sleep this week is the likely reason. When sleep dips even a little over several days, it compounds — affecting your mood, appetite, and ability to handle stress. A lighter day with nourishing food, steady hydration, and an earlier bedtime is the fastest way to bounce back.";
  }

  if (p.feelingNegative && p.sleepLast < 6.5) {
    return "Last night's sleep was short, and that's showing up in how you feel today. Less than six and a half hours affects more than energy — it impacts mood, hunger signals, and stress tolerance. Keep today's expectations realistic. Focus on eating well, staying hydrated, and getting a good night's sleep tonight.";
  }

  if (p.activityVsSleep === "mismatch") {
    return "You've been active this week, but your sleep has been getting shorter. High activity with declining sleep is a pattern that catches up in every area — energy, mood, stress tolerance, and even appetite control. Keep your movement going, but make winding down earlier tonight your top priority. Your body needs both sides of the equation.";
  }

  if (!p.sleepConsistent && p.activityLevel === "active") {
    return "Your activity has been strong, but your sleep schedule has been up and down. Inconsistent sleep makes it harder for your body to recover, regulate stress hormones, and maintain steady energy. Try going to bed within the same 30-minute window each night — even on weekends. Consistent sleep is one of the most powerful wellness habits you can build.";
  }

  if (p.movementStrong && p.recoveryHabitWeak) {
    return "You've been great about staying active, but recovery habits like stretching, good nutrition, hydration, and wind-down time have been falling behind. Movement is only half the picture — without recovery, the benefits plateau and stress accumulates. Try adding one restorative action today: a stretch, a mindful meal, or 10 minutes of quiet time.";
  }

  if (p.completionRate >= 0 && p.completionRate < 35 && p.recoveryLevel !== "low") {
    return "You've completed less of your daily plan this week. That usually means the plan is too ambitious, not that you're falling short. Your body is in decent shape, so the fix is about simplifying. Pick two or three things that matter most today — maybe a walk, a good meal, and getting to bed on time — and let the rest go.";
  }

  if (p.completionConsistent && p.recoveryLevel === "strong" && p.sleepTrend !== "down") {
    return "You've been showing up consistently across all areas — movement, nutrition, sleep, and mental wellness. Recovery is strong and your routine is working. This kind of steady, holistic effort is what creates lasting results. Keep doing what you're doing and trust the process.";
  }

  if (p.feelingPositive && p.recoveryLevel === "strong" && p.energyHigh) {
    return "Everything is aligned today — body, mind, and energy. When you feel this good and recovery backs it up, it's a window to challenge yourself. Push a bit harder in your workout, tackle something demanding, or invest extra effort in meal prep and habits that set up the rest of your week.";
  }

  if (p.feelingPositive && p.recoveryVsNormal === "below") {
    return "You're feeling good today, but your recovery is a bit lower than usual. That can mean your body is still catching up from recent days. Go ahead with your plans, but keep things moderate and make sure you're eating well and staying hydrated. Check in with yourself halfway through the day.";
  }

  if (p.energyHigh && p.recoveryLevel === "moderate") {
    return "Your energy is high, which is great. But recovery is only moderate, so there's a tradeoff — pushing hard today could mean feeling it tomorrow. A solid moderate effort is the sweet spot. Complement your activity with good nutrition and plan for a restful evening.";
  }

  if (p.energyHigh && p.activityLevel === "active" && p.sleepTrend === "steady") {
    return "You've been consistently active, energy is up, and sleep is steady. Your routine is working well across the board. Today is about sustaining this balance rather than ramping up. Consistency in movement, nutrition, sleep, and stress management — that's what drives lasting wellness.";
  }

  if (p.recoveryStreakDir === "improving" && p.recoveryStreak >= 2) {
    return "Your recovery has been improving for " + p.recoveryStreak + " days in a row. That's a great sign — your body is responding well to your recent habits. Whatever you've been doing with sleep, nutrition, and stress management is working. Lean into your plan today with confidence.";
  }

  if (p.recoveryStreakDir === "declining" && p.recoveryStreak >= 2) {
    return "Recovery has been trending down for " + p.recoveryStreak + " days. When recovery drops over multiple days, it usually means your body needs a break — not just from training, but from accumulated stress. Scale back today, eat nourishing foods, hydrate well, and prioritize a solid night of sleep. You'll bounce back faster by easing off now.";
  }

  if (p.stressHigh && p.recoveryLevel === "strong") {
    return "Stress is high today, but your body is holding up well — recovery looks solid. That means you have some buffer, but don't spend it all. A moderate day with some dedicated stress relief — breathing, a walk outside, or journaling — will help you manage the stress without draining your reserves.";
  }

  if (p.dayType === "push") {
    return "Your sleep, recovery, and energy are all in a good place today. When everything lines up like this, it's a window to make real progress — in your workout, your nutrition habits, or something you've been putting off. Challenge yourself, fuel well, and plan a good wind-down tonight.";
  }

  if (p.dayType === "recover") {
    return "A few signals suggest your body and mind could use a lighter day. That doesn't mean doing nothing — it means being smart about where you spend your energy. Gentle movement, nourishing food, plenty of water, and some quiet time will set you up well for tomorrow.";
  }

  if (p.dayType === "maintain") {
    return "Things look steady today — no major flags, no big green lights. This is a good day to follow your plan and stay consistent across all areas: eat well, stay hydrated, move your body, and protect your sleep tonight. Steady days like this are the foundation of lasting wellness.";
  }

  return "Your sleep, recovery, and energy are in a balanced range today. Stay consistent with your plan — eat nourishing food, drink enough water, move your body, and take care of your mind. Small, steady effort across all areas is what creates lasting change.";
}
