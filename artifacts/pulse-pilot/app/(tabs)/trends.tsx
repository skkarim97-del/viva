import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MiniChart } from "@/components/MiniChart";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export default function TrendsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { trends } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const trendColors = [c.accent, c.success, c.destructive, c.info, c.primary, c.warning];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>Trends</Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        30-day view of your key health metrics
      </Text>

      {trends.map((trend, i) => {
        const latest = trend.data[trend.data.length - 1];
        return (
          <MiniChart
            key={trend.label}
            data={trend.data}
            label={trend.label}
            currentValue={
              trend.unit === "steps"
                ? latest.value.toLocaleString()
                : trend.unit === "hrs"
                ? latest.value.toFixed(1)
                : latest.value.toString()
            }
            unit={trend.unit}
            trend={trend.trend}
            summary={trend.summary}
            color={trendColors[i % trendColors.length]}
          />
        );
      })}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
});
