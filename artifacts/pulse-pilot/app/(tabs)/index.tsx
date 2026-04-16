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

import { InputRow } from "@/components/InputRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { generateCoachInsight } from "@/data/insights";
import { formatDoseDisplay, getDoseOptions, type MedicationBrand } from "@/data/medicationData";
import { generateGreeting, generateInputSummary, buildCoachContext } from "@/lib/engine";
import { useColors } from "@/hooks/useColors";
import { CATEGORY_OPTIONS } from "@/types";
import type { MetricKey, FeelingType, ChatMessage, DailyStatusLabel, ActionCategory, AppetiteLevel, NauseaLevel, DigestionStatus, EnergyDaily, MedicationLogEntry, MentalState } from "@/types";

const TINT_GREEN = "#34C759";
const TINT_BLUE = "#38B6FF";
const TINT_PURPLE = "#AF52DE";
const TINT_RED = "#FF6B6B";
const TINT_MUTED = "#8E8E93";

const ENERGY_OPTIONS: { key: NonNullable<EnergyDaily>; label: string; tint: string }[] = [
  { key: "great", label: "Great", tint: TINT_GREEN },
  { key: "good", label: "Good", tint: TINT_BLUE },
  { key: "tired", label: "Tired", tint: TINT_PURPLE },
  { key: "depleted", label: "Depleted", tint: TINT_RED },
];

const APPETITE_OPTIONS: { key: NonNullable<AppetiteLevel>; label: string; tint: string }[] = [
  { key: "strong", label: "Strong", tint: TINT_GREEN },
  { key: "normal", label: "Normal", tint: TINT_BLUE },
  { key: "low", label: "Low", tint: TINT_PURPLE },
  { key: "very_low", label: "Very Low", tint: TINT_RED },
];

const NAUSEA_OPTIONS: { key: NonNullable<NauseaLevel>; label: string; tint: string }[] = [
  { key: "none", label: "None", tint: TINT_GREEN },
  { key: "mild", label: "Mild", tint: TINT_BLUE },
  { key: "moderate", label: "Moderate", tint: TINT_PURPLE },
  { key: "severe", label: "Severe", tint: TINT_RED },
];

const DIGESTION_OPTIONS: { key: NonNullable<DigestionStatus>; label: string; tint: string }[] = [
  { key: "fine", label: "Fine", tint: TINT_GREEN },
  { key: "bloated", label: "Bloated", tint: TINT_BLUE },
  { key: "constipated", label: "Constip.", tint: TINT_PURPLE },
  { key: "diarrhea", label: "Diarrhea", tint: TINT_RED },
];

const STATUS_COLOR_MAP: Record<DailyStatusLabel, (c: ReturnType<typeof useColors>) => string> = {
  "You're in a good place today": (c) => c.success,
  "A few small adjustments will help today": (c) => c.accent,
  "Let's make today a bit easier": (c) => c.warning,
  "Your body may need more support today": (c) => c.destructive,
};

import { API_BASE } from "@/lib/apiConfig";

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    todayMetrics, dailyPlan, insights, feeling, setFeeling,
    energy, setEnergy, stress, setStress,
    hydration, setHydration,
    trainingIntent, setTrainingIntent,
    chatMessages, addChatMessage, profile, updateProfile,
    toggleAction, editAction, weeklyConsistency,
    metrics, completionHistory,
    streakDays, todayCompletionRate,
    lastCompletionFeedback, clearCompletionFeedback,
    saveDailyCheckIn, todayCheckIn,
    appetite, setAppetite,
    nausea, setNausea,
    digestion, setDigestion,
    glp1Energy, setGlp1Energy,
    medicationLog, logMedicationDose, removeMedicationDose,
    adaptiveInsights,
    hasHealthData,
    availableMetricTypes,
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
  const [checkInMental, setCheckInMental] = useState<MentalState>(null);
  const [showDoseIncrease, setShowDoseIncrease] = useState(false);
  const [doseIncreaseStep, setDoseIncreaseStep] = useState<"ask" | "details">("ask");
  const [selectedPrevDose, setSelectedPrevDose] = useState<number | null>(null);
  const [selectedNewDose, setSelectedNewDose] = useState<number | null>(null);
  const [selectedDoseDate, setSelectedDoseDate] = useState<string>("today");
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

  const greetingText = React.useMemo(() => generateGreeting(profile), [profile?.name]);

  const coachInsight = React.useMemo(() => {
    if (!todayMetrics || metrics.length === 0 || !hasHealthData) return "";
    return generateCoachInsight(todayMetrics, metrics, {
      feeling, energy, stress, hydration, trainingIntent, completionHistory,
    });
  }, [todayMetrics, metrics, feeling, energy, stress, hydration, trainingIntent, completionHistory, hasHealthData]);

  const inputSummaryResult = React.useMemo(() => generateInputSummary({
    energy: glp1Energy, appetite, nausea, digestion,
  }), [glp1Energy, appetite, nausea, digestion]);
  const inputSummary = inputSummaryResult.text || null;

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const openMetric = (key: MetricKey) => {
    haptic();
    router.push({ pathname: "/metric-detail", params: { key } });
  };

  const selectAppetite = (a: NonNullable<AppetiteLevel>) => {
    setAppetite(appetite === a ? null : a);
  };

  const selectNausea = (n: NonNullable<NauseaLevel>) => {
    setNausea(nausea === n ? null : n);
  };

  const selectDigestion = (d: NonNullable<DigestionStatus>) => {
    setDigestion(digestion === d ? null : d);
  };

  const selectGlp1Energy = (e: NonNullable<EnergyDaily>) => {
    setGlp1Energy(glp1Energy === e ? null : e);
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

    // Native fetch on iOS/Android cannot consume SSE reliably. Use non-streaming JSON
    // on native, streaming on web (matches coach.tsx behavior).
    const useStream = Platform.OS === "web";
    const fetchUrl = useStream ? `${API_BASE}/coach/chat` : `${API_BASE}/coach/chat?stream=false`;
    console.log("[Coach] Fetching:", fetchUrl, "useStream:", useStream);

    try {
      const response = await fetch(fetchUrl, {
        method: "POST",
        headers: useStream
          ? { "Content-Type": "application/json" }
          : { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          healthContext: buildCoachContext(
            todayMetrics, metrics, profile, dailyPlan, insights,
            medicationLog,
            { energy: glp1Energy, appetite, nausea, digestion },
            { feeling, energy, stress, hydration, trainingIntent },
            streakDays, weeklyConsistency, todayCompletionRate,
          ),
          conversationHistory,
        }),
      });

      if (!response.ok) {
        let errorBody = "";
        try { errorBody = await response.text(); } catch {}
        console.log("[Coach] HTTP error", response.status, errorBody);
        throw { status: response.status, body: errorBody };
      }

      if (!useStream) {
        const data = await response.json();
        const fullText: string = typeof data?.content === "string" ? data.content : "";
        if (!fullText) throw new Error("Empty response from server");
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
    } catch (err: any) {
      console.log("[Coach] Full error:", err);
      console.log("[Coach] Error message:", err?.message);
      console.log("[Coach] Error status:", err?.status);
      console.log("[Coach] Error body:", err?.body);

      let userMessage = "Something went wrong. Try again in a moment.";
      if (err?.message === "Network request failed" || err?.message?.includes("network") || err?.message?.includes("fetch")) {
        userMessage = "Network error. Check your connection and try again.";
      } else if (err?.status === 500) {
        userMessage = `Server error (500). ${err?.body || "The AI service may be temporarily unavailable."}`;
      } else if (err?.status === 401 || err?.status === 403) {
        userMessage = "Configuration error. The AI service is not properly set up.";
      } else if (err?.status === 429) {
        userMessage = "Rate limited. Wait a moment and try again.";
      } else if (err?.status) {
        userMessage = `Server returned ${err.status}. ${err?.body || ""}`;
      } else if (err?.message) {
        userMessage = `Error: ${err.message}`;
      }

      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        role: "assistant",
        content: userMessage,
        timestamp: Date.now(),
      };
      setAskMessages((prev) => [...prev, errorMsg]);
    } finally {
      setStreamingText("");
      setIsTyping(false);
    }
  };

  const allMetricItems: { key: MetricKey; label: string; value: string; unit: string; requiredType: string }[] = [
    { key: "sleep", label: "Sleep", value: todayMetrics.sleepDuration.toFixed(1), unit: "hrs", requiredType: "sleep" },
    { key: "steps", label: "Steps", value: todayMetrics.steps >= 1000 ? `${(todayMetrics.steps / 1000).toFixed(1)}` : `${todayMetrics.steps}`, unit: todayMetrics.steps >= 1000 ? "k" : "", requiredType: "steps" },
    { key: "restingHR", label: "Heart Rate", value: `${todayMetrics.restingHeartRate}`, unit: "bpm", requiredType: "heartRate" },
    { key: "hrv", label: "HRV", value: `${todayMetrics.hrv}`, unit: "ms", requiredType: "hrv" },
  ];
  const metricItems = allMetricItems.filter(item => availableMetricTypes.includes(item.requiredType as any));

  const statusColor = STATUS_COLOR_MAP[dailyPlan.statusLabel](c);

  const hasMedProfile = !!profile.medicationProfile;
  const ACTION_META: Record<string, { label: string; icon: keyof typeof Feather.glyphMap; color: string }> = {
    move: { label: "Move", icon: "activity", color: c.primary },
    fuel: { label: "Fuel", icon: "coffee", color: c.warning },
    hydrate: { label: "Hydrate", icon: "droplet", color: "#5AC8FA" },
    recover: { label: "Recover", icon: "battery-charging", color: c.info },
  };

  const planActions = dailyPlan.actions.filter(a => a.category !== "consistent");
  const completedCount = planActions.filter(a => a.completed).length;
  const totalActions = planActions.length;

  const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
  const getWeekDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    return WEEK_DAYS.map((label, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const isToday = dateStr === today.toISOString().split("T")[0];
      const isFuture = d > today && !isToday;
      return { label, dateStr, isToday, isFuture, dayNum: d.getDate() };
    });
  };
  const weekDates = getWeekDates();
  const weekStartStr = weekDates[0].dateStr;
  const weekEndStr = weekDates[6].dateStr;
  const thisWeekDoseEntry = medicationLog.find(e => e.date >= weekStartStr && e.date <= weekEndStr && e.status === "taken");
  const todayDateStr = new Date().toISOString().split("T")[0];
  const todayDoseEntry = medicationLog.find(e => e.date === todayDateStr && e.status === "taken");

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
          {streakDays > 0 && (
            <View style={styles.streakRow}>
              <View style={[styles.streakBadge, { backgroundColor: c.warning + "14" }]}>
                <Feather name="zap" size={12} color={c.warning} />
                <Text style={[styles.streakText, { color: c.warning }]}>{streakDays}d streak</Text>
              </View>
            </View>
          )}
          <View style={styles.statusTopRow}>
            <View style={[styles.statusIndicator, { backgroundColor: statusColor + "14" }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusLabel, { color: statusColor }]}>{dailyPlan.statusLabel}</Text>
            </View>
          </View>
          <Text style={[styles.headline, { color: c.foreground }]} numberOfLines={2} adjustsFontSizeToFit>{dailyPlan.headline}</Text>
          <Text style={[styles.driversInline, { color: c.mutedForeground }]} numberOfLines={2}>
            {dailyPlan.statusDrivers.join(" · ")}
          </Text>
          {todayCompletionRate > 0 && (
            <View style={styles.progressBarWrap}>
              <View style={[styles.progressBarBg, { backgroundColor: c.border + "40" }]}>
                <View style={[styles.progressBarFill, { backgroundColor: c.success, width: `${todayCompletionRate}%` }]} />
              </View>
            </View>
          )}
        </View>

        {profile.medicationProfile && (() => {
          const mp = profile.medicationProfile!;
          const isWeekly = mp.frequency !== "daily";
          const isDaily = mp.frequency === "daily";
          const medDisplay = formatDoseDisplay(mp.medicationBrand, mp.doseValue, mp.doseUnit, mp.frequency as "weekly" | "daily");

          const handleLogDay = (dateStr: string) => {
            haptic();
            if (thisWeekDoseEntry && thisWeekDoseEntry.date === dateStr) {
              removeMedicationDose(thisWeekDoseEntry.id);
              return;
            }
            if (thisWeekDoseEntry) {
              removeMedicationDose(thisWeekDoseEntry.id);
            }
            logMedicationDose({
              id: `dose_${Date.now()}`,
              date: dateStr,
              medicationBrand: mp.medicationBrand,
              status: "taken",
              doseValue: mp.doseValue,
              doseUnit: mp.doseUnit,
              timestamp: Date.now(),
            });
          };

          const handleLogToday = () => {
            if (todayDoseEntry) return;
            haptic();
            logMedicationDose({
              id: `dose_${Date.now()}`,
              date: todayDateStr,
              medicationBrand: mp.medicationBrand,
              status: "taken",
              doseValue: mp.doseValue,
              doseUnit: mp.doseUnit,
              timestamp: Date.now(),
            });
          };

          const selectedDayLabel = thisWeekDoseEntry
            ? new Date(thisWeekDoseEntry.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })
            : null;

          return (
            <View style={[styles.treatmentCard, { backgroundColor: c.card }]}>
              <View style={styles.treatmentHeader}>
                <View style={styles.treatmentTitleRow}>
                  <Feather name="shield" size={14} color={c.accent} />
                  <Text style={[styles.treatmentTitle, { color: c.foreground }]}>Your Treatment</Text>
                </View>
                {mp.recentTitration && (
                  <View style={[styles.titrationBadge, { backgroundColor: "#FF950018" }]}>
                    <Text style={[styles.titrationText, { color: "#FF9500" }]}>Titrated</Text>
                  </View>
                )}
              </View>

              <Text style={[styles.treatmentMedName, { color: c.foreground }]}>{medDisplay}</Text>

              {isWeekly && (
                <View style={styles.treatmentWeekly}>
                  <View style={styles.weekDayRow}>
                    {weekDates.map((day) => {
                      const isSelected = thisWeekDoseEntry?.date === day.dateStr;
                      const isPast = !day.isFuture && !day.isToday;
                      return (
                        <Pressable
                          key={day.dateStr}
                          onPress={() => handleLogDay(day.dateStr)}
                          style={({ pressed }) => [
                            styles.weekDayBtn,
                            {
                              backgroundColor: isSelected ? c.accent : day.isToday ? c.accent + "12" : "transparent",
                              borderColor: day.isToday && !isSelected ? c.accent + "40" : "transparent",
                              borderWidth: day.isToday && !isSelected ? 1 : 0,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          <Text style={[
                            styles.weekDayLabel,
                            { color: isSelected ? "#FFFFFF" : isPast ? c.mutedForeground : c.foreground },
                          ]}>{day.label}</Text>
                          <Text style={[
                            styles.weekDayNum,
                            { color: isSelected ? "#FFFFFF" : isPast ? c.mutedForeground : c.foreground },
                          ]}>{day.dayNum}</Text>
                          {isSelected && (
                            <Feather name="check" size={10} color="#FFFFFF" style={{ marginTop: 1 }} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.treatmentStatus}>
                    {thisWeekDoseEntry ? (
                      <>
                        <Feather name="check-circle" size={13} color={c.success} />
                        <Text style={[styles.treatmentStatusText, { color: c.success }]}>
                          Dose logged this week
                        </Text>
                        <Text style={[styles.treatmentStatusSub, { color: c.mutedForeground }]}>
                          Taken on {selectedDayLabel}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Feather name="circle" size={13} color={c.mutedForeground} />
                        <Text style={[styles.treatmentStatusText, { color: c.mutedForeground }]}>
                          Not logged yet this week
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              )}

              {isDaily && (
                <View style={styles.treatmentDaily}>
                  {todayDoseEntry ? (
                    <Pressable
                      onPress={() => { haptic(); removeMedicationDose(todayDoseEntry.id); }}
                      style={({ pressed }) => [styles.dailyLoggedRow, { backgroundColor: c.success + "0A", opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Feather name="check-circle" size={15} color={c.success} />
                      <Text style={[styles.dailyLoggedText, { color: c.success }]}>Taken today</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={handleLogToday}
                      style={({ pressed }) => [
                        styles.dailyLogBtn,
                        { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
                      ]}
                    >
                      <Feather name="plus" size={14} color="#FFFFFF" />
                      <Text style={styles.dailyLogBtnText}>Log today's dose</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <View style={[styles.doseChangeDivider, { borderTopColor: c.border + "30" }]}>
                {mp.recentTitration && mp.doseChangeDate ? (
                  <View style={styles.doseChangeStatus}>
                    <Feather name="check-circle" size={12} color={c.success} />
                    <Text style={[styles.doseChangeStatusText, { color: c.mutedForeground }]}>
                      {mp.previousDoseValue
                        ? `${mp.previousDoseValue} ${mp.previousDoseUnit ?? mp.doseUnit} \u2192 ${mp.doseValue} ${mp.doseUnit}`
                        : `Dose increase logged (now ${mp.doseValue} ${mp.doseUnit})`}
                    </Text>
                    <Pressable
                      onPress={() => {
                        haptic();
                        updateProfile({
                          medicationProfile: {
                            ...mp,
                            recentTitration: false,
                            previousDoseValue: null,
                            previousDoseUnit: null,
                            previousFrequency: null,
                            doseChangeDate: null,
                          },
                        });
                      }}
                      hitSlop={8}
                      accessibilityLabel="Dismiss dose increase"
                    >
                      <Feather name="x" size={14} color={c.mutedForeground} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      haptic();
                      setDoseIncreaseStep("ask");
                      setSelectedPrevDose(null);
                      setSelectedNewDose(null);
                      setSelectedDoseDate("today");
                      setShowDoseIncrease(true);
                    }}
                    style={({ pressed }) => [styles.doseChangeBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Feather name="trending-up" size={13} color={c.accent} />
                    <Text style={[styles.doseChangeBtnText, { color: c.accent }]}>Did your dose increase?</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })()}

        {adaptiveInsights.length > 0 && (
          <View style={[styles.insightsCard, { backgroundColor: c.card }]}>
            <View style={styles.insightsHeader}>
              <Feather name="trending-up" size={14} color={c.accent} />
              <Text style={[styles.insightsTitle, { color: c.foreground }]}>{hasHealthData ? "Based on Your Data" : "Based on Your Check-ins"}</Text>
            </View>
            {adaptiveInsights.slice(0, 3).map((insight) => (
              <View key={insight.id} style={styles.insightRow}>
                <Feather
                  name={insight.type === "post_dose" ? "clock" : insight.type === "correlation" ? "link" : insight.type === "trend" ? "trending-up" : "zap"}
                  size={12}
                  color={c.accent}
                  style={{ marginTop: 2 }}
                />
                <Text style={[styles.insightText, { color: c.mutedForeground }]}>{insight.text}</Text>
              </View>
            ))}
          </View>
        )}

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
                          {msg.content.split(/\n\n+/).map((para: string, pi: number) => (
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

        <View style={[styles.inputContainer, { backgroundColor: c.card }]}>
          <View style={styles.inputHeader}>
            <Feather name="edit-3" size={14} color={c.accent} />
            <Text style={[styles.inputTitle, { color: c.foreground }]}>How are things today?</Text>
          </View>
          {inputSummary ? (
            <Text style={[styles.inputSummaryText, { color: c.mutedForeground }]}>{inputSummary}</Text>
          ) : null}
          <View style={styles.inputRows}>
            <InputRow label="Energy" options={ENERGY_OPTIONS} selected={glp1Energy} onSelect={selectGlp1Energy} containerBg={c.background} />
            <InputRow label="Appetite" options={APPETITE_OPTIONS} selected={appetite} onSelect={selectAppetite} containerBg={c.background} />
            <InputRow label="Nausea" options={NAUSEA_OPTIONS} selected={nausea} onSelect={selectNausea} containerBg={c.background} />
            <InputRow label="Digestion" options={DIGESTION_OPTIONS} selected={digestion} onSelect={selectDigestion} containerBg={c.background} />
          </View>
        </View>

        <View style={[styles.dayCard, { backgroundColor: c.card }]}>
          <View style={styles.dayHeader}>
            <Text style={[styles.dayTitle, { color: c.foreground }]}>Your Plan</Text>
            <Text style={[styles.dayProgress, { color: c.mutedForeground }]}>
              {completedCount}/{totalActions}
            </Text>
          </View>
          {planActions.map((action) => {
            const meta = ACTION_META[action.category];

            return (
              <View key={action.id} style={[
                styles.actionRow,
                { backgroundColor: action.completed ? c.success + "0A" : "transparent" },
              ]}>
                <Pressable
                  onPress={() => {
                    haptic();
                    toggleAction(action.id);
                  }}
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
                  onPress={() => {
                    haptic();
                    setEditingAction(action.category);
                  }}
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

        <View style={[styles.askCard, { backgroundColor: c.card }]}>
          {coachInsight ? (
            <View style={{ gap: 6 }}>
              <View style={styles.insightsHeader}>
                <Feather name="message-circle" size={14} color={c.accent} />
                <Text style={[styles.insightsTitle, { color: c.foreground }]}>Your Coach</Text>
              </View>
              <Text style={[styles.coachInsightText, { color: c.foreground }]}>
                {coachInsight}
              </Text>
            </View>
          ) : null}

          {askMessages.length > 0 && !showChat && (
            <Pressable onPress={() => setShowChat(true)}>
              <View style={[styles.askBubble, { backgroundColor: c.background }]}>
                <Text style={[styles.askMsgText, { color: c.foreground }]} numberOfLines={2}>
                  {askMessages[askMessages.length - 1].content}
                </Text>
              </View>
              <Text style={[styles.chatViewAll, { color: c.accent }]}>View conversation</Text>
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
                <Feather name="info" size={14} color={c.accent} />
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
              { backgroundColor: c.card, borderColor: c.accent + "30", opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="sunset" size={16} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.checkInButtonTitle, { color: c.foreground }]}>How are you feeling mentally?</Text>
              <Text style={[styles.checkInButtonSub, { color: c.mutedForeground }]}>Takes 5 seconds</Text>
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

        {hasHealthData && metricItems.length > 0 ? (
          <View>
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
            {metricItems.length < allMetricItems.length && (
              <Text style={[styles.partialDataNote, { color: c.mutedForeground }]}>
                Some metrics require Apple Watch or manual entry
              </Text>
            )}
          </View>
        ) : (
          <View style={[styles.emptyHealthCard, { backgroundColor: c.card }]}>
            <View style={[styles.emptyHealthIconWrap, { backgroundColor: c.accent + "12" }]}>
              <Feather name="heart" size={20} color={c.accent} />
            </View>
            <Text style={[styles.emptyHealthTitle, { color: c.foreground }]}>Connect Apple Health</Text>
            <Text style={[styles.emptyHealthDesc, { color: c.mutedForeground }]}>
              Unlock passive insights like sleep, steps, and heart rate. Your recommendations will become more personalized over time.
            </Text>
            <Pressable
              onPress={() => { haptic(); router.push("/(tabs)/settings"); }}
              style={({ pressed }) => [styles.emptyHealthBtn, { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="settings" size={13} color="#FFFFFF" />
              <Text style={styles.emptyHealthBtnText}>Open Settings</Text>
            </Pressable>
            <Text style={[styles.emptyHealthNote, { color: c.mutedForeground }]}>
              Using daily check-ins for your plan
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={editingAction !== null && editingAction !== "consistent"}
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
              const recommendedOption = options.find(o => o.title === currentAction?.recommended);
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
                      const isBestMatch = option.title === currentAction?.recommended;
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
                            {isBestMatch && !isSelected && (
                              <View style={[styles.recommendedBadge, { backgroundColor: c.success + "14" }]}>
                                <Feather name="zap" size={10} color={c.success} />
                                <Text style={[styles.recommendedText, { color: c.success }]}>Best match today</Text>
                              </View>
                            )}
                            {isBestMatch && isSelected && currentAction?.reason && (
                              <Text style={[styles.modalOptionReason, { color: c.mutedForeground }]}>{currentAction.reason}</Text>
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
        onRequestClose={() => { setShowCheckIn(false); setCheckInMental(null); }}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { setShowCheckIn(false); setCheckInMental(null); }}>
          <Pressable style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: Math.max(bottomPad, 24) }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle}>
              <View style={[styles.handleBar, { backgroundColor: c.border }]} />
            </View>
            <View style={[styles.modalHeader, { marginBottom: 8 }]}>
              <View style={[styles.modalIconWrap, { backgroundColor: c.accent + "12" }]}>
                <Feather name="sunset" size={18} color={c.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: c.foreground }]}>How are you feeling mentally?</Text>
              </View>
            </View>

            <View style={{ gap: 20, paddingHorizontal: 4 }}>
              <InputRow
                label="MENTAL STATE"
                options={[
                  { key: "focused" as const, label: "Focused", tint: TINT_GREEN },
                  { key: "good" as const, label: "Good", tint: TINT_BLUE },
                  { key: "low" as const, label: "Low", tint: TINT_PURPLE },
                  { key: "burnt_out" as const, label: "Burnt out", tint: TINT_RED },
                ]}
                selected={checkInMental}
                onSelect={(v) => setCheckInMental(checkInMental === v ? null : v)}
              />

              <Pressable
                onPress={() => {
                  if (checkInMental) {
                    haptic();
                    saveDailyCheckIn({
                      date: new Date().toISOString().split("T")[0],
                      mentalState: checkInMental,
                    });
                    setShowCheckIn(false);
                    setCheckInMental(null);
                  }
                }}
                style={({ pressed }) => [
                  styles.checkInSubmit,
                  {
                    backgroundColor: checkInMental ? c.primary : c.primary + "40",
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

      {profile.medicationProfile && (
        <Modal
          visible={showDoseIncrease}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDoseIncrease(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowDoseIncrease(false)}>
            <Pressable style={[styles.modalSheet, { backgroundColor: c.card, paddingBottom: Math.max(bottomPad, 24) }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHandle}>
                <View style={[styles.handleBar, { backgroundColor: c.border }]} />
              </View>
              <View style={styles.modalHeader}>
                <View style={[styles.modalIconWrap, { backgroundColor: "#FF950018" }]}>
                  <Feather name="trending-up" size={18} color="#FF9500" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: c.foreground }]}>Dose Increase</Text>
                  <Text style={[styles.modalInstruction, { color: c.mutedForeground }]}>
                    {doseIncreaseStep === "ask"
                      ? "This helps us adjust your support during the transition."
                      : "Select your previous dose so we can tailor your plan."}
                  </Text>
                </View>
              </View>

              {doseIncreaseStep === "ask" && (
                <View style={styles.modalOptions}>
                  <Pressable
                    onPress={() => {
                      haptic();
                      setDoseIncreaseStep("details");
                    }}
                    style={({ pressed }) => [
                      styles.modalOption,
                      { borderColor: c.accent + "40", backgroundColor: c.accent + "08", opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <View style={styles.modalOptionContent}>
                      <View style={styles.modalOptionTitleRow}>
                        <Text style={[styles.modalOptionText, { color: c.foreground }]}>Yes, my dose increased</Text>
                        <Feather name="chevron-right" size={16} color={c.mutedForeground} />
                      </View>
                      <Text style={[styles.modalOptionSubtitle, { color: c.mutedForeground }]}>
                        We will adjust your plan for the transition
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      haptic();
                      setShowDoseIncrease(false);
                    }}
                    style={({ pressed }) => [
                      styles.modalOption,
                      { borderColor: c.border + "40", opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <View style={styles.modalOptionContent}>
                      <Text style={[styles.modalOptionText, { color: c.foreground }]}>No, staying at the same dose</Text>
                    </View>
                  </Pressable>
                </View>
              )}

              {doseIncreaseStep === "details" && (() => {
                const mp = profile.medicationProfile!;
                const brandKey = mp.medicationBrand.toLowerCase() as MedicationBrand;
                const allDoses = getDoseOptions(brandKey);
                const isOther = brandKey === "other" || allDoses.length === 0;

                const computeDateStr = (key: string): string => {
                  const d = new Date();
                  if (key === "yesterday") d.setDate(d.getDate() - 1);
                  else if (key === "this_week") d.setDate(d.getDate() - 4);
                  else if (key === "over_week") d.setDate(d.getDate() - 10);
                  return d.toISOString().split("T")[0];
                };

                const DATE_OPTIONS: { key: string; label: string }[] = [
                  { key: "today", label: "Today" },
                  { key: "yesterday", label: "Yesterday" },
                  { key: "this_week", label: "This week" },
                  { key: "over_week", label: "Over a week ago" },
                ];

                const currentIdx = allDoses.findIndex(d => d.value === mp.doseValue);
                const nearbyPrev = (() => {
                  if (isOther) return [];
                  const idx = currentIdx >= 0 ? currentIdx : allDoses.length - 1;
                  const start = Math.max(0, idx - 2);
                  return allDoses.slice(start, idx + 1).slice(-3);
                })();

                const nearbyNew = (() => {
                  if (isOther || selectedPrevDose === null) return [];
                  if (selectedPrevDose === -1) {
                    const idx = currentIdx >= 0 ? currentIdx : 0;
                    return allDoses.slice(idx, idx + 2);
                  }
                  const prevIdx = allDoses.findIndex(d => d.value === selectedPrevDose);
                  if (prevIdx < 0) return allDoses.slice(0, 2);
                  return allDoses.slice(prevIdx + 1, prevIdx + 3);
                })();

                const SAME_DOSE = -2;
                const isSameDose = selectedNewDose === SAME_DOSE;

                const canSave = isOther
                  ? (selectedPrevDose !== null && selectedPrevDose > 0 && selectedNewDose !== null && selectedNewDose > selectedPrevDose)
                  : selectedPrevDose !== null && selectedNewDose !== null;

                const renderPill = (
                  value: number,
                  label: string,
                  isSelected: boolean,
                  onPress: () => void,
                  variant: "accent" | "primary" = "accent",
                ) => {
                  const bg = variant === "accent" ? c.accent : c.primary;
                  return (
                    <Pressable
                      key={value}
                      onPress={onPress}
                      style={[
                        styles.dosePill,
                        {
                          backgroundColor: isSelected ? bg : bg + "0A",
                          borderColor: isSelected ? bg : c.border + "40",
                        },
                      ]}
                    >
                      <Text style={[
                        styles.dosePillText,
                        { color: isSelected ? "#FFFFFF" : c.foreground },
                      ]}>{label}</Text>
                    </Pressable>
                  );
                };

                return (
                  <View style={{ gap: 16 }}>
                    {!isOther ? (
                      <>
                        <Text style={[styles.doseDetailLabel, { color: c.foreground }]}>Previous dose</Text>
                        <View style={styles.dosePillRow}>
                          {nearbyPrev.map((d) =>
                            renderPill(d.value, d.label, selectedPrevDose === d.value, () => {
                              haptic();
                              if (selectedPrevDose === d.value) { setSelectedPrevDose(null); setSelectedNewDose(null); }
                              else { setSelectedPrevDose(d.value); setSelectedNewDose(null); }
                            })
                          )}
                          {renderPill(-1, "Not sure", selectedPrevDose === -1, () => {
                            haptic(); setSelectedPrevDose(-1); setSelectedNewDose(null);
                          })}
                        </View>

                        {selectedPrevDose !== null && (
                          <>
                            <Text style={[styles.doseDetailLabel, { color: c.foreground, marginTop: 4 }]}>New dose</Text>
                            <View style={styles.dosePillRow}>
                              {nearbyNew.map((d) =>
                                renderPill(d.value, d.label, selectedNewDose === d.value, () => {
                                  haptic(); setSelectedNewDose(selectedNewDose === d.value ? null : d.value);
                                }, "primary")
                              )}
                              {renderPill(SAME_DOSE, "Same dose", isSameDose, () => {
                                haptic(); setSelectedNewDose(isSameDose ? null : SAME_DOSE);
                              }, "primary")}
                              {renderPill(-1, "Not sure", selectedNewDose === -1, () => {
                                haptic(); setSelectedNewDose(selectedNewDose === -1 ? null : -1);
                              }, "primary")}
                            </View>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <Text style={[styles.doseDetailLabel, { color: c.foreground }]}>Previous dose (mg)</Text>
                        <TextInput
                          style={[styles.otherDoseInput, { color: c.foreground, borderColor: c.border + "40", backgroundColor: c.accent + "06" }]}
                          keyboardType="decimal-pad"
                          placeholder="e.g. 2.5"
                          placeholderTextColor={c.mutedForeground + "80"}
                          value={selectedPrevDose !== null && selectedPrevDose > 0 ? String(selectedPrevDose) : ""}
                          onChangeText={(t) => {
                            const v = parseFloat(t);
                            setSelectedPrevDose(t === "" ? null : (isNaN(v) ? null : v));
                          }}
                        />
                        <Text style={[styles.doseDetailLabel, { color: c.foreground, marginTop: 4 }]}>New dose (mg)</Text>
                        <TextInput
                          style={[styles.otherDoseInput, { color: c.foreground, borderColor: c.border + "40", backgroundColor: c.accent + "06" }]}
                          keyboardType="decimal-pad"
                          placeholder="e.g. 5"
                          placeholderTextColor={c.mutedForeground + "80"}
                          value={selectedNewDose !== null && selectedNewDose > 0 ? String(selectedNewDose) : ""}
                          onChangeText={(t) => {
                            const v = parseFloat(t);
                            setSelectedNewDose(t === "" ? null : (isNaN(v) ? null : v));
                          }}
                        />
                      </>
                    )}

                    <Text style={[styles.doseDetailLabel, { color: c.foreground, marginTop: 4 }]}>When did it change?</Text>
                    <View style={styles.dosePillRow}>
                      {DATE_OPTIONS.map((opt) => {
                        const sel = selectedDoseDate === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => { haptic(); setSelectedDoseDate(opt.key); }}
                            style={[
                              styles.dosePill,
                              {
                                backgroundColor: sel ? c.accent : c.accent + "0A",
                                borderColor: sel ? c.accent : c.border + "40",
                              },
                            ]}
                          >
                            <Text style={[
                              styles.dosePillText,
                              { color: sel ? "#FFFFFF" : c.foreground },
                            ]}>{opt.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Pressable
                      onPress={() => {
                        if (isSameDose) {
                          haptic();
                          setShowDoseIncrease(false);
                          setSelectedPrevDose(null);
                          setSelectedNewDose(null);
                          return;
                        }
                        if (!canSave) return;
                        haptic();
                        const dateStr = computeDateStr(selectedDoseDate);
                        const prevVal = selectedPrevDose === -1 ? null : selectedPrevDose;
                        const newVal = selectedNewDose!;
                        const newDoseInfo = !isOther ? allDoses.find(d => d.value === newVal) : null;
                        updateProfile({
                          medicationProfile: {
                            ...mp,
                            doseValue: newVal > 0 ? newVal : mp.doseValue,
                            doseUnit: newDoseInfo?.unit ?? mp.doseUnit,
                            frequency: newDoseInfo?.frequency ?? mp.frequency,
                            recentTitration: true,
                            previousDoseValue: prevVal,
                            previousDoseUnit: mp.doseUnit,
                            previousFrequency: mp.frequency,
                            doseChangeDate: dateStr,
                          },
                        });
                        setShowDoseIncrease(false);
                        setSelectedPrevDose(null);
                        setSelectedNewDose(null);
                      }}
                      style={({ pressed }) => [
                        styles.checkInSubmit,
                        {
                          backgroundColor: (canSave || isSameDose) ? c.primary : c.primary + "40",
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <Feather name="check" size={16} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={styles.checkInSubmitText}>{isSameDose ? "Close" : "Save"}</Text>
                    </Pressable>
                  </View>
                );
              })()}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}



const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: 24,
  },

  tagline: {
    fontSize: 16,
    fontFamily: "Montserrat_500Medium",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 16,
    letterSpacing: 0.3,
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
    justifyContent: "center",
    width: "100%",
  },
  streakRow: {
    flexDirection: "row",
    justifyContent: "center",
    width: "100%",
    marginBottom: 6,
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
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
    lineHeight: 20,
    marginTop: 4,
    opacity: 0.65,
    paddingHorizontal: 8,
  },

  inputContainer: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    gap: 14,
  },
  inputHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.1,
  },
  inputSummaryText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
    marginTop: -4,
    opacity: 0.75,
  },
  inputRows: {
    gap: 14,
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
  emptyHealthCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  emptyHealthIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyHealthTitle: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  emptyHealthDesc: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 12,
    opacity: 0.7,
  },
  emptyHealthBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  emptyHealthBtnText: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    color: "#FFFFFF",
  },
  emptyHealthNote: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    opacity: 0.5,
    marginTop: 2,
  },
  partialDataNote: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    opacity: 0.5,
    marginTop: 8,
    fontStyle: "italic",
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
  modalOptionReason: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    opacity: 0.6,
    marginTop: 4,
    lineHeight: 16,
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
  insightsCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  insightsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  insightsTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.2,
  },
  insightRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  insightText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
    flex: 1,
  },
  treatmentCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  treatmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  treatmentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  treatmentTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
  },
  treatmentMedName: {
    fontSize: 14,
    fontFamily: "Montserrat_500Medium",
    marginBottom: 14,
  },
  treatmentWeekly: {
    gap: 10,
  },
  weekDayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  weekDayBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 36,
  },
  weekDayLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_500Medium",
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  },
  weekDayNum: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
    marginTop: 2,
  },
  treatmentStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
  },
  treatmentStatusText: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
  },
  treatmentStatusSub: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    marginLeft: 2,
  },
  treatmentDaily: {
    marginTop: 2,
  },
  dailyLoggedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  dailyLoggedText: {
    fontSize: 14,
    fontFamily: "Montserrat_500Medium",
  },
  dailyLogBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
  },
  dailyLogBtnText: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
    color: "#FFFFFF",
  },
  titrationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  titrationText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
  },
  doseChangeDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 12,
  },
  doseChangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  doseChangeBtnText: {
    fontSize: 13,
    fontFamily: "Montserrat_500Medium",
  },
  doseChangeStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  doseChangeStatusText: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    flex: 1,
  },
  doseDetailLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  dosePillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dosePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  dosePillText: {
    fontSize: 14,
    fontFamily: "Montserrat_500Medium",
  },
  otherDoseInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
  },
  doseDetailHint: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    fontStyle: "italic",
  },
});
