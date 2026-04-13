import type {
  GLP1DailyInputs,
  EnergyDaily,
  AppetiteLevel,
  HydrationDaily,
  ProteinConfidenceDaily,
  SideEffectSeverity,
  MovementIntent,
  InputCategory,
  TrendDirection,
  CategoryAnalytics,
  InputCorrelation,
  InputAnalytics,
  PatientSummary,
  PatientStatus,
  PatientFlag,
  AdherenceSummary,
  MedicationProfile,
  MedicationLogEntry,
  CompletionRecord,
  UserPatterns,
} from "@/types";

const ENERGY_SCORES: Record<string, number> = {
  great: 4,
  good: 3,
  tired: 2,
  depleted: 1,
};

const APPETITE_SCORES: Record<string, number> = {
  strong: 4,
  normal: 3,
  low: 2,
  very_low: 1,
};

const HYDRATION_SCORES: Record<string, number> = {
  high: 4,
  good: 3,
  okay: 2,
  poor: 1,
};

const PROTEIN_SCORES: Record<string, number> = {
  high: 4,
  good: 3,
  okay: 2,
  low: 1,
};

const SIDE_EFFECT_SCORES: Record<string, number> = {
  none: 4,
  mild: 3,
  moderate: 2,
  rough: 1,
};

const MOVEMENT_SCORES: Record<string, number> = {
  strength: 4,
  walk: 3,
  light_recovery: 2,
  rest: 1,
};

export function scoreEnergy(val: EnergyDaily): number {
  return val ? (ENERGY_SCORES[val] ?? 0) : 0;
}

export function scoreAppetite(val: AppetiteLevel): number {
  return val ? (APPETITE_SCORES[val] ?? 0) : 0;
}

export function scoreHydration(val: HydrationDaily): number {
  return val ? (HYDRATION_SCORES[val] ?? 0) : 0;
}

export function scoreProtein(val: ProteinConfidenceDaily): number {
  return val ? (PROTEIN_SCORES[val] ?? 0) : 0;
}

export function scoreSideEffects(val: SideEffectSeverity): number {
  return val ? (SIDE_EFFECT_SCORES[val] ?? 0) : 0;
}

export function scoreMovement(val: MovementIntent): number {
  return val ? (MOVEMENT_SCORES[val] ?? 0) : 0;
}

export function scoreInput(category: InputCategory, inputs: GLP1DailyInputs): number {
  switch (category) {
    case "energy": return scoreEnergy(inputs.energy);
    case "appetite": return scoreAppetite(inputs.appetite);
    case "hydration": return scoreHydration(inputs.hydration);
    case "protein": return scoreProtein(inputs.proteinConfidence);
    case "sideEffects": return scoreSideEffects(inputs.sideEffects);
    case "movement": return scoreMovement(inputs.movementIntent);
  }
}

function avg(values: number[]): number {
  const valid = values.filter(v => v > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function computeTrend(values: number[]): TrendDirection {
  const valid = values.filter(v => v > 0);
  if (valid.length < 3) return "flat";
  const half = Math.floor(valid.length / 2);
  const firstHalf = avg(valid.slice(0, half));
  const secondHalf = avg(valid.slice(half));
  const diff = secondHalf - firstHalf;
  if (diff > 0.4) return "up";
  if (diff < -0.4) return "down";
  return "flat";
}

const ALL_CATEGORIES: InputCategory[] = ["energy", "appetite", "hydration", "protein", "sideEffects", "movement"];

export function computeCategoryAnalytics(history: GLP1DailyInputs[]): CategoryAnalytics[] {
  const last7 = history.slice(-7);
  return ALL_CATEGORIES.map(category => {
    const values = last7.map(day => scoreInput(category, day));
    return {
      category,
      avg7d: Math.round(avg(values) * 100) / 100,
      trend: computeTrend(values),
      values,
    };
  });
}

export function computeCorrelations(history: GLP1DailyInputs[]): InputCorrelation[] {
  const last7 = history.slice(-7);
  if (last7.length < 3) return [];
  const correlations: InputCorrelation[] = [];

  const pairs: [InputCategory, InputCategory, string, string][] = [
    ["appetite", "protein", "Lower appetite tends to reduce protein intake", "Better appetite supports protein goals"],
    ["hydration", "energy", "Lower hydration may be affecting energy levels", "Good hydration is supporting energy"],
    ["sideEffects", "movement", "Side effects may be limiting activity", "Fewer side effects support staying active"],
    ["sideEffects", "appetite", "Side effects may be suppressing appetite", "Manageable side effects help maintain appetite"],
    ["energy", "movement", "Lower energy is reducing activity", "Good energy supports staying active"],
    ["hydration", "sideEffects", "Low hydration may be worsening side effects", "Hydration helps manage side effects"],
  ];

  for (const [catA, catB, negInsight, posInsight] of pairs) {
    const a: number[] = [];
    const b: number[] = [];
    for (const day of last7) {
      const scoreA = scoreInput(catA, day);
      const scoreB = scoreInput(catB, day);
      if (scoreA > 0 && scoreB > 0) {
        a.push(scoreA);
        b.push(scoreB);
      }
    }
    if (a.length < 3) continue;

    const avgA = avg(a);
    const avgB = avg(b);
    const minLen = a.length;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < minLen; i++) {
      const da = a[i] - avgA;
      const db = b[i] - avgB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    if (den === 0) continue;
    const r = num / den;

    let strength: "strong" | "moderate" | "weak";
    const absR = Math.abs(r);
    if (absR >= 0.7) strength = "strong";
    else if (absR >= 0.4) strength = "moderate";
    else continue;

    const direction = r > 0 ? "positive" as const : "negative" as const;
    const isNegativeTrend = avgA <= 2.5 || avgB <= 2.5;
    const insight = isNegativeTrend ? negInsight : posInsight;

    correlations.push({ pair: [catA, catB], direction, strength, insight });
  }

  return correlations;
}

export function generateInputInsights(analytics: CategoryAnalytics[], correlations: InputCorrelation[]): string[] {
  const insights: string[] = [];

  const categoryLabels: Record<InputCategory, string> = {
    energy: "energy",
    appetite: "appetite",
    hydration: "hydration",
    protein: "protein intake",
    sideEffects: "side effects",
    movement: "activity",
  };

  for (const cat of analytics) {
    if (cat.avg7d === 0) continue;

    if (cat.trend === "down" && cat.avg7d <= 2.5) {
      if (cat.category === "sideEffects") {
        insights.push("Side effects have been more noticeable this week");
      } else {
        insights.push(`Your ${categoryLabels[cat.category]} has been lower than usual this week`);
      }
    } else if (cat.trend === "up" && cat.avg7d >= 3) {
      if (cat.category === "sideEffects") {
        insights.push("Side effects have been easing up recently");
      } else {
        insights.push(`Your ${categoryLabels[cat.category]} has been improving`);
      }
    } else if (cat.avg7d <= 1.5 && cat.category !== "sideEffects") {
      insights.push(`Your ${categoryLabels[cat.category]} has been consistently low this week`);
    } else if (cat.avg7d <= 1.5 && cat.category === "sideEffects") {
      insights.push("You have been dealing with significant side effects this week");
    }
  }

  for (const corr of correlations) {
    if (corr.strength === "strong") {
      insights.push(corr.insight);
    }
  }

  return insights.slice(0, 5);
}

export function computeInputAnalytics(history: GLP1DailyInputs[]): InputAnalytics {
  const categories = computeCategoryAnalytics(history);
  const correlations = computeCorrelations(history);
  const insights = generateInputInsights(categories, correlations);
  return {
    categories,
    correlations,
    insights,
    lastUpdated: new Date().toISOString(),
  };
}

export function computeAdherenceSummary(
  medicationLog: MedicationLogEntry[],
  frequency: "weekly" | "daily",
): AdherenceSummary {
  const last30 = medicationLog.filter(e => {
    const d = new Date(e.date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30;
  });

  const dosesTaken = last30.filter(e => e.status === "taken").length;
  const dosesMissed = last30.filter(e => e.status === "missed").length;
  const dosesDelayed = last30.filter(e => e.status === "delayed").length;
  const dosesExpected = frequency === "daily" ? 30 : 4;
  const adherenceRate = dosesExpected > 0 ? Math.round((dosesTaken / dosesExpected) * 100) : 0;

  let currentStreak = 0;
  let longestStreak = 0;
  const sorted = [...last30].filter(e => e.status === "taken").sort((a, b) => b.date.localeCompare(a.date));

  if (frequency === "daily") {
    for (let i = 0; i < sorted.length; i++) {
      const expected = new Date();
      expected.setDate(expected.getDate() - i);
      const dateStr = expected.toISOString().split("T")[0];
      if (sorted.find(e => e.date === dateStr)) {
        currentStreak++;
      } else {
        break;
      }
    }
  } else {
    currentStreak = sorted.length > 0 ? sorted.length : 0;
  }

  let streak = 0;
  const allSorted = [...medicationLog].filter(e => e.status === "taken").sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < allSorted.length; i++) {
    streak++;
    if (streak > longestStreak) longestStreak = streak;
    if (i < allSorted.length - 1) {
      const gap = Math.floor((new Date(allSorted[i + 1].date).getTime() - new Date(allSorted[i].date).getTime()) / (1000 * 60 * 60 * 24));
      const maxGap = frequency === "daily" ? 1 : 9;
      if (gap > maxGap) streak = 0;
    }
  }

  return { dosesTaken, dosesExpected, dosesMissed, dosesDelayed, adherenceRate: Math.min(100, adherenceRate), currentStreak, longestStreak };
}

function generateWeeklySummaryLines(analytics: CategoryAnalytics[], adherence: AdherenceSummary): string[] {
  const lines: string[] = [];

  const labels: Record<InputCategory, string> = {
    energy: "Energy",
    appetite: "Appetite",
    hydration: "Hydration",
    protein: "Protein intake",
    sideEffects: "Side effects",
    movement: "Activity",
  };

  for (const cat of analytics) {
    if (cat.avg7d === 0) continue;
    if (cat.category === "sideEffects") {
      if (cat.trend === "down") lines.push("Side effects have increased after recent changes");
      else if (cat.trend === "up") lines.push("Side effects have improved this week");
      else if (cat.avg7d <= 2) lines.push("Side effects remain noticeable this week");
    } else {
      if (cat.trend === "down" && cat.avg7d <= 2.5) lines.push(`${labels[cat.category]} dipped compared to last week`);
      else if (cat.trend === "up" && cat.avg7d >= 3) lines.push(`${labels[cat.category]} improved this week`);
    }
  }

  if (adherence.adherenceRate >= 90) {
    lines.push("Medication adherence has been strong");
  } else if (adherence.dosesMissed > 0) {
    lines.push("A dose was missed recently");
  }

  return lines.slice(0, 5);
}

export function buildPatientSummary(
  history: GLP1DailyInputs[],
  medicationProfile: MedicationProfile | undefined,
  medicationLog: MedicationLogEntry[],
  completionHistory: CompletionRecord[],
  patterns?: UserPatterns | null,
): PatientSummary {
  const analytics = computeCategoryAnalytics(history);
  const frequency = medicationProfile?.frequency ?? "weekly";
  const adherence = computeAdherenceSummary(medicationLog, frequency);

  const flags: PatientFlag[] = [];
  const findCat = (cat: InputCategory) => analytics.find(a => a.category === cat);

  const appetite = findCat("appetite");
  const hydration = findCat("hydration");
  const protein = findCat("protein");
  const energy = findCat("energy");
  const sideEffects = findCat("sideEffects");
  const movement = findCat("movement");

  if (appetite && appetite.avg7d <= 2 && appetite.avg7d > 0) flags.push("low_appetite");
  if (appetite && appetite.trend === "up" && appetite.avg7d >= 3) flags.push("improving_appetite");
  if (hydration && hydration.avg7d <= 2 && hydration.avg7d > 0) flags.push("low_hydration");
  if (hydration && hydration.trend === "up" && hydration.avg7d >= 3) flags.push("improving_hydration");
  if (protein && protein.avg7d <= 2 && protein.avg7d > 0) flags.push("low_protein");
  if (energy && energy.avg7d <= 2 && energy.avg7d > 0) flags.push("poor_energy");
  if (sideEffects && sideEffects.avg7d <= 2 && sideEffects.avg7d > 0) flags.push("high_side_effects");
  if (movement && movement.trend === "down" && movement.avg7d <= 2) flags.push("declining_activity");
  if (adherence.dosesMissed > 0) flags.push("missed_dose");

  const last7Completions = completionHistory.slice(-7);
  const avgCompletion = last7Completions.length > 0
    ? Math.round(last7Completions.reduce((s, r) => s + r.completionRate, 0) / last7Completions.length)
    : 0;
  if (avgCompletion >= 70 && last7Completions.length >= 5) flags.push("consistent_logging");

  const negativeFlags = flags.filter(f =>
    f === "low_appetite" || f === "declining_recovery" || f === "missed_dose" ||
    f === "high_side_effects" || f === "low_hydration" || f === "low_protein" ||
    f === "declining_activity" || f === "poor_energy"
  );
  const positiveFlags = flags.filter(f =>
    f === "improving_appetite" || f === "improving_hydration" || f === "consistent_logging"
  );

  let patientStatus: PatientStatus = "stable";
  if (medicationProfile?.timeOnMedicationBucket === "less_1_month") {
    patientStatus = "new_patient";
  } else if (negativeFlags.length >= 3) {
    patientStatus = "needs_attention";
  } else if (positiveFlags.length >= 2 && negativeFlags.length === 0) {
    patientStatus = "improving";
  }

  const trendFor = (cat: InputCategory) => {
    const found = findCat(cat);
    return { avg: found?.avg7d ?? 0, trend: found?.trend ?? ("flat" as TrendDirection) };
  };

  const weeklySummaryLines = generateWeeklySummaryLines(analytics, adherence);
  const consistencyScore = last7Completions.length > 0
    ? Math.round((last7Completions.length / 7) * 100)
    : 0;

  return {
    patientStatus,
    keyFlags: flags,
    medicationContext: medicationProfile ? {
      brand: medicationProfile.medicationBrand,
      dose: `${medicationProfile.doseValue} ${medicationProfile.doseUnit}`,
      frequency: medicationProfile.frequency,
      titrationStatus: medicationProfile.recentTitration ? "recent" : "stable",
      timeOnMedication: medicationProfile.timeOnMedicationBucket.replace(/_/g, " "),
    } : null,
    adherenceSummary: adherence,
    trendSummary: {
      energy: trendFor("energy"),
      appetite: trendFor("appetite"),
      hydration: trendFor("hydration"),
      protein: trendFor("protein"),
      sideEffects: trendFor("sideEffects"),
      movement: trendFor("movement"),
    },
    last7DayOverview: {
      avgCompletionRate: avgCompletion,
      daysLogged: last7Completions.length,
      consistencyScore,
    },
    weeklySummaryLines,
    generatedAt: new Date().toISOString(),
    detectedPatterns: patterns ?? undefined,
  };
}
