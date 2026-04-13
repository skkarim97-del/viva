import type {
  GLP1DailyInputs,
  InputCategory,
  TrendDirection,
  MedicationLogEntry,
  CompletionRecord,
  RollingAverage,
  PostDosePattern,
  DetectedPattern,
  AdaptiveOverride,
  UserPatterns,
  AdaptiveInsight,
  PatternConfidence,
} from "@/types";
import { scoreInput } from "./inputScoring";

const ALL_CATEGORIES: InputCategory[] = ["energy", "appetite", "hydration", "protein", "sideEffects", "movement"];

function avg(values: number[]): number {
  const valid = values.filter(v => v > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function computeTrendDirection(values: number[]): TrendDirection {
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

function computeVolatility(values: number[]): number {
  const valid = values.filter(v => v > 0);
  if (valid.length < 3) return 0;
  const mean = avg(valid);
  const variance = valid.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / valid.length;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

export function computeRollingAverages(history: GLP1DailyInputs[]): RollingAverage[] {
  const last7 = history.slice(-7);
  const last14 = history.slice(-14);

  return ALL_CATEGORIES.map(category => {
    const values7 = last7.map(day => scoreInput(category, day));
    const values14 = last14.map(day => scoreInput(category, day));

    return {
      category,
      avg7d: Math.round(avg(values7) * 100) / 100,
      avg14d: Math.round(avg(values14) * 100) / 100,
      trend7d: computeTrendDirection(values7),
      trend14d: computeTrendDirection(values14),
      volatility: computeVolatility(values14),
    };
  });
}

export function detectPostDoseEffects(
  history: GLP1DailyInputs[],
  medicationLog: MedicationLogEntry[],
): PostDosePattern[] {
  const takenDoses = medicationLog.filter(e => e.status === "taken").sort((a, b) => a.date.localeCompare(b.date));
  if (takenDoses.length < 2 || history.length < 7) return [];

  const patterns: PostDosePattern[] = [];
  const dayOffsets = [0, 1, 2, 3];

  for (const category of ALL_CATEGORIES) {
    for (const offset of dayOffsets) {
      const scores: number[] = [];

      for (const dose of takenDoses) {
        const doseDate = new Date(dose.date + "T12:00:00");
        const targetDate = new Date(doseDate);
        targetDate.setDate(targetDate.getDate() + offset);
        const targetStr = targetDate.toISOString().split("T")[0];

        const dayInput = history.find(h => h.date === targetStr);
        if (dayInput) {
          const score = scoreInput(category, dayInput);
          if (score > 0) scores.push(score);
        }
      }

      if (scores.length >= 2) {
        const avgScore = Math.round(avg(scores) * 100) / 100;
        patterns.push({
          dayOffset: offset,
          category,
          avgScore,
          sampleSize: scores.length,
        });
      }
    }
  }

  return patterns;
}

function findSignificantPostDoseDrops(postDose: PostDosePattern[], rollingAvgs: RollingAverage[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const cat of ALL_CATEGORIES) {
    const baseline = rollingAvgs.find(r => r.category === cat);
    if (!baseline || baseline.avg7d === 0) continue;

    const dayPatterns = postDose.filter(p => p.category === cat && p.sampleSize >= 2);
    if (dayPatterns.length === 0) continue;

    const day0 = dayPatterns.find(p => p.dayOffset === 0);
    const day1 = dayPatterns.find(p => p.dayOffset === 1);
    const day2 = dayPatterns.find(p => p.dayOffset === 2);

    const categoryLabels: Record<InputCategory, string> = {
      energy: "energy",
      appetite: "appetite",
      hydration: "hydration",
      protein: "protein intake",
      sideEffects: "side effects",
      movement: "activity",
    };

    if (day1 && day1.avgScore < baseline.avg7d - 0.5 && day1.sampleSize >= 2) {
      const confidence = day1.sampleSize >= 4 ? "high" : day1.sampleSize >= 3 ? "medium" : "low";
      if (cat === "sideEffects") {
        patterns.push({
          id: `post_dose_${cat}_day1`,
          description: `Side effects tend to increase 1 day after your dose`,
          confidence: confidence as PatternConfidence,
          dataPoints: day1.sampleSize,
          lastSeen: today,
        });
      } else {
        patterns.push({
          id: `post_dose_${cat}_day1`,
          description: `Your ${categoryLabels[cat]} tends to dip 1 day after your dose`,
          confidence: confidence as PatternConfidence,
          dataPoints: day1.sampleSize,
          lastSeen: today,
        });
      }
    }

    if (day2 && day2.avgScore < baseline.avg7d - 0.5 && day2.sampleSize >= 2) {
      const confidence = day2.sampleSize >= 4 ? "high" : day2.sampleSize >= 3 ? "medium" : "low";
      if (cat === "sideEffects") {
        patterns.push({
          id: `post_dose_${cat}_day2`,
          description: `Side effects tend to linger for 2 days after your dose`,
          confidence: confidence as PatternConfidence,
          dataPoints: day2.sampleSize,
          lastSeen: today,
        });
      } else if (!patterns.find(p => p.id === `post_dose_${cat}_day1`)) {
        patterns.push({
          id: `post_dose_${cat}_day2`,
          description: `Your ${categoryLabels[cat]} tends to dip around 2 days after your dose`,
          confidence: confidence as PatternConfidence,
          dataPoints: day2.sampleSize,
          lastSeen: today,
        });
      }
    }

    if (day0 && day0.avgScore > baseline.avg7d + 0.3 && day0.sampleSize >= 2) {
      const confidence = day0.sampleSize >= 4 ? "high" : "medium";
      if (cat !== "sideEffects") {
        patterns.push({
          id: `dose_day_boost_${cat}`,
          description: `Your ${categoryLabels[cat]} tends to be better on dose day`,
          confidence: confidence as PatternConfidence,
          dataPoints: day0.sampleSize,
          lastSeen: today,
        });
      }
    }
  }

  return patterns;
}

function detectBehavioralPatterns(
  history: GLP1DailyInputs[],
  rollingAvgs: RollingAverage[],
  completionHistory: CompletionRecord[],
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const today = new Date().toISOString().split("T")[0];

  if (history.length < 5) return patterns;

  const hydration = rollingAvgs.find(r => r.category === "hydration");
  const energy = rollingAvgs.find(r => r.category === "energy");
  const sideEffects = rollingAvgs.find(r => r.category === "sideEffects");
  const appetite = rollingAvgs.find(r => r.category === "appetite");
  const protein = rollingAvgs.find(r => r.category === "protein");
  const movement = rollingAvgs.find(r => r.category === "movement");

  let lowHydrationLowEnergy = 0;
  let goodHydrationGoodEnergy = 0;
  let totalPairs = 0;
  for (const day of history.slice(-14)) {
    const h = scoreInput("hydration", day);
    const e = scoreInput("energy", day);
    if (h === 0 || e === 0) continue;
    totalPairs++;
    if (h <= 2 && e <= 2) lowHydrationLowEnergy++;
    if (h >= 3 && e >= 3) goodHydrationGoodEnergy++;
  }
  if (totalPairs >= 5 && (lowHydrationLowEnergy + goodHydrationGoodEnergy) / totalPairs >= 0.6) {
    patterns.push({
      id: "hydration_energy_link",
      description: "Your energy tends to track closely with your hydration",
      confidence: totalPairs >= 10 ? "high" : "medium",
      dataPoints: totalPairs,
      lastSeen: today,
    });
  }

  let lowAppLowProtein = 0;
  let appProtPairs = 0;
  for (const day of history.slice(-14)) {
    const a = scoreInput("appetite", day);
    const p = scoreInput("protein", day);
    if (a === 0 || p === 0) continue;
    appProtPairs++;
    if (a <= 2 && p <= 2) lowAppLowProtein++;
  }
  if (appProtPairs >= 5 && lowAppLowProtein / appProtPairs >= 0.5) {
    patterns.push({
      id: "appetite_protein_struggle",
      description: "When appetite drops, your protein intake tends to follow",
      confidence: appProtPairs >= 10 ? "high" : "medium",
      dataPoints: appProtPairs,
      lastSeen: today,
    });
  }

  let lowEnergyRestBetter = 0;
  let lowEnergyMoveBetter = 0;
  let lowEnergyDays = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const eToday = scoreInput("energy", history[i]);
    if (eToday > 2 || eToday === 0) continue;
    lowEnergyDays++;
    const mToday = scoreInput("movement", history[i]);
    const eTomorrow = scoreInput("energy", history[i + 1]);
    if (eTomorrow === 0) continue;
    if (mToday <= 2 && eTomorrow >= 3) lowEnergyRestBetter++;
    if (mToday >= 3 && eTomorrow >= 3) lowEnergyMoveBetter++;
  }
  if (lowEnergyDays >= 3) {
    if (lowEnergyRestBetter > lowEnergyMoveBetter && lowEnergyRestBetter >= 2) {
      patterns.push({
        id: "rest_helps_recovery",
        description: "You tend to bounce back better when you rest on low energy days",
        confidence: lowEnergyDays >= 5 ? "high" : "medium",
        dataPoints: lowEnergyDays,
        lastSeen: today,
      });
    } else if (lowEnergyMoveBetter > lowEnergyRestBetter && lowEnergyMoveBetter >= 2) {
      patterns.push({
        id: "light_movement_helps",
        description: "Light movement on low energy days tends to help you feel better the next day",
        confidence: lowEnergyDays >= 5 ? "high" : "medium",
        dataPoints: lowEnergyDays,
        lastSeen: today,
      });
    }
  }

  if (sideEffects && hydration) {
    let seLowHydLow = 0;
    let seLowHydHigh = 0;
    let seDays = 0;
    for (const day of history.slice(-14)) {
      const se = scoreInput("sideEffects", day);
      const h = scoreInput("hydration", day);
      if (se === 0 || h === 0) continue;
      if (se <= 2) {
        seDays++;
        if (h <= 2) seLowHydLow++;
        if (h >= 3) seLowHydHigh++;
      }
    }
    if (seDays >= 3 && seLowHydLow >= 2 && seLowHydLow > seLowHydHigh) {
      patterns.push({
        id: "hydration_manages_side_effects",
        description: "Staying hydrated seems to help keep your side effects more manageable",
        confidence: seDays >= 5 ? "high" : "medium",
        dataPoints: seDays,
        lastSeen: today,
      });
    }
  }

  const last7Completions = completionHistory.slice(-7);
  if (last7Completions.length >= 5) {
    const avgRate = last7Completions.reduce((s, r) => s + r.completionRate, 0) / last7Completions.length;
    if (avgRate >= 70) {
      patterns.push({
        id: "strong_consistency",
        description: "You have been consistently following your plan this week",
        confidence: "high",
        dataPoints: last7Completions.length,
        lastSeen: today,
      });
    }
  }

  if (movement && movement.trend14d === "up" && movement.avg14d >= 2.5) {
    patterns.push({
      id: "activity_improving",
      description: "Your activity levels have been gradually improving over the past two weeks",
      confidence: "medium",
      dataPoints: history.slice(-14).length,
      lastSeen: today,
    });
  }

  return patterns;
}

function generateAdaptiveOverrides(
  patterns: DetectedPattern[],
  rollingAvgs: RollingAverage[],
  postDose: PostDosePattern[],
): AdaptiveOverride[] {
  const overrides: AdaptiveOverride[] = [];

  const appetiteProtein = patterns.find(p => p.id === "appetite_protein_struggle");
  if (appetiteProtein && appetiteProtein.confidence !== "low") {
    overrides.push({
      ruleId: "fuel_low_appetite",
      baseRecommendation: "Small frequent meals",
      adaptedRecommendation: "Protein-first small meals. Start each meal with protein.",
      reason: "Your data shows protein tends to drop when appetite is low",
      confidence: appetiteProtein.confidence,
    });
  }

  const restHelps = patterns.find(p => p.id === "rest_helps_recovery");
  if (restHelps && restHelps.confidence !== "low") {
    overrides.push({
      ruleId: "move_low_energy",
      baseRecommendation: "Light walk",
      adaptedRecommendation: "Rest day or very gentle stretching",
      reason: "You tend to recover better with rest on low energy days",
      confidence: restHelps.confidence,
    });
  }

  const movementHelps = patterns.find(p => p.id === "light_movement_helps");
  if (movementHelps && movementHelps.confidence !== "low") {
    overrides.push({
      ruleId: "move_low_energy",
      baseRecommendation: "Rest",
      adaptedRecommendation: "Short gentle walk",
      reason: "Light movement on tired days tends to help you feel better afterward",
      confidence: movementHelps.confidence,
    });
  }

  const hydrationSE = patterns.find(p => p.id === "hydration_manages_side_effects");
  if (hydrationSE && hydrationSE.confidence !== "low") {
    overrides.push({
      ruleId: "hydrate_side_effects",
      baseRecommendation: "6-8 cups water",
      adaptedRecommendation: "8+ cups with electrolytes",
      reason: "Hydration has helped keep your side effects more manageable",
      confidence: hydrationSE.confidence,
    });
  }

  const hydrationEnergy = patterns.find(p => p.id === "hydration_energy_link");
  if (hydrationEnergy && hydrationEnergy.confidence !== "low") {
    overrides.push({
      ruleId: "hydrate_energy",
      baseRecommendation: "6-8 cups water",
      adaptedRecommendation: "8+ cups. Hydration is closely tied to your energy levels.",
      reason: "Your energy tends to track with your hydration",
      confidence: hydrationEnergy.confidence,
    });
  }

  return overrides;
}

function determineOverallConfidence(
  history: GLP1DailyInputs[],
  patterns: DetectedPattern[],
): PatternConfidence {
  const dataPoints = history.length;
  const highConfPatterns = patterns.filter(p => p.confidence === "high").length;

  if (dataPoints >= 14 && highConfPatterns >= 2) return "high";
  if (dataPoints >= 7 && patterns.length >= 2) return "medium";
  return "low";
}

export function computeUserPatterns(
  history: GLP1DailyInputs[],
  medicationLog: MedicationLogEntry[],
  completionHistory: CompletionRecord[],
): UserPatterns {
  const rollingAverages = computeRollingAverages(history);
  const postDoseEffects = detectPostDoseEffects(history, medicationLog);
  const postDosePatterns = findSignificantPostDoseDrops(postDoseEffects, rollingAverages);
  const behavioralPatterns = detectBehavioralPatterns(history, rollingAverages, completionHistory);
  const allPatterns = [...postDosePatterns, ...behavioralPatterns];
  const adaptiveOverrides = generateAdaptiveOverrides(allPatterns, rollingAverages, postDoseEffects);
  const overallConfidence = determineOverallConfidence(history, allPatterns);

  return {
    rollingAverages,
    postDoseEffects,
    behavioralPatterns: allPatterns,
    adaptiveOverrides,
    overallConfidence,
    dataPointCount: history.length,
    lastComputed: new Date().toISOString(),
  };
}

export function generateAdaptiveInsights(patterns: UserPatterns): AdaptiveInsight[] {
  const insights: AdaptiveInsight[] = [];

  for (const pattern of patterns.behavioralPatterns) {
    if (pattern.confidence === "low") continue;

    let category: InputCategory | "general" = "general";
    let type: AdaptiveInsight["type"] = "pattern";

    if (pattern.id.startsWith("post_dose_") || pattern.id.startsWith("dose_day_")) {
      type = "post_dose";
      const catMatch = pattern.id.replace("post_dose_", "").replace("dose_day_boost_", "").split("_day")[0];
      if (ALL_CATEGORIES.includes(catMatch as InputCategory)) {
        category = catMatch as InputCategory;
      }
    } else if (pattern.id.includes("hydration") || pattern.id.includes("energy")) {
      type = "correlation";
      category = pattern.id.includes("hydration") ? "hydration" : "energy";
    } else if (pattern.id.includes("appetite") || pattern.id.includes("protein")) {
      type = "correlation";
      category = pattern.id.includes("appetite") ? "appetite" : "protein";
    } else if (pattern.id.includes("movement") || pattern.id.includes("activity")) {
      type = "trend";
      category = "movement";
    }

    insights.push({
      id: pattern.id,
      text: pattern.description,
      category,
      confidence: pattern.confidence,
      type,
    });
  }

  for (const rolling of patterns.rollingAverages) {
    if (rolling.avg7d === 0) continue;

    if (rolling.trend7d === "up" && rolling.trend14d === "up" && rolling.avg7d >= 3) {
      const labels: Record<InputCategory, string> = {
        energy: "energy",
        appetite: "appetite",
        hydration: "hydration",
        protein: "protein intake",
        sideEffects: "side effects",
        movement: "activity",
      };
      if (rolling.category === "sideEffects") {
        insights.push({
          id: `trend_improving_${rolling.category}`,
          text: "Side effects have been steadily improving over the past two weeks",
          category: rolling.category,
          confidence: "high",
          type: "trend",
        });
      } else {
        insights.push({
          id: `trend_improving_${rolling.category}`,
          text: `Your ${labels[rolling.category]} has been steadily improving over the past two weeks`,
          category: rolling.category,
          confidence: "high",
          type: "trend",
        });
      }
    }
  }

  for (const override of patterns.adaptiveOverrides) {
    if (override.confidence === "low") continue;
    if (!insights.find(i => i.text === override.reason)) {
      insights.push({
        id: `override_${override.ruleId}`,
        text: override.reason,
        category: "general",
        confidence: override.confidence,
        type: "pattern",
      });
    }
  }

  return insights.slice(0, 5);
}

export function getDaysSinceLastDose(medicationLog: MedicationLogEntry[]): number | null {
  const taken = medicationLog.filter(e => e.status === "taken").sort((a, b) => b.date.localeCompare(a.date));
  if (taken.length === 0) return null;
  const lastDate = new Date(taken[0].date + "T12:00:00");
  const now = new Date();
  return Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function shouldApplyPostDoseAdjustment(
  patterns: UserPatterns,
  medicationLog: MedicationLogEntry[],
  category: InputCategory,
): { shouldAdjust: boolean; severity: "mild" | "moderate" | "significant"; confidence: PatternConfidence } {
  const daysSince = getDaysSinceLastDose(medicationLog);
  if (daysSince === null || daysSince > 3) return { shouldAdjust: false, severity: "mild", confidence: "low" };

  const relevantPostDose = patterns.postDoseEffects.filter(
    p => p.category === category && p.dayOffset === daysSince && p.sampleSize >= 2
  );

  if (relevantPostDose.length === 0) return { shouldAdjust: false, severity: "mild", confidence: "low" };

  const baseline = patterns.rollingAverages.find(r => r.category === category);
  if (!baseline || baseline.avg7d === 0) return { shouldAdjust: false, severity: "mild", confidence: "low" };

  const postDose = relevantPostDose[0];
  const drop = baseline.avg7d - postDose.avgScore;

  if (drop < 0.3) return { shouldAdjust: false, severity: "mild", confidence: "low" };

  const severity = drop >= 1.0 ? "significant" : drop >= 0.5 ? "moderate" : "mild";
  const confidence: PatternConfidence = postDose.sampleSize >= 4 ? "high" : postDose.sampleSize >= 3 ? "medium" : "low";

  return { shouldAdjust: true, severity, confidence };
}
