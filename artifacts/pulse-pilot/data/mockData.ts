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
  FeelingType,
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

export function generateDailyPlan(metrics: HealthMetrics, feeling?: FeelingType): DailyPlan {
  let readinessScore = Math.round(
    metrics.recoveryScore * 0.3 +
    metrics.sleepQuality * 0.3 +
    (metrics.hrv / 60) * 100 * 0.2 +
    (1 - Math.min(metrics.restingHeartRate, 80) / 80) * 100 * 0.2
  );

  if (feeling === "exhausted") readinessScore = Math.min(readinessScore, 35);
  else if (feeling === "tired") readinessScore = Math.min(readinessScore, 55);
  else if (feeling === "stressed") readinessScore = Math.min(readinessScore, 50);
  else if (feeling === "great") readinessScore = Math.max(readinessScore, 75);

  const readinessLabel = readinessScore >= 80 ? "Excellent" : readinessScore >= 65 ? "Good" : readinessScore >= 45 ? "Moderate" : "Low";

  const feelingOverride = feeling === "exhausted" || feeling === "tired" || feeling === "stressed";
  const dataIsGood = metrics.recoveryScore >= 65 && metrics.sleepQuality >= 70;

  let headline = "";
  let summary = "";
  let todaysPlan = { workout: "", movement: "", nutrition: "", recovery: "" };
  let whyThisPlan: string[] = [];
  let optional = "";
  let workoutType = "";
  let workoutIntensity: "low" | "moderate" | "high" = "moderate";
  let workoutDuration = 40;
  let workoutDesc = "";

  if (feelingOverride && dataIsGood) {
    if (feeling === "exhausted") {
      headline = "Take it easy. You know your body best.";
      summary = "Your data looks solid, but you feel exhausted. Subjective fatigue matters. Rest today.";
      todaysPlan = {
        workout: "Active recovery only. Gentle stretching, 15 min.",
        movement: "Light walk if you feel like it. No pressure.",
        nutrition: "1,900 cal. Comfort foods that nourish. Stay hydrated.",
        recovery: "Prioritize sleep. In bed early tonight.",
      };
      whyThisPlan = [
        "Your data says go, but your body says stop. We listen to both.",
        "Training while mentally exhausted rarely produces good results.",
        "One rest day protects the rest of your week.",
      ];
      workoutType = "Active Recovery";
      workoutIntensity = "low";
      workoutDuration = 15;
      workoutDesc = "Gentle stretching and mobility only.";
    } else if (feeling === "tired") {
      headline = "Go light today. Save your energy.";
      summary = "Your metrics look decent, but you feel tired. A lighter session is the smarter call.";
      todaysPlan = {
        workout: "Easy walk or light yoga, 30 min.",
        movement: "6,000 steps. No need to push.",
        nutrition: "2,000 cal. Balanced, easy meals.",
        recovery: "Wind down early. Extra sleep helps more than an extra set.",
      };
      whyThisPlan = [
        "Fatigue you can feel often shows up in data tomorrow.",
        "A light day now prevents a forced rest day later.",
        "Consistency beats intensity when you are running low.",
      ];
      workoutType = "Light Activity";
      workoutIntensity = "low";
      workoutDuration = 30;
      workoutDesc = "Easy walk or gentle yoga.";
    } else {
      headline = "Dial it back. Manage your stress first.";
      summary = "Your body could handle training, but stress changes the equation. Go easy.";
      todaysPlan = {
        workout: "Zone 2 walk or yoga, 30 min. Nothing intense.",
        movement: "Move gently. Fresh air helps.",
        nutrition: "2,000 cal. Avoid skipping meals under stress.",
        recovery: "10 min breathing exercise. Limit caffeine after noon.",
      };
      whyThisPlan = [
        "Stress raises cortisol. Adding hard training raises it more.",
        "Low-intensity movement actually helps reduce stress.",
        "Protecting your nervous system is the priority today.",
      ];
      workoutType = "Stress Relief";
      workoutIntensity = "low";
      workoutDuration = 30;
      workoutDesc = "Gentle movement focused on stress relief.";
    }
    optional = "If you start feeling better, you can increase intensity slightly. But no obligation.";
  } else if (readinessScore >= 75) {
    headline = feeling === "great" ? "Let's go. You feel it and your data confirms it." : "Push today. Your body is ready.";
    summary = feeling === "great"
      ? "You feel great and your recovery backs it up. Make this session count."
      : "Recovery is strong, sleep was solid. A good day to train hard.";
    todaysPlan = {
      workout: "Strength, 50 min. Compound lifts, full body.",
      movement: "8,000 steps outside your workout.",
      nutrition: "2,200 cal. Protein and carbs before training.",
      recovery: "Stretch 10 min post-session. 96oz water.",
    };
    whyThisPlan = feeling === "great"
      ? [
          "You feel great and your body data agrees.",
          "Recovery signals are strong across the board.",
          "Days like this are when real progress happens.",
        ]
      : [
          "Your body is fully recharged from last night.",
          "Heart rate and recovery signals are strong.",
          "A hard session will produce real gains today.",
        ];
    optional = "If you feel fatigued mid-session, drop to moderate. No need to force it.";
    workoutType = "Strength Training";
    workoutIntensity = "high";
    workoutDuration = 50;
    workoutDesc = "Full body strength with compound movements.";
  } else if (readinessScore >= 45) {
    headline = "Train today. Keep it steady.";
    summary = "Recovery is solid, but not fully reset. A controlled session keeps you on track.";
    todaysPlan = {
      workout: "Zone 2 cardio, 40 min. Easy pace.",
      movement: "7,500 steps throughout the day.",
      nutrition: "2,000 cal. Balanced meals, protein at every meal.",
      recovery: "Wind down by 10pm. No screens 30 min before bed.",
    };
    whyThisPlan = [
      "Your body is not fully recharged yet.",
      "A steady workout will help without adding too much stress.",
      "Sleep was good enough to support training today.",
    ];
    optional = "If energy feels low, a 30-minute walk is a perfectly good alternative.";
    workoutType = "Zone 2 Cardio";
    workoutIntensity = "moderate";
    workoutDuration = 40;
    workoutDesc = "Steady-state cardio at a conversational pace.";
  } else {
    headline = "Recovery first today.";
    summary = "Your body is showing signs of fatigue. Rest now, train stronger tomorrow.";
    todaysPlan = {
      workout: "Active recovery only. Light stretching, 20 min.",
      movement: "A short walk is fine. No step target today.",
      nutrition: "1,900 cal. Nutrient-dense foods, stay hydrated.",
      recovery: "Prioritize 8+ hours sleep. In bed by 9:30pm.",
    };
    whyThisPlan = [
      "Your body needs time to repair and adapt.",
      "Resting heart rate is elevated, a sign of incomplete recovery.",
      "Pushing through fatigue creates more fatigue, not progress.",
    ];
    optional = "A 20-minute easy walk is the most you should do today.";
    workoutType = "Active Recovery";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Light mobility work and stretching.";
  }

  const sleepHours = metrics.sleepDuration;
  let sleepSummary = "";
  if (sleepHours < 7) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Below what your body needs. Aim for earlier bedtime tonight.`;
  } else if (sleepHours >= 8) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Solid rest. Keep this consistent.`;
  } else {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Adequate. Pushing closer to 8 would help recovery.`;
  }

  let recoverySummary = "";
  if (metrics.recoveryScore >= 75) {
    recoverySummary = "Recovery is strong. Your body has bounced back well.";
  } else if (metrics.recoveryScore >= 50) {
    recoverySummary = "Recovery is moderate. You can train, but listen to your body.";
  } else {
    recoverySummary = "Recovery is low. Rest today will help you come back stronger.";
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
        : "Focus on nutrient-dense foods and stay hydrated.",
    },
    fastingGuidance: "16:8 window. Eat between 12pm and 8pm.",
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
                ? "Full body strength. Compound lifts."
                : i === 1 || i === 4
                ? "Easy pace. Keep it conversational."
                : "Short, intense intervals. Full recovery between sets.",
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
      "96oz water minimum.",
      "Vegetables at every meal.",
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
      summary: "Down 2.1 lbs over the last 30 days. Steady, sustainable progress.",
    },
    {
      label: "HRV",
      data: metrics.map((m) => ({ date: m.date, value: m.hrv })),
      unit: "ms",
      trend: "up",
      summary: "Trending up. Your body is adapting well to current training.",
    },
    {
      label: "Resting HR",
      data: metrics.map((m) => ({ date: m.date, value: m.restingHeartRate })),
      unit: "bpm",
      trend: "down",
      summary: "Gradually decreasing. A sign of improving cardiovascular fitness.",
    },
    {
      label: "Sleep",
      data: metrics.map((m) => ({ date: m.date, value: m.sleepDuration })),
      unit: "hrs",
      trend: "stable",
      summary: "Consistent around 7.2h. More time in bed would improve recovery.",
    },
    {
      label: "Steps",
      data: metrics.map((m) => ({ date: m.date, value: m.steps })),
      unit: "steps",
      trend: "up",
      summary: "Averaging 8,200 daily. Above your 8,000 goal.",
    },
    {
      label: "Recovery",
      data: metrics.map((m) => ({ date: m.date, value: m.recoveryScore })),
      unit: "%",
      trend: "stable",
      summary: "Holding steady. Consistent sleep and rest days are keeping you balanced.",
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
        ? "You slept well."
        : todayMetrics.sleepDuration >= 6.5
        ? "Sleep was okay. Not great."
        : "Not enough sleep last night.",
      explanation: `${todayMetrics.sleepDuration.toFixed(1)} hours, ${todayMetrics.sleepQuality}% quality. 7-day average: ${avg.toFixed(1)} hours.`,
      whatItMeans: "Sleep is when your body repairs muscle, consolidates memory, and regulates hormones. Less than 7 hours consistently undermines recovery and training.",
      recommendation: todayMetrics.sleepDuration < 7
        ? "Set a bedtime alarm for 9:30pm. Avoid screens 30 min before bed. Keep the room cool and dark."
        : "Keep this up. Consistency matters more than occasional long nights.",
      currentValue: `${todayMetrics.sleepDuration.toFixed(1)}`,
      unit: "hrs",
    },
    hrv: {
      title: "Heart Rate Variability",
      headline: todayMetrics.hrv >= 45
        ? "HRV looks good. Recovery is on track."
        : todayMetrics.hrv >= 35
        ? "HRV is slightly below average."
        : "HRV is low. Your body needs rest.",
      explanation: `${todayMetrics.hrv} ms today. 7-day average: ${Math.round(avg)} ms.`,
      whatItMeans: "HRV measures variation between heartbeats. Higher means well-recovered and ready for stress. Lower means your nervous system is under load.",
      recommendation: todayMetrics.hrv < 38
        ? "Take it easy. Skip high-intensity work. Focus on hydration, light movement, and sleep."
        : "HRV supports training today. Listen to your body during the session.",
      currentValue: `${todayMetrics.hrv}`,
      unit: "ms",
    },
    steps: {
      title: "Daily Steps",
      headline: todayMetrics.steps >= 8000
        ? "Step goal hit."
        : todayMetrics.steps >= 5000
        ? "Partway to your step goal."
        : "Movement has been low today.",
      explanation: `${todayMetrics.steps.toLocaleString()} steps. Goal: 8,000. 7-day average: ${Math.round(avg).toLocaleString()}.`,
      whatItMeans: "Consistent movement outside of workouts supports cardiovascular health, metabolism, and recovery.",
      recommendation: todayMetrics.steps < 6000
        ? "Take a 20-minute walk after your next meal. Small breaks add up."
        : "On track. Keep moving throughout the day.",
      currentValue: todayMetrics.steps.toLocaleString(),
      unit: "steps",
    },
    restingHR: {
      title: "Resting Heart Rate",
      headline: todayMetrics.restingHeartRate <= 60
        ? "Resting heart rate is excellent."
        : todayMetrics.restingHeartRate <= 68
        ? "Resting heart rate is normal."
        : "Resting heart rate is elevated.",
      explanation: `${todayMetrics.restingHeartRate} bpm today. 7-day average: ${Math.round(avg)} bpm.`,
      whatItMeans: "Lower resting HR generally indicates better fitness. Elevated can signal stress, poor sleep, or incomplete recovery.",
      recommendation: todayMetrics.restingHeartRate > 66
        ? "Elevated resting HR often means more recovery is needed. Prioritize sleep and hydration."
        : "In a healthy range. Keep up consistent training and recovery.",
      currentValue: `${todayMetrics.restingHeartRate}`,
      unit: "bpm",
    },
    recovery: {
      title: "Recovery",
      headline: todayMetrics.recoveryScore >= 75
        ? "Recovery is strong. Ready to train."
        : todayMetrics.recoveryScore >= 50
        ? "Recovery is moderate. Train carefully."
        : "Recovery is low. Rest is the priority.",
      explanation: `Recovery score: ${todayMetrics.recoveryScore}%. Based on HRV, resting heart rate, and sleep quality.`,
      whatItMeans: "Recovery combines multiple signals to estimate how prepared your body is for stress. Higher scores support harder training. Lower scores mean your body is still adapting.",
      recommendation: todayMetrics.recoveryScore < 50
        ? "Skip intense training. Focus on active recovery, hydration, and sleep."
        : "Enough recovery to train. Match intensity to how you feel.",
      currentValue: `${todayMetrics.recoveryScore}`,
      unit: "%",
    },
    weight: {
      title: "Weight",
      headline: trendDir === "down"
        ? "Weight is trending down. On track."
        : trendDir === "up"
        ? "Weight has been trending up."
        : "Weight is stable.",
      explanation: `${todayMetrics.weight} lbs today. 7-day average: ${avg.toFixed(1)} lbs.`,
      whatItMeans: "Daily weight fluctuates from water, food timing, and other factors. The weekly trend matters more than any single day.",
      recommendation: "Weigh yourself at the same time each day. Focus on the trend, not the number.",
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
    "You can train today, but keep it moderate.\n\nRecovery is slightly below your usual level. A hard session could create extra fatigue without much benefit.\n\nRecommendation: Zone 2 cardio or controlled strength work. Save the heavy lifting for a day when recovery is above 80%.",
  hrv:
    "Your HRV has been below your 7-day average for two days.\n\nThis usually means accumulated stress from training, sleep, work, or diet.\n\nThis is not alarming. Prioritize sleep tonight and keep today lighter. If it stays low for 3+ days, reduce training volume.",
  eat:
    "Today, aim for about 2,100 calories.\n\n160g protein. 200g carbs. 60g fat.\n\nEat complex carbs before your workout. Get 30-40g protein within an hour after. Dinner: lean protein with vegetables.\n\n96oz water minimum.",
  fast:
    "Your 16:8 window works well today.\n\nStart eating at noon. Last meal by 8pm.\n\nWith moderate recovery, do not extend beyond 16 hours. On well-recovered days, you could push to 18 hours.\n\nMake your first meal protein-rich.",
  weight:
    "Down about 2 pounds over 4 weeks.\n\nThat is 0.5 lbs per week. Healthy pace.\n\nYour strength metrics are holding steady. That means fat loss, not muscle loss.\n\nStay the course.",
  overtraining:
    "Not overtraining yet, but close to the edge.\n\nHRV has been below baseline for 2 days. Resting heart rate is up 3 bpm.\n\nTake tomorrow as a full rest day. Come back with a lower-intensity session.\n\nCheck that you are sleeping 7+ hours and eating enough for your training load.",
  week:
    "This week:\n\nMonday: Strength, upper body, 45 min\nTuesday: Zone 2 run, 35 min\nWednesday: Rest\nThursday: Strength, lower body, 45 min\nFriday: Zone 2 bike, 40 min\nSaturday: Rest\nSunday: HIIT, 25 min\n\nGood mix of strength and cardio with enough recovery. Volume is moderate given your recent HRV.",
};
