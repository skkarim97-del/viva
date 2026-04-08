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
      color: "#1A5CFF",
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
        ? `Lower resting heart rate correlates with better recovery. This is a sign your cardiovascular fitness supports your recovery.`
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
    patterns.push(`${lowRecoveryDays} of the last 7 days had recovery below 60%. Consider prioritizing rest and hydration.`);
  }

  const highStepDays = recent.filter(m => m.steps > 10000).length;
  if (highStepDays >= 5) {
    patterns.push(`You hit 10,000+ steps on ${highStepDays} of 7 days. Activity consistency is strong.`);
  }

  return patterns;
}

export default function TrendsScreen() {
  const c = useColors();
  const { trends, insights, metrics } = useApp();

  const correlations = useMemo(() => buildCorrelations(metrics), [metrics]);
  const patterns = useMemo(() => detectPatterns(metrics), [metrics]);

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
          <Text style={[styles.summaryHeader, { color: c.foreground }]}>Your Week</Text>
          {insights.weekSummary.split("\n\n").map((line, i) => (
            <Text key={i} style={[styles.summaryText, { color: c.foreground }, i > 0 && { marginTop: 12 }]}>{line}</Text>
          ))}
        </View>
      )}

      {correlations.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Correlations</Text>
          <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>How your metrics connect to each other</Text>
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
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Patterns Detected</Text>
          {patterns.map((p, i) => (
            <View key={i} style={[styles.patternCard, { backgroundColor: c.card }]}>
              <Feather name="eye" size={14} color={c.primary} />
              <Text style={[styles.patternText, { color: c.foreground }]}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: c.foreground, marginTop: 8 }]}>Metrics</Text>
      {trends.map((trend) => {
        const latest = trend.data[trend.data.length - 1];
        const width = 260;
        const height = 44;
        const values = trend.data.map((d) => d.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const points = values
          .map((v, j) => {
            const x = (j / (values.length - 1)) * width;
            const y = height - ((v - min) / range) * (height - 4) - 2;
            return `${x},${y}`;
          })
          .join(" ");

        return (
          <Pressable
            key={trend.label}
            onPress={() => openDetail(trend.label)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: c.card, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardMeta}>
                <Text style={[styles.label, { color: c.mutedForeground }]}>{trend.label}</Text>
                <View style={styles.valueRow}>
                  <Text style={[styles.value, { color: c.foreground }]}>
                    {trend.unit === "steps"
                      ? latest.value.toLocaleString()
                      : trend.unit === "hrs"
                      ? latest.value.toFixed(1)
                      : latest.value.toString()}
                  </Text>
                  <Text style={[styles.unit, { color: c.mutedForeground }]}>{trend.unit}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={16} color={c.mutedForeground + "50"} />
            </View>
            <Svg width={width} height={height} style={styles.chart}>
              <Polyline points={points} fill="none" stroke={c.primary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={[styles.takeaway, { color: c.mutedForeground }]}>{trend.summary}</Text>
          </Pressable>
        );
      })}

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
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  summaryCard: {
    padding: 20,
    borderRadius: 20,
    gap: 10,
  },
  summaryHeader: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.3,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  sectionWrap: {
    gap: 10,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 2,
    opacity: 0.7,
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
    fontFamily: "Inter_600SemiBold",
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
    fontFamily: "Inter_500Medium",
  },
  corrInsight: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardMeta: {
    gap: 2,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  chart: {
    alignSelf: "center",
  },
  takeaway: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    opacity: 0.7,
  },
});
