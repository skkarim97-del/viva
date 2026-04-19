import type {
  GLP1DailyInputs,
  EnergyDaily,
  AppetiteLevel,
  NauseaLevel,
  DigestionStatus,
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

const NAUSEA_SCORES: Record<string, number> = {
  none: 4,
  mild: 3,
  moderate: 2,
  severe: 1,
};

const DIGESTION_SCORES: Record<string, number> = {
  fine: 4,
  bloated: 3,
  constipated: 2,
  diarrhea: 1,
};

export function scoreEnergy(val: EnergyDaily): number {
  return val ? (ENERGY_SCORES[val] ?? 0) : 0;
}

export function scoreAppetite(val: AppetiteLevel): number {
  return val ? (APPETITE_SCORES[val] ?? 0) : 0;
}

export function scoreNausea(val: NauseaLevel): number {
  return val ? (NAUSEA_SCORES[val] ?? 0) : 0;
}

export function scoreDigestion(val: DigestionStatus): number {
  return val ? (DIGESTION_SCORES[val] ?? 0) : 0;
}

export function scoreInput(category: InputCategory, inputs: GLP1DailyInputs): number {
  switch (category) {
    case "energy": return scoreEnergy(inputs.energy);
    case "appetite": return scoreAppetite(inputs.appetite);
    case "nausea": return scoreNausea(inputs.nausea);
    case "digestion": return scoreDigestion(inputs.digestion);
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

const ALL_CATEGORIES: InputCategory[] = ["energy", "appetite", "nausea", "digestion"];

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
    ["appetite", "nausea", "Nausea may be suppressing appetite", "Manageable nausea is helping maintain appetite"],
    ["nausea", "digestion", "Nausea and digestive issues are co-occurring", "Both nausea and digestion are in a good range"],
    ["energy", "appetite", "Lower energy correlates with reduced appetite", "Good energy supports healthy appetite"],
    ["digestion", "energy", "Digestive discomfort may be affecting energy", "Good digestion supports steadier energy"],
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
    nausea: "nausea",
    digestion: "digestion",
  };

  for (const cat of analytics) {
    if (cat.avg7d === 0) continue;

    if (cat.trend === "down" && cat.avg7d <= 2.5) {
      if (cat.category === "nausea") {
        insights.push("Nausea has been more noticeable this week");
      } else if (cat.category === "digestion") {
        insights.push("Digestion has been more unsettled this week");
      } else {
        insights.push(`Your ${categoryLabels[cat.category]} has been lower than usual this week`);
      }
    } else if (cat.trend === "up" && cat.avg7d >= 3) {
      if (cat.category === "nausea") {
        insights.push("Nausea has been easing up recently");
      } else if (cat.category === "digestion") {
        insights.push("Digestion has been settling down");
      } else {
        insights.push(`Your ${categoryLabels[cat.category]} has been improving`);
      }
    } else if (cat.avg7d <= 1.5 && cat.category !== "nausea" && cat.category !== "digestion") {
      insights.push(`Your ${categoryLabels[cat.category]} has been consistently low this week`);
    } else if (cat.avg7d <= 1.5 && cat.category === "nausea") {
      insights.push("You have been dealing with significant nausea this week");
    } else if (cat.avg7d <= 1.5 && cat.category === "digestion") {
      insights.push("Digestive issues have been persistent this week");
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
    nausea: "Nausea",
    digestion: "Digestion",
  };

  for (const cat of analytics) {
    if (cat.avg7d === 0) continue;
    if (cat.category === "nausea") {
      if (cat.trend === "down") lines.push("Nausea has increased after recent changes");
      else if (cat.trend === "up") lines.push("Nausea has improved this week");
      else if (cat.avg7d <= 2) lines.push("Nausea remains noticeable this week");
    } else if (cat.category === "digestion") {
      if (cat.trend === "down") lines.push("Digestion has worsened this week");
      else if (cat.trend === "up") lines.push("Digestion has improved this week");
      else if (cat.avg7d <= 2) lines.push("Digestive discomfort continues this week");
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
  const nausea = findCat("nausea");
  const energy = findCat("energy");
  const digestion = findCat("digestion");

  if (appetite && appetite.avg7d <= 2 && appetite.avg7d > 0) flags.push("low_appetite");
  if (appetite && appetite.trend === "up" && appetite.avg7d >= 3) flags.push("improving_appetite");
  if (nausea && nausea.avg7d <= 2 && nausea.avg7d > 0) flags.push("high_side_effects");
  if (energy && energy.avg7d <= 2 && energy.avg7d > 0) flags.push("poor_energy");
  if (digestion && digestion.avg7d <= 2 && digestion.avg7d > 0) flags.push("low_hydration");
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
  if (medicationProfile?.timeOnMedicationBucket === "less_30_days") {
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
      nausea: trendFor("nausea"),
      digestion: trendFor("digestion"),
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
