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
import colors from "@/constants/colors";
import type { ChatMessage } from "@/types";

const quickActions = [
  { label: "Should I work out today?", key: "workout" },
  { label: "Why is my recovery low?", key: "hrv" },
  { label: "What should I eat today?", key: "eat" },
  { label: "Should I fast today?", key: "fast" },
  { label: "Am I overtraining?", key: "overtraining" },
  { label: "Plan my week", key: "week" },
];

const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

export default function CoachScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { chatMessages, addChatMessage, todayMetrics, profile, trends, dailyPlan } = useApp();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const buildHealthContext = useCallback(() => {
    if (!todayMetrics) return undefined;

    const ctx: any = {};

    ctx.todayMetrics = {
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
    };

    ctx.profile = {
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
    };

    if (trends.length > 0) {
      const trendMap: Record<string, string> = {};
      for (const t of trends) {
        trendMap[t.label] = `${t.trend} — ${t.summary}`;
      }
      ctx.recentTrends = {
        weightTrend: trendMap["Weight"] || "unknown",
        hrvTrend: trendMap["HRV"] || "unknown",
        sleepTrend: trendMap["Sleep"] || "unknown",
        stepsTrend: trendMap["Steps"] || "unknown",
      };
    }

    if (dailyPlan) {
      ctx.readinessScore = dailyPlan.readinessScore;
      ctx.readinessLabel = dailyPlan.readinessLabel;
    }

    return ctx;
  }, [todayMetrics, profile, trends, dailyPlan]);

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

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

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
                const botMsg: ChatMessage = {
                  id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                  role: "assistant",
                  content: fullText,
                  timestamp: Date.now(),
                };
                addChatMessage(botMsg);
                setStreamingText("");
                setIsTyping(false);
                return;
              }
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (parseErr) {
              // skip malformed SSE lines
            }
          }
        }
      }

      if (fullText) {
        const botMsg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: fullText,
          timestamp: Date.now(),
        };
        addChatMessage(botMsg);
      }
    } catch (err) {
      console.error("Coach chat error:", err);
      const errorMsg: ChatMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: "I was not able to connect right now. Please try again in a moment.",
        timestamp: Date.now(),
      };
      addChatMessage(errorMsg);
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
              ? { backgroundColor: c.primary, borderBottomRightRadius: 4 }
              : { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderBottomLeftRadius: 4 },
          ]}
        >
          <Text
            style={[
              styles.msgText,
              { color: isUser ? c.primaryForeground : c.foreground },
            ]}
          >
            {item.content}
            {isStreaming ? "▍" : ""}
          </Text>
          {!isStreaming && (
            <Text
              style={[
                styles.msgTime,
                { color: isUser ? c.primaryForeground + "88" : c.mutedForeground },
              ]}
            >
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
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Coach</Text>
        <Text style={[styles.headerSubtitle, { color: c.mutedForeground }]}>
          AI-powered advice based on your data.
        </Text>
      </View>

      {showQuickActions ? (
        <ScrollView style={styles.quickActionsContainer} contentContainerStyle={styles.quickInner} showsVerticalScrollIndicator={false}>
          <Text style={[styles.quickPrompt, { color: c.mutedForeground }]}>
            Ask me anything about your health, training, or nutrition. I have access to all your metrics.
          </Text>
          <View style={styles.quickGrid}>
            {quickActions.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => sendMessage(action.label)}
                style={({ pressed }) => [
                  styles.quickCard,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.quickLabel, { color: c.foreground }]}>{action.label}</Text>
                <Feather name="arrow-right" size={14} color={c.mutedForeground} />
              </Pressable>
            ))}
          </View>
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
              <View style={[styles.msgRow]}>
                <View style={[styles.typingBubble, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={styles.typingDots}>
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground }]} />
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.6 }]} />
                    <View style={[styles.dot, { backgroundColor: c.mutedForeground, opacity: 0.3 }]} />
                  </View>
                </View>
              </View>
            ) : null
          }
        />
      )}

      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: c.background,
            borderTopColor: c.border,
            paddingBottom: bottomPad + 8,
          },
        ]}
      >
        <View style={[styles.inputRow, { backgroundColor: c.card, borderColor: c.border }]}>
          <TextInput
            style={[styles.input, { color: c.foreground }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask your coach..."
            placeholderTextColor={c.mutedForeground}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
            editable={!isTyping}
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={isTyping || !input.trim()}
            style={[styles.sendButton, { backgroundColor: input.trim() && !isTyping ? c.primary : c.muted }]}
          >
            <Feather name="arrow-up" size={18} color={input.trim() && !isTyping ? c.primaryForeground : c.mutedForeground} />
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
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  headerSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  quickActionsContainer: {
    flex: 1,
  },
  quickInner: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  quickPrompt: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  quickGrid: {
    gap: 8,
  },
  quickCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
  },
  quickLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 6,
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
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  msgText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  msgTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    alignSelf: "flex-end",
  },
  typingBubble: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderBottomLeftRadius: 4,
  },
  typingDots: {
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  inputContainer: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    paddingVertical: 12,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
