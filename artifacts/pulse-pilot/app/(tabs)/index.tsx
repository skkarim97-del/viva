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
import colors from "@/constants/colors";
import type { MetricKey } from "@/types";

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { todayMetrics, dailyPlan } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

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

  const metricItems: { key: MetricKey; icon: keyof typeof Feather.glyphMap; label: string; value: string; sub: string; color: string }[] = [
    { key: "sleep", icon: "moon", label: "Sleep", value: `${todayMetrics.sleepDuration.toFixed(1)}h`, sub: `${todayMetrics.sleepQuality}% quality`, color: c.info },
    { key: "hrv", icon: "activity", label: "HRV", value: `${todayMetrics.hrv} ms`, sub: "recovery signal", color: c.success },
    { key: "steps", icon: "navigation", label: "Steps", value: todayMetrics.steps.toLocaleString(), sub: "/ 8,000 goal", color: c.accent },
    { key: "restingHR", icon: "heart", label: "Resting HR", value: `${todayMetrics.restingHeartRate} bpm`, sub: "cardiac load", color: c.destructive },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.headlineCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.headlineRow}>
          <ReadinessRing score={dailyPlan.readinessScore} label={dailyPlan.readinessLabel} size={90} />
          <View style={styles.headlineText}>
            <Text style={[styles.headline, { color: c.foreground }]}>{dailyPlan.headline}</Text>
            <Text style={[styles.summaryText, { color: c.mutedForeground }]}>{dailyPlan.summary}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.planCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Today's Plan</Text>

        <View style={styles.planItem}>
          <View style={[styles.planIcon, { backgroundColor: c.primary + "12" }]}>
            <Feather name="target" size={16} color={c.primary} />
          </View>
          <View style={styles.planContent}>
            <Text style={[styles.planLabel, { color: c.mutedForeground }]}>Workout</Text>
            <Text style={[styles.planValue, { color: c.foreground }]}>{dailyPlan.todaysPlan.workout}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <View style={styles.planItem}>
          <View style={[styles.planIcon, { backgroundColor: c.accent + "12" }]}>
            <Feather name="navigation" size={16} color={c.accent} />
          </View>
          <View style={styles.planContent}>
            <Text style={[styles.planLabel, { color: c.mutedForeground }]}>Movement</Text>
            <Text style={[styles.planValue, { color: c.foreground }]}>{dailyPlan.todaysPlan.movement}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <View style={styles.planItem}>
          <View style={[styles.planIcon, { backgroundColor: c.warning + "12" }]}>
            <Feather name="coffee" size={16} color={c.warning} />
          </View>
          <View style={styles.planContent}>
            <Text style={[styles.planLabel, { color: c.mutedForeground }]}>Nutrition</Text>
            <Text style={[styles.planValue, { color: c.foreground }]}>{dailyPlan.todaysPlan.nutrition}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: c.border }]} />

        <View style={styles.planItem}>
          <View style={[styles.planIcon, { backgroundColor: c.info + "12" }]}>
            <Feather name="battery-charging" size={16} color={c.info} />
          </View>
          <View style={styles.planContent}>
            <Text style={[styles.planLabel, { color: c.mutedForeground }]}>Recovery</Text>
            <Text style={[styles.planValue, { color: c.foreground }]}>{dailyPlan.todaysPlan.recovery}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.whyCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Why This Plan</Text>
        {dailyPlan.whyThisPlan.map((reason, i) => (
          <View key={i} style={styles.whyRow}>
            <View style={[styles.whyDot, { backgroundColor: c.primary }]} />
            <Text style={[styles.whyText, { color: c.mutedForeground }]}>{reason}</Text>
          </View>
        ))}
        {dailyPlan.optional ? (
          <View style={[styles.optionalBox, { backgroundColor: c.muted }]}>
            <Text style={[styles.optionalText, { color: c.mutedForeground }]}>{dailyPlan.optional}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metricsSection}>
        <Text style={[styles.metricsLabel, { color: c.mutedForeground }]}>Your Metrics</Text>
        <View style={styles.metricsGrid}>
          {metricItems.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => openMetric(item.key)}
              style={({ pressed }) => [
                styles.metricTile,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.metricIcon, { backgroundColor: item.color + "12" }]}>
                <Feather name={item.icon} size={16} color={item.color} />
              </View>
              <Text style={[styles.metricValue, { color: c.foreground }]}>{item.value}</Text>
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{item.label}</Text>
              <Feather name="chevron-right" size={14} color={c.mutedForeground} style={styles.metricChevron} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, gap: 16 },

  headlineCard: {
    padding: 20,
    borderRadius: colors.radius,
    borderWidth: 1,
  },
  headlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  headlineText: {
    flex: 1,
    gap: 6,
  },
  headline: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    lineHeight: 24,
  },
  summaryText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },

  planCard: {
    padding: 18,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  planItem: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  planIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  planContent: {
    flex: 1,
    gap: 2,
  },
  planLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  planValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  divider: {
    height: 1,
    marginLeft: 44,
  },

  whyCard: {
    padding: 18,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 10,
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
    marginTop: 6,
  },
  whyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    flex: 1,
  },
  optionalBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  optionalText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    fontStyle: "italic",
  },

  metricsSection: {
    gap: 10,
  },
  metricsLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricTile: {
    width: "47%",
    flexGrow: 1,
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 6,
    position: "relative",
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  metricLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  metricChevron: {
    position: "absolute",
    top: 14,
    right: 12,
  },
});
