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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>This Week</Text>

      {weeklyPlan.days.map((day) => {
        const isToday = day.date === today;
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
              <Text style={[styles.dayName, { color: c.foreground }]}>
                {day.dayOfWeek}{isToday ? " \u2022 Today" : ""}
              </Text>
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
                {day.workout.type} \u2022 {day.workout.duration} min
              </Text>
            ) : (
              <View style={styles.restRow}>
                <Feather name="battery-charging" size={13} color={c.info} />
                <Text style={[styles.dayDetail, { color: c.mutedForeground }]}>Recovery, stretching, hydration</Text>
              </View>
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
        <Text style={[styles.note, { color: c.mutedForeground }]}>{weeklyPlan.adjustmentNote}</Text>
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
    marginBottom: 8,
  },
  dayCard: {
    padding: 16,
    borderRadius: 14,
    gap: 6,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dayName: {
    fontSize: 16,
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
  restRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nutritionCard: {
    padding: 16,
    borderRadius: 14,
    gap: 8,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  nutritionItem: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  note: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    paddingHorizontal: 4,
    marginTop: 4,
  },
});
