import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import type { ChatMessage } from "@/types";

const quickActions = [
  { label: "Should I work out today?", icon: "target" as const },
  { label: "Why is my recovery low?", icon: "heart" as const },
  { label: "What should I eat today?", icon: "coffee" as const },
  { label: "Am I overtraining?", icon: "alert-circle" as const },
  { label: "How should I train this week?", icon: "calendar" as const },
];

const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

export default function CoachScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { chatMessages, addChatMessage, todayMetrics, profile, trends, dailyPlan, insights, feeling, energy, stress, hydration, trainingIntent, completionHistory, weeklyConsistency, streakDays } = useApp();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const topPad = Platform.OS === "web" ? 60 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const buildHealthContext = useCallback(() => {
    if (!todayMetrics) return undefined;

    const todayDate = new Date().toISOString().split("T")[0];
    const todayRecord = completionHistory.find(r => r.date === todayDate);
    const todayCompletionRate = todayRecord
      ? Math.round((todayRecord.actions.filter(a => a.completed).length / todayRecord.actions.length) * 100)
      : 0;

    return {
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
        age: profile.age,
        sex: profile.sex,
        weight: profile.weight,
        goalWeight: profile.goalWeight,
        goals: profile.goals,
        workoutPreference: profile.workoutPreference,
        dietaryPreference: profile.dietaryPreference,
        fastingEnabled: profile.fastingEnabled,
        injuries: profile.injuries,
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
      sleepInsight: insights?.sleepDebt
        ? `${insights.sleepDebt.hours.toFixed(1)} hours of sleep debt this week. ${insights.sleepDebt.detail}`
        : undefined,
      hrvBaseline: insights?.hrvBaseline?.baseline,
      hrvDeviation: insights?.hrvBaseline
        ? Math.round(((todayMetrics.hrv - insights.hrvBaseline.baseline) / insights.hrvBaseline.baseline) * 100)
        : undefined,
      sleepDebt: insights?.sleepDebt?.hours,
      recoveryTrend: insights?.recoveryTrend?.direction,
      weeklyCompletionRate: todayCompletionRate,
      streakDays,
      weeklyConsistency,
    };
  }, [todayMetrics, profile, trends, dailyPlan, insights, feeling, energy, stress, hydration, trainingIntent, completionHistory, streakDays, weeklyConsistency]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: text.trim(),
      timestamp: Date.now(),
    };
    addChatMessage(userMsg);
    setInput("");

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setIsTyping(true);
    setStreamingText("");

    const conversationHistory = chatMessages.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    try {
      const response = await fetch(`${API_BASE}/coach/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          healthContext: buildHealthContext(),
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
                addChatMessage({
                  id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                  role: "assistant",
                  content: fullText,
                  timestamp: Date.now(),
                });
                setStreamingText("");
                setIsTyping(false);
                return;
              }
            } catch {}
          }
        }
      }

      if (fullText) {
        addChatMessage({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: fullText,
          timestamp: Date.now(),
        });
      }
    } catch {
      addChatMessage({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: "I was not able to connect right now. Please try again in a moment.",
        timestamp: Date.now(),
      });
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
          Ask about your training, recovery, nutrition, or trends.
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
              <View style={[styles.quickIconWrap, { backgroundColor: c.primary + "10" }]}>
                <Feather name={icon} size={16} color={c.primary} />
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
        <View style={[styles.inputRow, { backgroundColor: c.card }]}>
          <TextInput
            style={[styles.input, { color: c.foreground }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask your coach..."
            placeholderTextColor={c.mutedForeground + "80"}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
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
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    opacity: 0.7,
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
    fontFamily: "Inter_500Medium",
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
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  msgTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_400Regular",
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
