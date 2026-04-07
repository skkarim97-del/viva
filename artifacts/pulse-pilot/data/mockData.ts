import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  WeeklyPlan,
  TrendData,
  WorkoutEntry,
  IntegrationStatus,
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

  let workoutType = "Zone 2 Cardio";
  let workoutIntensity: "low" | "moderate" | "high" = "moderate";
  let workoutDuration = 40;
  let workoutDesc = "Moderate-intensity steady-state cardio to build your aerobic base.";

  if (readinessScore >= 75) {
    workoutType = "Strength Training";
    workoutIntensity = "high";
    workoutDuration = 50;
    workoutDesc = "Your body is recovered and ready. Time for a challenging strength session focusing on compound movements.";
  } else if (readinessScore < 45) {
    workoutType = "Active Recovery";
    workoutIntensity = "low";
    workoutDuration = 25;
    workoutDesc = "Your body needs rest. Light mobility work, stretching, or a gentle walk will help you recover faster.";
  }

  const sleepHours = metrics.sleepDuration;
  let sleepSummary = `You got ${sleepHours.toFixed(1)} hours of sleep`;
  if (sleepHours < 7) {
    sleepSummary += " - less than your body needs. Try to wind down earlier tonight.";
  } else if (sleepHours >= 8) {
    sleepSummary += " - great job prioritizing rest!";
  } else {
    sleepSummary += " - solid. Keep this consistent.";
  }

  let recoverySummary = "";
  if (metrics.recoveryScore >= 75) {
    recoverySummary = "Your recovery is strong today. Your body has bounced back well from recent activity.";
  } else if (metrics.recoveryScore >= 50) {
    recoverySummary = "Recovery is moderate. You can train, but listen to your body and don't push too hard.";
  } else {
    recoverySummary = "Your body is still recovering. Taking it easy today will help you come back stronger tomorrow.";
  }

  let whyThisPlan = "";
  if (readinessScore >= 75) {
    whyThisPlan = "Your HRV is above your baseline, resting heart rate is steady, and you slept well. This is a great day to challenge yourself.";
  } else if (readinessScore >= 45) {
    whyThisPlan = "Your recovery metrics are decent but not fully topped off. A moderate effort will keep you moving forward without overdoing it.";
  } else {
    whyThisPlan = "Your body is showing signs of accumulated stress - lower HRV and elevated resting heart rate. Recovery today means stronger performance tomorrow.";
  }

  return {
    date: metrics.date,
    readinessScore,
    readinessLabel,
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
    fastingGuidance: "16:8 window today. Start eating at 12pm, last meal by 8pm.",
    whyThisPlan,
    todaysPlanSummary: readinessScore >= 75
      ? "Push day - your body is ready for a challenge"
      : readinessScore >= 45
      ? "Steady day - maintain your momentum"
      : "Recovery day - rest to come back stronger",
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
                ? "Full body strength with compound lifts"
                : i === 1 || i === 4
                ? "Easy pace run or bike to build aerobic base"
                : "Short, intense intervals to boost metabolism",
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
      "Hit 160g protein daily",
      "Eat complex carbs before workouts",
      "Hydrate with at least 96oz water",
      "Include vegetables at every meal",
    ],
    stepGoal: 8000,
    fastingSchedule: "16:8 - Eat between 12pm and 8pm",
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
      summary: "Down 2.1 lbs over the last 30 days. You're on track for your goal.",
    },
    {
      label: "HRV",
      data: metrics.map((m) => ({ date: m.date, value: m.hrv })),
      unit: "ms",
      trend: "up",
      summary: "Your HRV has been trending up, which means your body is adapting well to training.",
    },
    {
      label: "Resting HR",
      data: metrics.map((m) => ({ date: m.date, value: m.restingHeartRate })),
      unit: "bpm",
      trend: "down",
      summary: "Resting heart rate is gradually decreasing - a sign of improving cardiovascular fitness.",
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
      summary: "Daily steps trending up. You're averaging 8,200 steps, above your 8,000 goal.",
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

export const integrations: IntegrationStatus[] = [
  { id: "apple_health", name: "Apple Health", icon: "heart", connected: false },
  { id: "garmin", name: "Garmin", icon: "watch", connected: false },
  { id: "whoop", name: "WHOOP", icon: "activity", connected: false },
];

export const coachResponses: Record<string, string> = {
  workout:
    "Based on your recovery score of 72% and decent sleep last night, today is a good day for a moderate-intensity workout. I'd suggest a 40-minute Zone 2 run or bike ride. Your HRV is close to your baseline, which tells me your body can handle some work but isn't fully topped off. Save the heavy lifting for when your recovery is above 80%.",
  hrv:
    "Your HRV has been lower than your 7-day average for the past two days. This usually means your body is dealing with some stress - could be from training, poor sleep, work stress, or even diet. It's not alarming, but I'd suggest prioritizing sleep tonight and keeping today's workout lighter. If it stays low for 3+ days, we should look at reducing training volume.",
  eat:
    "Today I'd aim for about 2,100 calories with 160g protein, 200g carbs, and 60g fat. Since you have a moderate workout planned, fuel up with complex carbs beforehand - oatmeal, sweet potato, or whole grain bread. After your workout, get 30-40g protein within an hour. For dinner, lean protein with plenty of vegetables. Don't forget to drink at least 96oz of water throughout the day.",
  fast:
    "Your 16:8 fasting window looks good for today. Start eating at noon and have your last meal by 8pm. Since your recovery is moderate, I wouldn't extend the fast longer than 16 hours. On recovery days when your body is well-rested, you could push to 18 hours, but today stick with 16:8. Make sure your first meal has a good protein source.",
  weight:
    "Looking at your data over the past 4 weeks, you've lost about 2 pounds. That's actually a healthy, sustainable rate - about 0.5 lbs per week. Sometimes progress feels slow, but rapid weight loss often leads to muscle loss and rebounds. Your strength metrics are holding steady, which means you're losing fat, not muscle. Stay the course - you're doing this right.",
  overtraining:
    "Looking at your recent data, you're not overtraining yet, but you're getting close to the edge. Your HRV has dipped below baseline for 2 consecutive days and your resting heart rate has crept up by 3 bpm. I'd suggest taking tomorrow as a full rest day, and when you come back, start with a lower-intensity session. Also check that you're sleeping 7+ hours and eating enough to support your training load.",
  week:
    "Here's what I'd suggest for this week: Monday - strength (upper body), Tuesday - Zone 2 run 35 min, Wednesday - rest, Thursday - strength (lower body), Friday - Zone 2 bike 40 min, Saturday - rest, Sunday - HIIT 25 min. This gives you a good mix of strength and cardio with enough recovery. Since your HRV has been a bit lower lately, I'm keeping the volume moderate.",
};
