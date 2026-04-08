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
  TextInput,
  KeyboardAvoidingView,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { ACTION_OPTIONS } from "@/types";
import type { MetricKey, FeelingType, EnergyLevel, StressLevel, HydrationLevel, TrainingIntent, ChatMessage, DailyStatusLabel, ActionCategory } from "@/types";

const FEELINGS: { key: NonNullable<FeelingType>; label: string }[] = [
  { key: "great", label: "Great" },
  { key: "good", label: "Good" },
  { key: "tired", label: "Tired" },
  { key: "stressed", label: "Stressed" },
];

const ENERGY_LEVELS: { key: NonNullable<EnergyLevel>; label: string; color: string }[] = [
  { key: "excellent", label: "Excellent", color: "#34C759" },
  { key: "high", label: "High", color: "#34C759" },
  { key: "medium", label: "Medium", color: "#86868B" },
  { key: "low", label: "Low", color: "#FF6B6B" },
];

const STRESS_LEVELS: { key: NonNullable<StressLevel>; label: string; color: string }[] = [
  { key: "low", label: "Low", color: "#34C759" },
  { key: "moderate", label: "Moderate", color: "#FF9500" },
  { key: "high", label: "High", color: "#FF6B6B" },
  { key: "very_high", label: "Very High", color: "#FF3B30" },
];

const HYDRATION_LEVELS: { key: NonNullable<HydrationLevel>; label: string; color: string }[] = [
  { key: "hydrated", label: "Hydrated", color: "#5AC8FA" },
  { key: "good", label: "Good", color: "#5AC8FA" },
  { key: "low", label: "Low", color: "#FF9500" },
  { key: "dehydrated", label: "Dehydrated", color: "#FF6B6B" },
];

const TRAINING_INTENTS: { key: NonNullable<TrainingIntent>; label: string; color: string }[] = [
  { key: "none", label: "None", color: "#86868B" },
  { key: "light", label: "Light", color: "#5AC8FA" },
  { key: "moderate", label: "Moderate", color: "#1A5CFF" },
  { key: "intense", label: "Intense", color: "#AF52DE" },
];

const STATUS_COLOR_MAP: Record<DailyStatusLabel, (c: ReturnType<typeof useColors>) => string> = {
  "Strong Day": (c) => c.success,
  "On Track": (c) => c.primary,
  "Slightly Off Track": (c) => c.warning,
  "Off Track": (c) => c.destructive,
};

const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    todayMetrics, dailyPlan, insights, feeling, setFeeling,
    energy, setEnergy, stress, setStress,
    hydration, setHydration,
    trainingIntent, setTrainingIntent,
    chatMessages, addChatMessage, profile,
    toggleAction, editAction, weeklyConsistency,
  } = useApp();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [showAsk, setShowAsk] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showRefine, setShowRefine] = useState(false);
  const [editingAction, setEditingAction] = useState<ActionCategory | null>(null);

  if (!todayMetrics || !dailyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>Loading...</Text>
      </View>
    );
  }

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const openMetric = (key: MetricKey) => {
    haptic();
    router.push({ pathname: "/metric-detail", params: { key } });
  };

  const selectFeeling = (f: NonNullable<FeelingType>) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const newVal = feeling === f ? null : f;
    setFeeling(newVal);
  };

  const selectEnergy = (e: NonNullable<EnergyLevel>) => {
    haptic();
    setEnergy(energy === e ? null : e);
  };

  const selectStress = (s: NonNullable<StressLevel>) => {
    haptic();
    setStress(stress === s ? null : s);
  };

  const selectHydration = (h: NonNullable<HydrationLevel>) => {
    haptic();
    setHydration(hydration === h ? null : h);
  };

  const selectTrainingIntent = (ti: NonNullable<TrainingIntent>) => {
    haptic();
    setTrainingIntent(trainingIntent === ti ? null : ti);
  };

  const sendAskMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };
    setAskMessages((prev) => [...prev, userMsg]);
    addChatMessage(userMsg);
    setAskInput("");
    setIsTyping(true);
    setStreamingText("");

    const conversationHistory = [...chatMessages.slice(-6), userMsg].map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    try {
      const response = await fetch(`${API_BASE}/coach/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          healthContext: {
            todayMetrics: {
              hrv: todayMetrics.hrv,
              restingHeartRate: todayMetrics.restingHeartRate,
              sleepDuration: todayMetrics.sleepDuration,
              sleepQuality: todayMetrics.sleepQuality,
              steps: todayMetrics.steps,
              recoveryScore: todayMetrics.recoveryScore,
              weight: todayMetrics.weight,
              strain: todayMetrics.strain,
            },
            profile: {
              age: profile.age,
              sex: profile.sex,
              weight: profile.weight,
              goalWeight: profile.goalWeight,
              goals: profile.goals,
            },
            readinessScore: dailyPlan?.readinessScore,
            dailyState: dailyPlan?.dailyState,
            userFeeling: feeling,
            userEnergy: energy,
            userStress: stress,
            userHydration: hydration,
            userTrainingIntent: trainingIntent,
            sleepInsight: insights?.sleepIntelligence?.insight,
          },
          conversationHistory,
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream reader");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullText += data.content;
                setStreamingText(fullText);
              }
              if (data.done) {
                const assistantMsg: ChatMessage = {
                  id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                  role: "assistant",
                  content: fullText,
                  timestamp: Date.now(),
                };
                setAskMessages((prev) => [...prev, assistantMsg]);
                addChatMessage(assistantMsg);
                setStreamingText("");
                setIsTyping(false);
                return;
              }
            } catch {}
          }
        }
      }
      if (fullText) {
        const assistantMsg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: fullText,
          timestamp: Date.now(),
        };
        setAskMessages((prev) => [...prev, assistantMsg]);
        addChatMessage(assistantMsg);
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        role: "assistant",
        content: "Could not connect right now. Try again in a moment.",
        timestamp: Date.now(),
      };
      setAskMessages((prev) => [...prev, errorMsg]);
    } finally {
      setStreamingText("");
      setIsTyping(false);
    }
  };

  const metricItems: { key: MetricKey; label: string; value: string; unit: string }[] = [
    { key: "sleep", label: "Sleep", value: todayMetrics.sleepDuration.toFixed(1), unit: "hrs" },
    { key: "steps", label: "Steps", value: todayMetrics.steps >= 1000 ? `${(todayMetrics.steps / 1000).toFixed(1)}` : `${todayMetrics.steps}`, unit: todayMetrics.steps >= 1000 ? "k" : "" },
    { key: "restingHR", label: "Heart Rate", value: `${todayMetrics.restingHeartRate}`, unit: "bpm" },
    { key: "hrv", label: "HRV", value: `${todayMetrics.hrv}`, unit: "ms" },
  ];

  const statusColor = STATUS_COLOR_MAP[dailyPlan.statusLabel](c);

  const ACTION_META: Record<ActionCategory, { label: string; icon: keyof typeof Feather.glyphMap; color: string }> = {
    move: { label: "Move", icon: "activity", color: c.primary },
    fuel: { label: "Fuel", icon: "coffee", color: c.warning },
    hydrate: { label: "Hydrate", icon: "droplet", color: "#5AC8FA" },
    recover: { label: "Recover", icon: "battery-charging", color: c.info },
    mind: { label: "Mind", icon: "sun", color: c.accent },
  };

  const completedCount = dailyPlan.actions.filter(a => a.completed).length;
  const totalActions = dailyPlan.actions.length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <ScrollView
        style={[styles.container, { backgroundColor: c.background }]}
        contentContainerStyle={[styles.content, { paddingTop: 0, paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader />

        <View style={[styles.statusCard, { backgroundColor: c.card }]}>
          <View style={[styles.statusIndicator, { backgroundColor: statusColor + "14" }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>{dailyPlan.statusLabel}</Text>
          </View>
          <Text style={[styles.headline, { color: c.foreground }]} numberOfLines={1} adjustsFontSizeToFit>{dailyPlan.headline}</Text>
          <Text style={[styles.driversInline, { color: c.mutedForeground }]} numberOfLines={2}>
            {dailyPlan.statusDrivers.join(" · ")}
          </Text>
        </View>

        <View style={[styles.feelingCard, { backgroundColor: c.card }]}>
          <Text style={[styles.feelingPrompt, { color: c.mutedForeground }]}>How are you feeling?</Text>
          <View style={styles.feelingRow}>
            {FEELINGS.map(({ key, label }) => {
              const isSelected = feeling === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => selectFeeling(key)}
                  style={({ pressed }) => [
                    styles.feelingChip,
                    {
                      backgroundColor: isSelected ? c.foreground : c.background,
                      opacity: pressed ? 0.8 : 1,
                      transform: [{ scale: pressed ? 0.96 : isSelected ? 1.02 : 1 }],
                    },
                  ]}
                >
                  <Text style={[styles.feelingLabel, { color: isSelected ? c.background : c.mutedForeground }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.refineCard, { backgroundColor: c.card }]}>
          <Pressable
            onPress={() => { haptic(); setShowRefine(!showRefine); }}
            style={styles.refineToggle}
          >
            <Text style={[styles.refineText, { color: c.foreground }]}>Refine your day</Text>
            <Feather name={showRefine ? "chevron-up" : "chevron-down"} size={14} color={c.mutedForeground} />
          </Pressable>

          {showRefine && (
            <View style={styles.refineSection}>
              <RefineRow
                label="Energy"
                items={ENERGY_LEVELS}
                selected={energy}
                onSelect={selectEnergy}
                cardBg={c.background}
                mutedColor={c.mutedForeground}
              />
              <RefineRow
                label="Stress"
                items={STRESS_LEVELS}
                selected={stress}
                onSelect={selectStress}
                cardBg={c.background}
                mutedColor={c.mutedForeground}
              />
              <RefineRow
                label="Hydration"
                items={HYDRATION_LEVELS}
                selected={hydration}
                onSelect={selectHydration}
                cardBg={c.background}
                mutedColor={c.mutedForeground}
              />
              <RefineRow
                label="Training"
                items={TRAINING_INTENTS}
                selected={trainingIntent}
                onSelect={selectTrainingIntent}
                cardBg={c.background}
                mutedColor={c.mutedForeground}
              />
            </View>
          )}
        </View>

        {dailyPlan.dailyFocus ? (
          <View style={[styles.focusCard, { backgroundColor: c.card }]}>
            <Text style={[styles.focusLabel, { color: c.mutedForeground }]}>Daily Focus</Text>
            <Text style={[styles.focusText, { color: c.foreground }]}>{dailyPlan.dailyFocus}</Text>
          </View>
        ) : null}

        <View style={[styles.dayCard, { backgroundColor: c.card }]}>
          <View style={styles.dayHeader}>
            <Text style={[styles.dayTitle, { color: c.foreground }]}>Your Day</Text>
            <Text style={[styles.dayProgress, { color: c.mutedForeground }]}>
              {completedCount}/{totalActions}
            </Text>
          </View>
          {dailyPlan.actions.map((action) => {
            const meta = ACTION_META[action.category];
            return (
              <View key={action.id} style={[
                styles.actionRow,
                { backgroundColor: action.completed ? c.success + "0A" : "transparent" },
              ]}>
                <Pressable
                  onPress={() => { haptic(); toggleAction(action.id); }}
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
                  onPress={() => { haptic(); setEditingAction(action.category); }}
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
                    ]}>
                      {action.text}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={c.mutedForeground + "40"} />
                </Pressable>
              </View>
            );
          })}
        </View>

        {weeklyConsistency >= 0 && (
          <View style={[styles.consistencyCard, { backgroundColor: c.card }]}>
            <Feather name="trending-up" size={14} color={c.success} />
            <Text style={[styles.consistencyText, { color: c.mutedForeground }]}>
              Consistency: {weeklyConsistency}% this week
            </Text>
          </View>
        )}

        <View style={styles.metricsRow}>
          {metricItems.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => openMetric(item.key)}
              style={({ pressed }) => [
                styles.metricTile,
                { backgroundColor: c.card, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>{item.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{item.value}</Text>
                <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{item.unit}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => setShowAsk(!showAsk)}
          style={({ pressed }) => [
            styles.askCard,
            { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View style={[styles.askIconWrap, { backgroundColor: c.primary + "10" }]}>
            <Feather name="message-circle" size={18} color={c.primary} />
          </View>
          <View style={styles.askContent}>
            <Text style={[styles.askTitle, { color: c.foreground }]}>Ask your coach</Text>
            <Text style={[styles.askSub, { color: c.mutedForeground }]}>Follow up on your day, sleep, stress, or nutrition</Text>
          </View>
          <Feather name={showAsk ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground + "60"} />
        </Pressable>

        {showAsk && (
          <View style={[styles.askPanel, { backgroundColor: c.card }]}>
            {askMessages.length > 0 && (
              <View style={styles.askMessagesWrap}>
                {askMessages.slice(-4).map((msg) => (
                  <View key={msg.id} style={[styles.askMsgRow, msg.role === "user" && styles.askMsgRowUser]}>
                    <View style={[
                      styles.askBubble,
                      msg.role === "user"
                        ? { backgroundColor: c.primary }
                        : { backgroundColor: c.background },
                    ]}>
                      <Text style={[styles.askMsgText, { color: msg.role === "user" ? c.primaryForeground : c.foreground }]}>
                        {msg.content}
                      </Text>
                    </View>
                  </View>
                ))}
                {streamingText ? (
                  <View style={styles.askMsgRow}>
                    <View style={[styles.askBubble, { backgroundColor: c.background }]}>
                      <Text style={[styles.askMsgText, { color: c.foreground }]}>{streamingText}{"\u258D"}</Text>
                    </View>
                  </View>
                ) : isTyping ? (
                  <View style={styles.askMsgRow}>
                    <View style={[styles.askBubble, { backgroundColor: c.background }]}>
                      <View style={styles.typingDots}>
                        <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
                        <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.5 }]} />
                        <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.25 }]} />
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            )}

            <View style={[styles.askInputRow, { backgroundColor: c.background }]}>
              <TextInput
                style={[styles.askInputField, { color: c.foreground }]}
                value={askInput}
                onChangeText={setAskInput}
                placeholder="Ask about your day..."
                placeholderTextColor={c.mutedForeground + "80"}
                onSubmitEditing={() => sendAskMessage(askInput)}
                returnKeyType="send"
                editable={!isTyping}
              />
              <Pressable
                onPress={() => sendAskMessage(askInput)}
                disabled={isTyping || !askInput.trim()}
                style={[styles.askSendBtn, { backgroundColor: askInput.trim() && !isTyping ? c.primary : c.muted }]}
              >
                <Feather name="arrow-up" size={14} color={askInput.trim() && !isTyping ? c.primaryForeground : c.mutedForeground} />
              </Pressable>
            </View>

            {askMessages.length === 0 && (
              <View style={styles.askSuggestions}>
                {["How is my sleep?", "Should I work out today?", "How can I reduce stress?"].map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => sendAskMessage(q)}
                    style={({ pressed }) => [styles.askSuggestion, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.askSuggestionText, { color: c.foreground }]}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={editingAction !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingAction(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setEditingAction(null)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: c.card }]} onPress={(e) => e.stopPropagation()}>
            {editingAction && (
              <>
                <View style={styles.modalHandle}>
                  <View style={[styles.handleBar, { backgroundColor: c.border }]} />
                </View>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIconWrap, { backgroundColor: ACTION_META[editingAction].color + "12" }]}>
                    <Feather name={ACTION_META[editingAction].icon} size={18} color={ACTION_META[editingAction].color} />
                  </View>
                  <Text style={[styles.modalTitle, { color: c.foreground }]}>{ACTION_META[editingAction].label}</Text>
                </View>
                <View style={styles.modalOptions}>
                  {ACTION_OPTIONS[editingAction].map((option) => {
                    const currentAction = dailyPlan.actions.find(a => a.category === editingAction);
                    const isSelected = currentAction?.text === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => {
                          haptic();
                          const action = dailyPlan.actions.find(a => a.category === editingAction);
                          if (action) {
                            editAction(action.id, option);
                          }
                          setEditingAction(null);
                        }}
                        style={({ pressed }) => [
                          styles.modalOption,
                          {
                            backgroundColor: isSelected ? c.primary + "10" : c.background,
                            borderColor: isSelected ? c.primary + "30" : c.border + "40",
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        <Text style={[
                          styles.modalOptionText,
                          { color: isSelected ? c.primary : c.foreground },
                        ]}>{option}</Text>
                        {isSelected && <Feather name="check" size={16} color={c.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function RefineRow<T extends string>({ label, items, selected, onSelect, cardBg, mutedColor }: {
  label: string;
  items: { key: T; label: string; color: string }[];
  selected: T | null;
  onSelect: (key: T) => void;
  cardBg: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.refineRow}>
      <Text style={[styles.refineLabel, { color: mutedColor }]}>{label}</Text>
      <View style={styles.refineChipRow}>
        {items.map(({ key, label: chipLabel, color }) => {
          const isSelected = selected === key;
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              style={({ pressed }) => [
                styles.refineChip,
                {
                  backgroundColor: isSelected ? color + "18" : cardBg,
                  borderWidth: 1,
                  borderColor: isSelected ? color + "40" : "transparent",
                  opacity: pressed ? 0.8 : 1,
                  transform: [{ scale: pressed ? 0.96 : isSelected ? 1.02 : 1 }],
                },
              ]}
            >
              <Text style={[styles.refineChipLabel, { color: isSelected ? color : mutedColor }]}>
                {chipLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: 24,
  },

  statusCard: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 24,
    marginBottom: 16,
    borderRadius: 24,
    gap: 10,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  headline: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
    lineHeight: 28,
    marginTop: 4,
  },
  driversInline: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    marginTop: 4,
    opacity: 0.7,
  },

  feelingCard: {
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 18,
    marginBottom: 12,
    gap: 14,
  },
  feelingPrompt: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  feelingRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  feelingChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
  },
  feelingLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },

  refineCard: {
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  refineToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  refineText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  refineSection: {
    gap: 20,
    marginTop: 20,
    paddingBottom: 6,
  },
  refineRow: {
    gap: 10,
  },
  refineLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  refineChipRow: {
    flexDirection: "row",
    gap: 8,
  },
  refineChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 18,
    alignItems: "center",
  },
  refineChipLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },

  focusCard: {
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 4,
  },
  focusLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  focusText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    lineHeight: 22,
  },

  dayCard: {
    borderRadius: 24,
    padding: 24,
    gap: 4,
    marginBottom: 16,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dayTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.1,
  },
  dayProgress: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 14,
    marginHorizontal: -6,
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
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  actionText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },

  consistencyCard: {
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  consistencyText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },

  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  metricTile: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  metricValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  metricUnit: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },

  askCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 24,
    gap: 12,
    marginBottom: 8,
  },
  askIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  askContent: {
    flex: 1,
    gap: 2,
  },
  askTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  askSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },

  askPanel: {
    borderRadius: 20,
    padding: 14,
    gap: 10,
    marginBottom: 8,
  },
  askMessagesWrap: {
    gap: 8,
    maxHeight: 300,
  },
  askMsgRow: {
    flexDirection: "row",
  },
  askMsgRowUser: {
    flexDirection: "row-reverse",
  },
  askBubble: {
    maxWidth: "85%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  askMsgText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  typingDots: {
    flexDirection: "row",
    gap: 4,
    paddingVertical: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  askInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    paddingLeft: 16,
    paddingRight: 4,
  },
  askInputField: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingVertical: 10,
  },
  askSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  askSuggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  askSuggestion: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  askSuggestionText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 40,
    paddingHorizontal: 24,
    maxHeight: "60%",
  },
  modalHandle: {
    alignItems: "center",
    paddingVertical: 12,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalHeader: {
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
    fontFamily: "Inter_600SemiBold",
  },
  modalOptions: {
    gap: 8,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  modalOptionText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
