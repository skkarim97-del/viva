import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useState, useRef, useCallback, useEffect } from "react";
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
import {
  sendCoachMessage,
  sendStructuredCoachMessage,
  getCoachMode,
  CoachRequestError,
  describeCoachError,
  type CoachCategory,
  type CoachSeverity,
  type CoachContextTag,
} from "@/lib/api/coachClient";
import { logIntervention } from "@/lib/intervention/logger";
import { logCareEventDeduped, logCareEventImmediate } from "@/lib/care-events/client";
import { Alert } from "react-native";
import { buildCoachContext } from "@/lib/engine/coachEngine";
import type { ChatMessage } from "@/types";

const quickActions = [
  { label: "How should I handle side effects?", icon: "heart" as const },
  { label: "Am I eating enough protein?", icon: "coffee" as const },
  { label: "Should I exercise today?", icon: "target" as const },
  { label: "How can I stay hydrated?", icon: "droplet" as const },
  { label: "What should I focus on this week?", icon: "calendar" as const },
];

// T006 -- structured-coach picker copy. Single source of truth for the
// labels the patient sees. Server never echoes these strings back so we
// don't have to keep them in sync over the wire -- they're purely UX.
const CATEGORY_META: Record<
  CoachCategory,
  { label: string; sublabel: string; icon: React.ComponentProps<typeof Feather>["name"] }
> = {
  symptom_support: {
    label: "How I'm feeling",
    sublabel: "General check-in or symptom",
    icon: "heart",
  },
  side_effect: {
    label: "Side effects",
    sublabel: "Nausea, fatigue, GI, etc.",
    icon: "alert-circle",
  },
  medication_question: {
    label: "Medication question",
    sublabel: "Timing, dose, missed shot",
    icon: "package",
  },
  nutrition: {
    label: "Eating & nutrition",
    sublabel: "Protein, appetite, meals",
    icon: "coffee",
  },
  hydration: {
    label: "Hydration",
    sublabel: "Fluids, electrolytes",
    icon: "droplet",
  },
  exercise: {
    label: "Exercise & movement",
    sublabel: "Workouts, energy, recovery",
    icon: "activity",
  },
  urgent_concern: {
    label: "Urgent concern",
    sublabel: "Needs care team attention",
    icon: "alert-triangle",
  },
  other: {
    label: "Something else",
    sublabel: "Doesn't fit above",
    icon: "more-horizontal",
  },
};

const SEVERITY_META: Record<
  CoachSeverity,
  { label: string; description: string }
> = {
  mild: { label: "Mild", description: "Noticeable, but I can keep going" },
  moderate: { label: "Moderate", description: "It's interfering with my day" },
  severe: {
    label: "Severe",
    description: "Affecting my ability to function or feels alarming",
  },
};

const CONTEXT_TAG_META: Record<CoachContextTag, string> = {
  started_recently: "Started recently",
  after_dose_change: "After a dose change",
  morning: "In the morning",
  evening: "In the evening",
  after_meal: "After a meal",
  with_food: "With food",
  ongoing: "Been ongoing",
  recurring: "Keeps coming back",
};

function categoryLabel(cat: string): string {
  return (CATEGORY_META as Record<string, { label: string }>)[cat]?.label ?? cat;
}

export default function CoachScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { chatMessages, addChatMessage, todayMetrics, metrics, profile, dailyState, insights, feeling, energy, stress, hydration, trainingIntent, completionHistory, weeklyConsistency, streakDays, glp1Energy, appetite, nausea, digestion, medicationLog } = useApp();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [lastFailedDraft, setLastFailedDraft] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const topPad = Platform.OS === "web" ? 60 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // T006 -- pilot mode state. Default to safe so the UI never momentarily
  // shows a free-text composer in production while /coach/mode is in
  // flight. If the server says open, we relax. If the lookup fails we
  // stay safe.
  const [safeMode, setSafeMode] = useState<boolean>(true);
  const [modeReady, setModeReady] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<CoachCategory | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<CoachSeverity | null>(null);
  const [selectedTags, setSelectedTags] = useState<CoachContextTag[]>([]);
  const [submittingStructured, setSubmittingStructured] = useState(false);

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

  // T006 -- discover pilot mode on mount. We don't block the screen on
  // this; we render the safe UI immediately (default state above) and
  // relax to free-text if the server reports open. If the request
  // fails entirely we stay in safe mode -- privacy fail-closed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await getCoachMode();
        if (cancelled) return;
        setSafeMode(info.safeMode);
      } catch {
        // network error -> stay in safe mode (default)
      } finally {
        if (!cancelled) setModeReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildHealthContext = useCallback(() => {
    if (!todayMetrics) return undefined;

    const todayDate = new Date().toISOString().split("T")[0];
    const todayRecord = completionHistory.find(r => r.date === todayDate);
    const todayCompletionRate = todayRecord
      ? Math.round((todayRecord.actions.filter(a => a.completed).length / todayRecord.actions.length) * 100)
      : 0;

    // Single source of truth: every coach request goes through buildCoachContext,
    // which reads from DailyTreatmentState/selectors and gates physiological metrics
    // through claimsPolicy. No parallel tier derivation lives here.
    return buildCoachContext(
      todayMetrics,
      metrics,
      profile,
      dailyState,
      insights,
      medicationLog,
      { energy: glp1Energy, appetite, nausea, digestion },
      { feeling, energy, stress, hydration, trainingIntent },
      streakDays,
      weeklyConsistency,
      todayCompletionRate,
      null,
    );
  }, [todayMetrics, metrics, profile, dailyState, insights, feeling, energy, stress, hydration, trainingIntent, completionHistory, streakDays, weeklyConsistency, glp1Energy, appetite, nausea, digestion, medicationLog]);

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
      console.log("[Coach] buildHealthContext threw:", e?.message || String(e));
      healthContext = undefined;
    }

    // Single attempt, then on failure retry once without the health context.
    // Some failures (serialize, unexpected server 4xx from the context payload)
    // can succeed with a plain message, so we fall back transparently before
    // surfacing an error to the user.
    const attempt = async (withContext: boolean) => {
      return sendCoachMessage({
        message: trimmed,
        healthContext: withContext ? healthContext : undefined,
        conversationHistory,
      });
    };

    try {
      let result;
      try {
        result = await attempt(true);
      } catch (firstErr: any) {
        const kind = firstErr?.kind;
        const retryable = kind === "serialize" || kind === "http" || kind === "parse" || kind === "empty" || kind === "unknown";
        console.log("[Coach] first attempt failed:", { kind, status: firstErr?.status, message: firstErr?.message, retryable });
        if (retryable && healthContext !== undefined) {
          console.log("[Coach] retrying without healthContext");
          try {
            result = await attempt(false);
          } catch (secondErr: any) {
            console.log("[Coach] retry failed:", { kind: secondErr?.kind, status: secondErr?.status, message: secondErr?.message });
            throw secondErr;
          }
        } else {
          throw firstErr;
        }
      }
      addChatMessage({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: result.content,
        timestamp: Date.now(),
      });
      // Log the coach turn as an "adherence_checkin" intervention
      // when the central treatment-state is available. This lets the
      // analytics view attribute re-engagement and outcome shifts
      // back to coach interactions.
      if (dailyState) {
        logIntervention({
          surface: "Coach",
          interventionType: "adherence_checkin",
          title: `coach:${(dailyState.communicationMode ?? "simplify")}`,
          rationale: dailyState.rationale?.join(" | ") ?? null,
          state: dailyState,
        });
      }
      // Care-events stream: one row per coach response so the dual-layer
      // funnel can attribute "Viva touched the patient today". De-duped
      // per (date|surface) so the same chat session doesn't write 30 rows.
      logCareEventDeduped("coach_message", "Coach", {
        mode: dailyState?.communicationMode ?? "simplify",
      });
    } catch (err: any) {
      console.log("[Coach] final error:", { kind: err?.kind, status: err?.status, message: err?.message, body: err?.body, url: err?.url });
      // T006 -- safe-mode 403. Server is telling us free-text is
      // disabled; flip the UI to the structured composer and post
      // a centered system notice instead of an error bubble.
      if (err instanceof CoachRequestError && err.kind === "safe_mode") {
        setSafeMode(true);
        addChatMessage({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content:
            "Free-text chat is paused for the pilot. Pick a category and severity below -- we'll respond with guidance and notify your care team if it's serious.",
          timestamp: Date.now(),
          kind: "notice",
        });
        return;
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

  // T006 -- structured submit. Builds a (category, severity, tags)
  // payload from the picker state, posts to /coach/structured, and
  // pushes both the user 'turn' (rendered as a labeled summary, not
  // free text the patient typed) and the templated assistant reply
  // into the same chatMessages list.
  const submitStructured = useCallback(async () => {
    if (!selectedCategory || !selectedSeverity || submittingStructured) return;
    const cat = selectedCategory;
    const sev = selectedSeverity;
    const tags = [...selectedTags];
    setSubmittingStructured(true);
    if (Platform.OS !== "web") {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    }
    // The user 'turn' has no free text by construction; we render a
    // labeled summary so the conversation is still readable.
    const summary =
      `${categoryLabel(cat)} - ${SEVERITY_META[sev].label}` +
      (tags.length > 0
        ? ` (${tags.map((t) => CONTEXT_TAG_META[t]).join(", ")})`
        : "");
    addChatMessage({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: summary,
      timestamp: Date.now(),
      kind: "structured",
      category: cat,
      severity: sev,
    });
    try {
      const result = await sendStructuredCoachMessage({
        category: cat,
        severity: sev,
        contextTags: tags.length > 0 ? tags : undefined,
      });
      addChatMessage({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: result.content,
        timestamp: Date.now(),
        kind: "structured",
        category: result.category,
        severity: result.severity,
        templateId: result.templateId,
        escalated: result.escalated,
      });
      // Reset picker so the next turn starts fresh.
      setSelectedCategory(null);
      setSelectedSeverity(null);
      setSelectedTags([]);
      // Keep the existing intervention + care-event side-effects so
      // analytics treat structured turns identically to free-text.
      if (dailyState) {
        logIntervention({
          surface: "Coach",
          interventionType: "adherence_checkin",
          title: `coach_structured:${cat}.${sev}`,
          rationale: dailyState.rationale?.join(" | ") ?? null,
          state: dailyState,
        });
      }
      logCareEventDeduped("coach_message", "Coach", {
        mode: dailyState?.communicationMode ?? "simplify",
      });
      if (Platform.OS !== "web") {
        try {
          Haptics.notificationAsync(
            result.escalated
              ? Haptics.NotificationFeedbackType.Warning
              : Haptics.NotificationFeedbackType.Success,
          );
        } catch {}
      }
    } catch (err: any) {
      const userMessage =
        err instanceof CoachRequestError
          ? describeCoachError(err)
          : `Something went wrong. ${err?.message || ""}`.trim();
      addChatMessage({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: userMessage,
        timestamp: Date.now(),
      });
    } finally {
      setSubmittingStructured(false);
    }
  }, [selectedCategory, selectedSeverity, selectedTags, submittingStructured, addChatMessage, dailyState]);

  const toggleTag = useCallback((tag: CoachContextTag) => {
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length >= 4
          ? prev // server caps at 4
          : [...prev, tag],
    );
  }, []);

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
    // T006 -- a 'notice' is a system-rendered turn (e.g. "free-text is
    // disabled"). Centered, neutral card, no avatar/time.
    if (item.kind === "notice") {
      return (
        <View style={styles.noticeRow}>
          <View style={[styles.noticeBubble, { backgroundColor: c.muted, borderColor: c.border ?? c.muted }]}>
            <Feather name="info" size={14} color={c.mutedForeground} />
            <Text style={[styles.noticeText, { color: c.mutedForeground }]}>
              {item.content}
            </Text>
          </View>
        </View>
      );
    }
    const isStructured = item.kind === "structured";
    const isEscalated = isStructured && item.escalated && !isUser;
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        <View style={{ maxWidth: "82%" }}>
          {isStructured && (
            <View
              style={[
                styles.structuredBadge,
                isUser ? styles.structuredBadgeUser : null,
                {
                  backgroundColor: isEscalated
                    ? "#dc262620"
                    : isUser
                      ? c.primary + "22"
                      : c.accent + "18",
                },
              ]}
            >
              <Feather
                name={isEscalated ? "alert-triangle" : "tag"}
                size={10}
                color={isEscalated ? "#dc2626" : isUser ? c.primary : c.accent}
              />
              <Text
                style={[
                  styles.structuredBadgeText,
                  {
                    color: isEscalated
                      ? "#dc2626"
                      : isUser
                        ? c.primary
                        : c.accent,
                  },
                ]}
              >
                {isEscalated
                  ? "Escalated to care team"
                  : item.category
                    ? `${categoryLabel(item.category)}${item.severity ? ` - ${SEVERITY_META[item.severity].label}` : ""}`
                    : "Structured"}
              </Text>
            </View>
          )}
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
      </View>
    );
  };

  // In safe mode there are no free-text quick actions to show -- the
  // composer below renders the picker directly.
  const showQuickActions = !safeMode && chatMessages.length === 0 && !isTyping;
  const showSafeIntro = safeMode && chatMessages.length === 0 && !isTyping;

  const requestCareTeamReview = useCallback(() => {
    const fire = async () => {
      const result = await logCareEventImmediate("escalation_requested", {
        source: "coach",
      });
      if (Platform.OS !== "web") {
        try {
          Haptics.notificationAsync(
            result === "ok"
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Warning,
          );
        } catch {}
      }
      const title =
        result === "ok"
          ? "Care team notified"
          : result === "no_auth"
            ? "Sign in required"
            : "Could not send right now";
      const body =
        result === "ok"
          ? "Your care team has been notified and will follow up soon."
          : result === "no_auth"
            ? "Please sign in again to notify your care team."
            : "We couldn't reach the server. Please try again in a moment.";
      if (Platform.OS === "web") {
        // Alert.alert is a no-op on web — fall back to window.alert.
        try { (globalThis as any).alert?.(`${title}\n\n${body}`); } catch {}
      } else {
        Alert.alert(title, body);
      }
    };
    if (Platform.OS === "web") {
      const yes = (globalThis as any).confirm?.(
        "Notify your care team that you'd like more support?",
      );
      if (yes) void fire();
      return;
    }
    Alert.alert(
      "Need more support?",
      "We'll let your care team know you'd like a closer look. They'll follow up with you.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Notify care team", onPress: () => void fire() },
      ],
    );
  }, []);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Coach</Text>
        <Text style={[styles.headerSub, { color: c.mutedForeground }]}>
          {safeMode
            ? "Pick a category and severity. We'll respond with guidance and loop in your care team if it's serious."
            : "Ask about your treatment, recovery, nutrition, or trends."}
        </Text>
        {safeMode && modeReady && (
          <View style={[styles.privacyBanner, { backgroundColor: c.accent + "12", borderColor: c.accent + "30" }]}>
            <Feather name="shield" size={12} color={c.accent} />
            <Text style={[styles.privacyText, { color: c.accent }]}>
              Pilot privacy mode: free-text chat is paused. Your selections are not sent to any outside AI service.
            </Text>
          </View>
        )}
      </View>

      {showSafeIntro ? (
        <ScrollView
          style={styles.quickArea}
          contentContainerStyle={styles.safeIntroInner}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.safeIntroCard, { backgroundColor: c.card }]}>
            <View style={[styles.safeIntroIconWrap, { backgroundColor: c.accent + "18" }]}>
              <Feather name="message-circle" size={20} color={c.accent} />
            </View>
            <Text style={[styles.safeIntroTitle, { color: c.foreground }]}>
              How can the coach help?
            </Text>
            <Text style={[styles.safeIntroBody, { color: c.mutedForeground }]}>
              Choose a category below, then say how it's affecting you. The coach will respond with guidance for that situation. If it's serious, your care team gets notified automatically.
            </Text>
          </View>
        </ScrollView>
      ) : showQuickActions ? (
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
        {!isTyping && !submittingStructured && (
          <Pressable
            onPress={requestCareTeamReview}
            style={({ pressed }) => [
              styles.supportLink,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            hitSlop={8}
          >
            <Feather name="life-buoy" size={13} color={c.mutedForeground} />
            <Text style={{ color: c.mutedForeground, fontFamily: "Montserrat_500Medium", fontSize: 12 }}>
              Need more support? Notify your care team
            </Text>
          </Pressable>
        )}
        {!safeMode && lastFailedDraft && !isTyping && (
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
        {safeMode ? (
          // T006 -- structured composer. Three sections:
          //  1) category grid -- always visible
          //  2) severity row -- enabled only after a category is picked
          //  3) optional context tags -- enabled only after severity
          //     is picked, capped at 4 (server enforces too)
          // Submit is enabled only when (category + severity) are set.
          <ScrollView
            style={styles.composerScroll}
            contentContainerStyle={styles.composerInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.composerSectionLabel, { color: c.mutedForeground }]}>
              1. What's it about?
            </Text>
            <View style={styles.categoryGrid}>
              {(Object.keys(CATEGORY_META) as CoachCategory[]).map((cat) => {
                const meta = CATEGORY_META[cat];
                const active = selectedCategory === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => {
                      setSelectedCategory(cat);
                      // changing category resets the rest so we never
                      // submit a (categoryA, severityChosenForB) pair
                      setSelectedSeverity(null);
                      setSelectedTags([]);
                      if (Platform.OS !== "web") {
                        try { Haptics.selectionAsync(); } catch {}
                      }
                    }}
                    style={({ pressed }) => [
                      styles.categoryBtn,
                      {
                        backgroundColor: active ? c.primary : c.card,
                        borderColor: active ? c.primary : "transparent",
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name={meta.icon}
                      size={14}
                      color={active ? c.primaryForeground : c.accent}
                    />
                    <Text
                      style={[
                        styles.categoryLabel,
                        { color: active ? c.primaryForeground : c.foreground },
                      ]}
                      numberOfLines={1}
                    >
                      {meta.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.composerSectionLabel, { color: c.mutedForeground, marginTop: 12 }]}>
              2. How severe?
            </Text>
            <View style={styles.severityRow}>
              {(Object.keys(SEVERITY_META) as CoachSeverity[]).map((sev) => {
                const meta = SEVERITY_META[sev];
                const active = selectedSeverity === sev;
                const disabled = !selectedCategory;
                return (
                  <Pressable
                    key={sev}
                    onPress={() => {
                      if (disabled) return;
                      setSelectedSeverity(sev);
                      if (Platform.OS !== "web") {
                        try { Haptics.selectionAsync(); } catch {}
                      }
                    }}
                    style={({ pressed }) => [
                      styles.severityBtn,
                      {
                        backgroundColor: active ? c.primary : c.card,
                        borderColor: active ? c.primary : "transparent",
                        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.severityLabel,
                        { color: active ? c.primaryForeground : c.foreground },
                      ]}
                    >
                      {meta.label}
                    </Text>
                    <Text
                      style={[
                        styles.severitySublabel,
                        {
                          color: active
                            ? c.primaryForeground + "cc"
                            : c.mutedForeground,
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {meta.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {selectedSeverity && (
              <>
                <Text style={[styles.composerSectionLabel, { color: c.mutedForeground, marginTop: 12 }]}>
                  3. Any context? (optional, pick up to 4)
                </Text>
                <View style={styles.tagRow}>
                  {(Object.keys(CONTEXT_TAG_META) as CoachContextTag[]).map(
                    (tag) => {
                      const active = selectedTags.includes(tag);
                      const atCap = !active && selectedTags.length >= 4;
                      return (
                        <Pressable
                          key={tag}
                          onPress={() => toggleTag(tag)}
                          disabled={atCap}
                          style={({ pressed }) => [
                            styles.tagChip,
                            {
                              backgroundColor: active
                                ? c.accent
                                : c.card,
                              borderColor: active ? c.accent : "transparent",
                              opacity: atCap ? 0.35 : pressed ? 0.85 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tagText,
                              {
                                color: active
                                  ? c.primaryForeground
                                  : c.foreground,
                              },
                            ]}
                          >
                            {CONTEXT_TAG_META[tag]}
                          </Text>
                        </Pressable>
                      );
                    },
                  )}
                </View>
              </>
            )}

            <Pressable
              onPress={submitStructured}
              disabled={
                !selectedCategory || !selectedSeverity || submittingStructured
              }
              style={({ pressed }) => [
                styles.submitBtn,
                {
                  backgroundColor:
                    selectedCategory && selectedSeverity && !submittingStructured
                      ? c.primary
                      : c.muted,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {submittingStructured ? (
                <Text style={[styles.submitText, { color: c.primaryForeground }]}>
                  Sending...
                </Text>
              ) : (
                <>
                  <Text style={[styles.submitText, { color: selectedCategory && selectedSeverity ? c.primaryForeground : c.mutedForeground }]}>
                    Get guidance
                  </Text>
                  <Feather
                    name="arrow-right"
                    size={16}
                    color={selectedCategory && selectedSeverity ? c.primaryForeground : c.mutedForeground}
                  />
                </>
              )}
            </Pressable>
          </ScrollView>
        ) : (
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
        )}
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
  supportLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    marginBottom: 4,
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
  // T006 -- safe-mode styles
  privacyBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  privacyText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 15,
  },
  safeIntroInner: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  safeIntroCard: {
    padding: 18,
    borderRadius: 18,
    gap: 10,
  },
  safeIntroIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  safeIntroTitle: {
    fontSize: 17,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.2,
  },
  safeIntroBody: {
    fontSize: 13.5,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
  },
  composerScroll: {
    maxHeight: 360,
  },
  composerInner: {
    paddingTop: 4,
    paddingBottom: 8,
    gap: 0,
  },
  composerSectionLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  categoryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: "47%",
  },
  categoryLabel: {
    fontSize: 12.5,
    fontFamily: "Montserrat_500Medium",
    flex: 1,
  },
  severityRow: {
    flexDirection: "row",
    gap: 6,
  },
  severityBtn: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
  },
  severityLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
  },
  severitySublabel: {
    fontSize: 10.5,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 13,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
  },
  submitBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  submitText: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
  },
  noticeRow: {
    alignItems: "center",
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  noticeBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "92%",
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 16,
  },
  structuredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  structuredBadgeUser: {
    alignSelf: "flex-end",
  },
  structuredBadgeText: {
    fontSize: 10,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.2,
  },
});
