import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { sendCoachMessage, CoachRequestError, describeCoachError } from "@/lib/api/coachClient";
import type { ChatMessage } from "@/types";

const quickActions = [
  { label: "How should I handle side effects?", icon: "heart" as const },
  { label: "Am I eating enough protein?", icon: "coffee" as const },
  { label: "Should I exercise today?", icon: "target" as const },
  { label: "How can I stay hydrated?", icon: "droplet" as const },
  { label: "What should I focus on this week?", icon: "calendar" as const },
];

export default function CoachScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { chatMessages, addChatMessage, todayMetrics, metrics, profile, trends, dailyPlan, insights, feeling, energy, stress, hydration, trainingIntent, completionHistory, weeklyConsistency, streakDays, glp1Energy, appetite, nausea, digestion, medicationLog, hasHealthData, availableMetricTypes } = useApp();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [lastFailedDraft, setLastFailedDraft] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const topPad = Platform.OS === "web" ? 60 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Dismiss the keyboard when the user navigates away from the coach screen
  // so it doesn't stay focused off-screen on other tabs.
  useFocusEffect(
    useCallback(() => {
      return () => {
        try { inputRef.current?.blur?.(); } catch {}
        Keyboard.dismiss();
      };
    }, []),
  );

  const buildHealthContext = useCallback(() => {
    if (!todayMetrics) return undefined;

    const todayDate = new Date().toISOString().split("T")[0];
    const todayRecord = completionHistory.find(r => r.date === todayDate);
    const todayCompletionRate = todayRecord
      ? Math.round((todayRecord.actions.filter(a => a.completed).length / todayRecord.actions.length) * 100)
      : 0;

    // Tier-gate the biometric block so the coach only sees metrics that are actually
    // backed by data the user has. Wearable-only metrics (HRV/RHR/recovery/strain) are
    // suppressed unless the wearable tier is active and the metric is usable; phone-only
    // metrics are suppressed when their freshness gate fails.
    const tier: "self_report" | "phone_health" | "wearable" =
      dailyPlan?.dataTier ?? (
        availableMetricTypes.some(t => t === "hrv" || t === "restingHeartRate") ? "wearable"
        : availableMetricTypes.some(t => t === "sleep" || t === "steps") ? "phone_health"
        : "self_report"
      );
    const wearableUsable = tier === "wearable" && hasHealthData;
    const phoneUsable = tier !== "self_report" && hasHealthData;
    const unavailableWearable: string[] = [];
    if (typeof todayMetrics.hrv !== "number") unavailableWearable.push("hrv");
    if (typeof todayMetrics.restingHeartRate !== "number") unavailableWearable.push("restingHeartRate");

    return {
      todayMetrics: hasHealthData ? {
        hrv: wearableUsable ? todayMetrics.hrv : null,
        restingHeartRate: wearableUsable ? todayMetrics.restingHeartRate : null,
        sleepDuration: phoneUsable ? todayMetrics.sleepDuration : 0,
        sleepQuality: wearableUsable ? todayMetrics.sleepQuality : null,
        steps: phoneUsable ? todayMetrics.steps : 0,
        recoveryScore: wearableUsable ? todayMetrics.recoveryScore : null,
        weight: todayMetrics.weight,
        strain: wearableUsable ? todayMetrics.strain : null,
        caloriesBurned: phoneUsable ? todayMetrics.caloriesBurned : 0,
        activeCalories: phoneUsable ? todayMetrics.activeCalories : 0,
      } : undefined,
      dataTier: tier,
      recommendationConfidence: dailyPlan?.recommendationConfidence,
      availableMetricTypes,
      unavailableWearableMetrics: tier === "wearable" ? unavailableWearable : ["hrv", "restingHeartRate"],
      basedOn: tier === "self_report" ? "self_report_only" as const : tier === "phone_health" ? "phone_health" as const : "wearable_enhanced" as const,
      profile: {
        age: profile.age,
        sex: profile.sex,
        weight: profile.weight,
        goalWeight: profile.goalWeight,
        goals: profile.goals,
        glp1Medication: profile.glp1Medication,
        glp1Duration: profile.glp1Duration,
        proteinConfidence: profile.proteinConfidence,
        strengthTrainingBaseline: profile.strengthTrainingBaseline,
        availableWorkoutTime: profile.availableWorkoutTime,
        daysAvailableToTrain: profile.daysAvailableToTrain,
      },
      recentTrends: trends.length > 0
        ? {
            weightTrend: trends.find((t) => t.label === "Weight")?.summary || "",
            hrvTrend: trends.find((t) => t.label === "HRV")?.summary || "",
            sleepTrend: trends.find((t) => t.label === "Sleep")?.summary || "",
            stepsTrend: trends.find((t) => t.label === "Steps")?.summary || "",
          }
        : undefined,
      readinessScore: dailyPlan?.readinessScore,
      readinessLabel: dailyPlan?.readinessLabel,
      dailyState: dailyPlan?.dailyState,
      userFeeling: feeling || undefined,
      userEnergy: energy || undefined,
      userStress: stress || undefined,
      userHydration: hydration || undefined,
      userTrainingIntent: trainingIntent || undefined,
      glp1DailyInputs: {
        energy: glp1Energy,
        appetite,
        nausea,
        digestion,
      },
      sleepInsight: hasHealthData && insights?.sleepDebt
        ? `${insights.sleepDebt.hours.toFixed(1)} hours of sleep debt this week. ${insights.sleepDebt.detail}`
        : undefined,
      hrvBaseline: hasHealthData ? insights?.hrvBaseline?.baseline : undefined,
      hrvDeviation: hasHealthData && insights?.hrvBaseline && insights.hrvBaseline.baseline > 0 && typeof todayMetrics.hrv === "number"
        ? Math.round(((todayMetrics.hrv - insights.hrvBaseline.baseline) / insights.hrvBaseline.baseline) * 100)
        : undefined,
      sleepDebt: hasHealthData ? insights?.sleepDebt?.hours : undefined,
      recoveryTrend: hasHealthData ? insights?.recoveryTrend?.direction : undefined,
      weeklyCompletionRate: todayCompletionRate,
      streakDays,
      weeklyConsistency,
      medicationProfile: profile.medicationProfile || undefined,
      recentDoseLog: medicationLog.slice(-5).map(e => ({ date: e.date, status: e.status, doseValue: e.doseValue, doseUnit: e.doseUnit })),
    };
  }, [todayMetrics, metrics, profile, trends, dailyPlan, insights, feeling, energy, stress, hydration, trainingIntent, completionHistory, streakDays, weeklyConsistency, glp1Energy, appetite, nausea, digestion, medicationLog, profile.medicationProfile, hasHealthData, availableMetricTypes]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    addChatMessage(userMsg);
    setInput("");
    setLastFailedDraft(null);

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setIsTyping(true);
    setStreamingText("");
    Keyboard.dismiss();

    const conversationHistory = chatMessages.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let healthContext: unknown;
    try {
      healthContext = buildHealthContext();
    } catch (e: any) {
      if (typeof __DEV__ !== "undefined" && __DEV__) console.log("[Coach] buildHealthContext threw:", e);
      healthContext = undefined;
    }

    try {
      const { content } = await sendCoachMessage({
        message: trimmed,
        healthContext,
        conversationHistory,
      });
      addChatMessage({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.log("[Coach] error:", { kind: err?.kind, status: err?.status, message: err?.message, body: err?.body });
      }
      const userMessage = err instanceof CoachRequestError
        ? describeCoachError(err)
        : `Something went wrong. ${err?.message || ""}`.trim();
      addChatMessage({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: userMessage,
        timestamp: Date.now(),
      });
      setLastFailedDraft(trimmed);
    } finally {
      setStreamingText("");
      setIsTyping(false);
    }
  }, [isTyping, chatMessages, addChatMessage, buildHealthContext]);

  const displayMessages = [...chatMessages];
  if (streamingText) {
    displayMessages.push({
      id: "streaming",
      role: "assistant",
      content: streamingText,
      timestamp: Date.now(),
    });
  }

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";
    const isStreaming = item.id === "streaming";
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        <View
          style={[
            styles.msgBubble,
            isUser
              ? { backgroundColor: c.primary }
              : { backgroundColor: c.card },
          ]}
        >
          <Text style={[styles.msgText, { color: isUser ? c.primaryForeground : c.foreground }]}>
            {item.content}{isStreaming ? "\u258D" : ""}
          </Text>
          {!isStreaming && (
            <Text style={[styles.msgTime, { color: isUser ? c.primaryForeground + "66" : c.mutedForeground }]}>
              {formatTime(item.timestamp)}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const showQuickActions = chatMessages.length === 0 && !isTyping;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Coach</Text>
        <Text style={[styles.headerSub, { color: c.mutedForeground }]}>
          Ask about your treatment, recovery, nutrition, or trends.
        </Text>
      </View>

      {showQuickActions ? (
        <ScrollView style={styles.quickArea} contentContainerStyle={styles.quickInner} showsVerticalScrollIndicator={false}>
          {quickActions.map(({ label, icon }) => (
            <Pressable
              key={label}
              onPress={() => sendMessage(label)}
              style={({ pressed }) => [
                styles.quickBtn,
                { backgroundColor: c.card, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <View style={[styles.quickIconWrap, { backgroundColor: c.accent + "10" }]}>
                <Feather name={icon} size={16} color={c.accent} />
              </View>
              <Text style={[styles.quickLabel, { color: c.foreground }]}>{label}</Text>
              <Feather name="chevron-right" size={14} color={c.mutedForeground + "60"} />
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <FlatList
          ref={flatListRef}
          data={[...displayMessages].reverse()}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          inverted
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            isTyping && !streamingText ? (
              <View style={styles.msgRow}>
                <View style={[styles.typingBubble, { backgroundColor: c.card }]}>
                  <View style={styles.typingDots}>
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.5 }]} />
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.25 }]} />
                  </View>
                </View>
              </View>
            ) : null
          }
        />
      )}

      <View style={[styles.inputArea, { backgroundColor: c.background, paddingBottom: bottomPad + 8 }]}>
        {lastFailedDraft && !isTyping && (
          <Pressable
            onPress={() => sendMessage(lastFailedDraft)}
            style={({ pressed }) => [
              styles.retryBar,
              { backgroundColor: c.card, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="refresh-cw" size={14} color={c.accent} />
            <Text style={{ color: c.accent, fontFamily: "Montserrat_600SemiBold", fontSize: 13, flex: 1 }} numberOfLines={1}>
              Retry: {lastFailedDraft}
            </Text>
            <Pressable onPress={() => { setInput(lastFailedDraft); setLastFailedDraft(null); }} hitSlop={8}>
              <Feather name="edit-2" size={14} color={c.mutedForeground} />
            </Pressable>
          </Pressable>
        )}
        <View style={[styles.inputRow, { backgroundColor: c.card }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: c.foreground }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask your coach..."
            placeholderTextColor={c.mutedForeground + "80"}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
            blurOnSubmit
            editable={!isTyping}
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={isTyping || !input.trim()}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: input.trim() && !isTyping ? c.primary : c.muted, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="arrow-up" size={16} color={input.trim() && !isTyping ? c.primaryForeground : c.mutedForeground} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
    opacity: 0.7,
  },
  retryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  quickArea: { flex: 1 },
  quickInner: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 8,
  },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    gap: 12,
  },
  quickIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 2,
  },
  msgRowUser: {
    flexDirection: "row-reverse",
  },
  msgBubble: {
    maxWidth: "78%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  msgText: {
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 22,
  },
  msgTime: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    marginTop: 6,
    alignSelf: "flex-end",
  },
  typingBubble: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 20,
  },
  typingDots: {
    flexDirection: "row",
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  inputArea: {
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    paddingLeft: 18,
    paddingRight: 5,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
    paddingVertical: 14,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
