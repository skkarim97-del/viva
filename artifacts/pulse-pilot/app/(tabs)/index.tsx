import { Feather } from "@expo/vector-icons";
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

import { MetricCard } from "@/components/MetricCard";
import { PlanCard } from "@/components/PlanCard";
import { ReadinessRing } from "@/components/ReadinessRing";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { todayMetrics, dailyPlan, profile } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (!todayMetrics || !dailyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading...</Text>
      </View>
    );
  }

  const greeting = getGreeting(profile.name);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: c.mutedForeground }]}>{greeting}</Text>
          <Text style={[styles.planSummary, { color: c.foreground }]}>
            {dailyPlan.todaysPlanSummary}
          </Text>
        </View>
      </View>

      <View style={styles.readinessSection}>
        <View style={[styles.readinessCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <ReadinessRing score={dailyPlan.readinessScore} label={dailyPlan.readinessLabel} />
          <View style={styles.readinessInfo}>
            <Text style={[styles.readinessTitle, { color: c.foreground }]}>Today's Readiness</Text>
            <Text style={[styles.readinessDesc, { color: c.mutedForeground }]}>
              {dailyPlan.recoverySummary}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <MetricCard
          icon="moon"
          label="Sleep"
          value={`${todayMetrics.sleepDuration.toFixed(1)}h`}
          subtitle={`${todayMetrics.sleepQuality}% quality`}
          color={c.info}
        />
        <MetricCard
          icon="activity"
          label="HRV"
          value={`${todayMetrics.hrv}`}
          subtitle="ms"
          color={c.success}
        />
      </View>

      <View style={styles.metricsRow}>
        <MetricCard
          icon="navigation"
          label="Steps"
          value={todayMetrics.steps.toLocaleString()}
          subtitle="/ 8,000 goal"
          color={c.accent}
        />
        <MetricCard
          icon="heart"
          label="Resting HR"
          value={`${todayMetrics.restingHeartRate}`}
          subtitle="bpm"
          color={c.destructive}
        />
      </View>

      <PlanCard
        title={dailyPlan.workoutRecommendation.type}
        description={dailyPlan.workoutRecommendation.description}
        icon="target"
        badges={[
          `${dailyPlan.workoutRecommendation.duration} min`,
          dailyPlan.workoutRecommendation.intensity,
        ]}
        accentColor={c.primary}
      />

      <PlanCard
        title="Nutrition Target"
        description={dailyPlan.nutritionTarget.note}
        icon="coffee"
        badges={[
          `${dailyPlan.nutritionTarget.calories} cal`,
          `${dailyPlan.nutritionTarget.protein}g protein`,
          `${dailyPlan.nutritionTarget.hydration}oz water`,
        ]}
        accentColor={c.accent}
      />

      {dailyPlan.fastingGuidance ? (
        <PlanCard
          title="Fasting Window"
          description={dailyPlan.fastingGuidance}
          icon="clock"
          accentColor={c.info}
        />
      ) : null}

      <View style={[styles.whyCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.whyHeader}>
          <Feather name="info" size={18} color={c.primary} />
          <Text style={[styles.whyTitle, { color: c.foreground }]}>Why this plan?</Text>
        </View>
        <Text style={[styles.whyText, { color: c.mutedForeground }]}>
          {dailyPlan.whyThisPlan}
        </Text>
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  const prefix = name ? `${name}, ` : "";
  if (hour < 12) return `Good morning${prefix ? ", " + name : ""}`;
  if (hour < 17) return `Good afternoon${prefix ? ", " + name : ""}`;
  return `Good evening${prefix ? ", " + name : ""}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  header: {
    marginBottom: 4,
  },
  greeting: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  planSummary: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  readinessSection: {},
  readinessCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 20,
  },
  readinessInfo: {
    flex: 1,
    gap: 6,
  },
  readinessTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  readinessDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  whyCard: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 8,
  },
  whyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  whyTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  whyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
