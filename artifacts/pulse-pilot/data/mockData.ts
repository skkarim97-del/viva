import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  WeeklyPlan,
  WeeklyPlanDay,
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

function makeActions(yourDay: { move: string; fuel: string; hydrate: string; recover: string; mind: string }): DailyAction[] {
  return [
    { id: "move", category: "move" as ActionCategory, text: yourDay.move, recommended: yourDay.move, completed: false },
    { id: "fuel", category: "fuel" as ActionCategory, text: yourDay.fuel, recommended: yourDay.fuel, completed: false },
    { id: "hydrate", category: "hydrate" as ActionCategory, text: yourDay.hydrate, recommended: yourDay.hydrate, completed: false },
    { id: "recover", category: "recover" as ActionCategory, text: yourDay.recover, recommended: yourDay.recover, completed: false },
    { id: "mind", category: "mind" as ActionCategory, text: yourDay.mind, recommended: yourDay.mind, completed: false },
  ];
}

export function generateDailyPlan(metrics: HealthMetrics, inputs?: WellnessInputs, history?: CompletionRecord[]): DailyPlan {
  const feeling = inputs?.feeling ?? null;
  const energy = inputs?.energy ?? null;
  const stress = inputs?.stress ?? null;
  const hydration = inputs?.hydration ?? null;
  const trainingIntent = inputs?.trainingIntent ?? null;

  let readinessScore = Math.round(
    metrics.recoveryScore * 0.3 +
    metrics.sleepQuality * 0.3 +
    (metrics.hrv / 60) * 100 * 0.2 +
    (1 - Math.min(metrics.restingHeartRate, 80) / 80) * 100 * 0.2
  );

  if (feeling === "tired") readinessScore = Math.min(readinessScore, 55);
  else if (feeling === "stressed") readinessScore = Math.min(readinessScore, 50);
  else if (feeling === "great") readinessScore = Math.max(readinessScore, 75);

  if (energy === "low") readinessScore = Math.min(readinessScore, 45);
  else if (energy === "excellent" || energy === "high") readinessScore = Math.max(readinessScore, 70);

  if (stress === "high") readinessScore = Math.min(readinessScore, 50);
  else if (stress === "very_high") readinessScore = Math.min(readinessScore, 35);

  if (trainingIntent === "none") readinessScore = Math.min(readinessScore, 40);

  if (hydration === "low") readinessScore = Math.max(readinessScore - 5, 0);
  else if (hydration === "dehydrated") readinessScore = Math.max(readinessScore - 10, 0);

  const readinessLabel = readinessScore >= 80 ? "Excellent" : readinessScore >= 65 ? "Good" : readinessScore >= 45 ? "Moderate" : "Low";

  const feelingOverride = feeling === "tired" || feeling === "stressed";
  const stressOverride = stress === "high" || stress === "very_high";
  const lowEnergy = energy === "low";
  const dataIsGood = metrics.recoveryScore >= 65 && metrics.sleepQuality >= 70;
  const noTraining = trainingIntent === "none";

  let headline = "";
  let summary = "";
  let dailyFocus = "";
  let dailyState: import("@/types").DailyState = "maintain";
  let yourDay = { move: "", fuel: "", hydrate: "", recover: "", mind: "" };
  let whyThisPlan: string[] = [];
  let optional = "";
  let workoutType = "";
  let workoutIntensity: "low" | "moderate" | "high" = "moderate";
  let workoutDuration = 40;
  let workoutDesc = "";

  const isDehydrated = hydration === "dehydrated" || hydration === "low";
  const hydrateText = isDehydrated ? "10+ cups water + electrolytes" : "8+ cups water throughout the day";

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

  if (stress === "very_high") {
    dailyState = "recover";
    headline = "Take it slow today.";
    summary = "High stress needs simplicity. Protect your energy and nourish yourself.";
    dailyFocus = "Simplify and recover";
    yourDay = {
      move: "20 min walk · fresh air",
      fuel: "Warm, nourishing meals · anti-inflammatory foods",
      hydrate: isDehydrated ? "10+ cups water, herbal tea tonight" : "8+ cups water, herbal tea tonight",
      recover: "Wind down by 9:30 · bed by 10:00 pm",
      mind: "10 min guided meditation or body scan",
    };
    whyThisPlan = [
      "Stress affects your entire body. sleep, digestion, energy, and mood.",
      "Simplifying today protects the rest of your week.",
      "Recovery isn't just physical. your mind needs rest too.",
    ];
    workoutType = "Rest";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Gentle movement only.";
    optional = "A short walk in nature can help reset your nervous system.";
  } else if (noTraining && !stressOverride && !feelingOverride) {
    dailyState = "maintain";
    headline = "Focus on balance today.";
    summary = "No training planned. A great day to nourish, hydrate, and recharge.";
    dailyFocus = "Nourish and recharge";
    yourDay = {
      move: "20 min walk · nature if possible",
      fuel: "Balanced meals · extra veggies and whole grains",
      hydrate: hydrateText,
      recover: "Bed by 10:00 pm · screen-free wind-down",
      mind: "Gratitude journaling or 5 min breathing",
    };
    whyThisPlan = [
      "Rest days are when your body and mind repair and adapt.",
      "Light movement and good nutrition accelerate recovery.",
      "Investing in rest today makes tomorrow more productive.",
    ];
    workoutType = "Rest Day";
    workoutIntensity = "low";
    workoutDuration = 20;
    workoutDesc = "Light movement and mobility.";
    optional = "If you feel the urge to train, keep it very light.";
  } else if (stressOverride && dataIsGood) {
    dailyState = "recover";
    headline = "Ease the tension today.";
    summary = "Your body is ready, but stress changes things. Focus on calming your system.";
    dailyFocus = "Stress management first";
    yourDay = {
      move: "30 min yoga or stretch",
      fuel: "Whole foods · magnesium-rich foods (leafy greens, nuts)",
      hydrate: isDehydrated ? "10+ cups water, reduce caffeine today" : "8+ cups water, reduce caffeine today",
      recover: "Warm bath or shower · bed by 10:00 pm",
      mind: "10 min breathing · box breathing or 4-7-8",
    };
    whyThisPlan = [
      "Stress raises cortisol, which affects sleep, appetite, and recovery.",
      "Gentle movement and breathing help calm your nervous system.",
      "The right nutrition can support your body's stress response.",
    ];
    workoutType = "Stress Relief";
    workoutIntensity = "low";
    workoutDuration = 30;
    workoutDesc = "Gentle yoga or stretching focused on stress relief.";
    optional = "If you start feeling better, a moderate walk can help too.";
  } else if (feelingOverride && dataIsGood) {
    if (feeling === "tired") {
      dailyState = "maintain";
      headline = "Keep it gentle today.";
      summary = "You're running low. Focus on recharging with good food, water, and rest.";
      dailyFocus = "Recharge your energy";
      yourDay = {
        move: "20 min walk · easy pace",
        fuel: "Balanced meals · complex carbs for sustained energy",
        hydrate: isDehydrated ? "10+ cups water, start with a big glass now" : "8+ cups water, start with a big glass now",
        recover: "Bed by 10:00 pm · aim for 8 hours",
        mind: "5 min breathing or a screen-free break",
      };
      whyThisPlan = [
        "Fatigue you can feel often shows up in data tomorrow.",
        "Good nutrition and hydration are the fastest way to restore energy.",
        "Consistency beats intensity when you're running low.",
      ];
      workoutType = "Light Activity";
      workoutIntensity = "low";
      workoutDuration = 30;
      workoutDesc = "Easy walk or gentle yoga.";
    } else {
      dailyState = "recover";
      headline = "Prioritize calm today.";
      summary = "Your body could handle training, but stress changes the equation. Take care of yourself.";
      dailyFocus = "Calm and restore";
      yourDay = {
        move: "Stretch / mobility · or a nature walk",
        fuel: "Comfort food done right · warm, whole-food meals",
        hydrate: isDehydrated ? "10+ cups water, herbal tea in the evening" : "8+ cups water, herbal tea in the evening",
        recover: "Wind down by 9:30 · bed by 10:00 pm",
        mind: "10 min meditation · body scan or guided",
      };
      whyThisPlan = [
        "Stress affects digestion, sleep quality, and energy levels.",
        "Gentle movement and breathing help your nervous system settle.",
        "Caring for your mind is caring for your body.",
      ];
      workoutType = "Stress Relief";
      workoutIntensity = "low";
      workoutDuration = 30;
      workoutDesc = "Gentle movement focused on stress relief.";
    }
    optional = "If you start feeling better, a moderate walk can shift your mood.";
  } else if (lowEnergy && dataIsGood) {
    dailyState = "maintain";
    headline = "Keep it gentle today.";
    summary = "Your data supports activity, but energy is low. Nourish and hydrate first.";
    dailyFocus = "Restore your energy";
    yourDay = {
      move: "20 min walk · fresh air helps energy",
      fuel: "Balanced meals · iron-rich foods and complex carbs",
      hydrate: isDehydrated ? "10+ cups water, dehydration drains energy" : "8+ cups water, dehydration drains energy",
      recover: "Bed by 10:00 pm · protect your sleep window",
      mind: "5 min breathing · reset mid-afternoon",
    };
    whyThisPlan = [
      "Low energy often signals dehydration, poor nutrition, or accumulated stress.",
      "Addressing the basics. water, food, rest. is the fastest fix.",
      "A gentle day now prevents a forced rest day later.",
    ];
    workoutType = "Light Activity";
    workoutIntensity = "low";
    workoutDuration = 30;
    workoutDesc = "Easy movement to stay active without adding strain.";
    optional = "If energy picks up after eating and hydrating, you can increase to moderate.";
  } else if (readinessScore >= 75) {
    const feelingGreat = feeling === "great" || energy === "excellent" || energy === "high";
    dailyState = "push";
    headline = feelingGreat ? "You're ready. Make the most of today." : "A strong day ahead.";
    summary = feelingGreat
      ? "You feel great and your body agrees. A good day to challenge yourself."
      : "Recovery is strong, sleep was solid. You have the capacity to push.";
    dailyFocus = "Challenge yourself today";
    yourDay = {
      move: trainingIntent === "intense" ? "60 min training · push your limits" : "Strength or cardio · challenge yourself",
      fuel: "High protein · whole foods · fuel your effort",
      hydrate: isDehydrated ? "10+ cups water + electrolytes" : "8+ cups water + electrolytes",
      recover: "Wind down by 9:30 · bed by 10:00 pm",
      mind: "5 min breathing · set an intention for the day",
    };
    whyThisPlan = feelingGreat
      ? [
          "When body and mind are aligned, that's when real progress happens.",
          "Recovery and sleep are supporting you. take advantage of it.",
          "Challenge your body, nourish it well, and rest tonight.",
        ]
      : [
          "Your body is fully recharged from last night.",
          "Recovery and sleep signals support a bigger effort today.",
          "Push now, recover well tonight, and you'll build real momentum.",
        ];
    optional = "If you feel fatigued mid-session, drop to moderate. Listen to your body.";
    workoutType = "Strength Training";
    workoutIntensity = "high";
    workoutDuration = 50;
    workoutDesc = "Full body strength with compound movements.";
  } else if (readinessScore >= 45) {
    dailyState = "build";
    headline = "Build momentum today.";
    summary = "Recovery is solid, but not fully reset. Stay consistent and take care of the basics.";
    dailyFocus = "Steady progress today";
    yourDay = {
      move: "40 min moderate cardio · steady pace",
      fuel: "Balanced meals · protein and veggies each meal",
      hydrate: hydrateText,
      recover: "Bed by 10:00 pm · aim for 8 hours",
      mind: "5 min breathing or journaling",
    };
    whyThisPlan = [
      "Your body is partially recharged. a moderate effort keeps you progressing.",
      "Good nutrition and hydration will support your recovery overnight.",
      "Consistency in the basics is what separates good weeks from great ones.",
    ];
    optional = "If energy feels low, a 20-minute walk is a great alternative.";
    workoutType = "Cardio";
    workoutIntensity = "moderate";
    workoutDuration = 40;
    workoutDesc = "Steady-state cardio at a conversational pace.";
  } else {
    dailyState = "recover";
    headline = "Recovery first today.";
    summary = "Your body is asking for rest. Focus on sleep, nutrition, hydration, and calm.";
    dailyFocus = "Rest and restore";
    yourDay = {
      move: "Stretch / mobility · or a gentle walk",
      fuel: "Recovery nutrition · anti-inflammatory foods, extra protein",
      hydrate: isDehydrated ? "10+ cups water + electrolytes" : "8+ cups water · sip throughout the day",
      recover: "Bed by 10:00 pm · aim for 8+ hours",
      mind: "10 min meditation · body scan or breathing",
    };
    whyThisPlan = [
      "Your body needs time to repair. that includes rest, nutrition, and calm.",
      "Sleep, hydration, and stress management are your best tools right now.",
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
      yourDay.mind = "5 min breathing";
    } else if (wc === "move") {
      yourDay.move = "20 min walk";
    }
  }

  if (trainingIntent === "light" && workoutIntensity === "high") {
    workoutIntensity = "moderate";
    workoutDuration = Math.min(workoutDuration, 35);
    yourDay.move = "40 min cardio";
  }

  if (trainingIntent === "moderate" && workoutIntensity === "high") {
    workoutDuration = Math.min(workoutDuration, 45);
  }

  const sleepHours = metrics.sleepDuration;
  let sleepSummary = "";
  if (sleepHours < 7) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Below what your body needs.`;
  } else if (sleepHours >= 8) {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Solid rest.`;
  } else {
    sleepSummary = `${sleepHours.toFixed(1)} hours. Adequate.`;
  }

  let recoverySummary = "";
  if (metrics.recoveryScore >= 75) {
    recoverySummary = "Recovery is strong.";
  } else if (metrics.recoveryScore >= 50) {
    recoverySummary = "Recovery is moderate.";
  } else {
    recoverySummary = "Recovery is low.";
  }

  const statusLabel: import("@/types").DailyStatusLabel =
    dailyState === "push" ? "Strong Day"
    : dailyState === "build" ? "On Track"
    : dailyState === "maintain" ? "Slightly Off Track"
    : "Off Track";

  const statusDrivers: string[] = [];

  if (metrics.recoveryScore >= 70) statusDrivers.push("Recovery is solid");
  else if (metrics.recoveryScore >= 50) statusDrivers.push("Recovery is moderate");
  else statusDrivers.push("Recovery is low");

  if (sleepHours >= 7.5) statusDrivers.push("Slept well");
  else if (sleepHours >= 6.5) statusDrivers.push("Sleep was adequate");
  else statusDrivers.push("Sleep was short");

  if (feeling === "great" || energy === "excellent" || energy === "high") statusDrivers.push("Feeling strong");
  else if (feeling === "stressed" || stressOverride) statusDrivers.push("Stress is elevated");
  else if (feeling === "tired") statusDrivers.push("Feeling tired");
  else if (energy === "low") statusDrivers.push("Energy is low");
  else if (isDehydrated) statusDrivers.push("Hydration is low");
  else if (trainingIntent === "none") statusDrivers.push("Rest day");
  else if (metrics.steps >= 8000) statusDrivers.push("Movement is strong");
  else statusDrivers.push("Movement has been light");

  const guidance =
    dailyState === "push" ? "Make the most of today"
    : dailyState === "build" ? "Stay consistent today"
    : dailyState === "maintain" ? "Focus on the basics today"
    : "Rest and restore today";

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
    actions: makeActions(yourDay),
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
      note: stressOverride
        ? "Focus on calming, whole foods. Magnesium-rich greens, omega-3s from fish, and complex carbs support your stress response."
        : readinessScore >= 65
        ? "Fuel your effort with protein and complex carbs. Include colorful vegetables and stay well hydrated."
        : "Focus on nutrient-dense, anti-inflammatory foods. Good nutrition accelerates recovery and restores energy.",
    },
    fastingGuidance: "16:8 window. Eat between 12pm and 8pm.",
  };
}

export function generateWeeklyPlan(): WeeklyPlan {
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const focusAreas = [
    "Strength + Stress Management",
    "Cardio + Hydration Focus",
    "Recovery + Nourish",
    "Strength + Sleep Optimization",
    "Active Movement + Nutrition",
    "Recovery + Mental Wellness",
    "Light Movement + Meal Prep",
  ];

  const dayConfigs: { move: string; fuel: string; hydrate: string; recover: string; mind: string }[] = [
    { move: "45 min strength", fuel: "High protein", hydrate: "10+ cups water", recover: "Bed by 10:00 pm", mind: "5 min breathing" },
    { move: "40 min cardio", fuel: "Balanced meals", hydrate: "Water + electrolytes", recover: "Aim for 7 hours", mind: "10 min meditation" },
    { move: "Active recovery", fuel: "Lighter meals", hydrate: "8 cups water", recover: "Aim for 8 hours", mind: "Quiet time" },
    { move: "45 min strength", fuel: "High protein", hydrate: "10+ cups water", recover: "Wind down 30 min early", mind: "5 min breathing" },
    { move: "40 min cardio", fuel: "Balanced meals", hydrate: "Water + electrolytes", recover: "Bed by 10:00 pm", mind: "10 min breathing" },
    { move: "Rest day", fuel: "Recovery nutrition", hydrate: "8 cups water", recover: "Aim for 8 hours", mind: "10 min meditation" },
    { move: "30 min yoga", fuel: "Balanced meals", hydrate: "8 cups water", recover: "Bed by 10:30 pm", mind: "Quiet time" },
  ];

  const categories: ActionCategory[] = ["move", "fuel", "hydrate", "recover", "mind"];

  const planDays: WeeklyPlanDay[] = dayNames.map((name, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const cfg = dayConfigs[i];
    return {
      dayOfWeek: name,
      date: date.toISOString().split("T")[0],
      focusArea: focusAreas[i],
      actions: categories.map((cat) => ({
        category: cat,
        recommended: cfg[cat],
        chosen: cfg[cat],
        completed: false,
      })),
    };
  });

  return {
    weekStartDate: monday.toISOString().split("T")[0],
    weekSummary: "This week focuses on steady progress with two lighter days to support recovery. Your plan balances movement, nutrition, hydration, and rest based on your recent patterns.",
    days: planDays,
    adjustmentNote: "If stress is high or sleep drops mid-week, swap a training day for yoga, stretching, and extra recovery time.",
  };
}

export function generateTrendData(): TrendData[] {
  return generateTrendDataFromMetrics(generateMockMetrics(28));
}

function computeTrend(values: number[]): "up" | "down" | "stable" {
  if (values.length < 4) return "stable";
  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const change = (avgSecond - avgFirst) / (avgFirst || 1);
  if (change > 0.03) return "up";
  if (change < -0.03) return "down";
  return "stable";
}

function trendSummary(label: string, values: number[], trend: "up" | "down" | "stable", unit: string): string {
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const latest = values[values.length - 1];
  const first = values[0];
  const change = latest - first;

  switch (label) {
    case "Weight": {
      if (Math.abs(change) < 0.5) return "Weight has been steady over the last 4 weeks. Your body composition is stable.";
      return trend === "down"
        ? `Down ${Math.abs(change).toFixed(1)} lbs over the past 4 weeks. Steady, sustainable progress.`
        : `Up ${Math.abs(change).toFixed(1)} lbs over the past 4 weeks. Check your nutrition if this isn't intentional.`;
    }
    case "HRV": {
      if (trend === "up") return "Trending up. Your body is adapting well and recovery capacity is improving.";
      if (trend === "down") return "Trending down over 4 weeks. This may reflect accumulated stress or too little recovery.";
      return `Holding steady around ${Math.round(avg)} ms. Consistent recovery and rest are keeping things balanced.`;
    }
    case "Resting HR": {
      if (trend === "down") return "Gradually decreasing. This is a sign of improving cardiovascular fitness.";
      if (trend === "up") return "Trending higher. Consider whether stress, poor sleep, or overtraining may be a factor.";
      return `Stable around ${Math.round(avg)} bpm. Your heart is in a consistent rhythm.`;
    }
    case "Sleep": {
      if (avg >= 7.5) return `Averaging ${avg.toFixed(1)} hours. Solid sleep is supporting your recovery and energy.`;
      if (avg < 6.5) return `Averaging only ${avg.toFixed(1)} hours. Getting closer to 7-8 hours would improve recovery and focus.`;
      return `Averaging ${avg.toFixed(1)} hours. A bit more sleep would give your body extra recovery time.`;
    }
    case "Steps": {
      const avgK = Math.round(avg).toLocaleString();
      if (avg >= 8000) return `Averaging ${avgK} daily. Strong daily movement that supports your overall health.`;
      if (avg >= 5000) return `Averaging ${avgK} daily. Adding a short walk could push you into a stronger range.`;
      return `Averaging ${avgK} daily. Look for ways to add more movement throughout your day.`;
    }
    case "Recovery": {
      if (avg >= 70) return "Recovery has been strong. Your body is bouncing back well between sessions.";
      if (avg < 50) return "Recovery has been low. More rest and better sleep would help you recharge.";
      return "Recovery is moderate. Consistent sleep and lighter training days will help it climb.";
    }
    default:
      return "";
  }
}

export function generateTrendDataFromMetrics(metrics: HealthMetrics[]): TrendData[] {
  if (!metrics || metrics.length === 0) return generateTrendData();

  const configs: { label: string; extract: (m: HealthMetrics) => number; unit: string }[] = [
    { label: "Weight", extract: (m) => m.weight, unit: "lbs" },
    { label: "HRV", extract: (m) => m.hrv, unit: "ms" },
    { label: "Resting HR", extract: (m) => m.restingHeartRate, unit: "bpm" },
    { label: "Sleep", extract: (m) => m.sleepDuration, unit: "hrs" },
    { label: "Steps", extract: (m) => m.steps, unit: "steps" },
    { label: "Recovery", extract: (m) => m.recoveryScore, unit: "%" },
  ];

  return configs.map(({ label, extract, unit }) => {
    const data = metrics.map((m) => ({ date: m.date, value: extract(m) }));
    const values = data.map((d) => d.value);
    const trend = computeTrend(values);
    const summary = trendSummary(label, values, trend, unit);
    return { label, data, unit, trend, summary };
  });
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
  { id: "samsung_health", name: "Samsung Health", icon: "smartphone", connected: false },
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
