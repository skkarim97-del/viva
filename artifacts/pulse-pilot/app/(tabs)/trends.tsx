import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React from "react";
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
import type { MetricKey } from "@/types";

const metricKeyMap: Record<string, MetricKey> = {
  Weight: "weight",
  HRV: "hrv",
  "Resting HR": "restingHR",
  Sleep: "sleep",
  Steps: "steps",
  Recovery: "recovery",
};

export default function TrendsScreen() {
  const c = useColors();
  const { trends, insights } = useApp();

  const openDetail = (label: string) => {
    const key = metricKeyMap[label];
    if (!key) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({ pathname: "/metric-detail", params: { key } });
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
          <Text style={[styles.summaryText, { color: c.foreground }]}>{insights.weekSummary}</Text>
        </View>
      )}

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
    padding: 16,
    borderRadius: 16,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
    opacity: 0.75,
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
