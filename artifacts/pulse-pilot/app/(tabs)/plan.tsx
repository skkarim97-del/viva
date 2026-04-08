import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import type { ActionCategory, WeeklyPlanDay } from "@/types";
import { WEEKLY_OPTIONS } from "@/types";

const CATEGORY_META: Record<ActionCategory, { label: string; icon: keyof typeof Feather.glyphMap; color: string }> = {
  move: { label: "Move", icon: "activity", color: "#FF6B6B" },
  fuel: { label: "Fuel", icon: "coffee", color: "#F0A500" },
  hydrate: { label: "Hydrate", icon: "droplet", color: "#5AC8FA" },
  recover: { label: "Recover", icon: "battery-charging", color: "#8B5CF6" },
  mind: { label: "Mind", icon: "sun", color: "#34D399" },
};

export default function PlanScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { weeklyPlan, editWeeklyAction, toggleWeeklyAction } = useApp();

  const [editingDay, setEditingDay] = useState<WeeklyPlanDay | null>(null);
  const [editingCategory, setEditingCategory] = useState<ActionCategory | null>(null);

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  if (!weeklyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading...</Text>
      </View>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  const openEdit = (day: WeeklyPlanDay, category: ActionCategory) => {
    haptic();
    setEditingDay(day);
    setEditingCategory(category);
  };

  const selectOption = (option: string) => {
    if (editingDay && editingCategory) {
      haptic();
      editWeeklyAction(editingDay.date, editingCategory, option);
      setEditingDay(null);
      setEditingCategory(null);
    }
  };

  const handleToggle = (date: string, category: ActionCategory) => {
    haptic();
    toggleWeeklyAction(date, category);
  };

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: c.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader />
        <Text style={[styles.title, { color: c.foreground }]}>This Week</Text>

        <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
          {weeklyPlan.weekSummary.split("\n\n").map((line, i) => (
            <Text key={i} style={[styles.summaryText, { color: c.foreground }, i > 0 && { marginTop: 8 }]}>{line}</Text>
          ))}
        </View>

        {weeklyPlan.days.map((day) => {
          const isToday = day.date === today;
          const completedCount = day.actions.filter(a => a.completed).length;
          const isPast = day.date < today;
          return (
            <View
              key={day.date}
              style={[
                styles.dayCard,
                { backgroundColor: c.card },
                isToday && { borderWidth: 1.5, borderColor: c.primary + "30" },
              ]}
            >
              <View style={styles.dayHeader}>
                <View style={styles.dayNameRow}>
                  <Text style={[styles.dayName, { color: c.foreground }]}>{day.dayOfWeek}</Text>
                  {isToday && (
                    <View style={[styles.todayBadge, { backgroundColor: c.primary + "15" }]}>
                      <Text style={[styles.todayText, { color: c.primary }]}>Today</Text>
                    </View>
                  )}
                </View>
                {completedCount > 0 && (
                  <Text style={[styles.progressText, { color: c.mutedForeground }]}>
                    {completedCount}/{day.actions.length}
                  </Text>
                )}
              </View>

              <Text style={[styles.focusLabel, { color: c.primary }]}>{day.focusArea}</Text>

              <View style={styles.actionsGrid}>
                {day.actions.map((action) => {
                  const meta = CATEGORY_META[action.category];
                  const isEdited = action.chosen !== action.recommended;
                  return (
                    <Pressable
                      key={action.category}
                      style={styles.actionRow}
                      onPress={() => openEdit(day, action.category)}
                    >
                      <Pressable
                        onPress={(e) => { e.stopPropagation(); handleToggle(day.date, action.category); }}
                        style={[
                          styles.checkBox,
                          action.completed && { backgroundColor: meta.color + "20", borderColor: meta.color + "40" },
                          !action.completed && { borderColor: c.border },
                        ]}
                      >
                        {action.completed && (
                          <Feather name="check" size={13} color={meta.color} />
                        )}
                      </Pressable>

                      <Feather name={meta.icon} size={14} color={meta.color} style={{ marginRight: 4 }} />

                      <Text
                        style={[
                          styles.actionLabel,
                          { color: c.mutedForeground },
                          action.completed && styles.actionCompleted,
                        ]}
                        numberOfLines={1}
                      >
                        {meta.label}
                      </Text>
                      <Text
                        style={[
                          styles.actionValue,
                          { color: c.foreground },
                          action.completed && { ...styles.actionCompleted, color: c.mutedForeground },
                          isEdited && !action.completed && { color: c.primary },
                        ]}
                        numberOfLines={1}
                      >
                        {action.chosen}
                      </Text>

                      <Feather name="chevron-right" size={12} color={c.mutedForeground + "40"} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        {weeklyPlan.adjustmentNote && (
          <View style={[styles.adjustNote, { backgroundColor: c.primary + "06" }]}>
            <Feather name="info" size={14} color={c.primary} />
            <Text style={[styles.adjustText, { color: c.foreground }]}>{weeklyPlan.adjustmentNote}</Text>
          </View>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

      <Modal visible={!!editingDay && !!editingCategory} animationType="slide" transparent>
        <Pressable style={styles.modalOverlay} onPress={() => { setEditingDay(null); setEditingCategory(null); }}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: Math.max(insets.bottom, 20) }]}
            onPress={(e) => e.stopPropagation()}
          >
            {editingCategory && editingDay && (
              <>
                <View style={styles.modalHandle} />
                <Text style={[styles.modalTitle, { color: c.foreground }]}>
                  {editingDay.dayOfWeek} — {CATEGORY_META[editingCategory].label}
                </Text>
                <Text style={[styles.modalSubtitle, { color: c.mutedForeground }]}>
                  Recommended: {editingDay.actions.find(a => a.category === editingCategory)?.recommended}
                </Text>
                <View style={styles.optionsGrid}>
                  {WEEKLY_OPTIONS[editingCategory].map((option) => {
                    const currentAction = editingDay.actions.find(a => a.category === editingCategory);
                    const isSelected = currentAction?.chosen === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => selectOption(option)}
                        style={[
                          styles.optionChip,
                          { borderColor: c.border },
                          isSelected && { backgroundColor: c.primary + "12", borderColor: c.primary },
                        ]}
                      >
                        <Text style={[
                          styles.optionText,
                          { color: c.foreground },
                          isSelected && { color: c.primary, fontFamily: "Inter_600SemiBold" },
                        ]}>
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: 24,
    gap: 8,
    paddingTop: 0,
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
    borderRadius: 20,
    gap: 10,
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
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.2,
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
  progressText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  focusLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
  },
  actionsGrid: {
    gap: 10,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTextWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    width: 55,
  },
  actionValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  actionCompleted: {
    textDecorationLine: "line-through",
    opacity: 0.5,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    maxHeight: "60%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.3)",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  optionsGrid: {
    gap: 8,
    paddingBottom: 8,
  },
  optionChip: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
