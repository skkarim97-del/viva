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
  recovery: "heartRate",
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
            {key === "sleep" ? "Sleep" : key === "hrv" ? "HRV" : key === "steps" ? "Steps" : key === "restingHR" ? "Heart Rate" : key === "recovery" ? "Recovery" : "Metric"}
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
        {todayFirst && detail.secondaryLabel && detail.secondaryValue ? (
          // Arriving from the Today tab: lead with the current/latest reading
          // and relegate the 4-week average to the secondary chip, because
          // the user just tapped a "today" metric card and expects today's
          // number to be the hero.
          (() => {
            const heroRaw = detail.secondaryValue;
            const spaceIdx = heroRaw.indexOf(" ");
            const heroValue = spaceIdx === -1 ? heroRaw : heroRaw.slice(0, spaceIdx);
            const heroUnit = spaceIdx === -1 ? detail.unit : heroRaw.slice(spaceIdx + 1);
            return (
              <View style={styles.heroSection}>
                <Text style={[styles.heroLabel, { color: c.mutedForeground }]}>{detail.secondaryLabel}</Text>
                <View style={styles.heroValueRow}>
                  <Text style={[styles.heroValue, { color: c.foreground }]}>{heroValue}</Text>
                  {heroUnit ? (
                    <Text style={[styles.heroUnit, { color: c.mutedForeground }]}>{heroUnit}</Text>
                  ) : null}
                  <Text style={[styles.heroTrend, { color: trendColor }]}>{trendArrow}</Text>
                </View>
                <View style={[styles.secondaryStat, { backgroundColor: c.muted }]}>
                  <Text style={[styles.secondaryStatLabel, { color: c.mutedForeground }]}>4-week average</Text>
                  <Text style={[styles.secondaryStatValue, { color: c.foreground }]}>
                    {detail.currentValue}{detail.unit ? ` ${detail.unit}` : ""}
                  </Text>
                </View>
                <Text style={[styles.heroHeadline, { color: c.foreground }]}>{detail.headline}</Text>
              </View>
            );
          })()
        ) : (
          <View style={styles.heroSection}>
            <Text style={[styles.heroLabel, { color: c.mutedForeground }]}>4-week average</Text>
            <View style={styles.heroValueRow}>
              <Text style={[styles.heroValue, { color: c.foreground }]}>{detail.currentValue}</Text>
              {detail.unit ? (
                <Text style={[styles.heroUnit, { color: c.mutedForeground }]}>{detail.unit}</Text>
              ) : null}
              <Text style={[styles.heroTrend, { color: trendColor }]}>{trendArrow}</Text>
            </View>
            {detail.secondaryLabel && detail.secondaryValue ? (
              <View style={[styles.secondaryStat, { backgroundColor: c.muted }]}>
                <Text style={[styles.secondaryStatLabel, { color: c.mutedForeground }]}>{detail.secondaryLabel}</Text>
                <Text style={[styles.secondaryStatValue, { color: c.foreground }]}>{detail.secondaryValue}</Text>
              </View>
            ) : null}
            <Text style={[styles.heroHeadline, { color: c.foreground }]}>{detail.headline}</Text>
          </View>
        )}

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
  heroLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  secondaryStat: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  secondaryStatLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
  },
  secondaryStatValue: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
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
