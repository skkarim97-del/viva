import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";

import { useApp } from "@/context/AppContext";
import type { AvailableMetricType } from "@/data/healthProviders";
import { getMetricDetail } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import type { MetricKey } from "@/types";

const METRIC_KEY_TO_TYPE: Record<string, AvailableMetricType> = {
  sleep: "sleep",
  hrv: "hrv",
  steps: "steps",
  restingHR: "heartRate",
};

export default function MetricDetailScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { key, source } = useLocalSearchParams<{ key: MetricKey; source?: string }>();
  const todayFirst = source === "today";
  const { todayMetrics, metrics, insights, hasHealthData, availableMetricTypes } = useApp();
  const topPad = Platform.OS === "web" ? 60 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!key || !todayMetrics || metrics.length === 0) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground }}>Loading...</Text>
      </View>
    );
  }

  const requiredType = METRIC_KEY_TO_TYPE[key as string];
  const metricUnavailable = requiredType && (!hasHealthData || !availableMetricTypes.includes(requiredType));

  if (metricUnavailable) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12 }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Feather name="chevron-left" size={24} color={c.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>
            {key === "sleep" ? "Sleep" : key === "hrv" ? "HRV" : key === "steps" ? "Steps" : key === "restingHR" ? "Heart Rate" : "Metric"}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.unavailableWrap}>
          <View style={[styles.unavailableIcon, { backgroundColor: c.muted }]}>
            <Feather name="activity" size={28} color={c.mutedForeground} />
          </View>
          <Text style={[styles.unavailableTitle, { color: c.foreground }]}>Not available yet</Text>
          <Text style={[styles.unavailableBody, { color: c.mutedForeground }]}>
            Connect Apple Health in Settings to see this metric. Once synced, your data will appear here automatically.
          </Text>
          <Pressable onPress={() => router.back()} style={[styles.unavailableBtn, { backgroundColor: c.primary }]}>
            <Text style={[styles.unavailableBtnText, { color: "#FFFFFF" }]}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const detail = getMetricDetail(key as MetricKey, todayMetrics, metrics);
  const chartWidth = 300;
  const chartHeight = 90;

  const values = detail.trend.data.map((d) => d.value);

  // Build a clean, row-based benchmark stack. Each benchmark gets its own
  // labeled row so the hierarchy reads top-to-bottom instead of packing
  // multiple stats onto one dense line. We compute the 7-day average here
  // because getMetricDetail folds it into a prose sentence but doesn't
  // expose it as a discrete field.
  const todayValue = (() => {
    switch (key) {
      case "sleep": return todayMetrics.sleepDuration;
      case "hrv": return todayMetrics.hrv ?? null;
      case "steps": return todayMetrics.steps;
      case "restingHR": return todayMetrics.restingHeartRate;
      case "weight": return todayMetrics.weight;
      case "activeCalories": return todayMetrics.activeCalories ?? null;
      default: return null;
    }
  })();
  const last7 = values.slice(-7);
  const avg7 = last7.length > 0 ? last7.reduce((s, v) => s + v, 0) / last7.length : null;
  const formatForKey = (n: number | null | undefined): string => {
    if (n === null || n === undefined) return "—";
    switch (key) {
      case "sleep": return n.toFixed(1);
      case "hrv":
      case "restingHR":
      case "steps":
      case "activeCalories":
        return Math.round(n).toLocaleString();
      case "weight": return n.toFixed(1);
      default: return String(n);
    }
  };
  const latestLabel = key === "sleep" ? "Last night" : "Today";
  const latestFormatted = formatForKey(todayValue);
  const avg7Formatted = formatForKey(avg7);
  const avg28Formatted = detail.currentValue;

  type BenchmarkRow = { label: string; value: string; emphasis: boolean };
  const primary: BenchmarkRow = todayFirst
    ? { label: latestLabel, value: latestFormatted, emphasis: true }
    : { label: "4-week average", value: avg28Formatted, emphasis: true };
  const benchmarks: BenchmarkRow[] = todayFirst
    ? [
        { label: "7-day average", value: avg7Formatted, emphasis: false },
        { label: "4-week average", value: avg28Formatted, emphasis: false },
      ]
    : [
        { label: latestLabel, value: latestFormatted, emphasis: false },
        { label: "7-day average", value: avg7Formatted, emphasis: false },
      ];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * chartWidth;
      const y = chartHeight - ((v - min) / range) * (chartHeight - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  const trendArrow = detail.trend.trend === "up" ? "\u2191" : detail.trend.trend === "down" ? "\u2193" : "\u2192";
  const isPositive =
    (key === "weight" || key === "restingHR")
      ? detail.trend.trend === "down"
      : detail.trend.trend === "up";
  const trendColor = isPositive ? c.success : detail.trend.trend === "stable" ? c.mutedForeground : c.destructive;

  const insightDetail = getInsightForMetric(key as MetricKey, insights);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <Feather name="chevron-left" size={24} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>{detail.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Primary stat — large, dominant, clearly labeled. Row-based
            benchmark stack below it so 7-day, 4-week, and latest each
            read on their own line instead of being packed together. */}
        <View style={styles.heroSection}>
          <Text style={[styles.heroLabel, { color: c.mutedForeground }]}>{primary.label}</Text>
          <View style={styles.heroValueRow}>
            <Text style={[styles.heroValue, { color: c.foreground }]}>{primary.value}</Text>
            {detail.unit ? (
              <Text style={[styles.heroUnit, { color: c.mutedForeground }]}>{detail.unit}</Text>
            ) : null}
            <Text style={[styles.heroTrend, { color: trendColor }]}>{trendArrow}</Text>
          </View>
          <Text style={[styles.heroHeadline, { color: c.foreground }]}>{detail.headline}</Text>
        </View>

        <View style={[styles.benchmarkCard, { backgroundColor: c.card }]}>
          {benchmarks.map((row, idx) => (
            <View
              key={row.label}
              style={[
                styles.benchmarkRow,
                idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Text style={[styles.benchmarkLabel, { color: c.mutedForeground }]}>{row.label}</Text>
              <Text style={[styles.benchmarkValue, { color: c.foreground }]}>
                {row.value}
                {detail.unit ? <Text style={[styles.benchmarkUnit, { color: c.mutedForeground }]}>{` ${detail.unit}`}</Text> : null}
              </Text>
            </View>
          ))}
        </View>

        {/* The benchmark card above already enumerates last night /
            7-day / 4-week, so an inline explanation card that repeats
            the same numbers ("4-week average: X. Last 7 days: Y...")
            is dropped. The "What this means" section below carries the
            interpretive copy on its own. */}

        <View style={[styles.section, { backgroundColor: c.card }]}>
          <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>30-day trend</Text>
          <Svg width={chartWidth} height={chartHeight} style={styles.chart}>
            <Polyline points={points} fill="none" stroke={c.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <View style={styles.chartLabels}>
            <Text style={[styles.chartLabel, { color: c.mutedForeground }]}>30d ago</Text>
            <Text style={[styles.chartLabel, { color: c.mutedForeground }]}>Today</Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: c.card }]}>
          <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>What this means</Text>
          <Text style={[styles.sectionBody, { color: c.foreground }]}>{detail.whatItMeans}</Text>
        </View>

        {insightDetail && (
          <View style={[styles.section, { backgroundColor: c.card }]}>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Deep analysis</Text>
            <Text style={[styles.sectionBody, { color: c.foreground }]}>{insightDetail}</Text>
          </View>
        )}

        <View style={[styles.recommendSection, { backgroundColor: c.primary + "08" }]}>
          <Text style={[styles.recommendLabel, { color: c.primary }]}>What to do</Text>
          <Text style={[styles.recommendText, { color: c.foreground }]}>{detail.recommendation}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function getInsightForMetric(key: MetricKey, insights: any): string | null {
  if (!insights) return null;
  switch (key) {
    case "sleep": return insights.sleepDebt.detail;
    case "hrv": return insights.hrvBaseline.detail;
    case "steps": return insights.calorieBalance.detail;
    case "weight": return insights.weightProjection.detail;
    case "restingHR": return insights.trainingLoad?.detail ?? "Resting heart rate reflects how your body is adapting to treatment. Lower values generally indicate better cardiovascular recovery.";
    default: return null;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Montserrat_600SemiBold",
  },
  content: {
    paddingHorizontal: 24,
    gap: 12,
  },
  heroSection: {
    paddingTop: 20,
    paddingBottom: 4,
    gap: 12,
  },
  heroLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  benchmarkCard: {
    borderRadius: 16,
    paddingHorizontal: 18,
    marginTop: 4,
    marginBottom: 4,
  },
  benchmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  benchmarkLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: 0.2,
  },
  benchmarkValue: {
    fontSize: 17,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.2,
  },
  benchmarkUnit: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
  },
  heroValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  heroValue: {
    fontSize: 48,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -2,
  },
  heroUnit: {
    fontSize: 18,
    fontFamily: "Montserrat_400Regular",
  },
  heroTrend: {
    fontSize: 22,
    fontFamily: "Montserrat_600SemiBold",
    marginLeft: 4,
  },
  heroHeadline: {
    fontSize: 16,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 23,
    opacity: 0.85,
  },
  section: {
    padding: 18,
    borderRadius: 20,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sectionBody: {
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
  },
  chart: {
    alignSelf: "center",
  },
  chartLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  chartLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
  },
  recommendSection: {
    padding: 18,
    borderRadius: 20,
    gap: 8,
  },
  recommendLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  recommendText: {
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
  },
  unavailableWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  unavailableIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  unavailableTitle: {
    fontSize: 19,
    fontFamily: "Montserrat_600SemiBold",
  },
  unavailableBody: {
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
    textAlign: "center",
  },
  unavailableBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  unavailableBtnText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
  },
});
