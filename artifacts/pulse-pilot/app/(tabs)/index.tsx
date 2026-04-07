import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
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
  const { todayMetrics, dailyPlan, insights, profile } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);

  if (!todayMetrics || !dailyPlan || !insights) {
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

  const toggleInsight = (key: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedInsight(expandedInsight === key ? null : key);
  };

  const metricItems: { key: MetricKey; icon: keyof typeof Feather.glyphMap; label: string; value: string; sub: string; color: string }[] = [
    { key: "sleep", icon: "moon", label: "Sleep", value: `${todayMetrics.sleepDuration.toFixed(1)}h`, sub: `${todayMetrics.sleepQuality}% quality`, color: c.info },
    { key: "hrv", icon: "activity", label: "HRV", value: `${todayMetrics.hrv} ms`, sub: `baseline ${insights.hrvBaseline.baseline}`, color: c.success },
    { key: "steps", icon: "navigation", label: "Steps", value: todayMetrics.steps.toLocaleString(), sub: "/ 8,000 goal", color: c.accent },
    { key: "restingHR", icon: "heart", label: "Resting HR", value: `${todayMetrics.restingHeartRate} bpm`, sub: "cardiac load", color: c.destructive },
  ];

  const riskColor = insights.riskFlags.severity === "high" ? c.destructive
    : insights.riskFlags.severity === "medium" ? c.warning
    : insights.riskFlags.severity === "low" ? c.accent
    : c.success;

  const insightCards: { key: string; icon: keyof typeof Feather.glyphMap; title: string; value: string; detail: string; color: string }[] = [
    {
      key: "priority",
      icon: "alert-circle",
      title: "Top Priority",
      value: insights.topPriority.split(".")[0] + ".",
      detail: insights.topPriority,
      color: c.primary,
    },
    {
      key: "sleepDebt",
      icon: "moon",
      title: "Sleep Debt",
      value: `${insights.sleepDebt.hours}h — ${insights.sleepDebt.label}`,
      detail: insights.sleepDebt.detail,
      color: insights.sleepDebt.hours > 5 ? c.destructive : insights.sleepDebt.hours > 2 ? c.warning : c.success,
    },
    {
      key: "training",
      icon: "trending-up",
      title: "Training Load",
      value: `${insights.trainingLoad.label} — ${insights.trainingLoad.trend}`,
      detail: insights.trainingLoad.detail,
      color: insights.trainingLoad.trend === "rising" ? c.warning : c.success,
    },
    {
      key: "recovery",
      icon: "battery-charging",
      title: "Recovery Trend",
      value: `${insights.recoveryTrend.direction}${insights.recoveryTrend.streak > 0 ? ` (${insights.recoveryTrend.streak} days)` : ""}`,
      detail: insights.recoveryTrend.detail,
      color: insights.recoveryTrend.direction === "improving" ? c.success : insights.recoveryTrend.direction === "declining" ? c.destructive : c.info,
    },
    {
      key: "weight",
      icon: "bar-chart-2",
      title: "Weight Projection",
      value: insights.weightProjection.weeksToGoal
        ? `~${insights.weightProjection.weeksToGoal} weeks to goal`
        : `${insights.weightProjection.rate >= 0 ? "+" : ""}${insights.weightProjection.rate} lbs/week`,
      detail: insights.weightProjection.detail,
      color: insights.weightProjection.onTrack ? c.success : c.warning,
    },
    {
      key: "tdee",
      icon: "zap",
      title: "Energy Balance",
      value: `TDEE: ${insights.bodyComposition.estimatedTDEE.toLocaleString()} cal`,
      detail: insights.bodyComposition.detail,
      color: c.accent,
    },
    {
      key: "consistency",
      icon: "check-circle",
      title: "Consistency Score",
      value: `${insights.consistencyScore.score}/100 — ${insights.consistencyScore.label}`,
      detail: insights.consistencyScore.detail,
      color: insights.consistencyScore.score >= 80 ? c.success : insights.consistencyScore.score >= 60 ? c.warning : c.destructive,
    },
    {
      key: "hrv",
      icon: "activity",
      title: "HRV vs Baseline",
      value: `${insights.hrvBaseline.current} ms (${insights.hrvBaseline.deviation >= 0 ? "+" : ""}${insights.hrvBaseline.deviation})`,
      detail: insights.hrvBaseline.detail,
      color: insights.hrvBaseline.deviation >= 0 ? c.success : c.warning,
    },
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

      {insights.riskFlags.flags.length > 0 && (
        <View style={[styles.riskCard, { backgroundColor: riskColor + "08", borderColor: riskColor + "30" }]}>
          <View style={styles.riskHeader}>
            <Feather name="alert-triangle" size={16} color={riskColor} />
            <Text style={[styles.riskTitle, { color: riskColor }]}>
              {insights.riskFlags.severity === "high" ? "Attention Needed" : "Watch List"}
            </Text>
          </View>
          {insights.riskFlags.flags.map((flag, i) => (
            <Text key={i} style={[styles.riskText, { color: c.foreground }]}>
              {flag}
            </Text>
          ))}
        </View>
      )}

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
      </View>

      <Text style={[styles.sectionHeader, { color: c.foreground }]}>Deep Insights</Text>
      <Text style={[styles.sectionSubheader, { color: c.mutedForeground }]}>
        Tap any card for the full analysis.
      </Text>

      {insightCards.map((card) => {
        const isExpanded = expandedInsight === card.key;
        return (
          <Pressable
            key={card.key}
            onPress={() => toggleInsight(card.key)}
            style={({ pressed }) => [
              styles.insightCard,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <View style={styles.insightHeader}>
              <View style={[styles.insightIcon, { backgroundColor: card.color + "12" }]}>
                <Feather name={card.icon} size={16} color={card.color} />
              </View>
              <View style={styles.insightMeta}>
                <Text style={[styles.insightTitle, { color: c.mutedForeground }]}>{card.title}</Text>
                <Text style={[styles.insightValue, { color: c.foreground }]}>{card.value}</Text>
              </View>
              <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
            </View>
            {isExpanded && (
              <Text style={[styles.insightDetail, { color: c.mutedForeground }]}>{card.detail}</Text>
            )}
          </Pressable>
        );
      })}

      <View style={[styles.weekSummaryCard, { backgroundColor: c.muted }]}>
        <Text style={[styles.weekSummaryTitle, { color: c.foreground }]}>Week at a Glance</Text>
        <Text style={[styles.weekSummaryText, { color: c.mutedForeground }]}>{insights.weekSummary}</Text>
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
              <Text style={[styles.metricSub, { color: c.mutedForeground }]}>{item.sub}</Text>
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
  content: { paddingHorizontal: 20, gap: 14 },

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

  riskCard: {
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 8,
  },
  riskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  riskTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  riskText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    paddingLeft: 24,
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

  sectionHeader: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  sectionSubheader: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: -8,
  },

  insightCard: {
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 10,
  },
  insightHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  insightIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  insightMeta: {
    flex: 1,
    gap: 1,
  },
  insightTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  insightValue: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  insightDetail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    paddingLeft: 44,
  },

  weekSummaryCard: {
    padding: 14,
    borderRadius: colors.radius,
    gap: 6,
  },
  weekSummaryTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  weekSummaryText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },

  metricsSection: {
    gap: 10,
    marginTop: 2,
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
  metricSub: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  metricChevron: {
    position: "absolute",
    top: 14,
    right: 12,
  },
});
