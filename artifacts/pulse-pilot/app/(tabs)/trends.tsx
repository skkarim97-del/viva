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
import colors from "@/constants/colors";
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
  const { trends } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const trendColors = [c.accent, c.success, c.destructive, c.info, c.primary, c.warning];

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
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>Trends</Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        Tap any metric for a detailed breakdown.
      </Text>

      {trends.map((trend, i) => {
        const latest = trend.data[trend.data.length - 1];
        const chartColor = trendColors[i % trendColors.length];
        const width = 280;
        const height = 56;
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

        const isPositive =
          (trend.label === "Weight" || trend.label === "Resting HR")
            ? trend.trend === "down"
            : trend.trend === "up";
        const trendColor = isPositive ? c.success : trend.trend === "stable" ? c.mutedForeground : c.destructive;
        const trendArrow = trend.trend === "up" ? "\u2191" : trend.trend === "down" ? "\u2193" : "\u2192";

        return (
          <Pressable
            key={trend.label}
            onPress={() => openDetail(trend.label)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardLeft}>
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
                  <Text style={[styles.trendArrow, { color: trendColor }]}>{trendArrow}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={c.mutedForeground} />
            </View>
            <Svg width={width} height={height} style={styles.chart}>
              <Polyline points={points} fill="none" stroke={chartColor} strokeWidth={2} />
            </Svg>
            <Text style={[styles.summary, { color: c.mutedForeground }]}>{trend.summary}</Text>
          </Pressable>
        );
      })}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    gap: 14,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  card: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLeft: {
    gap: 2,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  value: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  unit: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  trendArrow: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginLeft: 4,
  },
  chart: {
    alignSelf: "center",
  },
  summary: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
