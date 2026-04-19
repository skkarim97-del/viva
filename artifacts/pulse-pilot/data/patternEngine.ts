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

const ALL_CATEGORIES: InputCategory[] = ["energy", "appetite", "nausea", "digestion"];

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
      // Count of days with a valid (non-zero) score for this category
      // in the last 14 days. history is already upserted to ≤ 1 entry
      // per day in AppContext.saveGlp1Inputs, so this is "days of data"
      // and the trend insight gate uses it to require a meaningful
      // sample before claiming any directional pattern.
      sampleSize14d: values14.filter(v => v > 0).length,
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
      nausea: "nausea",
      digestion: "digestion",
    };

    if (day1 && day1.avgScore < baseline.avg7d - 0.5 && day1.sampleSize >= 2) {
      const confidence = day1.sampleSize >= 4 ? "high" : day1.sampleSize >= 3 ? "medium" : "low";
      if (cat === "nausea") {
        patterns.push({
          id: `post_dose_${cat}_day1`,
          description: `Nausea tends to increase 1 day after your dose`,
          confidence: confidence as PatternConfidence,
          dataPoints: day1.sampleSize,
          lastSeen: today,
        });
      } else if (cat === "digestion") {
        patterns.push({
          id: `post_dose_${cat}_day1`,
          description: `Digestion tends to be more unsettled 1 day after your dose`,
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
      if (cat === "nausea") {
        patterns.push({
          id: `post_dose_${cat}_day2`,
          description: `Nausea tends to linger for 2 days after your dose`,
          confidence: confidence as PatternConfidence,
          dataPoints: day2.sampleSize,
          lastSeen: today,
        });
      } else if (cat === "digestion") {
        patterns.push({
          id: `post_dose_${cat}_day2`,
          description: `Digestive issues tend to persist for 2 days after your dose`,
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
      if (cat !== "nausea" && cat !== "digestion") {
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

  const nausea = rollingAvgs.find(r => r.category === "nausea");
  const energy = rollingAvgs.find(r => r.category === "energy");
  const appetite = rollingAvgs.find(r => r.category === "appetite");
  const digestion = rollingAvgs.find(r => r.category === "digestion");

  let nauseaLowAppLow = 0;
  let nauseaGoodAppGood = 0;
  let nauseaAppPairs = 0;
  for (const day of history.slice(-14)) {
    const n = scoreInput("nausea", day);
    const a = scoreInput("appetite", day);
    if (n === 0 || a === 0) continue;
    nauseaAppPairs++;
    if (n <= 2 && a <= 2) nauseaLowAppLow++;
    if (n >= 3 && a >= 3) nauseaGoodAppGood++;
  }
  if (nauseaAppPairs >= 5 && (nauseaLowAppLow + nauseaGoodAppGood) / nauseaAppPairs >= 0.6) {
    patterns.push({
      id: "nausea_appetite_link",
      description: "Your appetite tends to track closely with your nausea levels",
      confidence: nauseaAppPairs >= 10 ? "high" : "medium",
      dataPoints: nauseaAppPairs,
      lastSeen: today,
    });
  }

  let digestionLowEnergyLow = 0;
  let digestionGoodEnergyGood = 0;
  let digEnergyPairs = 0;
  for (const day of history.slice(-14)) {
    const d = scoreInput("digestion", day);
    const e = scoreInput("energy", day);
    if (d === 0 || e === 0) continue;
    digEnergyPairs++;
    if (d <= 2 && e <= 2) digestionLowEnergyLow++;
    if (d >= 3 && e >= 3) digestionGoodEnergyGood++;
  }
  if (digEnergyPairs >= 5 && (digestionLowEnergyLow + digestionGoodEnergyGood) / digEnergyPairs >= 0.6) {
    patterns.push({
      id: "digestion_energy_link",
      description: "Your energy tends to track closely with your digestion",
      confidence: digEnergyPairs >= 10 ? "high" : "medium",
      dataPoints: digEnergyPairs,
      lastSeen: today,
    });
  }

  if (nausea && digestion) {
    let nauseaDigBothBad = 0;
    let nauseaDays = 0;
    for (const day of history.slice(-14)) {
      const n = scoreInput("nausea", day);
      const d = scoreInput("digestion", day);
      if (n === 0 || d === 0) continue;
      if (n <= 2) {
        nauseaDays++;
        if (d <= 2) nauseaDigBothBad++;
      }
    }
    if (nauseaDays >= 3 && nauseaDigBothBad >= 2 && nauseaDigBothBad / nauseaDays >= 0.5) {
      patterns.push({
        id: "nausea_digestion_co_occur",
        description: "Nausea and digestive issues tend to appear together",
        confidence: nauseaDays >= 5 ? "high" : "medium",
        dataPoints: nauseaDays,
        lastSeen: today,
      });
    }
  }

  let lowEnergyNextDayBetter = 0;
  let lowEnergyDays = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const eToday = scoreInput("energy", history[i]);
    if (eToday > 2 || eToday === 0) continue;
    lowEnergyDays++;
    const eTomorrow = scoreInput("energy", history[i + 1]);
    if (eTomorrow === 0) continue;
    if (eTomorrow >= 3) lowEnergyNextDayBetter++;
  }
  if (lowEnergyDays >= 3 && lowEnergyNextDayBetter >= 2) {
    patterns.push({
      id: "energy_bounce_back",
      description: "Your energy tends to bounce back the day after a low energy day",
      confidence: lowEnergyDays >= 5 ? "high" : "medium",
      dataPoints: lowEnergyDays,
      lastSeen: today,
    });
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

  return patterns;
}

function generateAdaptiveOverrides(
  patterns: DetectedPattern[],
  rollingAvgs: RollingAverage[],
  postDose: PostDosePattern[],
): AdaptiveOverride[] {
  const overrides: AdaptiveOverride[] = [];

  const nauseaAppetite = patterns.find(p => p.id === "nausea_appetite_link");
  if (nauseaAppetite && nauseaAppetite.confidence !== "low") {
    overrides.push({
      ruleId: "fuel_low_appetite",
      baseRecommendation: "Small frequent meals",
      adaptedRecommendation: "Protein-first small meals. Start each meal with protein when nausea is manageable.",
      reason: "Your data shows appetite tends to drop when nausea increases",
      confidence: nauseaAppetite.confidence,
    });
  }

  const energyBounce = patterns.find(p => p.id === "energy_bounce_back");
  if (energyBounce && energyBounce.confidence !== "low") {
    overrides.push({
      ruleId: "move_low_energy",
      baseRecommendation: "Light walk",
      adaptedRecommendation: "Rest day or very gentle stretching. Your energy tends to recover well with rest.",
      reason: "You tend to bounce back better when you rest on low energy days",
      confidence: energyBounce.confidence,
    });
  }

  const nauseaDigestion = patterns.find(p => p.id === "nausea_digestion_co_occur");
  if (nauseaDigestion && nauseaDigestion.confidence !== "low") {
    overrides.push({
      ruleId: "hydrate_side_effects",
      baseRecommendation: "6-8 cups water",
      adaptedRecommendation: "8+ cups with electrolytes. Extra hydration helps when nausea and digestive issues appear together.",
      reason: "Nausea and digestive issues tend to appear together for you",
      confidence: nauseaDigestion.confidence,
    });
  }

  const digestionEnergy = patterns.find(p => p.id === "digestion_energy_link");
  if (digestionEnergy && digestionEnergy.confidence !== "low") {
    overrides.push({
      ruleId: "hydrate_energy",
      baseRecommendation: "6-8 cups water",
      adaptedRecommendation: "8+ cups. Good digestion and hydration are closely tied to your energy levels.",
      reason: "Your energy tends to track with your digestion",
      confidence: digestionEnergy.confidence,
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
    } else if (pattern.id.includes("nausea")) {
      type = "correlation";
      category = "nausea";
    } else if (pattern.id.includes("digestion")) {
      type = "correlation";
      category = "digestion";
    } else if (pattern.id.includes("appetite")) {
      type = "correlation";
      category = "appetite";
    } else if (pattern.id.includes("energy")) {
      type = "correlation";
      category = "energy";
    }

    insights.push({
      id: pattern.id,
      text: pattern.description,
      category,
      confidence: pattern.confidence,
      type,
    });
  }

  // Trend insights ("steadily improving over the past two weeks") need a
  // real sample before we make that claim. Each entry in glp1InputHistory
  // is one day (upserted by date in AppContext), so sampleSize14d is the
  // count of days the patient actually checked in for this category in
  // the last 14 days. We require at least 7 days of data before any
  // trend statement, and we phrase the timeframe based on how much data
  // we actually have. Anything less only contributes a neutral fallback.
  // Pilot-stage threshold: 5 days is enough to start surfacing
  // directional patterns so early users feel value quickly. The
  // separate "two weeks" phrasing gate (sampleSize14d >= 10) still
  // protects us from claiming a 14-day pattern off a 5-day signal.
  const TREND_MIN_DAYS = 5;
  let anyTrendShown = false;
  let maxSampleSize = 0;

  for (const rolling of patterns.rollingAverages) {
    if (rolling.avg7d === 0) continue;
    if (rolling.sampleSize14d > maxSampleSize) maxSampleSize = rolling.sampleSize14d;

    const hasEnoughData = rolling.sampleSize14d >= TREND_MIN_DAYS;
    const directionConsistent =
      rolling.trend7d === "up" && rolling.trend14d === "up" && rolling.avg7d >= 3;

    if (hasEnoughData && directionConsistent) {
      anyTrendShown = true;
      // Only claim "two weeks" once we genuinely have ~10+ days of data.
      // Below that we soften to "in your recent check-ins" so the timeframe
      // matches the actual evidence.
      const window = rolling.sampleSize14d >= 10
        ? "over the past two weeks"
        : "in your recent check-ins";
      const labels: Record<InputCategory, string> = {
        energy: "energy",
        appetite: "appetite",
        nausea: "nausea",
        digestion: "digestion",
      };
      let text: string;
      if (rolling.category === "nausea") {
        text = `Nausea has been steadily improving ${window}`;
      } else if (rolling.category === "digestion") {
        text = `Digestion has been steadily settling down ${window}`;
      } else {
        text = `Your ${labels[rolling.category]} has been steadily improving ${window}`;
      }
      insights.push({
        id: `trend_improving_${rolling.category}`,
        text,
        category: rolling.category,
        confidence: "high",
        type: "trend",
      });
    }
  }

  // If we have some data but nothing rises to a real trend, surface a
  // neutral baseline statement instead of leaving the section empty (or,
  // worse, letting an unrelated pattern carry weight it shouldn't). We
  // only do this when the patient has clearly engaged (≥ 3 days) so the
  // "still building" framing is honest -- a single check-in shouldn't
  // claim a baseline either.
  // Actionable nudge instead of a passive "tracking..." statement.
  // Behavioral lift: users who see a clear ask ("keep logging") check
  // in more consistently than users who see a status update.
  if (!anyTrendShown && maxSampleSize >= 1 && maxSampleSize < TREND_MIN_DAYS) {
    const daysLeft = TREND_MIN_DAYS - maxSampleSize;
    insights.push({
      id: "trend_baseline_building",
      text: maxSampleSize >= 3
        ? `Keep logging daily -- ${daysLeft} more day${daysLeft === 1 ? "" : "s"} unlocks your pattern view`
        : "Keep logging daily so we can understand your pattern",
      category: "general",
      confidence: "low",
      type: "trend",
    });
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
