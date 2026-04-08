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
  WellnessInputs,
  DailyAction,
  CompletionRecord,
  ActionCategory,
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
      caloriesBurned: Math.round(2100 + (Math.random() - 0.5) * 400),
      activeCalories: Math.round(350 + (Math.random() - 0.5) * 200),
      restingHeartRate: Math.round(baseRhr + (Math.random() - 0.5) * 4),
      hrv: Math.round(baseHrv + (Math.random() - 0.5) * 6),
      weight: Math.round((baseWeight + (Math.random() - 0.5) * 1) * 10) / 10,
      sleepDuration: Math.round((baseSleep + (Math.random() - 0.5) * 1.2) * 10) / 10,
      sleepQuality: Math.round(70 + Math.sin(i / 6) * 15 + (Math.random() - 0.5) * 10),
      recoveryScore: Math.round(65 + Math.sin(i / 5) * 15 + (Math.random() - 0.5) * 10),
      strain: Math.round(8 + Math.sin(i / 4) * 4 + (Math.random() - 0.5) * 3),
      vo2Max: 42,
    });
  }
  return metrics;
}

export function generateMockWorkouts(): WorkoutEntry[] {
  const workouts: WorkoutEntry[] = [];
  const types = ["Strength Training", "Zone 2 Run", "HIIT", "Yoga", "Cycling", "Walking"];
  for (let i = 13; i >= 0; i--) {
    if (i % 2 === 0) {
      const type = types[i % types.length];
      workouts.push({
        id: `w_${i}`,
        date: generateDateString(i),
        type,
        duration: 30 + Math.round(Math.random() * 30),
        intensity: type === "HIIT" ? "very_high" : type === "Strength Training" ? "high" : type === "Yoga" || type === "Walking" ? "low" : "moderate",
        caloriesBurned: 200 + Math.round(Math.random() * 300),
      });
    }
  }
  return workouts;
}

export function generateTodayMetrics(): HealthMetrics {
  const all = generateMockMetrics(1);
  return all[0];
}

function makeActions(yourDay: { move: string; fuel: string; recover: string; mind: string }, hydration: string | null): DailyAction[] {
  const actions: DailyAction[] = [
    { id: "move", category: "move" as ActionCategory, text: yourDay.move, completed: false },
    { id: "fuel", category: "fuel" as ActionCategory, text: yourDay.fuel, completed: false },
    { id: "recover", category: "recover" as ActionCategory, text: yourDay.recover, completed: false },
    { id: "mind", category: "mind" as ActionCategory, text: yourDay.mind, completed: false },
  ];
  if (hydration === "low") {
    actions.push({ id: "hydrate", category: "hydrate" as ActionCategory, text: "Drink 2–3L of Water Throughout the Day", completed: false });
  }
  return actions;
}

export function generateDailyPlan(metrics: HealthMetrics, inputs?: WellnessInputs, history?: CompletionRecord[]): DailyPlan {
  const feeling = inputs?.feeling ?? null;
  const energy = inputs?.energy ?? null;
  const stress = inputs?.stress ?? null;
  const hydration = inputs?.hydration ?? null;
  const lifeLoad = inputs?.lifeLoad ?? null;
  const trainingIntent = inputs?.trainingIntent ?? null;

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

  if (energy === "low") readinessScore = Math.min(readinessScore, 45);
  else if (energy === "high") readinessScore = Math.max(readinessScore, 70);

  if (stress === "high") readinessScore = Math.min(readinessScore, 50);

  if (lifeLoad === "overwhelmed") readinessScore = Math.min(readinessScore, 35);
  else if (lifeLoad === "busy") readinessScore = Math.min(readinessScore, 55);

  if (trainingIntent === "none") readinessScore = Math.min(readinessScore, 40);

  if (hydration === "low") readinessScore = Math.max(readinessScore - 5, 0);

  const readinessLabel = readinessScore >= 80 ? "Excellent" : readinessScore >= 65 ? "Good" : readinessScore >= 45 ? "Moderate" : "Low";

  const feelingOverride = feeling === "exhausted" || feeling === "tired" || feeling === "stressed";
  const stressOverride = stress === "high";
  const lowEnergy = energy === "low";
  const dataIsGood = metrics.recoveryScore >= 65 && metrics.sleepQuality >= 70;

  let headline = "";
  let summary = "";
  let dailyFocus = "";
  let dailyState: import("@/types").DailyState = "maintain";
  let yourDay = { move: "", fuel: "", recover: "", mind: "" };
  let whyThisPlan: string[] = [];
  let optional = "";
  let workoutType = "";
  let workoutIntensity: "low" | "moderate" | "high" = "moderate";
  let workoutDuration = 40;
  let workoutDesc = "";

  const overwhelmedOverride = lifeLoad === "overwhelmed";
  const busyOverride = lifeLoad === "busy";
  const noTraining = trainingIntent === "none";

  const recentHistory = history?.slice(-7) ?? [];
  const weeklyRate = recentHistory.length > 0
    ? Math.round(recentHistory.reduce((sum, r) => sum + r.completionRate, 0) / recentHistory.length)
    : -1;
  const categoryRates: Record<string, { done: number; total: number }> = {};
  for (const rec of recentHistory) {
    for (const a of rec.actions) {
      if (!categoryRates[a.category]) categoryRates[a.category] = { done: 0, total: 0 };
      categoryRates[a.category].total++;
      if (a.completed) categoryRates[a.category].done++;
    }
  }
  const weakCategories = Object.entries(categoryRates)
    .filter(([, v]) => v.total >= 3 && v.done / v.total < 0.4)
    .map(([k]) => k);

  if (weeklyRate >= 0 && weeklyRate < 40 && recentHistory.length >= 3) {
    readinessScore = Math.min(readinessScore, 50);
  }

  if (overwhelmedOverride) {
    dailyState = "recover";
    headline = "Take it slow. Be kind to yourself.";
    summary = "When you're overwhelmed, your body needs simplicity. Keep today easy and kind.";
    dailyFocus = "Simplify and recover";
    yourDay = {
      move: "15–20 Minutes of Gentle Walking",
      fuel: hydration === "low" ? "Simple, Nourishing Meals · Drink Water Consistently" : "Simple, Nourishing Meals · Don't Skip Any",
      recover: "Early Bedtime Tonight · Protect Your Sleep",
      mind: "10 Minutes of Breathing or a Calm Walk",
    };
    whyThisPlan = [
      "Life stress and training stress compound.",
      "Simplifying today protects the rest of your week.",
      "Recovery isn't just physical — your mind needs rest too.",
    ];
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Gentle movement only. No structured workout.";
    optional = "A short walk is enough. Don't add pressure.";
  } else if (noTraining && !stressOverride && !feelingOverride) {
    dailyState = "maintain";
    headline = "Focus on balance today.";
    summary = "No training planned. Focus on staying active and giving your body what it needs.";
    dailyFocus = "Active rest day";
    yourDay = {
      move: "20–30 Minutes of Walking or Light Stretching",
      fuel: hydration === "low" ? "Balanced Meals · Prioritize Water Intake" : "Balanced Meals · Protein and Vegetables",
      recover: "Catch Up on Sleep · Wind Down Early",
      mind: "Take a Mental Break · Read or Relax",
    };
    whyThisPlan = [
      "Rest days are when your body adapts and grows stronger.",
      "Light movement supports recovery without adding strain.",
      "Honoring your intent keeps your plan sustainable.",
    ];
    workoutType = "Rest Day";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Light movement and mobility.";
    optional = "If you feel the urge to train, keep it very light.";
  } else if (stressOverride && dataIsGood) {
    dailyState = "recover";
    headline = "Ease the tension. Prioritize calm.";
    summary = "Your body could train, but stress changes the equation. Today is about calming your system.";
    dailyFocus = "Keep stress low today";
    yourDay = {
      move: "30 Minutes of Gentle Walking or Yoga",
      fuel: "Balanced Meals · Limit Caffeine After Noon",
      recover: "Wind Down Early · Prioritize Rest",
      mind: "10 Minutes of Breathing Exercises",
    };
    whyThisPlan = [
      "Stress raises cortisol. Hard training raises it more.",
      "Gentle movement helps reduce stress naturally.",
      "Protecting your nervous system is the priority today.",
    ];
    workoutType = "Stress Relief";
    workoutIntensity = "low";
    workoutDuration = 30;
    workoutDesc = "Gentle movement focused on stress relief.";
    optional = "If you start feeling better, increase intensity slightly. No obligation.";
  } else if (feelingOverride && dataIsGood) {
    if (feeling === "exhausted") {
      dailyState = "recover";
      headline = "Rest and recharge today.";
      summary = "Your data looks solid, but you feel exhausted. Subjective fatigue matters. Rest today.";
      dailyFocus = "Focus on recovery";
      yourDay = {
        move: "15 Minutes of Gentle Stretching",
        fuel: "Nourishing Meals · Stay Well Hydrated",
        recover: "Early Bedtime Tonight · Prioritize Sleep",
        mind: "10 Minutes of Meditation or Deep Breathing",
      };
      whyThisPlan = [
        "Your data says go, but your body says stop. We listen to both.",
        "Training while exhausted rarely produces good results.",
        "One rest day protects the rest of your week.",
      ];
      workoutType = "Active Recovery";
      workoutIntensity = "low";
      workoutDuration = 15;
      workoutDesc = "Gentle stretching and mobility only.";
    } else if (feeling === "tired") {
      dailyState = "maintain";
      headline = "Stay consistent. Keep it light.";
      summary = "Your metrics look decent, but you feel tired. A lighter session is the smarter call.";
      dailyFocus = "Stay consistent today";
      yourDay = {
        move: "30 Minutes of Easy Walking or Yoga",
        fuel: "Balanced Meals · Eat Consistently Throughout the Day",
        recover: "Extra Sleep Tonight · Wind Down Early",
        mind: "5 Minutes of Deep Breathing Before Bed",
      };
      whyThisPlan = [
        "Fatigue you can feel often shows up in data tomorrow.",
        "A light day now prevents a forced rest day later.",
        "Consistency beats intensity when you're running low.",
      ];
      workoutType = "Light Activity";
      workoutIntensity = "low";
      workoutDuration = 30;
      workoutDesc = "Easy walk or gentle yoga.";
    } else {
      dailyState = "recover";
      headline = "Ease the tension. Prioritize calm.";
      summary = "Your body could handle training, but stress changes the equation. Go easy.";
      dailyFocus = "Keep stress low today";
      yourDay = {
        move: "30 Minutes of Gentle Walking or Yoga",
        fuel: "Balanced Meals · Don't Skip Meals Under Stress",
        recover: "Reduce Stimulation · Early Bedtime",
        mind: "10 Minutes of Breathing · Limit Caffeine",
      };
      whyThisPlan = [
        "Stress raises cortisol. Hard training raises it more.",
        "Gentle movement helps reduce stress naturally.",
        "Protecting your nervous system is the priority today.",
      ];
      workoutType = "Stress Relief";
      workoutIntensity = "low";
      workoutDuration = 30;
      workoutDesc = "Gentle movement focused on stress relief.";
    }
    optional = "If you start feeling better, increase intensity slightly. No obligation.";
  } else if (lowEnergy && dataIsGood) {
    dailyState = "maintain";
    headline = "Low energy. Keep it gentle.";
    summary = "Your data supports training, but your energy is low. A gentle session keeps you on track.";
    dailyFocus = "Stay consistent today";
    yourDay = {
      move: "30 Minutes of Easy Walking or Yoga",
      fuel: "Balanced Meals · Eat Consistently",
      recover: "Short Nap if Possible · Early Bedtime",
      mind: "10 Minutes of Light Stretching · Walk Outside",
    };
    whyThisPlan = [
      "Low energy often means your body is still processing yesterday.",
      "A gentle session now protects tomorrow's performance.",
      "Rest is not the enemy of progress. It's part of it.",
    ];
    workoutType = "Light Activity";
    workoutIntensity = "low";
    workoutDuration = 30;
    workoutDesc = "Easy movement to stay active without adding strain.";
    optional = "If energy picks up, you can increase to moderate. Listen to your body.";
  } else if (readinessScore >= 75) {
    const feelingGreat = feeling === "great" || energy === "high";
    dailyState = "push";
    headline = feelingGreat ? "You're ready. Make it count." : "Strong day. Push yourself.";
    summary = feelingGreat
      ? "You feel great and your recovery backs it up."
      : "Recovery is strong, sleep was solid. A good day to push.";
    dailyFocus = "Maximize today";
    yourDay = {
      move: "50 Minutes of Strength Training · Compound Lifts, Full Body",
      fuel: "Prioritize Protein · Carbs Before Activity",
      recover: "10 Minutes of Stretching Post-Session · Wind Down Before Bed",
      mind: "Channel Your Energy · Stay Focused",
    };
    whyThisPlan = feelingGreat
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
    dailyState = "build";
    headline = "Stay active. Keep it balanced.";
    summary = "Recovery is solid, but not fully reset. A controlled session keeps you on track.";
    dailyFocus = "Focus on consistency today";
    yourDay = {
      move: "40 Minutes of Cardio at Easy Pace",
      fuel: "Balanced Meals · Protein at Every Meal",
      recover: "Consistent Bedtime · No Screens 30 Minutes Before Bed",
      mind: "5 Minutes of Breathing Before Sleep",
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
    dailyState = "recover";
    headline = "Recovery comes first today.";
    summary = "Your body is showing signs of fatigue. Rest now, come back stronger.";
    dailyFocus = "Focus on recovery";
    yourDay = {
      move: "20 Minutes of Light Stretching or a Short Walk",
      fuel: "Nutrient-Dense Foods · Stay Well Hydrated",
      recover: "8+ Hours of Sleep · In Bed Early",
      mind: "10 Minutes of Meditation or Light Reading",
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

  for (const wc of weakCategories) {
    if (wc === "mind") {
      yourDay.mind = yourDay.mind.replace(/10 Minutes|5 Minutes/i, "3 Minutes");
    } else if (wc === "move") {
      yourDay.move = yourDay.move.replace(/50 Minutes|40 Minutes|30 Minutes/i, "15 Minutes");
    } else if (wc === "recover") {
      yourDay.recover = yourDay.recover.replace(/8\+/, "7+");
    } else if (wc === "fuel") {
      yourDay.fuel = yourDay.fuel.split("·")[0].trim();
    }
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

  const statusLabel: import("@/types").DailyStatusLabel =
    dailyState === "push" ? "Strong Day"
    : dailyState === "build" ? "On Track"
    : dailyState === "maintain" ? "Slightly Off Track"
    : "Off Track";

  if (busyOverride && !overwhelmedOverride && dailyState !== "recover") {
    workoutDuration = Math.min(workoutDuration, 30);
    yourDay.move = yourDay.move.replace(/\d{2,3}\s*Minutes/i, `${workoutDuration} Minutes`);
    yourDay.fuel = yourDay.fuel + (hydration === "low" ? " · Prioritize Water" : "");
    yourDay.mind = "Keep It Simple · Short Walk or 5 Minutes of Breathing";
  }

  if (hydration === "low" && !overwhelmedOverride && !noTraining) {
    if (!yourDay.fuel.toLowerCase().includes("water") && !yourDay.fuel.toLowerCase().includes("hydrat")) {
      yourDay.fuel += " · Drink More Water Today";
    }
    if (workoutIntensity === "high") {
      yourDay.fuel += " · Add Electrolytes Before Training";
    }
  }

  if (trainingIntent === "light" && workoutIntensity === "high") {
    workoutIntensity = "moderate";
    workoutDuration = Math.min(workoutDuration, 35);
    yourDay.move = yourDay.move.replace(/\d{2,3}\s*Minutes/i, `${workoutDuration} Minutes`) + " · Keep It Moderate";
  }

  const statusDrivers: string[] = [];
  if (lifeLoad === "overwhelmed") statusDrivers.push("Life load is heavy");
  else if (lifeLoad === "busy") statusDrivers.push("Busy day ahead");

  if (sleepHours >= 7.5) statusDrivers.push("You slept well");
  else if (sleepHours >= 6.5) statusDrivers.push("Sleep was adequate");
  else statusDrivers.push("Sleep was poor");

  if (metrics.recoveryScore >= 70) statusDrivers.push("Recovery is solid");
  else if (metrics.recoveryScore >= 50) statusDrivers.push("Recovery is moderate");
  else statusDrivers.push("Recovery is lower than usual");

  if (feeling === "great" || energy === "high") statusDrivers.push("You're feeling strong");
  else if (feeling === "exhausted") statusDrivers.push("You feel exhausted");
  else if (feeling === "tired") statusDrivers.push("You're feeling tired");
  else if (feeling === "stressed" || stress === "high") statusDrivers.push("Stress is elevated");
  else if (energy === "low") statusDrivers.push("Energy is low");
  else if (hydration === "low") statusDrivers.push("Hydration is low");
  else if (trainingIntent === "none") statusDrivers.push("No training planned");
  else if (metrics.steps >= 8000) statusDrivers.push("Activity is consistent");
  else statusDrivers.push("Activity has been light");

  const guidance =
    dailyState === "push" ? "Good day to push"
    : dailyState === "build" ? "Stay consistent today"
    : dailyState === "maintain" ? "Take it easy today"
    : "Focus on recovery today";

  return {
    date: metrics.date,
    readinessScore,
    readinessLabel,
    dailyState,
    statusLabel,
    statusDrivers: statusDrivers.slice(0, 3),
    guidance,
    headline,
    summary,
    dailyFocus,
    actions: makeActions(yourDay, hydration),
    yourDay,
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
                ? "Full Body Strength · Compound Lifts"
                : i === 1 || i === 4
                ? "Easy Pace · Keep It Conversational"
                : "Short, Intense Intervals · Full Recovery Between Sets",
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
