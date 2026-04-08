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

export function generateCoachInsight(
  todayMetrics: HealthMetrics,
  allMetrics: HealthMetrics[],
  userInputs: CoachInsightInputs
): string {
  const last7 = allMetrics.slice(-7);
  const last14 = allMetrics.slice(-14);

  const avgSleep7 = last7.reduce((s, m) => s + m.sleepDuration, 0) / last7.length;
  const sleepTonight = todayMetrics.sleepDuration;
  const sleepTrending = avgSleep7 > sleepTonight + 0.3 ? "down" : sleepTonight > avgSleep7 + 0.3 ? "up" : "steady";

  const hrvBaseline = last14.reduce((s, m) => s + m.hrv, 0) / last14.length;
  const hrvDev = ((todayMetrics.hrv - hrvBaseline) / hrvBaseline) * 100;
  const hrvState = hrvDev > 8 ? "above" : hrvDev < -8 ? "below" : "normal";

  const avgRecovery7 = last7.reduce((s, m) => s + m.recoveryScore, 0) / last7.length;
  const recoveryState = todayMetrics.recoveryScore >= 70 ? "strong" : todayMetrics.recoveryScore >= 50 ? "moderate" : "low";

  const avgSteps7 = last7.reduce((s, m) => s + m.steps, 0) / last7.length;
  const activityState = avgSteps7 >= 8000 ? "active" : avgSteps7 >= 5000 ? "moderate" : "low";

  const last3Recovery = last7.slice(-3);
  const consecutiveLowRecovery = last3Recovery.every(m => m.recoveryScore < 50);
  const recentHistory = userInputs.completionHistory.slice(-7);
  const weeklyCompletionRate = recentHistory.length > 0
    ? Math.round(recentHistory.reduce((sum, r) => sum + r.completionRate, 0) / recentHistory.length)
    : -1;

  const { feeling, energy, stress, hydration } = userInputs;

  const signals: string[] = [];

  if (consecutiveLowRecovery && sleepTrending === "down") {
    signals.push("Your recovery has been low for a few days and sleep is trending shorter — your body is asking for rest.");
    signals.push("Keep today light and aim for an earlier bedtime to break the cycle.");
    return signals.join(" ");
  }

  if (stress === "very_high" || stress === "high") {
    if (hrvState === "below") {
      signals.push("Stress is elevated and your heart rate variability confirms it — your nervous system is working harder than usual.");
      signals.push("Prioritize calm today. Light movement and breathing exercises will help more than a hard workout.");
      return signals.join(" ");
    }
    if (sleepTonight < 6.5) {
      signals.push("You're dealing with high stress on limited sleep, which compounds quickly.");
      signals.push("Focus on hydration, a short walk, and getting to bed early tonight — everything else can wait.");
      return signals.join(" ");
    }
    signals.push("Stress is running high today. Even though your body might feel capable, going easier protects your energy for the rest of the week.");
  }

  if (feeling === "tired" || energy === "low") {
    if (recoveryState === "strong" && hrvState !== "below") {
      signals.push("You're feeling tired, but your recovery signals are actually solid.");
      signals.push("This might be mental fatigue rather than physical. A moderate session could actually boost your energy — just don't push too hard.");
      return signals.join(" ");
    }
    if (sleepTrending === "down") {
      signals.push("Low energy makes sense — your sleep has been trending shorter this week.");
      signals.push("A lighter day today plus an earlier bedtime will pay off by tomorrow.");
      return signals.join(" ");
    }
    signals.push("Energy is low today. Listen to that signal and keep things manageable.");
  }

  if (hydration === "dehydrated" || hydration === "low") {
    if (sleepTrending === "down" || energy === "low") {
      signals.push("Low hydration combined with " + (sleepTrending === "down" ? "declining sleep" : "low energy") + " is likely making you feel worse than your body actually is.");
      signals.push("Start with water and electrolytes — you may feel noticeably better within an hour.");
      return signals.join(" ");
    }
  }

  if (feeling === "great" || energy === "excellent" || energy === "high") {
    if (hrvState === "above" && recoveryState === "strong") {
      signals.push("Everything is aligned today — you're feeling good, recovery is strong, and your HRV is above baseline.");
      signals.push("This is a great window for a challenging workout or focused deep work.");
      return signals.join(" ");
    }
    if (hrvState === "below") {
      signals.push("You're feeling good, but your HRV is below baseline — there may be underlying fatigue your body hasn't surfaced yet.");
      signals.push("Go ahead with your plan, but stay moderate and check in with how you feel mid-session.");
      return signals.join(" ");
    }
    if (activityState === "active") {
      signals.push("You've been consistently active and you're feeling strong. Great momentum.");
      signals.push("Keep the intensity where it is — now is about sustaining, not escalating.");
      return signals.join(" ");
    }
    signals.push("Good energy today. Your body is ready for what you have planned.");
  }

  if (signals.length === 0) {
    if (hrvState === "above" && recoveryState === "strong" && sleepTonight >= 7) {
      signals.push("Your body is well-rested and recovered. Sleep was solid and your HRV is tracking above baseline.");
      signals.push("A productive day ahead — make the most of it.");
    } else if (hrvState === "below" && recoveryState === "low") {
      signals.push("Recovery and HRV are both lower than usual, which often means accumulated stress or insufficient rest.");
      signals.push("Ease up today and focus on sleep tonight — you'll bounce back faster by resting now.");
    } else if (weeklyCompletionRate >= 0 && weeklyCompletionRate < 40) {
      signals.push("You've been completing less of your daily plan this week. That's okay — it might mean the plan needs adjusting, not that you're falling behind.");
      signals.push("Try simplifying today. A few small wins build momentum better than ambitious plans left undone.");
    } else if (sleepTrending === "down" && activityState === "active") {
      signals.push("You've been active but sleep is slipping — that combination catches up fast.");
      signals.push("Maintain your movement but prioritize winding down earlier tonight.");
    } else if (recoveryState === "moderate") {
      signals.push("Recovery is middling today — not bad, but not fully charged either.");
      signals.push("A steady, moderate effort is the right call. Save the harder sessions for when recovery is stronger.");
    } else {
      signals.push("Things look balanced today. No major flags from your sleep, recovery, or activity.");
      signals.push("Stay consistent with your plan and keep building on the routine.");
    }
  }

  if (hydration === "dehydrated" || hydration === "low") {
    if (signals.length < 3) {
      signals.push("Also, your hydration is low — drink consistently throughout the day, not just when you feel thirsty.");
    }
  }

  return signals.join(" ");
}
