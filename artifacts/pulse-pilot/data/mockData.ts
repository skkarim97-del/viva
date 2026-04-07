import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  WeeklyPlan,
  TrendData,
  WorkoutEntry,
  IntegrationStatus,
  MetricDetail,
  MetricKey,
} from "@/types";

export const defaultProfile: UserProfile = {
  id: "user_1",
  name: "",
  age: 32,
  sex: "male",
  height: 70,
  weight: 185,
  goalWeight: 170,
  dietaryPreference: "balanced",
  workoutPreference: "mixed",
  injuries: "",
  availableWorkoutTime: 45,
  daysAvailableToTrain: 4,
  coachingTone: "motivating",
  goals: ["fat_loss", "better_sleep"],
  tier: "free",
  onboardingComplete: false,
  fastingEnabled: false,
  units: "imperial",
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
    const baseSteps = 7500 + Math.sin(i / 3) * 2500;
    const baseWeight = 185 - (i > 15 ? 0 : (15 - i) * 0.15);

    metrics.push({
      date: generateDateString(i),
      steps: Math.round(baseSteps + (Math.random() - 0.5) * 1000),
      caloriesBurned: Math.round(2200 + Math.random() * 400),
      activeCalories: Math.round(350 + Math.random() * 200),
      restingHeartRate: Math.round(baseRhr + (Math.random() - 0.5) * 4),
      hrv: Math.round(baseHrv + (Math.random() - 0.5) * 6),
      weight: Math.round((baseWeight + (Math.random() - 0.5) * 1) * 10) / 10,
      sleepDuration: Math.round((baseSleep + (Math.random() - 0.5) * 1) * 10) / 10,
      sleepQuality: Math.round(65 + Math.random() * 30),
      recoveryScore: Math.round(55 + Math.random() * 40),
      strain: Math.round((8 + Math.random() * 8) * 10) / 10,
      vo2Max: 38 + Math.round(Math.random() * 5),
    });
  }
  return metrics;
}

export function generateMockWorkouts(): WorkoutEntry[] {
  const types = ["Strength Training", "Zone 2 Run", "HIIT", "Yoga", "Walk", "Cycling"];
  const intensities: ("low" | "moderate" | "high" | "very_high")[] = ["low", "moderate", "high", "very_high"];
  const workouts: WorkoutEntry[] = [];

  for (let i = 0; i < 12; i++) {
    workouts.push({
      id: `wo_${i}`,
      date: generateDateString(i * 2 + Math.round(Math.random())),
      type: types[i % types.length],
      duration: 30 + Math.round(Math.random() * 30),
      intensity: intensities[Math.min(i % 4, 3)],
      caloriesBurned: 200 + Math.round(Math.random() * 300),
      heartRateAvg: 120 + Math.round(Math.random() * 40),
    });
  }
  return workouts;
}

export function getTodayMetrics(): HealthMetrics {
  const all = generateMockMetrics(1);
  return all[0];
}

export function generateDailyPlan(metrics: HealthMetrics): DailyPlan {
  const readinessScore = Math.round(
    metrics.recoveryScore * 0.3 +
    metrics.sleepQuality * 0.3 +
    (metrics.hrv / 60) * 100 * 0.2 +
    (1 - Math.min(metrics.restingHeartRate, 80) / 80) * 100 * 0.2
  );

  const readinessLabel = readinessScore >= 80 ? "Excellent" : readinessScore >= 65 ? "Good" : readinessScore >= 45 ? "Moderate" : "Low";

  let headline = "";
  let summary = "";
  let todaysPlan = { workout: "", movement: "", nutrition: "", recovery: "" };
  let whyThisPlan: string[] = [];
  let optional = "";
  let workoutType = "";
  let workoutIntensity: "low" | "moderate" | "high" = "moderate";
  let workoutDuration = 40;
  let workoutDesc = "";

  if (readinessScore >= 75) {
    headline = "Push today. Your body is ready for a challenge.";
    summary = "Your recovery is strong and sleep was solid. This is a good day to train hard.";
    todaysPlan = {
      workout: "Strength training, 50 minutes. Focus on compound lifts.",
      movement: "Hit 8,000 steps outside of your workout.",
      nutrition: "2,200 calories. Prioritize protein and complex carbs before training.",
      recovery: "Stretch for 10 minutes after your session. Hydrate with 96oz of water.",
    };
    whyThisPlan = [
      "Your HRV is above your 7-day average.",
      "Resting heart rate is steady at baseline.",
      "You slept well and recovery score is high.",
    ];
    optional = "If you feel fatigued by mid-session, drop to moderate intensity. No need to force it.";
    workoutType = "Strength Training";
    workoutIntensity = "high";
    workoutDuration = 50;
    workoutDesc = "Full body strength with compound movements. Your body is recovered and ready.";
  } else if (readinessScore >= 45) {
    headline = "Go moderate today. Stay consistent without overdoing it.";
    summary = "Your recovery is decent but not fully topped off. A steady effort keeps you on track.";
    todaysPlan = {
      workout: "Zone 2 cardio, 40 minutes. Easy pace run, bike, or walk.",
      movement: "Aim for 7,500 steps throughout the day.",
      nutrition: "2,000 calories. Balanced meals with protein at every meal.",
      recovery: "Wind down by 10pm. Avoid screens 30 minutes before bed.",
    };
    whyThisPlan = [
      "Recovery metrics are moderate, not fully recharged.",
      "Sleep was adequate but not exceptional.",
      "A moderate session builds fitness without adding too much stress.",
    ];
    optional = "If energy feels low, a 30-minute walk is a perfectly good alternative.";
    workoutType = "Zone 2 Cardio";
    workoutIntensity = "moderate";
    workoutDuration = 40;
    workoutDesc = "Steady-state cardio at an easy, conversational pace. Build your aerobic base.";
  } else {
    headline = "Rest today. Recovery will make you stronger tomorrow.";
    summary = "Your body is showing signs of accumulated stress. Taking it easy today is the right call.";
    todaysPlan = {
      workout: "Active recovery only. Light stretching or gentle yoga, 20 minutes.",
      movement: "A short walk is fine. No step target today.",
      nutrition: "1,900 calories. Focus on nutrient-dense foods and hydration.",
      recovery: "Prioritize sleep tonight. Aim for 8+ hours. Try to be in bed by 9:30pm.",
    };
    whyThisPlan = [
      "Your HRV is below your baseline, indicating your body needs rest.",
      "Resting heart rate is elevated, a sign of incomplete recovery.",
      "Sleep quality was lower than usual.",
    ];
    optional = "If you feel restless, a 20-minute walk at an easy pace is the most you should do.";
    workoutType = "Active Recovery";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Light mobility work and stretching. Let your body recover.";
  }

  const sleepHours = metrics.sleepDuration;
  let sleepSummary = "";
  if (sleepHours < 7) {
    sleepSummary = `You got ${sleepHours.toFixed(1)} hours. That is less than your body needs. Aim for an earlier bedtime tonight.`;
  } else if (sleepHours >= 8) {
    sleepSummary = `You got ${sleepHours.toFixed(1)} hours. Solid rest. Keep this consistent.`;
  } else {
    sleepSummary = `You got ${sleepHours.toFixed(1)} hours. Adequate, but pushing closer to 8 would help recovery.`;
  }

  let recoverySummary = "";
  if (metrics.recoveryScore >= 75) {
    recoverySummary = "Your recovery is strong. Your body has bounced back well from recent activity.";
  } else if (metrics.recoveryScore >= 50) {
    recoverySummary = "Recovery is moderate. You can train, but listen to your body.";
  } else {
    recoverySummary = "Your body is still recovering. Rest today will help you come back stronger.";
  }

  return {
    date: metrics.date,
    readinessScore,
    readinessLabel,
    headline,
    summary,
    todaysPlan,
    whyThisPlan,
    optional,
    recoverySummary,
    sleepSummary,
    workoutRecommendation: {
      type: workoutType,
      duration: workoutDuration,
      intensity: workoutIntensity,
      description: workoutDesc,
    },
    nutritionTarget: {
      calories: readinessScore >= 65 ? 2200 : 1900,
      protein: 160,
      carbs: readinessScore >= 65 ? 220 : 180,
      fat: 65,
      hydration: 96,
      note: readinessScore >= 65
        ? "Fuel up for your workout. Prioritize protein and complex carbs."
        : "Focus on nutrient-dense foods and stay hydrated for recovery.",
    },
    fastingGuidance: "16:8 window. Start eating at 12pm, last meal by 8pm.",
  };
}

export function generateWeeklyPlan(): WeeklyPlan {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const planDays = days.map((day, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const isRest = i === 2 || i === 5;

    return {
      dayOfWeek: day,
      date: date.toISOString().split("T")[0],
      isRestDay: isRest,
      workout: isRest
        ? undefined
        : {
            type: i === 0 || i === 3 ? "Strength Training" : i === 1 || i === 4 ? "Zone 2 Cardio" : "HIIT",
            duration: i === 6 ? 30 : 45,
            intensity: (i === 0 || i === 3 ? "high" : i === 6 ? "high" : "moderate") as "low" | "moderate" | "high",
            description:
              i === 0 || i === 3
                ? "Full body strength with compound lifts."
                : i === 1 || i === 4
                ? "Easy pace run or bike. Keep it conversational."
                : "Short, intense intervals. Push hard, recover fully between sets.",
          },
      focusArea: isRest
        ? "Rest & Recovery"
        : i === 0 || i === 3
        ? "Strength"
        : i === 1 || i === 4
        ? "Cardio"
        : "Conditioning",
    };
  });

  return {
    weekStartDate: monday.toISOString().split("T")[0],
    days: planDays,
    nutritionPriorities: [
      "Hit 160g protein daily.",
      "Eat complex carbs before workouts.",
      "Drink at least 96oz of water.",
      "Include vegetables at every meal.",
    ],
    stepGoal: 8000,
    fastingSchedule: "16:8. Eat between 12pm and 8pm.",
    adjustmentNote: "If you feel unusually tired mid-week, swap Thursday's strength session for active recovery.",
  };
}

export function generateTrendData(): TrendData[] {
  const metrics = generateMockMetrics(30);

  return [
    {
      label: "Weight",
      data: metrics.map((m) => ({ date: m.date, value: m.weight })),
      unit: "lbs",
      trend: "down",
      summary: "Down 2.1 lbs over the last 30 days. You are on track for your goal.",
    },
    {
      label: "HRV",
      data: metrics.map((m) => ({ date: m.date, value: m.hrv })),
      unit: "ms",
      trend: "up",
      summary: "Your HRV has been trending up. Your body is adapting well to training.",
    },
    {
      label: "Resting HR",
      data: metrics.map((m) => ({ date: m.date, value: m.restingHeartRate })),
      unit: "bpm",
      trend: "down",
      summary: "Resting heart rate is gradually decreasing. A sign of improving cardiovascular fitness.",
    },
    {
      label: "Sleep",
      data: metrics.map((m) => ({ date: m.date, value: m.sleepDuration })),
      unit: "hrs",
      trend: "stable",
      summary: "Sleep is consistent around 7.2 hours. Try to push closer to 8 hours for better recovery.",
    },
    {
      label: "Steps",
      data: metrics.map((m) => ({ date: m.date, value: m.steps })),
      unit: "steps",
      trend: "up",
      summary: "Daily steps trending up. You are averaging 8,200 steps, above your 8,000 goal.",
    },
    {
      label: "Recovery",
      data: metrics.map((m) => ({ date: m.date, value: m.recoveryScore })),
      unit: "%",
      trend: "stable",
      summary: "Recovery scores are steady. Consistent sleep and rest days are keeping you balanced.",
    },
  ];
}

export function getMetricDetail(
  key: MetricKey,
  todayMetrics: HealthMetrics,
  allMetrics: HealthMetrics[]
): MetricDetail {
  const trendData = allMetrics.map((m) => {
    let value = 0;
    switch (key) {
      case "sleep": value = m.sleepDuration; break;
      case "hrv": value = m.hrv; break;
      case "steps": value = m.steps; break;
      case "restingHR": value = m.restingHeartRate; break;
      case "recovery": value = m.recoveryScore; break;
      case "weight": value = m.weight; break;
    }
    return { date: m.date, value };
  });

  const recent = trendData.slice(-7);
  const avg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const current = trendData[trendData.length - 1].value;
  const trendDir: "up" | "down" | "stable" =
    current > avg * 1.03 ? "up" : current < avg * 0.97 ? "down" : "stable";

  const details: Record<MetricKey, Omit<MetricDetail, "key" | "trend">> = {
    sleep: {
      title: "Sleep",
      headline: todayMetrics.sleepDuration >= 7.5
        ? "You slept well last night."
        : todayMetrics.sleepDuration >= 6.5
        ? "Sleep was adequate but could be better."
        : "You did not get enough sleep last night.",
      explanation: `You got ${todayMetrics.sleepDuration.toFixed(1)} hours with ${todayMetrics.sleepQuality}% quality. Your 7-day average is ${avg.toFixed(1)} hours.`,
      whatItMeans: "Sleep is when your body repairs muscle, consolidates memory, and regulates hormones. Consistently getting less than 7 hours undermines recovery and training gains.",
      recommendation: todayMetrics.sleepDuration < 7
        ? "Set a bedtime alarm for 9:30pm tonight. Avoid screens for 30 minutes before bed. Keep your room cool and dark."
        : "Keep doing what you are doing. Consistency matters more than occasional long nights.",
      currentValue: `${todayMetrics.sleepDuration.toFixed(1)}`,
      unit: "hrs",
    },
    hrv: {
      title: "Heart Rate Variability",
      headline: todayMetrics.hrv >= 45
        ? "Your recovery looks good based on HRV."
        : todayMetrics.hrv >= 35
        ? "Your HRV is slightly below your average."
        : "Your HRV is low. Your body needs more recovery.",
      explanation: `Your HRV is ${todayMetrics.hrv} ms today. Your 7-day average is ${Math.round(avg)} ms.`,
      whatItMeans: "HRV measures the variation between heartbeats. Higher HRV generally means your body is well-recovered and ready for stress. Lower HRV means your nervous system is under more load.",
      recommendation: todayMetrics.hrv < 38
        ? "Take it easy today. Avoid high-intensity training. Focus on hydration, light movement, and sleep."
        : "Your HRV supports training today. Listen to how you feel during the session.",
      currentValue: `${todayMetrics.hrv}`,
      unit: "ms",
    },
    steps: {
      title: "Daily Steps",
      headline: todayMetrics.steps >= 8000
        ? "You have hit your step goal."
        : todayMetrics.steps >= 5000
        ? "You are partway to your step goal."
        : "Your movement has been low today.",
      explanation: `You have ${todayMetrics.steps.toLocaleString()} steps so far. Your goal is 8,000. Your 7-day average is ${Math.round(avg).toLocaleString()}.`,
      whatItMeans: "Daily steps are a simple measure of overall movement. Consistent movement outside of workouts supports cardiovascular health, metabolism, and recovery.",
      recommendation: todayMetrics.steps < 6000
        ? "Take a 20-minute walk after your next meal. Small movement breaks add up."
        : "You are on track. Keep moving throughout the day.",
      currentValue: todayMetrics.steps.toLocaleString(),
      unit: "steps",
    },
    restingHR: {
      title: "Resting Heart Rate",
      headline: todayMetrics.restingHeartRate <= 60
        ? "Your resting heart rate is excellent."
        : todayMetrics.restingHeartRate <= 68
        ? "Resting heart rate is normal."
        : "Your resting heart rate is elevated today.",
      explanation: `Your resting HR is ${todayMetrics.restingHeartRate} bpm. Your 7-day average is ${Math.round(avg)} bpm.`,
      whatItMeans: "Resting heart rate reflects your cardiovascular fitness and recovery. A lower resting HR generally indicates better fitness. Elevated resting HR can signal stress, poor sleep, or incomplete recovery.",
      recommendation: todayMetrics.restingHeartRate > 66
        ? "An elevated resting HR often means your body needs more recovery. Prioritize sleep and hydration today."
        : "Your resting HR is in a healthy range. Keep up with consistent training and recovery.",
      currentValue: `${todayMetrics.restingHeartRate}`,
      unit: "bpm",
    },
    recovery: {
      title: "Recovery Score",
      headline: todayMetrics.recoveryScore >= 75
        ? "Your recovery is strong. You are ready to train."
        : todayMetrics.recoveryScore >= 50
        ? "Recovery is moderate. Train carefully today."
        : "Recovery is low. Rest is the priority today.",
      explanation: `Your recovery score is ${todayMetrics.recoveryScore}%. This is based on your HRV, resting heart rate, and sleep quality.`,
      whatItMeans: "Recovery score combines multiple signals to estimate how prepared your body is for stress. Higher scores mean you can handle harder training. Lower scores mean your body is still adapting.",
      recommendation: todayMetrics.recoveryScore < 50
        ? "Skip intense training today. Focus on active recovery, hydration, and getting to bed early."
        : "You have enough recovery to train. Match your intensity to how you feel.",
      currentValue: `${todayMetrics.recoveryScore}`,
      unit: "%",
    },
    weight: {
      title: "Weight",
      headline: trendDir === "down"
        ? "Your weight is trending down. You are making progress."
        : trendDir === "up"
        ? "Your weight has been trending up recently."
        : "Your weight is stable.",
      explanation: `You are at ${todayMetrics.weight} lbs today. Your 7-day average is ${avg.toFixed(1)} lbs.`,
      whatItMeans: "Daily weight fluctuates due to water, food timing, and other factors. The trend over weeks matters more than any single day. Focus on the direction, not the number.",
      recommendation: "Weigh yourself at the same time each day for consistency. Look at the weekly trend, not daily swings.",
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
  { id: "garmin", name: "Garmin", icon: "watch", connected: false },
  { id: "whoop", name: "WHOOP", icon: "activity", connected: false },
];

export const coachResponses: Record<string, string> = {
  workout:
    "Based on your recovery score and last night's sleep, today is a good day for moderate training.\n\nI recommend a 40-minute Zone 2 run or bike ride at an easy, conversational pace.\n\nYour HRV is close to your baseline. Your body can handle work but is not fully topped off. Save the heavy lifting for a day when recovery is above 80%.",
  hrv:
    "Your HRV has been lower than your 7-day average for two days.\n\nThis usually means your body is dealing with some stress. It could be from training, poor sleep, work, or diet.\n\nThis is not alarming. Prioritize sleep tonight and keep today's workout lighter. If it stays low for three or more days, reduce your training volume.",
  eat:
    "Today, aim for about 2,100 calories.\n\n160g protein. 200g carbs. 60g fat.\n\nSince you have a moderate workout planned, eat complex carbs beforehand. Oatmeal, sweet potato, or whole grain bread work well.\n\nGet 30-40g protein within an hour after your workout. For dinner, lean protein with plenty of vegetables.\n\nDrink at least 96oz of water throughout the day.",
  fast:
    "Your 16:8 fasting window looks good for today.\n\nStart eating at noon. Last meal by 8pm.\n\nSince your recovery is moderate, do not extend the fast beyond 16 hours today. On well-recovered days, you could push to 18 hours.\n\nMake sure your first meal has a solid protein source.",
  weight:
    "Over the past 4 weeks, you have lost about 2 pounds.\n\nThat is a healthy rate. About 0.5 lbs per week.\n\nSometimes progress feels slow. But rapid weight loss often leads to muscle loss and rebounds.\n\nYour strength metrics are holding steady. That means you are losing fat, not muscle.\n\nStay the course. You are doing this right.",
  overtraining:
    "You are not overtraining yet, but you are getting close to the edge.\n\nYour HRV has dipped below baseline for 2 consecutive days. Your resting heart rate has crept up by 3 bpm.\n\nTake tomorrow as a full rest day. When you come back, start with a lower-intensity session.\n\nAlso check that you are sleeping 7 or more hours and eating enough to support your training load.",
  week:
    "Here is what I recommend for this week:\n\nMonday: Strength, upper body, 45 min\nTuesday: Zone 2 run, 35 min\nWednesday: Rest\nThursday: Strength, lower body, 45 min\nFriday: Zone 2 bike, 40 min\nSaturday: Rest\nSunday: HIIT, 25 min\n\nThis gives you a good mix of strength and cardio with enough recovery. Since your HRV has been a bit lower lately, I am keeping the volume moderate.",
};
