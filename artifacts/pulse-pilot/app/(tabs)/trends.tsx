import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
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
import { computeHabitStats } from "@/data/insights";
import { formatDoseDisplay, getDoseTier } from "@/data/medicationData";
import {
  buildCorrelations,
  detectPatterns,
  buildGLP1Insights,
  buildKeyInsights,
  weeklyAverages,
  computeHabitWeeklyRates,
} from "@/lib/engine/trendsEngine";
import type { TrendCorrelation, GLP1Insight } from "@/lib/engine/trendsEngine";
import { useColors } from "@/hooks/useColors";
import type { MetricKey, HealthMetrics } from "@/types";

const metricKeyMap: Record<string, MetricKey> = {
  Weight: "weight",
  HRV: "hrv",
  "Resting HR": "restingHR",
  Sleep: "sleep",
  Steps: "steps",
  Recovery: "recovery",
};

interface SparkMetric {
  label: string;
  value: string;
  unit: string;
  data: number[];
  color: string;
  detailKey?: string;
}

function buildSparkPoints(data: number[], width: number, height: number): string {
  if (data.length < 2) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

export default function TrendsScreen() {
  const c = useColors();
  const { insights, metrics, completionHistory, weeklyConsistency, weeklyDaysCompleted, streakDays, todayCompletionRate, dailyPlan, profile, medicationLog, inputAnalytics, hasHealthData, availableMetricTypes } = useApp();

  const correlations = useMemo(() => hasHealthData ? buildCorrelations(metrics) : [], [metrics, hasHealthData]);
  const patterns = useMemo(() => hasHealthData ? detectPatterns(metrics, availableMetricTypes) : [], [metrics, hasHealthData, availableMetricTypes]);
  const habitStats = useMemo(() => computeHabitStats(completionHistory), [completionHistory]);
  const baseInsights = useMemo(() => hasHealthData ? buildKeyInsights(metrics, habitStats, availableMetricTypes) : [], [metrics, habitStats, hasHealthData, availableMetricTypes]);
  const keyInsights = useMemo(() => {
    const analyticsInsights = inputAnalytics?.insights ?? [];
    const combined = [...baseInsights];
    for (const ai of analyticsInsights) {
      if (!combined.includes(ai)) combined.push(ai);
    }
    return combined.slice(0, 6);
  }, [baseInsights, inputAnalytics]);
  const glp1Insights = useMemo(() => hasHealthData ? buildGLP1Insights(metrics, profile.medicationProfile, medicationLog, completionHistory) : [], [metrics, profile.medicationProfile, medicationLog, completionHistory, hasHealthData]);

  const openDetail = (label: string) => {
    const key = metricKeyMap[label];
    if (!key) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({ pathname: "/metric-detail", params: { key } });
  };

  const strengthLabel = (s: TrendCorrelation["strength"]) => {
    if (s === "strong") return "Strong link";
    if (s === "moderate") return "Moderate link";
    return "Weak link";
  };

  const last28 = metrics.slice(-28);
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const avgNullable = (arr: (number | null | undefined)[]) => {
    const f = arr.filter((v): v is number => typeof v === "number");
    return f.length > 0 ? f.reduce((s, v) => s + v, 0) / f.length : 0;
  };

  const avgSleep = +(avg(last28.map(m => m.sleepDuration))).toFixed(1);
  const avgHrv = Math.round(avgNullable(last28.map(m => m.hrv)));
  const avgRHR = Math.round(avgNullable(last28.map(m => m.restingHeartRate)));
  const avgSteps = Math.round(avg(last28.map(m => m.steps)));
  const avgActiveCalories = Math.round(avg(last28.map(m => m.activeCalories || 0)));
  const activeDays = last28.filter(m => (m.activeCalories || 0) > 200 || m.steps > 8000).length;
  const activeDaysPerWeek = last28.length > 0 ? +((activeDays / last28.length) * 7).toFixed(1) : 0;

  const sleepData = weeklyAverages(last28.map(m => m.sleepDuration));
  const hrvData = weeklyAverages(last28.map(m => m.hrv));
  const rhrData = weeklyAverages(last28.map(m => m.restingHeartRate));
  const stepsData = weeklyAverages(last28.map(m => m.steps));
  const activityData = weeklyAverages(last28.map(m => ((m.activeCalories || 0) > 200 || m.steps > 8000) ? 1 : 0));
  const activeCalData = weeklyAverages(last28.map(m => m.activeCalories || 0));
  const habitRateData = computeHabitWeeklyRates(completionHistory);

  const planActionsFiltered = dailyPlan ? dailyPlan.actions.filter(a => a.category !== "consistent") : [];
  const completedCount = planActionsFiltered.filter(a => a.completed).length;
  const totalActions = planActionsFiltered.length;

  const allRecoveryMetrics: (SparkMetric & { requiredType: string })[] = [
    { label: "Sleep", value: `${avgSleep}`, unit: "hrs", data: sleepData, color: "#AF52DE", detailKey: "Sleep", requiredType: "sleep" },
    { label: "HRV", value: `${avgHrv}`, unit: "ms", data: hrvData, color: "#5AC8FA", detailKey: "HRV", requiredType: "hrv" },
    { label: "Resting HR", value: `${avgRHR}`, unit: "bpm", data: rhrData, color: "#FF6B6B", detailKey: "Resting HR", requiredType: "heartRate" },
  ];
  const recoveryMetrics = allRecoveryMetrics.filter(m => availableMetricTypes.includes(m.requiredType as any));

  const allActivityMetrics: (SparkMetric & { requiredType: string })[] = [
    { label: "Steps", value: avgSteps >= 1000 ? `${(avgSteps / 1000).toFixed(1)}k` : `${avgSteps}`, unit: "avg", data: stepsData, color: "#34C759", detailKey: "Steps", requiredType: "steps" },
    { label: "Active Days", value: `${activeDaysPerWeek}`, unit: "/week", data: activityData.map(v => v * 7), color: "#142240", requiredType: "steps" },
    { label: "Active Cal", value: `${avgActiveCalories}`, unit: "avg", data: activeCalData, color: "#FF9500", requiredType: "calories" },
  ];
  const activityMetrics = allActivityMetrics.filter(m => availableMetricTypes.includes(m.requiredType as any));

  const habitsMetrics: SparkMetric[] = [
    { label: "Weekly", value: `${weeklyDaysCompleted}/7`, unit: "days", data: habitRateData, color: "#142240" },
    { label: "Streak", value: `${streakDays}`, unit: "days", data: [streakDays], color: "#FF9500" },
    { label: "Today", value: `${completedCount}/${totalActions}`, unit: "done", data: [completedCount], color: "#34C759" },
  ];

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
          <Text style={[styles.summaryHeader, { color: c.foreground }]}>How You're Doing</Text>
          {insights.weekSummary.split("\n\n").map((line, i) => (
            <Text key={i} style={[styles.summaryText, { color: c.foreground }]}>{line}</Text>
          ))}
          {!hasHealthData && (
            <Text style={[styles.dataSourceNote, { color: c.mutedForeground }]}>Based on your daily check-ins and plan activity</Text>
          )}
        </View>
      )}

      {profile.medicationProfile && (
        <View style={[styles.medSection, { backgroundColor: c.card }]}>
          <View style={styles.medSectionHeader}>
            <Feather name="package" size={16} color={c.accent} />
            <Text style={[styles.medSectionTitle, { color: c.foreground }]}>Medication</Text>
          </View>
          <Text style={[styles.medDoseText, { color: c.foreground }]}>
            {formatDoseDisplay(
              profile.medicationProfile.medicationBrand,
              profile.medicationProfile.doseValue,
              profile.medicationProfile.doseUnit,
              profile.medicationProfile.frequency as "weekly" | "daily"
            )}
          </Text>
          <View style={styles.medStatsRow}>
            {(() => {
              const last7 = medicationLog.filter(e => {
                const d = new Date(e.date);
                const now = new Date();
                return (now.getTime() - d.getTime()) < 7 * 86400000;
              });
              const taken = last7.filter(e => e.status === "taken").length;
              const total = profile.medicationProfile?.frequency === "daily" ? 7 : 1;
              return (
                <View style={[styles.medStatItem, { backgroundColor: c.background }]}>
                  <Text style={[styles.medStatValue, { color: c.foreground }]}>{taken}/{total}</Text>
                  <Text style={[styles.medStatLabel, { color: c.mutedForeground }]}>doses this week</Text>
                </View>
              );
            })()}
            <View style={[styles.medStatItem, { backgroundColor: c.background }]}>
              <Text style={[styles.medStatValue, { color: c.foreground }]}>
                {getDoseTier(profile.medicationProfile.medicationBrand, profile.medicationProfile.doseValue)}
              </Text>
              <Text style={[styles.medStatLabel, { color: c.mutedForeground }]}>dose tier</Text>
            </View>
            {profile.medicationProfile.recentTitration && (
              <View style={[styles.medStatItem, { backgroundColor: "#FF950010" }]}>
                <Text style={[styles.medStatValue, { color: "#FF9500" }]}>Yes</Text>
                <Text style={[styles.medStatLabel, { color: "#FF9500" }]}>titrated</Text>
              </View>
            )}
          </View>
          {medicationLog.length > 0 && (
            <View style={styles.medLogPreview}>
              <Text style={[styles.medLogTitle, { color: c.mutedForeground }]}>Recent doses</Text>
              {medicationLog.slice(-5).reverse().map((entry) => (
                <View key={entry.id} style={styles.medLogRow}>
                  <Feather name={entry.status === "taken" ? "check-circle" : entry.status === "skipped" ? "x-circle" : "clock"} size={13} color={entry.status === "taken" ? "#34C759" : entry.status === "skipped" ? "#FF6B6B" : c.mutedForeground} />
                  <Text style={[styles.medLogDate, { color: c.mutedForeground }]}>{entry.date}</Text>
                  <Text style={[styles.medLogStatus, { color: entry.status === "taken" ? "#34C759" : entry.status === "skipped" ? "#FF6B6B" : c.mutedForeground }]}>{entry.status}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {keyInsights.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>What We're Noticing</Text>
          {keyInsights.map((insight, i) => (
            <View key={i} style={[styles.insightCard, { backgroundColor: c.card }]}>
              <Feather name="zap" size={13} color={c.accent} />
              <Text style={[styles.insightText, { color: c.foreground }]}>{insight}</Text>
            </View>
          ))}
        </View>
      )}

      {glp1Insights.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Treatment Patterns</Text>
          <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>What we are noticing about your medication journey</Text>
          {glp1Insights.map((insight, i) => (
            <View key={i} style={[styles.glp1InsightCard, { backgroundColor: c.card }]}>
              <View style={[styles.glp1InsightIcon, { backgroundColor: insight.color + "14" }]}>
                <Feather name={insight.icon as any} size={14} color={insight.color} />
              </View>
              <Text style={[styles.glp1InsightText, { color: c.foreground }]}>{insight.text}</Text>
            </View>
          ))}
        </View>
      )}

      {correlations.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Correlations</Text>
          <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>How your body signals connect</Text>
          {correlations.map((corr, i) => (
            <View key={i} style={[styles.corrCard, { backgroundColor: c.card }]}>
              <View style={styles.corrHeader}>
                <View style={[styles.corrIconWrap, { backgroundColor: corr.color + "14" }]}>
                  <Feather name={corr.icon as any} size={16} color={corr.color} />
                </View>
                <View style={styles.corrMeta}>
                  <Text style={[styles.corrTitle, { color: c.foreground }]}>{corr.title}</Text>
                  <View style={styles.corrBadgeRow}>
                    <View style={[styles.corrBadge, { backgroundColor: corr.strength === "strong" ? c.success + "18" : corr.strength === "moderate" ? c.warning + "18" : c.muted }]}>
                      <Text style={[styles.corrBadgeText, { color: corr.strength === "strong" ? c.success : corr.strength === "moderate" ? c.warning : c.mutedForeground }]}>
                        {strengthLabel(corr.strength)}
                      </Text>
                    </View>
                    <View style={[styles.corrBadge, { backgroundColor: corr.direction === "positive" ? c.success + "18" : corr.direction === "negative" ? "#FF6B6B18" : c.muted }]}>
                      <Feather
                        name={corr.direction === "positive" ? "trending-up" : corr.direction === "negative" ? "trending-down" : "minus"}
                        size={10}
                        color={corr.direction === "positive" ? c.success : corr.direction === "negative" ? "#FF6B6B" : c.mutedForeground}
                      />
                    </View>
                  </View>
                </View>
              </View>
              <Text style={[styles.corrInsight, { color: c.mutedForeground }]}>{corr.insight}</Text>
            </View>
          ))}
        </View>
      )}

      {patterns.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Patterns During Treatment</Text>
          {patterns.map((p, i) => (
            <View key={i} style={[styles.patternCard, { backgroundColor: c.card }]}>
              <Feather name="eye" size={14} color={c.accent} />
              <Text style={[styles.patternText, { color: c.foreground }]}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.sectionWrap}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Key Metrics</Text>
        <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>{hasHealthData ? "Rolling 4-week averages. Mini chart shows weekly averages across the last 4 weeks." : "Connect Apple Health for health metrics"}</Text>

        {hasHealthData && (recoveryMetrics.length > 0 || activityMetrics.length > 0) ? (
          <>
            {recoveryMetrics.length > 0 && (
              <>
                <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>Recovery / Body</Text>
                <View style={styles.metricsRow}>
                  {recoveryMetrics.map((m) => (
                    <Pressable
                      key={m.label}
                      onPress={() => m.detailKey && openDetail(m.detailKey)}
                      style={({ pressed }) => [styles.metricTile, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
                    >
                      <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{m.label}</Text>
                      <View style={styles.metricValueRow}>
                        <Text style={[styles.metricValue, { color: c.foreground }]}>{m.value}</Text>
                        <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{m.unit}</Text>
                      </View>
                      {m.data.length >= 2 && (
                        <Svg width={60} height={20} style={styles.spark}>
                          <Polyline
                            points={buildSparkPoints(m.data, 60, 20)}
                            fill="none"
                            stroke={m.color}
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </Svg>
                      )}
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {activityMetrics.length > 0 && (
              <>
                <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>Movement</Text>
                <View style={styles.metricsRow}>
                  {activityMetrics.map((m) => (
                    <Pressable
                      key={m.label}
                      onPress={() => m.detailKey && openDetail(m.detailKey)}
                      style={({ pressed }) => [styles.metricTile, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}
                    >
                      <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{m.label}</Text>
                      <View style={styles.metricValueRow}>
                        <Text style={[styles.metricValue, { color: c.foreground }]}>{m.value}</Text>
                        <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{m.unit}</Text>
                      </View>
                      {m.data.length >= 2 && (
                        <Svg width={60} height={20} style={styles.spark}>
                          <Polyline
                            points={buildSparkPoints(m.data, 60, 20)}
                            fill="none"
                            stroke={m.color}
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </Svg>
                      )}
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {(recoveryMetrics.length < allRecoveryMetrics.length || activityMetrics.length < allActivityMetrics.length) && (
              <Text style={[styles.partialDataNote, { color: c.mutedForeground }]}>
                Some metrics require Apple Watch or manual entry
              </Text>
            )}
          </>
        ) : (
          <View style={[styles.emptyMetricsCard, { backgroundColor: c.card }]}>
            <View style={[styles.emptyMetricsIconWrap, { backgroundColor: c.accent + "12" }]}>
              <Feather name="activity" size={18} color={c.accent} />
            </View>
            <Text style={[styles.emptyMetricsTitle, { color: c.foreground }]}>Health metrics unavailable</Text>
            <Text style={[styles.emptyMetricsText, { color: c.mutedForeground }]}>
              Connect Apple Health in Settings to see recovery, sleep, and movement trends. Your consistency data below is based on daily check-ins.
            </Text>
          </View>
        )}

        <Text style={[styles.categoryLabel, { color: c.mutedForeground }]}>Consistency</Text>
        <View style={styles.metricsRow}>
          {habitsMetrics.map((m) => (
            <View key={m.label} style={[styles.metricTile, { backgroundColor: c.card }]}>
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{m.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{m.value}</Text>
                <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{m.unit}</Text>
              </View>
              {m.data.length >= 2 && (
                <Svg width={60} height={20} style={styles.spark}>
                  <Polyline
                    points={buildSparkPoints(m.data, 60, 20)}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </View>
          ))}
        </View>
      </View>

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
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  summaryCard: {
    padding: 20,
    borderRadius: 20,
    gap: 12,
  },
  emptyMetricsCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyMetricsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  emptyMetricsTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  emptyMetricsText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    lineHeight: 20,
    opacity: 0.7,
    paddingHorizontal: 8,
  },
  summaryHeader: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
    opacity: 0.75,
    letterSpacing: -0.1,
  },
  dataSourceNote: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    opacity: 0.5,
    fontStyle: "italic",
    marginTop: 2,
  },
  partialDataNote: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    opacity: 0.5,
    marginTop: 8,
    fontStyle: "italic",
  },
  sectionWrap: {
    gap: 10,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    marginBottom: 2,
    opacity: 0.7,
  },
  insightCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 16,
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 21,
  },
  corrCard: {
    padding: 16,
    borderRadius: 18,
    gap: 10,
  },
  corrHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  corrIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  corrMeta: {
    flex: 1,
    gap: 4,
  },
  corrTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.2,
  },
  corrBadgeRow: {
    flexDirection: "row",
    gap: 6,
  },
  corrBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  corrBadgeText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
  },
  corrInsight: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
    opacity: 0.8,
  },
  patternCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 16,
  },
  patternText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
  },
  categoryLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: -2,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricTile: {
    flex: 1,
    padding: 14,
    borderRadius: 20,
    alignItems: "center",
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: 0.1,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
  },
  metricValue: {
    fontSize: 20,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.3,
  },
  metricUnit: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
  },
  spark: {
    marginTop: 2,
  },
  medSection: {
    padding: 20,
    borderRadius: 20,
    gap: 12,
  },
  medSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  medSectionTitle: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.2,
  },
  medDoseText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
  },
  medStatsRow: {
    flexDirection: "row",
    gap: 8,
  },
  medStatItem: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    alignItems: "center",
    gap: 2,
  },
  medStatValue: {
    fontSize: 16,
    fontFamily: "Montserrat_700Bold",
    textTransform: "capitalize",
  },
  medStatLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_400Regular",
  },
  medLogPreview: {
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.15)",
  },
  medLogTitle: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
  },
  medLogRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  medLogDate: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    flex: 1,
  },
  medLogStatus: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
    textTransform: "capitalize",
  },
  glp1InsightCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
  glp1InsightIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  glp1InsightText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 21,
  },
});
