import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
} from "react-native";

import Svg, { Polyline } from "react-native-svg";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { computeHabitStats } from "@/data/insights";
import { useColors } from "@/hooks/useColors";
import type { MetricKey, HealthMetrics } from "@/types";

const metricKeyMap: Record<string, MetricKey> = {
  Weight: "weight",
  HRV: "hrv",
  "Resting HR": "restingHR",
  Sleep: "sleep",
  Steps: "steps",
  Recovery: "recovery",
};

interface Correlation {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  strength: "strong" | "moderate" | "weak";
  insight: string;
  direction: "positive" | "negative" | "neutral";
}

function computeCorrelation(a: number[], b: number[]): number {
  if (a.length < 3 || a.length !== b.length) return 0;
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function getCorrelationStrength(r: number): "strong" | "moderate" | "weak" {
  const abs = Math.abs(r);
  if (abs >= 0.6) return "strong";
  if (abs >= 0.3) return "moderate";
  return "weak";
}

function buildCorrelations(metrics: HealthMetrics[]): Correlation[] {
  if (metrics.length < 5) return [];
  const recent = metrics.slice(-14);
  const sleep = recent.map(m => m.sleepDuration);
  const hrv = recent.map(m => m.hrv);
  const recovery = recent.map(m => m.recoveryScore);
  const steps = recent.map(m => m.steps);
  const rhr = recent.map(m => m.restingHeartRate);

  const correlations: Correlation[] = [];

  const sleepHrv = computeCorrelation(sleep, hrv);
  const sleepHrvStrength = getCorrelationStrength(sleepHrv);
  if (sleepHrvStrength !== "weak") {
    const avgSleep = +(sleep.reduce((s, v) => s + v, 0) / sleep.length).toFixed(1);
    const avgHrv = Math.round(hrv.reduce((s, v) => s + v, 0) / hrv.length);
    correlations.push({
      title: "Sleep vs HRV",
      icon: "moon",
      color: "#AF52DE",
      strength: sleepHrvStrength,
      direction: sleepHrv > 0 ? "positive" : "negative",
      insight: sleepHrv > 0
        ? `More sleep is linked to higher HRV in your data. Your average ${avgSleep} hrs of sleep correlates with an HRV of ${avgHrv} ms.`
        : `Your HRV tends to drop when you sleep more, which may indicate restless or low-quality sleep despite longer duration.`,
    });
  }

  const sleepRecovery = computeCorrelation(sleep, recovery);
  const sleepRecStrength = getCorrelationStrength(sleepRecovery);
  if (sleepRecStrength !== "weak") {
    correlations.push({
      title: "Sleep vs Recovery",
      icon: "battery-charging",
      color: "#34C759",
      strength: sleepRecStrength,
      direction: sleepRecovery > 0 ? "positive" : "negative",
      insight: sleepRecovery > 0
        ? `Better sleep consistently drives higher recovery scores. This is one of your strongest levers for feeling good the next day.`
        : `Recovery scores drop when you sleep longer, possibly due to oversleeping on lower-quality nights.`,
    });
  }

  const stepsRecovery = computeCorrelation(steps, recovery);
  const stepsRecStrength = getCorrelationStrength(stepsRecovery);
  if (stepsRecStrength !== "weak") {
    const avgSteps = Math.round(steps.reduce((s, v) => s + v, 0) / steps.length);
    correlations.push({
      title: "Activity vs Recovery",
      icon: "activity",
      color: "#142240",
      strength: stepsRecStrength,
      direction: stepsRecovery > 0 ? "positive" : "negative",
      insight: stepsRecovery > 0
        ? `Higher activity days lead to better recovery the next day. Your average ${avgSteps.toLocaleString()} steps supports this pattern.`
        : `High-activity days (${avgSteps.toLocaleString()}+ steps) are followed by lower recovery. Consider spacing intense days with rest.`,
    });
  }

  const rhrRecovery = computeCorrelation(rhr, recovery);
  const rhrRecStrength = getCorrelationStrength(rhrRecovery);
  if (rhrRecStrength !== "weak") {
    correlations.push({
      title: "Resting HR vs Recovery",
      icon: "heart",
      color: "#FF6B6B",
      strength: rhrRecStrength,
      direction: rhrRecovery > 0 ? "positive" : "negative",
      insight: rhrRecovery < 0
        ? `Lower resting heart rate correlates with better recovery. This is a sign your body is adapting well to treatment.`
        : `Your resting heart rate rises with recovery, which may reflect your body working harder to bounce back on certain days.`,
    });
  }

  if (correlations.length === 0) {
    correlations.push({
      title: "Sleep vs Recovery",
      icon: "battery-charging",
      color: "#34C759",
      strength: "moderate",
      direction: "positive",
      insight: "More data is needed to detect strong patterns. Keep logging for clearer insights.",
    });
  }

  return correlations;
}

function detectPatterns(metrics: HealthMetrics[]): string[] {
  if (metrics.length < 7) return [];
  const recent = metrics.slice(-7);
  const patterns: string[] = [];

  const avgSleep = recent.reduce((s, m) => s + m.sleepDuration, 0) / recent.length;
  const sleepTrend = recent[recent.length - 1].sleepDuration - recent[0].sleepDuration;
  if (Math.abs(sleepTrend) > 0.5) {
    patterns.push(
      sleepTrend > 0
        ? `Sleep is trending up this week. You averaged ${avgSleep.toFixed(1)} hrs, up from ${recent[0].sleepDuration.toFixed(1)} hrs.`
        : `Sleep has been declining this week. You dropped from ${recent[0].sleepDuration.toFixed(1)} hrs to ${recent[recent.length - 1].sleepDuration.toFixed(1)} hrs.`
    );
  }

  const avgHrv = recent.reduce((s, m) => s + m.hrv, 0) / recent.length;
  const hrvStdDev = Math.sqrt(recent.reduce((s, m) => s + Math.pow(m.hrv - avgHrv, 2), 0) / recent.length);
  if (hrvStdDev > 12) {
    patterns.push(`HRV is highly variable (std dev ${hrvStdDev.toFixed(0)} ms). Inconsistent sleep or stress may be driving this.`);
  } else if (hrvStdDev < 5) {
    patterns.push(`HRV is remarkably stable at ${Math.round(avgHrv)} ms. Your recovery rhythm looks consistent.`);
  }

  const lowRecoveryDays = recent.filter(m => m.recoveryScore < 60).length;
  if (lowRecoveryDays >= 3) {
    patterns.push(`${lowRecoveryDays} of the last 7 days had recovery below 60%. Rest and hydration are extra important on treatment.`);
  }

  const highStepDays = recent.filter(m => m.steps > 10000).length;
  if (highStepDays >= 5) {
    patterns.push(`You hit 10,000+ steps on ${highStepDays} of 7 days. Great for preserving muscle during treatment.`);
  }

  return patterns;
}

function buildKeyInsights(metrics: HealthMetrics[], habitStats: { weeklyPercent: number; streakDays: number; todayCompleted: number; todayTotal: number; topHabit: string | null; topHabitPercent: number }): string[] {
  const insights: string[] = [];
  if (metrics.length < 3) return insights;
  const recent = metrics.slice(-7);

  const avgSleep = recent.reduce((s, m) => s + m.sleepDuration, 0) / recent.length;
  const avgRecovery = Math.round(recent.reduce((s, m) => s + m.recoveryScore, 0) / recent.length);
  const avgSteps = Math.round(recent.reduce((s, m) => s + m.steps, 0) / recent.length);

  if (habitStats.todayCompleted > 0) {
    insights.push(`You completed ${habitStats.todayCompleted} of ${habitStats.todayTotal} actions today.`);
  }

  if (habitStats.weeklyPercent > 0 && habitStats.weeklyPercent < 50) {
    insights.push(`Consistency is at ${habitStats.weeklyPercent}% this week. Every small step matters on treatment.`);
  } else if (habitStats.weeklyPercent >= 80) {
    insights.push(`Consistency is excellent at ${habitStats.weeklyPercent}% this week. This supports your treatment.`);
  }

  if (habitStats.streakDays >= 3) {
    insights.push(`You are on a ${habitStats.streakDays}-day streak. Consistency is key during treatment.`);
  } else if (habitStats.streakDays === 0 && habitStats.weeklyPercent > 0) {
    insights.push(`Your streak was broken. Today is a fresh start.`);
  }

  if (avgSleep < 6.5) {
    insights.push(`Sleep averaged ${avgSleep.toFixed(1)} hrs this week. Better sleep helps manage side effects.`);
  } else if (avgSleep >= 7.5) {
    insights.push(`Sleep averaged ${avgSleep.toFixed(1)} hrs. Strong foundation for recovery on treatment.`);
  }

  if (avgRecovery < 55) {
    insights.push(`Recovery has been low at ${avgRecovery}%. Prioritize rest and hydration.`);
  } else if (avgRecovery >= 75) {
    insights.push(`Recovery is solid at ${avgRecovery}%. Your body is handling treatment well.`);
  }

  if (avgSteps >= 10000) {
    insights.push(`Averaging ${avgSteps.toLocaleString()} steps. Great for muscle preservation.`);
  } else if (avgSteps < 5000) {
    insights.push(`Steps averaged ${avgSteps.toLocaleString()} this week. Gentle walks after meals can help.`);
  }

  return insights.slice(0, 5);
}

interface SparkMetric {
  label: string;
  value: string;
  unit: string;
  data: number[];
  color: string;
  detailKey?: string;
}

function weeklyAverages(daily: number[], weeks: number = 4): number[] {
  const result: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = daily.length - (weeks - w) * 7;
    const end = start + 7;
    const slice = daily.slice(Math.max(0, start), Math.max(0, end));
    if (slice.length > 0) {
      result.push(slice.reduce((s, v) => s + v, 0) / slice.length);
    }
  }
  return result.length > 0 ? result : [0];
}

function buildSparkPoints(data: number[], width: number, height: number): string {
  if (data.length < 2) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function computeHabitWeeklyRates(history: { date: string; completionRate: number }[]): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rateMap = new Map<string, number>();
  for (const r of history) {
    rateMap.set(r.date.slice(0, 10), r.completionRate);
  }
  const result: number[] = [];
  for (let w = 0; w < 4; w++) {
    let sum = 0;
    let count = 0;
    for (let d = 0; d < 7; d++) {
      const dayOffset = (3 - w) * 7 + (6 - d);
      const dt = new Date(today);
      dt.setDate(dt.getDate() - dayOffset);
      const key = dt.toISOString().slice(0, 10);
      const rate = rateMap.get(key);
      if (rate !== undefined) {
        sum += rate;
        count++;
      }
    }
    result.push(count > 0 ? Math.round(sum / count) : 0);
  }
  return result;
}

export default function TrendsScreen() {
  const c = useColors();
  const { insights, metrics, completionHistory, weeklyConsistency, streakDays, todayCompletionRate, dailyPlan } = useApp();

  const correlations = useMemo(() => buildCorrelations(metrics), [metrics]);
  const patterns = useMemo(() => detectPatterns(metrics), [metrics]);
  const habitStats = useMemo(() => computeHabitStats(completionHistory), [completionHistory]);
  const keyInsights = useMemo(() => buildKeyInsights(metrics, habitStats), [metrics, habitStats]);

  const openDetail = (label: string) => {
    const key = metricKeyMap[label];
    if (!key) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({ pathname: "/metric-detail", params: { key } });
  };

  const strengthLabel = (s: Correlation["strength"]) => {
    if (s === "strong") return "Strong link";
    if (s === "moderate") return "Moderate link";
    return "Weak link";
  };

  const last28 = metrics.slice(-28);
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  const avgSleep = +(avg(last28.map(m => m.sleepDuration))).toFixed(1);
  const avgHrv = Math.round(avg(last28.map(m => m.hrv)));
  const avgRHR = Math.round(avg(last28.map(m => m.restingHeartRate)));
  const avgSteps = Math.round(avg(last28.map(m => m.steps)));
  const avgActiveCalories = Math.round(avg(last28.map(m => m.activeCalories || 0)));
  const activeDays = last28.filter(m => (m.activeCalories || 0) > 200 || m.steps > 8000).length;
  const activeDaysPerWeek = last28.length > 0 ? +((activeDays / last28.length) * 7).toFixed(1) : 0;

  const sleepData = weeklyAverages(last28.map(m => m.sleepDuration));
  const hrvData = weeklyAverages(last28.map(m => m.hrv));
  const rhrData = weeklyAverages(last28.map(m => m.restingHeartRate));
  const stepsData = weeklyAverages(last28.map(m => m.steps));
  const activityData = weeklyAverages(last28.map(m => ((m.activeCalories || 0) > 200 || m.steps > 8000) ? 1 : 0));
  const activeCalData = weeklyAverages(last28.map(m => m.activeCalories || 0));
  const habitRateData = computeHabitWeeklyRates(completionHistory);

  const completedCount = dailyPlan ? dailyPlan.actions.filter(a => a.completed).length : 0;
  const totalActions = dailyPlan ? dailyPlan.actions.length : 5;

  const recoveryMetrics: SparkMetric[] = [
    { label: "Sleep", value: `${avgSleep}`, unit: "hrs", data: sleepData, color: "#AF52DE", detailKey: "Sleep" },
    { label: "HRV", value: `${avgHrv}`, unit: "ms", data: hrvData, color: "#5AC8FA", detailKey: "HRV" },
    { label: "Resting HR", value: `${avgRHR}`, unit: "bpm", data: rhrData, color: "#FF6B6B", detailKey: "Resting HR" },
  ];

  const activityMetrics: SparkMetric[] = [
    { label: "Steps", value: avgSteps >= 1000 ? `${(avgSteps / 1000).toFixed(1)}k` : `${avgSteps}`, unit: "avg", data: stepsData, color: "#34C759", detailKey: "Steps" },
    { label: "Active Days", value: `${activeDaysPerWeek}`, unit: "/week", data: activityData.map(v => v * 7), color: "#142240" },
    { label: "Active Cal", value: `${avgActiveCalories}`, unit: "avg", data: activeCalData, color: "#FF9500" },
  ];

  const habitsMetrics: SparkMetric[] = [
    { label: "Weekly", value: `${weeklyConsistency >= 0 ? weeklyConsistency : 0}%`, unit: "completion", data: habitRateData, color: "#142240" },
    { label: "Streak", value: `${streakDays}`, unit: "days", data: [streakDays], color: "#FF9500" },
    { label: "Today", value: `${completedCount}/${totalActions}`, unit: "done", data: [completedCount], color: "#34C759" },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: 0 }]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader />
      <Text style={[styles.title, { color: c.foreground }]}>Trends</Text>

      {insights && (
        <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
          <Text style={[styles.summaryHeader, { color: c.foreground }]}>How You're Doing</Text>
          {insights.weekSummary.split("\n\n").map((line, i) => (
            <Text key={i} style={[styles.summaryText, { color: c.foreground }]}>{line}</Text>
          ))}
        </View>
      )}

      {keyInsights.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>What We're Noticing</Text>
          {keyInsights.map((insight, i) => (
            <View key={i} style={[styles.insightCard, { backgroundColor: c.card }]}>
              <Feather name="zap" size={13} color={c.accent} />
              <Text style={[styles.insightText, { color: c.foreground }]}>{insight}</Text>
            </View>
          ))}
        </View>
      )}

      {correlations.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Correlations</Text>
          <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>How your body signals connect</Text>
          {correlations.map((corr, i) => (
            <View key={i} style={[styles.corrCard, { backgroundColor: c.card }]}>
              <View style={styles.corrHeader}>
                <View style={[styles.corrIconWrap, { backgroundColor: corr.color + "14" }]}>
                  <Feather name={corr.icon} size={16} color={corr.color} />
                </View>
                <View style={styles.corrMeta}>
                  <Text style={[styles.corrTitle, { color: c.foreground }]}>{corr.title}</Text>
                  <View style={styles.corrBadgeRow}>
                    <View style={[styles.corrBadge, { backgroundColor: corr.strength === "strong" ? c.success + "18" : corr.strength === "moderate" ? c.warning + "18" : c.muted }]}>
                      <Text style={[styles.corrBadgeText, { color: corr.strength === "strong" ? c.success : corr.strength === "moderate" ? c.warning : c.mutedForeground }]}>
                        {strengthLabel(corr.strength)}
                      </Text>
                    </View>
                    <View style={[styles.corrBadge, { backgroundColor: corr.direction === "positive" ? c.success + "18" : corr.direction === "negative" ? "#FF6B6B18" : c.muted }]}>
                      <Feather
                        name={corr.direction === "positive" ? "trending-up" : corr.direction === "negative" ? "trending-down" : "minus"}
                        size={10}
                        color={corr.direction === "positive" ? c.success : corr.direction === "negative" ? "#FF6B6B" : c.mutedForeground}
                      />
                    </View>
                  </View>
                </View>
              </View>
              <Text style={[styles.corrInsight, { color: c.mutedForeground }]}>{corr.insight}</Text>
            </View>
          ))}
        </View>
      )}

      {patterns.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Patterns During Treatment</Text>
          {patterns.map((p, i) => (
            <View key={i} style={[styles.patternCard, { backgroundColor: c.card }]}>
              <Feather name="eye" size={14} color={c.accent} />
              <Text style={[styles.patternText, { color: c.foreground }]}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.sectionWrap}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Key Metrics</Text>
        <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>4-week averages</Text>

        <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>Recovery / Body</Text>
        <View style={styles.metricsRow}>
          {recoveryMetrics.map((m) => (
            <Pressable
              key={m.label}
              onPress={() => m.detailKey && openDetail(m.detailKey)}
              style={({ pressed }) => [styles.metricTile, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{m.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{m.value}</Text>
                <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{m.unit}</Text>
              </View>
              {m.data.length >= 2 && (
                <Svg width={60} height={20} style={styles.spark}>
                  <Polyline
                    points={buildSparkPoints(m.data, 60, 20)}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </Pressable>
          ))}
        </View>

        <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>Movement</Text>
        <View style={styles.metricsRow}>
          {activityMetrics.map((m) => (
            <Pressable
              key={m.label}
              onPress={() => m.detailKey && openDetail(m.detailKey)}
              style={({ pressed }) => [styles.metricTile, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{m.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{m.value}</Text>
                <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{m.unit}</Text>
              </View>
              {m.data.length >= 2 && (
                <Svg width={60} height={20} style={styles.spark}>
                  <Polyline
                    points={buildSparkPoints(m.data, 60, 20)}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </Pressable>
          ))}
        </View>

        <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>Consistency</Text>
        <View style={styles.metricsRow}>
          {habitsMetrics.map((m) => (
            <View key={m.label} style={[styles.metricTile, { backgroundColor: c.card }]}>
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{m.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{m.value}</Text>
                <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{m.unit}</Text>
              </View>
              {m.data.length >= 2 && (
                <Svg width={60} height={20} style={styles.spark}>
                  <Polyline
                    points={buildSparkPoints(m.data, 60, 20)}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={{ height: 110 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  summaryCard: {
    padding: 20,
    borderRadius: 20,
    gap: 12,
  },
  summaryHeader: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
  },
  sectionWrap: {
    gap: 10,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    marginBottom: 2,
    opacity: 0.7,
  },
  insightCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 16,
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 21,
  },
  corrCard: {
    padding: 16,
    borderRadius: 18,
    gap: 10,
  },
  corrHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  corrIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  corrMeta: {
    flex: 1,
    gap: 4,
  },
  corrTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.2,
  },
  corrBadgeRow: {
    flexDirection: "row",
    gap: 6,
  },
  corrBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  corrBadgeText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
  },
  corrInsight: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
    opacity: 0.8,
  },
  patternCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 16,
  },
  patternText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
  },
  categoryLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: -2,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricTile: {
    flex: 1,
    padding: 14,
    borderRadius: 20,
    alignItems: "center",
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: 0.1,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
  },
  metricValue: {
    fontSize: 20,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.3,
  },
  metricUnit: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
  },
  spark: {
    marginTop: 2,
  },
});
