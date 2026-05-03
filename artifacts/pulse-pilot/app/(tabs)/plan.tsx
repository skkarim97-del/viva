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
import { CATEGORY_OPTIONS } from "@/types";
import type { ActionCategory, WeeklyPlanDay } from "@/types";
import { selectWeeklyDayView } from "@/lib/engine";
import { logIntervention, type InterventionType } from "@/lib/intervention/logger";
import { logCareEventDeduped } from "@/lib/care-events/client";

const CATEGORY_META: Record<ActionCategory, { label: string; icon: keyof typeof Feather.glyphMap; color: string }> = {
  move: { label: "Move", icon: "activity", color: "#FF6B6B" },
  fuel: { label: "Fuel", icon: "coffee", color: "#F0A500" },
  hydrate: { label: "Hydrate", icon: "droplet", color: "#5AC8FA" },
  recover: { label: "Recover", icon: "battery-charging", color: "#8B5CF6" },
  consistent: { label: "Medication", icon: "shield", color: "#34D399" },
};

export default function PlanScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { weeklyPlan, dailyState, editWeeklyAction, toggleWeeklyAction } = useApp();

  const [editingDay, setEditingDay] = useState<WeeklyPlanDay | null>(null);
  const [editingCategory, setEditingCategory] = useState<ActionCategory | null>(null);

  // Log the dominant intervention surfaced in the weekly plan once
  // per day. The plan derives from dailyState.primaryFocus, so we
  // log under the same canonical types the analytics view uses.
  React.useEffect(() => {
    if (!dailyState) return;
    const focusToType: Partial<Record<string, InterventionType>> = {
      hydration: "hydration",
      fueling: "protein_fueling",
      recovery: "recovery_rest",
      symptom_relief: "symptom_monitoring",
      continuity_support: "light_movement",
    };
    const t = focusToType[dailyState.primaryFocus];
    if (!t) return;
    logIntervention({
      surface: "WeeklyPlan",
      interventionType: t,
      title: `weekly:${dailyState.primaryFocus}`,
      rationale: dailyState.rationale?.join(" | ") ?? null,
      state: dailyState,
    });
    // Care-events stream: one row per (date|surface|focus) so the
    // dual-layer funnel knows Viva surfaced an actionable rec to this
    // patient today.
    logCareEventDeduped(
      "recommendation_shown",
      `WeeklyPlan|${dailyState.primaryFocus}`,
      { surface: "WeeklyPlan", focus: dailyState.primaryFocus },
    );
  }, [dailyState]);

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  if (!weeklyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Montserrat_500Medium" }}>Loading...</Text>
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
        <Text style={[styles.title, { color: c.foreground }]}>Your Week</Text>

        <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
          <Text style={[styles.summaryHeader, { color: c.foreground }]}>This Week</Text>
          {weeklyPlan.weekSummary.split("\n\n").map((line, i) => (
            <Text key={i} style={[styles.summaryText, { color: c.foreground }, i > 0 && { marginTop: 10 }]}>{line}</Text>
          ))}
        </View>

        {weeklyPlan.days.map((day) => {
          const view = selectWeeklyDayView(day, today, dailyState);
          const isToday = view.confidence === "today";
          const isTentative = view.confidence === "tentative";
          const supportActions = day.actions.filter(a => a.category !== "consistent");
          const completedCount = supportActions.filter(a => a.completed).length;
          return (
            <View
              key={day.date}
              style={[
                styles.dayCard,
                { backgroundColor: c.card },
                isToday && { borderWidth: 1.5, borderColor: c.accent + "45", backgroundColor: c.accent + "06" },
                // Future days are visually demoted: lighter card +
                // dashed border keeps them parsable as "not yet
                // committed" without being noisy.
                isTentative && { opacity: 0.78, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
              ]}
            >
              <View style={styles.dayHeader}>
                <View style={styles.dayNameRow}>
                  <Text style={[styles.dayName, { color: c.foreground }]}>{day.dayOfWeek}</Text>
                  {isToday && (
                    <View style={[styles.todayBadge, { backgroundColor: c.accent + "20" }]}>
                      <Text style={[styles.todayText, { color: c.accent }]}>Today</Text>
                    </View>
                  )}
                  {isTentative && (
                    <View style={[styles.tentativeBadge, { borderColor: c.border }]}>
                      <Text style={[styles.tentativeBadgeText, { color: c.mutedForeground }]}>Tentative</Text>
                    </View>
                  )}
                </View>
                {completedCount > 0 && (
                  <Text style={[styles.progressText, { color: c.mutedForeground }]}>
                    {completedCount}/{supportActions.length}
                  </Text>
                )}
              </View>

              <Text style={[styles.focusKicker, { color: c.mutedForeground }]}>{view.focusLabel}</Text>
              <Text
                style={[
                  styles.focusLabel,
                  { color: isTentative ? c.mutedForeground : c.accent },
                ]}
              >
                {view.focusText}
              </Text>

              {view.tentativeCaption && (
                <Text style={[styles.tentativeCaption, { color: c.mutedForeground }]}>
                  {view.tentativeCaption}
                </Text>
              )}

              {view.showAdaptiveNote && day.adaptiveNote && (
                <View style={[styles.adaptiveNote, { backgroundColor: c.accent + "08" }]}>
                  <Feather name="heart" size={12} color={c.accent} style={{ marginTop: 1 }} />
                  <Text style={[styles.adaptiveNoteText, { color: c.mutedForeground }]}>{day.adaptiveNote}</Text>
                </View>
              )}

              <View style={styles.actionsGrid}>
                {day.actions.filter(a => a.category !== "consistent").map((action) => {
                  const meta = CATEGORY_META[action.category];
                  return (
                    <View
                      key={action.category}
                      style={[
                        styles.actionRow,
                        { backgroundColor: action.completed ? c.success + "0A" : "transparent" },
                      ]}
                    >
                      <Pressable
                        onPress={() => handleToggle(day.date, action.category)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={({ pressed }) => [
                          styles.actionCheck,
                          {
                            backgroundColor: action.completed ? c.success : "transparent",
                            borderColor: action.completed ? c.success : c.border,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        {action.completed && <Feather name="check" size={11} color="#fff" />}
                      </Pressable>
                      <Pressable
                        onPress={() => openEdit(day, action.category)}
                        style={({ pressed }) => [
                          styles.actionBody,
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <View style={[styles.dayIconWrap, { backgroundColor: meta.color + "12" }]}>
                          <Feather name={meta.icon} size={15} color={meta.color} />
                        </View>
                        <View style={styles.actionContent}>
                          <Text style={[styles.actionLabel, { color: c.mutedForeground }]}>{meta.label}</Text>
                          <Text style={[
                            styles.actionText,
                            {
                              color: action.completed ? c.mutedForeground : c.foreground,
                              textDecorationLine: action.completed ? "line-through" : "none",
                              opacity: action.completed ? 0.6 : 1,
                            },
                          ]} numberOfLines={1}>
                            {action.chosen}
                          </Text>
                          {/* Subtitle pulled from CATEGORY_OPTIONS so the
                              Week tab matches Today's "Your plan" copy
                              without a parallel string table. Falls back
                              to nothing if the chosen title isn't in the
                              ladder (e.g. legacy plan rows from older
                              sessions), so this is safe to add to every
                              row. */}
                          {(() => {
                            const sub = CATEGORY_OPTIONS[action.category]
                              ?.find((o) => o.title === action.chosen)?.subtitle;
                            if (!sub) return null;
                            return (
                              <Text
                                style={[
                                  styles.actionSubtitle,
                                  {
                                    color: c.mutedForeground,
                                    opacity: action.completed ? 0.5 : 1,
                                  },
                                ]}
                                numberOfLines={2}
                              >
                                {sub}
                              </Text>
                            );
                          })()}
                        </View>
                        <Feather name="chevron-right" size={14} color={c.mutedForeground + "40"} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        {weeklyPlan.adjustmentNote && (
          <View style={[styles.adjustNote, { backgroundColor: c.accent + "06" }]}>
            <Feather name="info" size={14} color={c.accent} />
            <Text style={[styles.adjustText, { color: c.foreground }]}>{weeklyPlan.adjustmentNote}</Text>
          </View>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

      <Modal visible={!!editingDay && !!editingCategory} animationType="slide" transparent>
        <Pressable style={styles.modalOverlay} onPress={() => { setEditingDay(null); setEditingCategory(null); }}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: Math.max(insets.bottom, 24) }]}
            onPress={(e) => e.stopPropagation()}
          >
            {editingCategory && editingDay && (() => {
              const meta = CATEGORY_META[editingCategory];
              const options = CATEGORY_OPTIONS[editingCategory];
              const currentAction = editingDay.actions.find(a => a.category === editingCategory);
              const selectedOption = options.find(o => o.title === currentAction?.chosen);
              return (
                <>
                  <View style={styles.modalHandle} />
                  <View style={styles.modalHeaderRow}>
                    <View style={[styles.modalIconWrap, { backgroundColor: meta.color + "12" }]}>
                      <Feather name={meta.icon} size={18} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalTitle, { color: c.foreground }]}>
                        {editingDay.dayOfWeek}: {meta.label}
                      </Text>
                      <Text style={[styles.modalSubtitle, { color: c.mutedForeground }]}>Choose one for the day</Text>
                    </View>
                  </View>
                  <View style={styles.optionsGrid}>
                    {options.map((option) => {
                      const isSelected = currentAction?.chosen === option.title;
                      const isRecommended = currentAction?.recommended === option.title;
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => selectOption(option.title)}
                          style={({ pressed }) => [
                            styles.optionChip,
                            {
                              borderColor: isSelected ? meta.color + "40" : c.border + "30",
                              backgroundColor: isSelected ? meta.color + "10" : c.background,
                              opacity: pressed ? 0.85 : 1,
                            },
                          ]}
                        >
                          <View style={styles.optionContent}>
                            <View style={styles.optionTitleRow}>
                              <Text style={[
                                styles.optionText,
                                { color: isSelected ? meta.color : c.foreground },
                                isSelected && { fontFamily: "Montserrat_600SemiBold" },
                              ]}>
                                {option.title}
                              </Text>
                              {isSelected && <Feather name="check-circle" size={18} color={meta.color} />}
                            </View>
                            <Text style={[styles.optionSubtitle, { color: c.mutedForeground }]}>{option.subtitle}</Text>
                            {isRecommended && !isSelected && (
                              <View style={[styles.recBadge, { backgroundColor: c.success + "14" }]}>
                                <Feather name="zap" size={10} color={c.success} />
                                <Text style={[styles.recBadgeText, { color: c.success }]}>Recommended</Text>
                              </View>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  {selectedOption?.supportText && selectedOption.supportText.length > 0 && (
                    <View style={styles.supportSection}>
                      {selectedOption.supportText.map((tip, i) => (
                        <View key={i} style={styles.supportRow}>
                          <Feather name="info" size={11} color={c.mutedForeground} />
                          <Text style={[styles.supportTip, { color: c.mutedForeground }]}>{tip}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              );
            })()}
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
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  summaryCard: {
    padding: 20,
    borderRadius: 20,
    marginBottom: 8,
    gap: 10,
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
  dayCard: {
    padding: 16,
    borderRadius: 20,
    gap: 8,
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
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.2,
  },
  todayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  todayText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
  },
  progressText: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
  },
  focusKicker: {
    fontSize: 10,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginTop: 4,
    opacity: 0.75,
  },
  focusLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    marginBottom: 2,
  },
  tentativeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tentativeBadgeText: {
    fontSize: 10,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  tentativeCaption: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    fontStyle: "italic",
    lineHeight: 16,
    marginTop: -2,
    marginBottom: 4,
  },
  adaptiveNote: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 2,
  },
  adaptiveNoteText: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 18,
    flex: 1,
  },
  actionsGrid: {
    gap: 2,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 6,
    marginHorizontal: -6,
    borderRadius: 14,
  },
  actionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dayIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionContent: {
    flex: 1,
    gap: 1,
  },
  actionLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  actionText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
  },
  actionSubtitle: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    marginTop: 1,
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
    fontFamily: "Montserrat_400Regular",
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
    maxHeight: "70%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.3)",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  modalIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    marginTop: 2,
  },
  optionsGrid: {
    gap: 10,
    paddingBottom: 8,
  },
  optionChip: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  optionContent: {
    gap: 4,
  },
  optionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionText: {
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
    flex: 1,
  },
  optionSubtitle: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    opacity: 0.7,
  },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  recBadgeText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
  },
  supportSection: {
    marginTop: 16,
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.15)",
  },
  supportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  supportTip: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
  },
});
