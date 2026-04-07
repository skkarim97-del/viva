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
import colors from "@/constants/colors";

export default function PlanScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { weeklyPlan } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

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
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>This Week</Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        Your training schedule, adjusted for recovery.
      </Text>

      <View style={styles.daysList}>
        {weeklyPlan.days.map((day) => {
          const isToday = day.date === today;
          return (
            <View
              key={day.date}
              style={[
                styles.dayCard,
                {
                  backgroundColor: isToday ? c.primary + "08" : c.card,
                  borderColor: isToday ? c.primary : c.border,
                  borderWidth: isToday ? 2 : 1,
                },
              ]}
            >
              <View style={styles.dayHeader}>
                <View style={styles.dayLeft}>
                  <Text style={[styles.dayName, { color: c.foreground }]}>
                    {day.dayOfWeek}
                    {isToday ? " (Today)" : ""}
                  </Text>
                </View>
                <View
                  style={[
                    styles.focusBadge,
                    {
                      backgroundColor: day.isRestDay ? c.info + "15" : c.primary + "15",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.focusBadgeText,
                      { color: day.isRestDay ? c.info : c.primary },
                    ]}
                  >
                    {day.focusArea}
                  </Text>
                </View>
              </View>

              {day.workout ? (
                <View style={styles.workoutInfo}>
                  <Text style={[styles.workoutType, { color: c.foreground }]}>
                    {day.workout.type} - {day.workout.duration} min
                  </Text>
                  <Text style={[styles.workoutDesc, { color: c.mutedForeground }]}>
                    {day.workout.description}
                  </Text>
                </View>
              ) : (
                <View style={styles.restInfo}>
                  <Feather name="battery-charging" size={14} color={c.info} />
                  <Text style={[styles.restText, { color: c.mutedForeground }]}>
                    Focus on recovery, stretching, and hydration.
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Nutrition This Week</Text>
        {weeklyPlan.nutritionPriorities.map((p) => (
          <View key={p} style={styles.bulletRow}>
            <View style={[styles.bullet, { backgroundColor: c.primary }]} />
            <Text style={[styles.bulletText, { color: c.mutedForeground }]}>{p}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Step Goal</Text>
        <Text style={[styles.sectionValue, { color: c.foreground }]}>
          {weeklyPlan.stepGoal.toLocaleString()} steps per day.
        </Text>
      </View>

      {weeklyPlan.fastingSchedule ? (
        <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Fasting</Text>
          <Text style={[styles.sectionValue, { color: c.mutedForeground }]}>
            {weeklyPlan.fastingSchedule}
          </Text>
        </View>
      ) : null}

      {weeklyPlan.adjustmentNote ? (
        <View style={[styles.noteCard, { backgroundColor: c.warning + "10", borderColor: c.warning + "30" }]}>
          <Feather name="alert-circle" size={16} color={c.warning} />
          <Text style={[styles.noteText, { color: c.foreground }]}>
            {weeklyPlan.adjustmentNote}
          </Text>
        </View>
      ) : null}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  daysList: {
    gap: 8,
  },
  dayCard: {
    padding: 14,
    borderRadius: colors.radius,
    gap: 8,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dayLeft: {
    gap: 2,
  },
  dayName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  focusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  focusBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  workoutInfo: {
    gap: 4,
  },
  workoutType: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  workoutDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  restInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  restText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  sectionCard: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  sectionValue: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  bulletText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 20,
  },
  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 10,
  },
  noteText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    flex: 1,
  },
});
