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
import { getMetricDetail } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import type { MetricKey } from "@/types";

export default function MetricDetailScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { key } = useLocalSearchParams<{ key: MetricKey }>();
  const { todayMetrics, metrics, insights } = useApp();
  const topPad = Platform.OS === "web" ? 60 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!key || !todayMetrics || metrics.length === 0) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground }}>Loading...</Text>
      </View>
    );
  }

  const detail = getMetricDetail(key as MetricKey, todayMetrics, metrics);
  const chartWidth = 300;
  const chartHeight = 90;

  const values = detail.trend.data.map((d) => d.value);
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
        <View style={styles.heroSection}>
          <View style={styles.heroValueRow}>
            <Text style={[styles.heroValue, { color: c.foreground }]}>{detail.currentValue}</Text>
            <Text style={[styles.heroUnit, { color: c.mutedForeground }]}>{detail.unit}</Text>
            <Text style={[styles.heroTrend, { color: trendColor }]}>{trendArrow}</Text>
          </View>
          <Text style={[styles.heroHeadline, { color: c.foreground }]}>{detail.headline}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: c.card }]}>
          <Text style={[styles.sectionBody, { color: c.mutedForeground }]}>{detail.explanation}</Text>
        </View>

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
    case "recovery": return insights.recoveryTrend.detail;
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
    paddingVertical: 16,
    gap: 10,
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
});
