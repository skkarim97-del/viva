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
      <Text style={[styles.title, { color: c.foreground }]}>Weekly Plan</Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        Personalized for your goals and recovery
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
                <View style={styles.dayInfo}>
                  <Text style={[styles.dayName, { color: c.foreground }]}>
                    {day.dayOfWeek}
                    {isToday ? " (Today)" : ""}
                  </Text>
                  <Text style={[styles.dayDate, { color: c.mutedForeground }]}>{day.date}</Text>
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
                  <View style={styles.workoutDetail}>
                    <Feather name="target" size={14} color={c.primary} />
                    <Text style={[styles.workoutType, { color: c.foreground }]}>
                      {day.workout.type}
                    </Text>
                  </View>
                  <View style={styles.workoutDetail}>
                    <Feather name="clock" size={14} color={c.mutedForeground} />
                    <Text style={[styles.workoutMeta, { color: c.mutedForeground }]}>
                      {day.workout.duration} min
                    </Text>
                  </View>
                  <Text style={[styles.workoutDesc, { color: c.mutedForeground }]}>
                    {day.workout.description}
                  </Text>
                </View>
              ) : (
                <View style={styles.restInfo}>
                  <Feather name="battery-charging" size={16} color={c.info} />
                  <Text style={[styles.restText, { color: c.mutedForeground }]}>
                    Focus on recovery, stretching, and hydration
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.sectionHeader}>
          <Feather name="navigation" size={16} color={c.accent} />
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Step Goal</Text>
        </View>
        <Text style={[styles.sectionValue, { color: c.foreground }]}>
          {weeklyPlan.stepGoal.toLocaleString()} steps / day
        </Text>
      </View>

      <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.sectionHeader}>
          <Feather name="coffee" size={16} color={c.accent} />
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Nutrition Priorities</Text>
        </View>
        {weeklyPlan.nutritionPriorities.map((p) => (
          <View key={p} style={styles.priorityRow}>
            <Feather name="check" size={14} color={c.success} />
            <Text style={[styles.priorityText, { color: c.mutedForeground }]}>{p}</Text>
          </View>
        ))}
      </View>

      {weeklyPlan.fastingSchedule ? (
        <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.sectionHeader}>
            <Feather name="clock" size={16} color={c.info} />
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Fasting Schedule</Text>
          </View>
          <Text style={[styles.sectionValue, { color: c.mutedForeground }]}>
            {weeklyPlan.fastingSchedule}
          </Text>
        </View>
      ) : null}

      {weeklyPlan.adjustmentNote ? (
        <View style={[styles.adjustmentCard, { backgroundColor: c.warning + "10", borderColor: c.warning + "30" }]}>
          <Feather name="alert-circle" size={16} color={c.warning} />
          <Text style={[styles.adjustmentText, { color: c.foreground }]}>
            {weeklyPlan.adjustmentNote}
          </Text>
        </View>
      ) : null}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
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
    gap: 10,
  },
  dayCard: {
    padding: 16,
    borderRadius: colors.radius,
    gap: 10,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dayInfo: {
    gap: 2,
  },
  dayName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  dayDate: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
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
    gap: 6,
  },
  workoutDetail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  workoutType: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  workoutMeta: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  sectionValue: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  priorityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priorityText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  adjustmentCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 10,
  },
  adjustmentText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    flex: 1,
  },
});
