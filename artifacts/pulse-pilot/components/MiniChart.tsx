import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Polyline } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface MiniChartProps {
  data: { date: string; value: number }[];
  label: string;
  currentValue: string;
  unit: string;
  trend: "up" | "down" | "stable";
  summary: string;
  color?: string;
}

export function MiniChart({ data, label, currentValue, unit, trend, summary, color }: MiniChartProps) {
  const c = useColors();
  const chartColor = color || c.primary;
  const width = 280;
  const height = 60;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const trendIcon = trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "\u2192";
  const trendColor = label === "Weight" || label === "Resting HR"
    ? trend === "down" ? c.success : trend === "up" ? c.destructive : c.mutedForeground
    : trend === "up" ? c.success : trend === "down" ? c.destructive : c.mutedForeground;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
          <View style={styles.valueRow}>
            <Text style={[styles.value, { color: c.foreground }]}>{currentValue}</Text>
            <Text style={[styles.unit, { color: c.mutedForeground }]}>{unit}</Text>
            <Text style={[styles.trend, { color: trendColor }]}>{trendIcon}</Text>
          </View>
        </View>
      </View>
      <Svg width={width} height={height} style={styles.chart}>
        <Polyline points={points} fill="none" stroke={chartColor} strokeWidth={2} />
      </Svg>
      <Text style={[styles.summary, { color: c.mutedForeground }]}>{summary}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    marginTop: 2,
  },
  value: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  unit: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  trend: {
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
