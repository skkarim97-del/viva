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
import colors from "@/constants/colors";
import type { MetricKey } from "@/types";

export default function MetricDetailScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { key } = useLocalSearchParams<{ key: MetricKey }>();
  const { todayMetrics, metrics } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!key || !todayMetrics || metrics.length === 0) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground }}>Loading...</Text>
      </View>
    );
  }

  const detail = getMetricDetail(key as MetricKey, todayMetrics, metrics);
  const chartWidth = 320;
  const chartHeight = 120;

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

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>{detail.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.valueCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.valueRow}>
            <Text style={[styles.currentValue, { color: c.foreground }]}>{detail.currentValue}</Text>
            <Text style={[styles.currentUnit, { color: c.mutedForeground }]}>{detail.unit}</Text>
            <Text style={[styles.trendArrow, { color: trendColor }]}>{trendArrow}</Text>
          </View>
          <Text style={[styles.headlineText, { color: c.foreground }]}>{detail.headline}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Current Status</Text>
          <Text style={[styles.cardBody, { color: c.mutedForeground }]}>{detail.explanation}</Text>
        </View>

        <View style={[styles.chartCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>30-Day Trend</Text>
          <Svg width={chartWidth} height={chartHeight} style={styles.chart}>
            <Polyline points={points} fill="none" stroke={c.primary} strokeWidth={2.5} />
          </Svg>
          <View style={styles.chartLabels}>
            <Text style={[styles.chartLabel, { color: c.mutedForeground }]}>30 days ago</Text>
            <Text style={[styles.chartLabel, { color: c.mutedForeground }]}>Today</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>What This Means</Text>
          <Text style={[styles.cardBody, { color: c.mutedForeground }]}>{detail.whatItMeans}</Text>
        </View>

        <View style={[styles.recommendCard, { backgroundColor: c.primary + "08", borderColor: c.primary + "25" }]}>
          <View style={styles.recommendHeader}>
            <Feather name="check-circle" size={18} color={c.primary} />
            <Text style={[styles.cardTitle, { color: c.foreground }]}>Recommendation</Text>
          </View>
          <Text style={[styles.cardBody, { color: c.foreground }]}>{detail.recommendation}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backButton: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  content: {
    paddingHorizontal: 20,
    gap: 14,
  },
  valueCard: {
    padding: 20,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 8,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  currentValue: {
    fontSize: 40,
    fontFamily: "Inter_700Bold",
  },
  currentUnit: {
    fontSize: 18,
    fontFamily: "Inter_400Regular",
  },
  trendArrow: {
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
    marginLeft: 4,
  },
  headlineText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    lineHeight: 22,
  },
  card: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  cardBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  chartCard: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 12,
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
    fontFamily: "Inter_400Regular",
  },
  recommendCard: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 8,
  },
  recommendHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
