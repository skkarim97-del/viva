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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";

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
  const insets = useSafeAreaInsets();
  const { trends, insights } = useApp();
  const topPad = Platform.OS === "web" ? 60 : insets.top;

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
      contentContainerStyle={[styles.content, { paddingTop: topPad + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>Trends</Text>

      {insights && (
        <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
          <Text style={[styles.summaryText, { color: c.mutedForeground }]}>{insights.weekSummary}</Text>
        </View>
      )}

      {trends.map((trend) => {
        const latest = trend.data[trend.data.length - 1];
        const width = 260;
        const height = 48;
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
              { backgroundColor: c.card, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={styles.cardTop}>
              <View>
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
              <Feather name="chevron-right" size={16} color={c.mutedForeground} />
            </View>
            <Svg width={width} height={height} style={styles.chart}>
              <Polyline points={points} fill="none" stroke={c.primary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
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
    borderRadius: 14,
  },
  summaryText: {
    fontSize: 14,
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
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
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
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  chart: {
    alignSelf: "center",
  },
});
