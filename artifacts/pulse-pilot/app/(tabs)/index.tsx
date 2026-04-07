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

import { ReadinessRing } from "@/components/ReadinessRing";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import type { MetricKey } from "@/types";

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { todayMetrics, dailyPlan, insights } = useApp();
  const topPad = Platform.OS === "web" ? 60 : insets.top;

  if (!todayMetrics || !dailyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading...</Text>
      </View>
    );
  }

  const openMetric = (key: MetricKey) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({ pathname: "/metric-detail", params: { key } });
  };

  const metricItems: { key: MetricKey; label: string; value: string; unit: string }[] = [
    {
      key: "sleep",
      label: "Sleep",
      value: todayMetrics.sleepDuration.toFixed(1),
      unit: "hrs",
    },
    {
      key: "recovery",
      label: "Recovery",
      value: `${todayMetrics.recoveryScore}`,
      unit: "%",
    },
    {
      key: "steps",
      label: "Steps",
      value: todayMetrics.steps >= 1000 ? `${(todayMetrics.steps / 1000).toFixed(1)}` : `${todayMetrics.steps}`,
      unit: todayMetrics.steps >= 1000 ? "k" : "",
    },
    {
      key: "restingHR",
      label: "Heart Rate",
      value: `${todayMetrics.restingHeartRate}`,
      unit: "bpm",
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.statusSection}>
        <ReadinessRing score={dailyPlan.readinessScore} label={dailyPlan.readinessLabel} size={96} />
        <Text style={[styles.headline, { color: c.foreground }]}>{dailyPlan.headline}</Text>
        <Text style={[styles.summary, { color: c.mutedForeground }]}>{dailyPlan.summary}</Text>
      </View>

      <View style={[styles.planCard, { backgroundColor: c.card }]}>
        <Text style={[styles.planTitle, { color: c.foreground }]}>Today's Plan</Text>
        <View style={[styles.planDivider, { backgroundColor: c.border }]} />
        <PlanRow icon="target" iconColor={c.primary} label="Workout" value={dailyPlan.todaysPlan.workout} foreground={c.foreground} muted={c.mutedForeground} />
        <PlanRow icon="navigation" iconColor={c.accent} label="Movement" value={dailyPlan.todaysPlan.movement} foreground={c.foreground} muted={c.mutedForeground} />
        <PlanRow icon="coffee" iconColor={c.warning} label="Nutrition" value={dailyPlan.todaysPlan.nutrition} foreground={c.foreground} muted={c.mutedForeground} />
        <PlanRow icon="moon" iconColor={c.info} label="Recovery" value={dailyPlan.todaysPlan.recovery} foreground={c.foreground} muted={c.mutedForeground} />
      </View>

      <View style={styles.whySection}>
        <Text style={[styles.whyTitle, { color: c.mutedForeground }]}>Why this plan</Text>
        {dailyPlan.whyThisPlan.slice(0, 3).map((reason, i) => (
          <View key={i} style={styles.whyRow}>
            <View style={[styles.whyDot, { backgroundColor: c.primary + "40" }]} />
            <Text style={[styles.whyText, { color: c.foreground }]}>{reason}</Text>
          </View>
        ))}
      </View>

      <View style={styles.metricsRow}>
        {metricItems.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => openMetric(item.key)}
            style={({ pressed }) => [
              styles.metricTile,
              { backgroundColor: c.card, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{item.label}</Text>
            <View style={styles.metricValueRow}>
              <Text style={[styles.metricValue, { color: c.foreground }]}>{item.value}</Text>
              <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{item.unit}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 110 }} />
    </ScrollView>
  );
}

function PlanRow({ icon, iconColor, label, value, foreground, muted }: {
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  label: string;
  value: string;
  foreground: string;
  muted: string;
}) {
  return (
    <View style={styles.planRow}>
      <View style={[styles.planIconWrap, { backgroundColor: iconColor + "12" }]}>
        <Feather name={icon} size={15} color={iconColor} />
      </View>
      <View style={styles.planRowContent}>
        <Text style={[styles.planRowLabel, { color: muted }]}>{label}</Text>
        <Text style={[styles.planRowValue, { color: foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: 24,
  },

  statusSection: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
    gap: 14,
    marginBottom: 28,
  },
  headline: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 26,
    letterSpacing: -0.4,
    paddingHorizontal: 20,
    marginTop: 2,
  },
  summary: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
    opacity: 0.8,
  },

  planCard: {
    borderRadius: 20,
    padding: 20,
    gap: 16,
    marginBottom: 24,
  },
  planTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.1,
  },
  planDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: -4,
  },
  planRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  planIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planRowContent: {
    flex: 1,
    gap: 2,
    paddingTop: 2,
  },
  planRowLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  planRowValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },

  whySection: {
    paddingHorizontal: 4,
    gap: 10,
    marginBottom: 28,
  },
  whyTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  whyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  whyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  whyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    flex: 1,
    opacity: 0.75,
  },

  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricTile: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  metricValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  metricUnit: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
