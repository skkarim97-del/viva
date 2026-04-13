import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Platform,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Modal,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { generateCoachInsight } from "@/data/insights";
import { useColors } from "@/hooks/useColors";
import { CATEGORY_OPTIONS } from "@/types";
import type { MetricKey, FeelingType, ChatMessage, DailyStatusLabel, ActionCategory, AppetiteLevel, SideEffectSeverity, ProteinConfidenceDaily, MovementIntent, EnergyDaily } from "@/types";

const FEELINGS: { key: NonNullable<FeelingType>; label: string }[] = [
  { key: "great", label: "Great" },
  { key: "good", label: "Good" },
  { key: "tired", label: "Tired" },
  { key: "stressed", label: "Stressed" },
];

const APPETITE_LEVELS: { key: NonNullable<AppetiteLevel>; label: string; color: string }[] = [
  { key: "normal", label: "Normal", color: "#34C759" },
  { key: "low", label: "Low", color: "#FF9500" },
  { key: "very_low", label: "Very Low", color: "#FF6B6B" },
];

const SIDE_EFFECT_LEVELS: { key: NonNullable<SideEffectSeverity>; label: string; color: string }[] = [
  { key: "none", label: "None", color: "#34C759" },
  { key: "mild", label: "Mild", color: "#5AC8FA" },
  { key: "moderate", label: "Moderate", color: "#FF9500" },
  { key: "rough", label: "Rough", color: "#FF6B6B" },
];

const PROTEIN_CONFIDENCE_LEVELS: { key: NonNullable<ProteinConfidenceDaily>; label: string; color: string }[] = [
  { key: "good", label: "Good", color: "#34C759" },
  { key: "okay", label: "Okay", color: "#FF9500" },
  { key: "poor", label: "Poor", color: "#FF6B6B" },
];

const MOVEMENT_INTENTS: { key: NonNullable<MovementIntent>; label: string; color: string }[] = [
  { key: "strength", label: "Strength", color: "#AF52DE" },
  { key: "walk", label: "Walk", color: "#34C759" },
  { key: "light_recovery", label: "Light", color: "#5AC8FA" },
  { key: "rest", label: "Rest", color: "#86868B" },
];

const STATUS_COLOR_MAP: Record<DailyStatusLabel, (c: ReturnType<typeof useColors>) => string> = {
  "You're in a good place today": (c) => c.success,
  "A few small adjustments will help today": (c) => c.primary,
  "Let's make today a bit easier": (c) => c.warning,
  "Your body may need more support today": (c) => c.destructive,
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
    metrics, completionHistory,
    streakDays, todayCompletionRate,
    lastCompletionFeedback, clearCompletionFeedback,
    saveDailyCheckIn, todayCheckIn,
    appetite, setAppetite,
    sideEffects, setSideEffects,
    proteinConfidence, setProteinConfidence,
    movementIntent, setMovementIntent,
  } = useApp();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [askInput, setAskInput] = useState("");
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [editingAction, setEditingAction] = useState<ActionCategory | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showWhyPlan, setShowWhyPlan] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [checkInEnergy, setCheckInEnergy] = useState<EnergyDaily>(null);
  const [checkInProtein, setCheckInProtein] = useState<ProteinConfidenceDaily>(null);
  const [checkInSideEffects, setCheckInSideEffects] = useState<SideEffectSeverity>(null);
  const chatListRef = useRef<FlatList>(null);
  const feedbackOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (lastCompletionFeedback) {
      Animated.sequence([
        Animated.timing(feedbackOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2400),
        Animated.timing(feedbackOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => clearCompletionFeedback());
    }
  }, [lastCompletionFeedback]);

  if (!todayMetrics || !dailyPlan) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Montserrat_500Medium" }}>Loading...</Text>
      </View>
    );
  }

  const greetingText = React.useMemo(() => {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const firstName = profile?.name?.trim();
    return firstName ? `${timeGreeting}, ${firstName}` : "Your AI Health Coach";
  }, [profile?.name]);

  const coachInsight = React.useMemo(() => {
    if (!todayMetrics || metrics.length === 0) return "";
    return generateCoachInsight(todayMetrics, metrics, {
      feeling, energy, stress, hydration, trainingIntent, completionHistory,
    });
  }, [todayMetrics, metrics, feeling, energy, stress, hydration, trainingIntent, completionHistory]);

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

  const selectAppetite = (a: NonNullable<AppetiteLevel>) => {
    haptic();
    setAppetite(appetite === a ? null : a);
  };

  const selectSideEffects = (s: NonNullable<SideEffectSeverity>) => {
    haptic();
    setSideEffects(sideEffects === s ? null : s);
  };

  const selectProteinConfidence = (p: NonNullable<ProteinConfidenceDaily>) => {
    haptic();
    setProteinConfidence(proteinConfidence === p ? null : p);
  };

  const selectMovementIntent = (m: NonNullable<MovementIntent>) => {
    haptic();
    setMovementIntent(movementIntent === m ? null : m);
  };

  const sendAskMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    if (!showChat) setShowChat(true);

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
              caloriesBurned: todayMetrics.caloriesBurned,
              activeCalories: todayMetrics.activeCalories,
            },
            profile: {
              name: profile.name || undefined,
              age: profile.age,
              sex: profile.sex,
              weight: profile.weight,
              goalWeight: profile.goalWeight,
              goals: profile.goals,
              glp1Medication: profile.glp1Medication,
              glp1Duration: profile.glp1Duration,
              proteinConfidence: profile.proteinConfidence,
              strengthTrainingBaseline: profile.strengthTrainingBaseline,
            },
            readinessScore: dailyPlan?.readinessScore,
            dailyState: dailyPlan?.dailyState,
            userFeeling: feeling,
            userEnergy: energy,
            userStress: stress,
            userHydration: hydration,
            userTrainingIntent: trainingIntent,
            sleepInsight: insights?.sleepIntelligence?.insight,
            hrvBaseline: metrics.length >= 7
              ? Math.round(metrics.slice(-7).reduce((s, m) => s + m.hrv, 0) / Math.min(metrics.length, 7))
              : undefined,
            sleepDebt: metrics.length >= 3
              ? +(metrics.slice(-3).reduce((s, m) => s + Math.max(0, 7.5 - m.sleepDuration), 0)).toFixed(1)
              : undefined,
            recoveryTrend: metrics.length >= 3
              ? (() => {
                  const scores = metrics.slice(-3).map(m => m.recoveryScore);
                  const diff = scores[scores.length - 1] - scores[0];
                  if (diff > 5) return "improving";
                  if (diff < -5) return "declining";
                  return "stable";
                })()
              : undefined,
            streakDays,
            weeklyCompletionRate: weeklyConsistency,
            todayCompletionRate,
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
    consistent: { label: "Stay Consistent", icon: "check-circle", color: c.accent },
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

        <Text style={[styles.tagline, { color: c.mutedForeground }]}>{greetingText}</Text>

        <View style={[styles.statusCard, { backgroundColor: c.card }]}>
          <View style={styles.statusTopRow}>
            <View style={[styles.statusIndicator, { backgroundColor: statusColor + "14" }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusLabel, { color: statusColor }]}>{dailyPlan.statusLabel}</Text>
            </View>
            {streakDays > 0 && (
              <View style={[styles.streakBadge, { backgroundColor: c.warning + "14" }]}>
                <Feather name="zap" size={12} color={c.warning} />
                <Text style={[styles.streakText, { color: c.warning }]}>{streakDays}d</Text>
              </View>
            )}
          </View>
          <Text style={[styles.headline, { color: c.foreground }]} numberOfLines={2} adjustsFontSizeToFit>{dailyPlan.headline}</Text>
          <Text style={[styles.driversInline, { color: c.mutedForeground }]} numberOfLines={2}>
            {dailyPlan.statusDrivers.join(" · ")}
          </Text>
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
          {todayCompletionRate > 0 && (
            <View style={styles.progressBarWrap}>
              <View style={[styles.progressBarBg, { backgroundColor: c.border + "40" }]}>
                <View style={[styles.progressBarFill, { backgroundColor: c.success, width: `${todayCompletionRate}%` }]} />
              </View>
            </View>
          )}
        </View>

        {lastCompletionFeedback && (
          <Animated.View style={[styles.feedbackToast, { backgroundColor: c.success + "14", opacity: feedbackOpacity }]}>
            <Feather name="check-circle" size={14} color={c.success} />
            <Text style={[styles.feedbackText, { color: c.success }]}>{lastCompletionFeedback}</Text>
          </Animated.View>
        )}

        <Modal visible={showChat} animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent>
          <View style={[styles.chatModal, { backgroundColor: c.background }]}>
            <View style={[styles.chatHeader, { borderBottomColor: c.border, paddingTop: Math.max(insets.top, 16) }]}>
              <Pressable onPress={() => setShowChat(false)} hitSlop={12}>
                <Feather name="chevron-down" size={24} color={c.foreground} />
              </Pressable>
              <Text style={[styles.chatHeaderTitle, { color: c.foreground }]}>Your VIVA Coach</Text>
              <View style={{ width: 24 }} />
            </View>

            <FlatList
              ref={chatListRef}
              data={[
                ...askMessages,
                ...(streamingText ? [{ id: "streaming", role: "assistant" as const, content: streamingText + "\u258D", timestamp: Date.now() }] : []),
                ...(isTyping && !streamingText ? [{ id: "typing", role: "typing" as const, content: "", timestamp: Date.now() }] : []),
              ]}
              keyExtractor={(item) => item.id}
              style={styles.chatList}
              contentContainerStyle={styles.chatListContent}
              onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => chatListRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item: msg }) => {
                if (msg.role === "typing") {
                  return (
                    <View style={styles.askMsgRow}>
                      <View style={[styles.askBubble, { backgroundColor: c.card }]}>
                        <View style={styles.typingDots}>
                          <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
                          <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.5 }]} />
                          <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.25 }]} />
                        </View>
                      </View>
                    </View>
                  );
                }
                return (
                  <View style={[styles.askMsgRow, msg.role === "user" && styles.askMsgRowUser]}>
                    <View style={[
                      styles.askBubble,
                      msg.role === "user"
                        ? { backgroundColor: c.primary }
                        : { backgroundColor: c.card },
                    ]}>
                      {msg.role === "assistant" && msg.content.includes("\n") ? (
                        <View style={{ gap: 8 }}>
                          {msg.content.split(/\n\n+/).map((para, pi) => (
                            <Text key={pi} style={[styles.askMsgText, { color: c.foreground }]}>
                              {para}
                            </Text>
                          ))}
                        </View>
                      ) : (
                        <Text style={[styles.askMsgText, { color: msg.role === "user" ? c.primaryForeground : c.foreground }]}>
                          {msg.content}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              }}
            />

            <View style={[styles.chatInputContainer, { backgroundColor: c.background, paddingBottom: Math.max(bottomPad, 16) }]}>
              <View style={[styles.askInputRow, { backgroundColor: c.card }]}>
                <TextInput
                  style={[styles.askInputField, { color: c.foreground }]}
                  value={askInput}
                  onChangeText={setAskInput}
                  placeholder="Ask about your health..."
                  placeholderTextColor={c.mutedForeground + "80"}
                  onSubmitEditing={() => sendAskMessage(askInput)}
                  returnKeyType="send"
                  editable={!isTyping}
                  autoFocus
                />
                <Pressable
                  onPress={() => sendAskMessage(askInput)}
                  disabled={isTyping || !askInput.trim()}
                  style={[styles.askSendBtn, { backgroundColor: askInput.trim() && !isTyping ? c.primary : c.muted }]}
                >
                  <Feather name="arrow-up" size={14} color={askInput.trim() && !isTyping ? c.primaryForeground : c.mutedForeground} />
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <View style={[styles.dayCard, { backgroundColor: c.card }]}>
          <View style={styles.dayHeader}>
            <Text style={[styles.dayTitle, { color: c.foreground }]}>Today</Text>
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
                    {action.reason && !action.completed && (
                      <Text style={[styles.actionReason, { color: c.mutedForeground }]}>{action.reason}</Text>
                    )}
                  </View>
                  <Feather name="chevron-right" size={14} color={c.mutedForeground + "40"} />
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.refineSection}>
          <RefineRow
            label="Appetite"
            items={APPETITE_LEVELS}
            selected={appetite}
            onSelect={selectAppetite}
            cardBg={c.card}
            mutedColor={c.mutedForeground}
          />
          <RefineRow
            label="Side Effects"
            items={SIDE_EFFECT_LEVELS}
            selected={sideEffects}
            onSelect={selectSideEffects}
            cardBg={c.card}
            mutedColor={c.mutedForeground}
          />
          <RefineRow
            label="Protein"
            items={PROTEIN_CONFIDENCE_LEVELS}
            selected={proteinConfidence}
            onSelect={selectProteinConfidence}
            cardBg={c.card}
            mutedColor={c.mutedForeground}
          />
          <RefineRow
            label="Movement"
            items={MOVEMENT_INTENTS}
            selected={movementIntent}
            onSelect={selectMovementIntent}
            cardBg={c.card}
            mutedColor={c.mutedForeground}
          />
        </View>

        <View style={[styles.askCard, { backgroundColor: c.card }]}>
          {coachInsight ? (
            <Text style={[styles.coachInsightText, { color: c.foreground }]}>
              {coachInsight}
            </Text>
          ) : null}

          {askMessages.length > 0 && !showChat && (
            <Pressable onPress={() => setShowChat(true)}>
              <View style={[styles.askBubble, { backgroundColor: c.background }]}>
                <Text style={[styles.askMsgText, { color: c.foreground }]} numberOfLines={2}>
                  {askMessages[askMessages.length - 1].content}
                </Text>
              </View>
              <Text style={[styles.chatViewAll, { color: c.primary }]}>View conversation</Text>
            </Pressable>
          )}

          <View style={[styles.askInputRow, { backgroundColor: c.background }]}>
            <TextInput
              style={[styles.askInputField, { color: c.foreground }]}
              value={askInput}
              onChangeText={setAskInput}
              placeholder="Ask your coach anything..."
              placeholderTextColor={c.mutedForeground + "80"}
              onSubmitEditing={() => sendAskMessage(askInput)}
              returnKeyType="send"
              editable={!isTyping}
              onFocus={() => { if (askMessages.length > 0) setShowChat(true); }}
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
              {["Managing side effects", "Protein on low appetite days", "Is it okay to rest today?"].map((q) => (
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

        {dailyPlan?.whyThisPlan?.length > 0 && (
          <Pressable
            onPress={() => { haptic(); setShowWhyPlan(!showWhyPlan); }}
            style={[styles.whyPlanCard, { backgroundColor: c.card }]}
          >
            <View style={styles.whyPlanHeader}>
              <View style={styles.whyPlanTitleRow}>
                <Feather name="info" size={14} color={c.primary} />
                <Text style={[styles.whyPlanTitle, { color: c.foreground }]}>Why this plan</Text>
              </View>
              <Feather name={showWhyPlan ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
            </View>
            {showWhyPlan && (
              <View style={styles.whyPlanContent}>
                {dailyPlan.whyThisPlan.map((reason, i) => (
                  <Text key={i} style={[styles.whyPlanText, { color: c.mutedForeground }]}>{reason}</Text>
                ))}
              </View>
            )}
          </Pressable>
        )}

        {!todayCheckIn && completedCount >= 3 && (
          <Pressable
            onPress={() => { haptic(); setShowCheckIn(true); }}
            style={({ pressed }) => [
              styles.checkInButton,
              { backgroundColor: c.card, borderColor: c.primary + "30", opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="sunset" size={16} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.checkInButtonTitle, { color: c.foreground }]}>Quick reflection</Text>
              <Text style={[styles.checkInButtonSub, { color: c.mutedForeground }]}>Takes 15 seconds</Text>
            </View>
            <Feather name="chevron-right" size={14} color={c.mutedForeground + "60"} />
          </Pressable>
        )}

        {todayCheckIn && (
          <View style={[styles.checkInDone, { backgroundColor: c.card }]}>
            <Feather name="check-circle" size={14} color={c.success} />
            <Text style={[styles.checkInDoneText, { color: c.mutedForeground }]}>Reflection saved</Text>
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
              <Text style={[styles.metricLabel, { color: c.mutedForeground }]} numberOfLines={1}>{item.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, { color: c.foreground }]}>{item.value}</Text>
                <Text style={[styles.metricUnit, { color: c.mutedForeground }]}>{item.unit}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={editingAction !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingAction(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setEditingAction(null)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: Math.max(bottomPad, 24) }]} onPress={(e) => e.stopPropagation()}>
            {editingAction && (() => {
              const meta = ACTION_META[editingAction];
              const options = CATEGORY_OPTIONS[editingAction];
              const currentAction = dailyPlan.actions.find(a => a.category === editingAction);
              const selectedOption = options.find(o => o.title === currentAction?.text);
              return (
                <>
                  <View style={styles.modalHandle}>
                    <View style={[styles.handleBar, { backgroundColor: c.border }]} />
                  </View>
                  <View style={styles.modalHeader}>
                    <View style={[styles.modalIconWrap, { backgroundColor: meta.color + "12" }]}>
                      <Feather name={meta.icon} size={18} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalTitle, { color: c.foreground }]}>{meta.label}</Text>
                      <Text style={[styles.modalInstruction, { color: c.mutedForeground }]}>Choose one for today</Text>
                    </View>
                  </View>
                  <View style={styles.modalOptions}>
                    {options.map((option) => {
                      const isSelected = currentAction?.text === option.title;
                      const isRecommended = option.stateTag === dailyPlan.recommendedStateTag;
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => {
                            haptic();
                            if (currentAction) {
                              editAction(currentAction.id, option.title);
                            }
                            setEditingAction(null);
                          }}
                          style={({ pressed }) => [
                            styles.modalOption,
                            {
                              backgroundColor: isSelected ? meta.color + "10" : c.background,
                              borderColor: isSelected ? meta.color + "40" : c.border + "30",
                              opacity: pressed ? 0.85 : 1,
                            },
                          ]}
                        >
                          <View style={styles.modalOptionContent}>
                            <View style={styles.modalOptionTitleRow}>
                              <Text style={[
                                styles.modalOptionText,
                                { color: isSelected ? meta.color : c.foreground },
                                isSelected && { fontFamily: "Montserrat_600SemiBold" },
                              ]}>{option.title}</Text>
                              {isSelected && <Feather name="check-circle" size={18} color={meta.color} />}
                            </View>
                            <Text style={[styles.modalOptionSubtitle, { color: c.mutedForeground }]}>{option.subtitle}</Text>
                            {isRecommended && !isSelected && (
                              <View style={[styles.recommendedBadge, { backgroundColor: c.success + "14" }]}>
                                <Feather name="zap" size={10} color={c.success} />
                                <Text style={[styles.recommendedText, { color: c.success }]}>Best match today</Text>
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
                          <Text style={[styles.supportText, { color: c.mutedForeground }]}>{tip}</Text>
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

      <Modal
        visible={showCheckIn}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowCheckIn(false); setCheckInEnergy(null); setCheckInProtein(null); setCheckInSideEffects(null); }}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { setShowCheckIn(false); setCheckInEnergy(null); setCheckInProtein(null); setCheckInSideEffects(null); }}>
          <Pressable style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: Math.max(bottomPad, 24) }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle}>
              <View style={[styles.handleBar, { backgroundColor: c.border }]} />
            </View>
            <View style={[styles.modalHeader, { marginBottom: 8 }]}>
              <View style={[styles.modalIconWrap, { backgroundColor: c.primary + "12" }]}>
                <Feather name="sunset" size={18} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: c.foreground }]}>How was today?</Text>
              </View>
            </View>

            <View style={{ gap: 20, paddingHorizontal: 4 }}>
              <View style={{ gap: 8 }}>
                <Text style={[styles.checkInLabel, { color: c.foreground }]}>Energy</Text>
                <View style={styles.checkInChipRow}>
                  {(["great", "good", "tired", "depleted"] as const).map(v => (
                    <Pressable key={v} onPress={() => { haptic(); setCheckInEnergy(checkInEnergy === v ? null : v); }}
                      style={[styles.checkInChip, { flex: 1, backgroundColor: checkInEnergy === v ? c.primary + "18" : c.background, borderColor: checkInEnergy === v ? c.primary + "40" : c.border + "30" }]}>
                      <Text style={[styles.checkInChipText, { color: checkInEnergy === v ? c.primary : c.foreground }]}>
                        {v === "great" ? "Great" : v === "good" ? "Good" : v === "tired" ? "Tired" : "Low"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ gap: 8 }}>
                <Text style={[styles.checkInLabel, { color: c.foreground }]}>Side effects</Text>
                <View style={styles.checkInChipRow}>
                  {(["none", "mild", "moderate", "rough"] as const).map(v => (
                    <Pressable key={v} onPress={() => { haptic(); setCheckInSideEffects(checkInSideEffects === v ? null : v); }}
                      style={[styles.checkInChip, { flex: 1, backgroundColor: checkInSideEffects === v ? c.primary + "18" : c.background, borderColor: checkInSideEffects === v ? c.primary + "40" : c.border + "30" }]}>
                      <Text style={[styles.checkInChipText, { color: checkInSideEffects === v ? c.primary : c.foreground }]}>
                        {v === "none" ? "None" : v === "mild" ? "Mild" : v === "moderate" ? "Some" : "Rough"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ gap: 8 }}>
                <Text style={[styles.checkInLabel, { color: c.foreground }]}>Protein</Text>
                <View style={styles.checkInChipRow}>
                  {(["good", "okay", "poor"] as const).map(v => (
                    <Pressable key={v} onPress={() => { haptic(); setCheckInProtein(checkInProtein === v ? null : v); }}
                      style={[styles.checkInChip, { flex: 1, backgroundColor: checkInProtein === v ? c.primary + "18" : c.background, borderColor: checkInProtein === v ? c.primary + "40" : c.border + "30" }]}>
                      <Text style={[styles.checkInChipText, { color: checkInProtein === v ? c.primary : c.foreground }]}>
                        {v === "good" ? "Good" : v === "okay" ? "Okay" : "Low"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable
                onPress={() => {
                  if (checkInEnergy) {
                    haptic();
                    saveDailyCheckIn({
                      date: new Date().toISOString().split("T")[0],
                      energy: checkInEnergy,
                      appetite: null,
                      hydration: null,
                      proteinConfidence: checkInProtein ?? null,
                      sideEffects: checkInSideEffects ?? null,
                      movementIntent: null,
                    });
                    setShowCheckIn(false);
                    setCheckInEnergy(null);
                    setCheckInProtein(null);
                    setCheckInSideEffects(null);
                  }
                }}
                style={({ pressed }) => [
                  styles.checkInSubmit,
                  {
                    backgroundColor: checkInEnergy ? c.primary : c.primary + "40",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Feather name="check" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.checkInSubmitText}>Done</Text>
              </Pressable>
            </View>
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

  tagline: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: 0.2,
    opacity: 0.6,
  },
  statusCard: {
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 24,
    marginBottom: 12,
    borderRadius: 20,
    gap: 8,
  },
  statusTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  streakText: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
  },
  progressBarWrap: {
    width: "100%",
    gap: 4,
    marginTop: 4,
  },
  progressBarBg: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  feedbackToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  feedbackText: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    flex: 1,
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
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.3,
  },
  headline: {
    fontSize: 20,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
    lineHeight: 26,
    marginTop: 2,
  },
  driversInline: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    lineHeight: 19,
    marginTop: 4,
    opacity: 0.7,
  },

  feelingRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  feelingChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
  },
  feelingLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
  },

  refineSection: {
    gap: 16,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  refineRow: {
    gap: 10,
  },
  refineLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
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
    fontFamily: "Montserrat_500Medium",
  },

  dayCard: {
    borderRadius: 20,
    padding: 20,
    gap: 2,
    marginBottom: 12,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dayTitle: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.1,
  },
  dayProgress: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
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
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  actionText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
  },
  actionReason: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    marginTop: 2,
    opacity: 0.7,
  },

  checkInButton: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    borderWidth: 1,
  },
  checkInButtonTitle: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
  },
  checkInButtonSub: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    marginTop: 2,
  },
  checkInDone: {
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },
  checkInDoneText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
  },
  checkInLabel: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
  },
  checkInChipRow: {
    flexDirection: "row" as const,
    gap: 8,
  },
  checkInChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  checkInChipText: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
  },
  checkInSubmit: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    marginTop: 4,
  },
  checkInSubmitText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    color: "#fff",
  },

  whyPlanCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  whyPlanHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  whyPlanTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  whyPlanTitle: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
  },
  whyPlanContent: {
    marginTop: 14,
    gap: 10,
  },
  whyPlanText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
  },

  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  metricTile: {
    flex: 1,
    borderRadius: 20,
    padding: 12,
    gap: 4,
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: 0.2,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  metricValue: {
    fontSize: 22,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.5,
  },
  metricUnit: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
  },

  askCard: {
    padding: 20,
    borderRadius: 20,
    gap: 14,
    marginBottom: 12,
  },
  coachInsightText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  chatViewAll: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
    marginTop: 8,
  },
  chatModal: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chatHeaderTitle: {
    fontSize: 17,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  chatList: {
    flex: 1,
  },
  chatListContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  chatInputContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.06)",
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
    fontFamily: "Montserrat_400Regular",
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
    fontFamily: "Montserrat_400Regular",
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
    fontFamily: "Montserrat_500Medium",
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
    fontFamily: "Montserrat_600SemiBold",
  },
  modalInstruction: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    marginTop: 2,
  },
  modalOptions: {
    gap: 10,
  },
  modalOption: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  modalOptionContent: {
    gap: 4,
  },
  modalOptionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalOptionText: {
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
    flex: 1,
  },
  modalOptionSubtitle: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    opacity: 0.7,
  },
  recommendedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  recommendedText: {
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
  supportText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
  },
});
