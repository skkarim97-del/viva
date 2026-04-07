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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ReadinessRing } from "@/components/ReadinessRing";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import type { MetricKey, FeelingType, EnergyLevel, StressLevel, ChatMessage } from "@/types";

const FEELINGS: { key: NonNullable<FeelingType>; label: string }[] = [
  { key: "great", label: "Great" },
  { key: "good", label: "Good" },
  { key: "tired", label: "Tired" },
  { key: "exhausted", label: "Exhausted" },
  { key: "stressed", label: "Stressed" },
];

const ENERGY_LEVELS: { key: NonNullable<EnergyLevel>; label: string }[] = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

const STRESS_LEVELS: { key: NonNullable<StressLevel>; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "moderate", label: "Moderate" },
  { key: "high", label: "High" },
];

const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    todayMetrics, dailyPlan, insights, feeling, setFeeling,
    energy, setEnergy, stress, setStress,
    chatMessages, addChatMessage, profile,
  } = useApp();
  const topPad = Platform.OS === "web" ? 60 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [showAsk, setShowAsk] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showEnergyStress, setShowEnergyStress] = useState(false);

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
    if (newVal && !showEnergyStress) setShowEnergyStress(true);
  };

  const selectEnergy = (e: NonNullable<EnergyLevel>) => {
    haptic();
    setEnergy(energy === e ? null : e);
  };

  const selectStress = (s: NonNullable<StressLevel>) => {
    haptic();
    setStress(stress === s ? null : s);
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
            userFeeling: feeling,
            userEnergy: energy,
            userStress: stress,
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
    { key: "recovery", label: "Recovery", value: `${todayMetrics.recoveryScore}`, unit: "%" },
    { key: "steps", label: "Steps", value: todayMetrics.steps >= 1000 ? `${(todayMetrics.steps / 1000).toFixed(1)}` : `${todayMetrics.steps}`, unit: todayMetrics.steps >= 1000 ? "k" : "" },
    { key: "restingHR", label: "Heart Rate", value: `${todayMetrics.restingHeartRate}`, unit: "bpm" },
  ];

  const focusColor = dailyPlan.dailyFocus.includes("push") || dailyPlan.dailyFocus.includes("performance")
    ? c.success
    : dailyPlan.dailyFocus.includes("recovery")
    ? c.info
    : dailyPlan.dailyFocus.includes("stress")
    ? c.warning
    : c.primary;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <ScrollView
        style={[styles.container, { backgroundColor: c.background }]}
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.statusSection}>
          <ReadinessRing score={dailyPlan.readinessScore} label={dailyPlan.readinessLabel} size={96} />
        </View>

        <View style={styles.feelingSection}>
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
                      backgroundColor: isSelected ? c.primary : c.card,
                      opacity: pressed ? 0.8 : 1,
                      transform: [{ scale: pressed ? 0.95 : 1 }],
                    },
                  ]}
                >
                  <Text style={[styles.feelingLabel, { color: isSelected ? c.primaryForeground : c.foreground }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {showEnergyStress && (
            <View style={styles.subInputs}>
              <View style={styles.subInputRow}>
                <Text style={[styles.subInputLabel, { color: c.mutedForeground }]}>Energy</Text>
                <View style={styles.subChipRow}>
                  {ENERGY_LEVELS.map(({ key, label }) => {
                    const isSelected = energy === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => selectEnergy(key)}
                        style={({ pressed }) => [
                          styles.subChip,
                          {
                            backgroundColor: isSelected ? c.primary : c.card,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.subChipLabel, { color: isSelected ? c.primaryForeground : c.foreground }]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.subInputRow}>
                <Text style={[styles.subInputLabel, { color: c.mutedForeground }]}>Stress</Text>
                <View style={styles.subChipRow}>
                  {STRESS_LEVELS.map(({ key, label }) => {
                    const isSelected = stress === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => selectStress(key)}
                        style={({ pressed }) => [
                          styles.subChip,
                          {
                            backgroundColor: isSelected ? c.primary : c.card,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.subChipLabel, { color: isSelected ? c.primaryForeground : c.foreground }]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.coachingSection}>
          <Text style={[styles.headline, { color: c.foreground }]}>{dailyPlan.headline}</Text>
          <Text style={[styles.summary, { color: c.mutedForeground }]}>{dailyPlan.summary}</Text>
        </View>

        <View style={[styles.focusCard, { backgroundColor: focusColor + "10" }]}>
          <View style={[styles.focusDot, { backgroundColor: focusColor }]} />
          <Text style={[styles.focusText, { color: c.foreground }]}>{dailyPlan.dailyFocus}</Text>
        </View>

        <View style={[styles.planCard, { backgroundColor: c.card }]}>
          <Text style={[styles.planTitle, { color: c.foreground }]}>Today's Plan</Text>
          <View style={[styles.planDivider, { backgroundColor: c.border }]} />
          <PlanRow icon="target" iconColor={c.primary} label="Workout" value={dailyPlan.todaysPlan.workout} foreground={c.foreground} muted={c.mutedForeground} />
          <PlanRow icon="navigation" iconColor={c.accent} label="Movement" value={dailyPlan.todaysPlan.movement} foreground={c.foreground} muted={c.mutedForeground} />
          <PlanRow icon="coffee" iconColor={c.warning} label="Nutrition" value={dailyPlan.todaysPlan.nutrition} foreground={c.foreground} muted={c.mutedForeground} />
          <PlanRow icon="moon" iconColor={c.info} label="Recovery & Mind" value={dailyPlan.todaysPlan.recoveryMind} foreground={c.foreground} muted={c.mutedForeground} />
        </View>

        <View style={styles.whySection}>
          <Text style={[styles.whyTitle, { color: c.mutedForeground }]}>Why this plan</Text>
          {dailyPlan.whyThisPlan.slice(0, 3).map((reason, i) => (
            <View key={i} style={styles.whyRow}>
              <View style={[styles.whyDot, { backgroundColor: c.primary + "40" }]} />
              <Text style={[styles.whyText, { color: c.foreground }]}>{reason}</Text>
            </View>
          ))}
        </View>

        {insights?.sleepIntelligence && (
          <View style={[styles.sleepCard, { backgroundColor: c.card }]}>
            <View style={styles.sleepHeader}>
              <Feather name="moon" size={14} color={c.info} />
              <Text style={[styles.sleepTitle, { color: c.foreground }]}>Sleep Intelligence</Text>
            </View>
            <Text style={[styles.sleepInsight, { color: c.foreground }]}>{insights.sleepIntelligence.insight}</Text>
            <Text style={[styles.sleepRec, { color: c.mutedForeground }]}>{insights.sleepIntelligence.recommendation}</Text>
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
            <Text style={[styles.askSub, { color: c.mutedForeground }]}>Follow up on your plan, sleep, stress, or nutrition</Text>
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
                placeholder="Ask about today's plan..."
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
    </KeyboardAvoidingView>
  );
}

function PlanRow({ icon, iconColor, label, value, foreground, muted }: {
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  label: string;
  value: string;
  foreground: string;
  muted: string;
}) {
  return (
    <View style={styles.planRow}>
      <View style={[styles.planIconWrap, { backgroundColor: iconColor + "12" }]}>
        <Feather name={icon} size={15} color={iconColor} />
      </View>
      <View style={styles.planRowContent}>
        <Text style={[styles.planRowLabel, { color: muted }]}>{label}</Text>
        <Text style={[styles.planRowValue, { color: foreground }]}>{value}</Text>
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

  statusSection: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
    marginBottom: 16,
  },

  feelingSection: {
    marginBottom: 24,
    gap: 10,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  feelingLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  subInputs: {
    gap: 10,
    marginTop: 4,
  },
  subInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  subInputLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    width: 50,
    textAlign: "right",
  },
  subChipRow: {
    flexDirection: "row",
    gap: 6,
  },
  subChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  subChipLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },

  coachingSection: {
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  headline: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 26,
    letterSpacing: -0.4,
    paddingHorizontal: 20,
  },
  summary: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
    opacity: 0.8,
  },

  focusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 24,
    alignSelf: "center",
  },
  focusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  focusText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.1,
  },

  planCard: {
    borderRadius: 20,
    padding: 20,
    gap: 16,
    marginBottom: 24,
  },
  planTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.1,
  },
  planDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: -4,
  },
  planRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  planIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planRowContent: {
    flex: 1,
    gap: 2,
    paddingTop: 2,
  },
  planRowLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  planRowValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },

  whySection: {
    paddingHorizontal: 4,
    gap: 10,
    marginBottom: 24,
  },
  whyTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  whyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  whyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  whyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    flex: 1,
    opacity: 0.75,
  },

  sleepCard: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
    marginBottom: 20,
  },
  sleepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sleepTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  sleepInsight: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  sleepRec: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    opacity: 0.7,
  },

  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  metricTile: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
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
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginBottom: 8,
  },
  askIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
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
    borderRadius: 16,
    padding: 12,
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
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 4,
  },
  askInputField: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingVertical: 10,
  },
  askSendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  askSuggestionText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
