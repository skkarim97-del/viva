import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export default function PlanScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { weeklyPlan } = useApp();
  const topPad = Platform.OS === "web" ? 60 : insets.top;

  if (!weeklyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading...</Text>
      </View>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  const getDayTag = (day: typeof weeklyPlan.days[0], index: number): string | null => {
    if (day.isRestDay) return "recovery day";
    if (day.workout?.intensity === "high") return "build day";
    if (day.workout?.intensity === "moderate") return "steady effort";
    return null;
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>This Week</Text>

      <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
        <Text style={[styles.summaryText, { color: c.foreground }]}>
          This week focuses on steady progress with two lighter days to support recovery. The plan adapts based on your recovery and training load.
        </Text>
      </View>

      {weeklyPlan.days.map((day, index) => {
        const isToday = day.date === today;
        const tag = getDayTag(day, index);
        return (
          <View
            key={day.date}
            style={[
              styles.dayCard,
              { backgroundColor: c.card },
              isToday && { backgroundColor: c.primary + "08" },
            ]}
          >
            <View style={styles.dayHeader}>
              <View style={styles.dayNameRow}>
                <Text style={[styles.dayName, { color: c.foreground }]}>
                  {day.dayOfWeek}
                </Text>
                {isToday && (
                  <View style={[styles.todayBadge, { backgroundColor: c.primary + "15" }]}>
                    <Text style={[styles.todayText, { color: c.primary }]}>Today</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.focusBadge,
                  { color: day.isRestDay ? c.info : c.primary },
                ]}
              >
                {day.focusArea}
              </Text>
            </View>

            {day.workout ? (
              <Text style={[styles.dayDetail, { color: c.mutedForeground }]}>
                {day.workout.type} \u00B7 {day.workout.duration} min
              </Text>
            ) : (
              <View style={styles.restRow}>
                <Feather name="battery-charging" size={13} color={c.info} />
                <Text style={[styles.dayDetail, { color: c.mutedForeground }]}>Recovery, stretching, hydration</Text>
              </View>
            )}

            {tag && (
              <Text style={[styles.dayTag, { color: c.mutedForeground }]}>{tag}</Text>
            )}
          </View>
        );
      })}

      <View style={[styles.nutritionCard, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Nutrition this week</Text>
        {weeklyPlan.nutritionPriorities.map((p) => (
          <Text key={p} style={[styles.nutritionItem, { color: c.foreground }]}>{p}</Text>
        ))}
      </View>

      {weeklyPlan.adjustmentNote && (
        <View style={[styles.adjustNote, { backgroundColor: c.primary + "06" }]}>
          <Feather name="info" size={14} color={c.primary} />
          <Text style={[styles.adjustText, { color: c.foreground }]}>{weeklyPlan.adjustmentNote}</Text>
        </View>
      )}

      <View style={{ height: 110 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: 24,
    gap: 8,
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
    marginBottom: 4,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
    opacity: 0.75,
  },
  dayCard: {
    padding: 16,
    borderRadius: 16,
    gap: 6,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dayNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dayName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  todayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  todayText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  focusBadge: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  dayDetail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  dayTag: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    opacity: 0.6,
  },
  restRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nutritionCard: {
    padding: 16,
    borderRadius: 16,
    gap: 8,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  nutritionItem: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  adjustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 14,
    gap: 10,
    marginTop: 4,
  },
  adjustText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    flex: 1,
    opacity: 0.75,
  },
});
