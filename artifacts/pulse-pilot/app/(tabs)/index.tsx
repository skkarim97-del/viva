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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InputRow } from "@/components/InputRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SymptomTipCard } from "@/components/SymptomTipCard";
import { InterventionCard } from "@/components/InterventionCard";
import {
  interventionsApi,
  type PatientIntervention,
  type FeedbackResult,
} from "@/lib/api/interventionsClient";
import WeightLogModal from "@/components/WeightLogModal";
import { sessionApi } from "@/lib/api/sessionClient";
import { logIntervention, type InterventionType } from "@/lib/intervention/logger";
import { logCareEventDeduped, logCareEventImmediate } from "@/lib/care-events/client";
import { useApp } from "@/context/AppContext";
import { type SymptomKind } from "@/lib/symptomTips";
import { generateCoachInsight } from "@/data/insights";
import { formatDoseDisplay, getDoseOptions, type MedicationBrand } from "@/data/medicationData";
import {
  generateGreeting,
  buildCoachContext,
  selectStatusChip,
  selectHero,
  selectInsightSummary,
  selectInterventions,
  selectInsufficientDataNotice,
  selectActiveInterventionForAck,
  type StatusChip,
} from "@/lib/engine";
import { sendCoachMessage, CoachRequestError, describeCoachError } from "@/lib/api/coachClient";
import { summarizeCoachThread } from "@/lib/coachSummary";
import { useColors } from "@/hooks/useColors";
import { CATEGORY_OPTIONS } from "@/types";
import type { MetricKey, FeelingType, ChatMessage, DailyState, ActionCategory, AppetiteLevel, NauseaLevel, DigestionStatus, EnergyDaily, MedicationLogEntry, MentalState } from "@/types";

// Persistent "last day we surfaced the weekly prompt" key. We only
// auto-pop the modal once per calendar day even if the patient cold-
// starts the app multiple times -- avoids nag behavior. Stored as a
// YYYY-MM-DD string in AsyncStorage; cleared implicitly by the date
// rolling over.
const WEIGHT_PROMPT_LAST_SHOWN_KEY = "@viva_weight_prompt_lastShownDate";

// How long a symptom tip stays suppressed after the patient acks it,
// assuming the symptom severity hasn't worsened. Crossing this window
// while the symptom is still being logged counts as a recurrence and
// the card is allowed to surface again. Tuned to ~4h so within a
// single day a patient can still get a second nudge if the issue
// hasn't resolved, without spam.
const SUPPRESSION_RETRIGGER_MS = 4 * 60 * 60 * 1000;

function todayLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Module-scoped guard so we don't fire the AsyncStorage check more
// than once per JS runtime even if the Today screen remounts.
let weeklyWeightPromptCheckedThisLaunch = false;

// Today-tab severity palette. Maps symptom-input options to a calm
// 4-step scale: positive (green) -> normal/neutral (blue) ->
// moderate concern (soft amber) -> heavier concern (amber). Red is
// intentionally absent from the normal patient flow -- it is
// reserved for true clinical red-flag states elsewhere -- so a
// patient logging "Severe nausea" or "Diarrhea" sees attention
// (amber), not alarm. TINT_AMBER_SOFT is the lighter step used for
// the third option in 4-button rows so moderate and heavier still
// read as distinct without flooding the page with orange.
const TINT_GREEN = "#34C759";
const TINT_BLUE = "#38B6FF";
const TINT_AMBER_SOFT = "#FFB340";
const TINT_AMBER = "#FF9500";
const TINT_MUTED = "#8E8E93";

const ENERGY_OPTIONS: { key: NonNullable<EnergyDaily>; label: string; tint: string }[] = [
  { key: "great", label: "Great", tint: TINT_GREEN },
  { key: "good", label: "Good", tint: TINT_BLUE },
  { key: "tired", label: "Tired", tint: TINT_AMBER_SOFT },
  { key: "depleted", label: "Depleted", tint: TINT_AMBER },
];

const APPETITE_OPTIONS: { key: NonNullable<AppetiteLevel>; label: string; tint: string }[] = [
  { key: "strong", label: "Strong", tint: TINT_GREEN },
  { key: "normal", label: "Normal", tint: TINT_BLUE },
  { key: "low", label: "Low", tint: TINT_AMBER_SOFT },
  { key: "very_low", label: "Very Low", tint: TINT_AMBER },
];

const NAUSEA_OPTIONS: { key: NonNullable<NauseaLevel>; label: string; tint: string }[] = [
  { key: "none", label: "None", tint: TINT_GREEN },
  { key: "mild", label: "Mild", tint: TINT_BLUE },
  { key: "moderate", label: "Moderate", tint: TINT_AMBER_SOFT },
  { key: "severe", label: "Severe", tint: TINT_AMBER },
];

const BOWEL_OPTIONS: { key: "yes" | "no"; label: string; tint: string }[] = [
  { key: "yes", label: "Yes", tint: TINT_GREEN },
  { key: "no", label: "No", tint: TINT_AMBER },
];

const DIGESTION_OPTIONS: { key: NonNullable<DigestionStatus>; label: string; tint: string }[] = [
  { key: "fine", label: "Fine", tint: TINT_GREEN },
  { key: "bloated", label: "Bloated", tint: TINT_BLUE },
  { key: "constipated", label: "Constip.", tint: TINT_AMBER_SOFT },
  { key: "diarrhea", label: "Diarrhea", tint: TINT_AMBER },
];

// Status chip color derives from the selector's semantic tone, not
// from raw plan.dailyState. This lets new treatment-aware bands
// (escalate, support) and the insufficient-data path render with
// the right tone without each consumer maintaining its own map.
const TONE_COLOR: Record<StatusChip["tone"], (c: ReturnType<typeof useColors>) => string> = {
  success: (c) => c.success,
  accent: (c) => c.accent,
  warning: (c) => c.warning,
  destructive: (c) => c.destructive,
  muted: (c) => c.mutedForeground,
};

export default function DashboardScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    todayMetrics, dailyPlan, dailyState, insights, feeling, setFeeling,
    energy, setEnergy, stress, setStress,
    hydration, setHydration,
    trainingIntent, setTrainingIntent,
    chatMessages, addChatMessage, profile, updateProfile,
    toggleAction, editAction, weeklyConsistency,
    metrics, completionHistory,
    streakDays, todayCompletionRate,
    lastCompletionFeedback, clearCompletionFeedback,
    saveDailyCheckIn, todayCheckIn, acknowledgeSymptomTip, guidanceAckTitleHistory,
    recordSymptomTrend, requestClinicianForSymptom,
    guidanceAckHistory, clinicianRequestedToday,
    checkinSyncStatus, flushCheckinSync,
    appetite, setAppetite,
    nausea, setNausea,
    digestion, setDigestion,
    bowelMovementToday, setBowelMovementToday,
    glp1Energy, setGlp1Energy,
    medicationLog, logMedicationDose, removeMedicationDose,
    adaptiveInsights,
    hasHealthData,
    availableMetricTypes,
  } = useApp();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // ----- AI-personalized micro-intervention loop (Phase 3) -----
  // The personalized card REPLACES the legacy SymptomTipCard layer
  // whenever an active row exists -- the parent suppresses the
  // static-tip block below in that case so the patient sees ONE
  // prioritized recommendation that references their own signals,
  // instead of a generic static tip stacked on top of it.
  //
  // Lifecycle:
  //   1. Load /active on mount.
  //   2. If empty, kick off /generate (source=checkin) so a patient
  //      who already logged a check-in today still gets a card.
  //   3. Refetch /active after every card action.
  //   4. When the patient changes any symptom input today AND there's
  //      no active intervention yet, debounce-call /generate again so
  //      a freshly logged signal can spawn a personalized card.
  //
  // All network calls are best-effort -- a failure must never block
  // the rest of the Today screen from rendering.
  const [activeInterventions, setActiveInterventions] = useState<PatientIntervention[]>([]);

  // Cold-start symptom hydration: when this tab mounts and the local
  // sliders are still null (fresh browser session, e.g. the Replit
  // dev preview right after auto-login), pull today's saved check-in
  // row from the server so the UI reflects what the patient already
  // submitted earlier. We only hydrate keys that are currently null,
  // so an in-progress edit is never overwritten. Best-effort: any
  // failure is silent and leaves the sliders empty.
  const hydratedFromServerRef = useRef(false);
  useEffect(() => {
    if (hydratedFromServerRef.current) return;
    const allEmpty =
      glp1Energy === null &&
      nausea === null &&
      appetite === null &&
      digestion === null &&
      bowelMovementToday === null;
    if (!allEmpty) {
      hydratedFromServerRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      const row = await sessionApi.getTodayCheckin().catch(() => null);
      if (cancelled || !row) return;
      hydratedFromServerRef.current = true;
      if (glp1Energy === null && row.energy) setGlp1Energy(row.energy);
      if (nausea === null && row.nausea) setNausea(row.nausea);
      if (appetite === null && row.appetite) setAppetite(row.appetite);
      if (digestion === null && row.digestion) setDigestion(row.digestion);
      if (bowelMovementToday === null && row.bowelMovement !== null) {
        setBowelMovementToday(row.bowelMovement);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    glp1Energy,
    nausea,
    appetite,
    digestion,
    bowelMovementToday,
    setGlp1Energy,
    setNausea,
    setAppetite,
    setDigestion,
    setBowelMovementToday,
  ]);
  // We must NOT fire /generate before the first /active fetch lands --
  // otherwise on a slow network the mount effect would always race
  // ahead of the active-load and pointlessly ask the engine to
  // generate while a row may already exist. `activeLoaded` flips true
  // exactly once after the first /active call completes (success OR
  // failure), and gates both auto-generate effects below.
  const [activeLoaded, setActiveLoaded] = useState(false);
  const reloadActiveInterventions = React.useCallback(async () => {
    try {
      const items = await interventionsApi.active();
      setActiveInterventions(items);
    } catch {
      // Best-effort: leave whatever's currently rendered alone.
    } finally {
      setActiveLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reloadActiveInterventions();
  }, [reloadActiveInterventions]);

  // Single in-flight /generate guard. Prevents the mount effect and
  // the symptom-input watcher from racing each other (or themselves)
  // when the network is slow -- without this guard a debounce that
  // fires while a previous /generate is still pending would issue a
  // duplicate request, which the server's trigger-based dedupe might
  // not collapse under concurrent latency. Wraps every UI-initiated
  // /generate call.
  //
  // Returns "started" if the request actually went out, "queued" if
  // it was blocked by an in-flight call (the symptom-input watcher
  // uses this to NOT advance its signature snapshot, so a follow-up
  // edit during the in-flight window still gets a chance to fire).
  const generateInFlightRef = useRef(false);
  const queuedFollowUpRef = useRef(false);
  const tryGenerate = React.useCallback(async (): Promise<"started" | "queued"> => {
    if (generateInFlightRef.current) {
      // Mark that a follow-up was requested while we were busy. The
      // in-flight call will run one extra /generate after it settles
      // so a legitimate symptom-change trigger isn't dropped.
      queuedFollowUpRef.current = true;
      return "queued";
    }
    // Drain loop: run the initial request, then keep running one
    // /generate per queued follow-up until the queue settles. Without
    // this loop a second-order overlap (queued during the follow-up's
    // own in-flight window) would set the flag again but never drain,
    // dropping a legitimate symptom-change trigger that has no further
    // signature change to retry.
    do {
      queuedFollowUpRef.current = false;
      generateInFlightRef.current = true;
      try {
        let created: PatientIntervention | null = null;
        try {
          created = await interventionsApi.generate({ source: "checkin" });
        } catch {
          /* swallow -- best effort */
        }
        if (created) await reloadActiveInterventions();
      } finally {
        generateInFlightRef.current = false;
      }
    } while (queuedFollowUpRef.current);
    return "started";
  }, [reloadActiveInterventions]);

  // Track whether we've already issued a /generate for the CURRENT
  // empty-active state. Resets to false whenever activeInterventions
  // becomes non-empty (so the next time it goes empty -- e.g. after a
  // feedback collection drops the row -- we'll attempt one more
  // generate). We also re-attempt when symptom inputs change below.
  const hasActive = activeInterventions.length > 0;
  const generateAttemptedRef = useRef(false);
  useEffect(() => {
    if (!activeLoaded) return; // wait for first /active to land
    if (hasActive) {
      generateAttemptedRef.current = false;
      return;
    }
    if (generateAttemptedRef.current) return;
    generateAttemptedRef.current = true;
    void tryGenerate();
  }, [activeLoaded, hasActive, tryGenerate]);

  // Pilot auto-save + generate. The patient's symptom sliders
  // (energy / appetite / nausea / digestion / bowel) only update
  // local React state -- they are NOT persisted to the backend
  // until saveDailyCheckIn runs, and saveDailyCheckIn's only call
  // site is the mental-state quick check-in modal "Done" button.
  // For the pilot Today experience we want the personalized card
  // to spawn as soon as the patient provides enough symptom data,
  // without forcing them to also tap the mental-state modal.
  //
  // This effect, debounced 1.2s, runs whenever the symptom
  // signature changes AND the minimum required fields (energy +
  // nausea) are set. It:
  //   1. POSTs the current symptom snapshot to /me/checkins so
  //      the engine has a fresh row in patient_checkins to read.
  //   2. Awaits that POST before calling /generate, so we never
  //      run the engine against stale or missing DB data.
  //   3. Snaps the signature on success so a no-op symptom
  //      change (or the same signature returning later) doesn't
  //      re-fire.
  //
  // We seed lastSavedSignatureRef with the first observed
  // signature once /active resolves, so we don't auto-fire for
  // inputs the patient logged earlier in the day; only edits
  // diverging from that snapshot trigger the auto-save chain.
  const symptomSignature = `${glp1Energy ?? ""}|${appetite ?? ""}|${nausea ?? ""}|${digestion ?? ""}|${bowelMovementToday ?? ""}`;
  const hasMinSymptomData = !!(glp1Energy && nausea);
  const lastSavedSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeLoaded) return;
    if (lastSavedSignatureRef.current === null) {
      lastSavedSignatureRef.current = symptomSignature;
      return;
    }
    // NOTE: previously bailed when hasActive=true. That blocked the
    // patient's edits from ever reaching /me/checkins or /generate
    // once any intervention was visible -- so escalating severity
    // (moderate -> severe) silently no-op'd. The server engine de-dupes
    // on its own (allowing supersede when severity escalates), so the
    // frontend just needs to fire the chain on every signature change.
    if (!hasMinSymptomData) return;
    if (lastSavedSignatureRef.current === symptomSignature) return;
    const handle = setTimeout(async () => {
      const snapshot = symptomSignature;
      const todayYmd = new Date().toISOString().split("T")[0]!;
      let savedOk = false;
      try {
        await sessionApi.submitCheckin({
          date: todayYmd,
          energy: glp1Energy!,
          nausea: nausea!,
          mood: 3,
          appetite: appetite ?? null,
          digestion: digestion ?? null,
          bowelMovement: bowelMovementToday,
        });
        savedOk = true;
      } catch {
        /* best effort */
      }
      if (!savedOk) return;
      const outcome = await tryGenerate();
      if (outcome === "started") {
        lastSavedSignatureRef.current = snapshot;
      }
    }, 1200);
    return () => clearTimeout(handle);
  }, [
    activeLoaded,
    symptomSignature,
    hasMinSymptomData,
    glp1Energy,
    nausea,
    appetite,
    digestion,
    bowelMovementToday,
    tryGenerate,
  ]);

  const onInterventionAccept = React.useCallback(
    async (id: number) => {
      try { await interventionsApi.accept(id); } catch { /* swallow */ }
      await reloadActiveInterventions();
    },
    [reloadActiveInterventions],
  );
  const onInterventionDismiss = React.useCallback(
    async (id: number) => {
      try { await interventionsApi.dismiss(id); } catch { /* swallow */ }
      await reloadActiveInterventions();
    },
    [reloadActiveInterventions],
  );
  const onInterventionFeedback = React.useCallback(
    async (id: number, result: FeedbackResult) => {
      // Server transitions the row to either `feedback_collected`
      // (better/same/didnt_try) or `escalated` (worse, auto-escalate).
      // /active intentionally OMITS `feedback_collected` from its
      // response (it only returns shown/accepted/pending_feedback/
      // escalated), so a plain refetch would hide the row before the
      // patient gets to see the "Thanks for letting us know" copy.
      // We therefore optimistically merge the feedback response into
      // local state, hold for ~2.5s so the thank-you renders, and
      // THEN refetch -- which drops the now-collected row from the
      // active list. The escalated path still refetches immediately
      // because /active does include escalated rows.
      try {
        const resp = await interventionsApi.feedback(id, result);
        const updated = resp?.intervention;
        if (updated) {
          setActiveInterventions((prev) =>
            prev.map((iv) => (iv.id === id ? updated : iv)),
          );
          if (updated.status === "feedback_collected") {
            setTimeout(() => {
              void reloadActiveInterventions();
            }, 2500);
            return;
          }
        }
      } catch {
        /* swallow */
      }
      await reloadActiveInterventions();
    },
    [reloadActiveInterventions],
  );
  const onInterventionEscalate = React.useCallback(
    async (id: number) => {
      try {
        await interventionsApi.escalate(id, "want_to_talk_to_doctor");
      } catch { /* swallow */ }
      await reloadActiveInterventions();
    },
    [reloadActiveInterventions],
  );

  const [askInput, setAskInput] = useState("");
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [editingAction, setEditingAction] = useState<ActionCategory | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showWhyPlan, setShowWhyPlan] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [checkInMental, setCheckInMental] = useState<MentalState>(null);
  // Per-symptom suppression record. We track the severity at the
  // time the patient acked AND the wall-clock timestamp so the tip
  // can re-surface when:
  //   1. The same symptom worsens (current severity > acked severity)
  //   2. SUPPRESSION_RETRIGGER_MS has passed and the symptom is still
  //      logged (recurrence after a meaningful gap)
  // The map is in-component state -- it resets on app restart, which
  // is the desired "fresh day" behavior since the symptom inputs
  // themselves are also same-day.
  const [dismissedTips, setDismissedTips] = useState<
    Map<SymptomKind, { severity: 1 | 2 | 3; ackedAt: number }>
  >(() => new Map());
  const [showDoseIncrease, setShowDoseIncrease] = useState(false);
  const [doseIncreaseStep, setDoseIncreaseStep] = useState<"ask" | "details">("ask");
  const [selectedPrevDose, setSelectedPrevDose] = useState<number | null>(null);
  const [selectedNewDose, setSelectedNewDose] = useState<number | null>(null);
  const [selectedDoseDate, setSelectedDoseDate] = useState<string>("today");
  const chatListRef = useRef<FlatList>(null);
  const feedbackOpacity = useRef(new Animated.Value(0)).current;

  // Weekly weight prompt. Surfaces at most once per calendar day even
  // if the patient cold-starts multiple times (we persist the last
  // shown date to AsyncStorage). The server still owns the "due" flag
  // -- this guard is purely about prompt frequency.
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [latestWeightLbs, setLatestWeightLbs] = useState<number | null>(null);
  const [weightDaysSince, setWeightDaysSince] = useState<number | null>(null);
  const { updateProfile: updateProfileForWeightSync } = useApp();
  useEffect(() => {
    if (weeklyWeightPromptCheckedThisLaunch) return;
    weeklyWeightPromptCheckedThisLaunch = true;
    (async () => {
      try {
        const r = await sessionApi.getLatestWeight();
        setLatestWeightLbs(r.latest?.weightLbs ?? null);
        setWeightDaysSince(r.daysSinceLast);
        // Mirror the server's authoritative weight onto the local
        // profile so downstream consumers (BMR, coach context) keep
        // working now that the dedicated settings row is gone.
        if (r.latest?.weightLbs != null) {
          updateProfileForWeightSync({ weight: r.latest.weightLbs });
        }
        if (!r.weeklyPromptDue) return;
        const today = todayLocalDateString();
        const lastShown = await AsyncStorage.getItem(
          WEIGHT_PROMPT_LAST_SHOWN_KEY,
        );
        if (lastShown === today) return;
        await AsyncStorage.setItem(WEIGHT_PROMPT_LAST_SHOWN_KEY, today);
        setWeightModalOpen(true);
      } catch {
        // Silent: a missing prompt is strictly better than a noisy
        // error toast on app open.
      }
    })();
  }, [updateProfileForWeightSync]);

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

  // All Today recommendation surfaces now read from the central
  // DailyTreatmentState through selectors. The dailyState object is
  // computed in AppContext and includes raw symptom interventions for
  // today; the dismissed-tips suppression filter is applied here
  // because that state is component-local (resets on app restart by
  // design).
  const insightSummary = React.useMemo(
    () => (dailyState ? selectInsightSummary(dailyState) : null),
    [dailyState],
  );
  const inputSummary = insightSummary?.text || null;

  const insufficientNotice = React.useMemo(
    () => (dailyState ? selectInsufficientDataNotice(dailyState) : null),
    [dailyState],
  );

  const symptomTips = React.useMemo(() => {
    if (!dailyState) return [];
    const raw = selectInterventions(dailyState);
    if (dismissedTips.size === 0) return raw;
    const now = Date.now();
    return raw.filter((t) => {
      const ack = dismissedTips.get(t.symptom);
      if (!ack) return true;
      // Worsened since ack -> resurface immediately as a fresh
      // (now-more-severe) tip.
      if (t.severity > ack.severity) return true;
      // Recurrence after a meaningful gap -> resurface. Same-state
      // pings inside the window are suppressed to avoid spam.
      if (now - ack.ackedAt >= SUPPRESSION_RETRIGGER_MS) return true;
      return false;
    });
  }, [dailyState, dismissedTips]);

  // Best-effort intervention logging. Fires once per day per (focus +
  // tip-symptom). Never blocks rendering; failures are swallowed by
  // the logger. The dependency array includes only the data we actually
  // read so re-renders that don't change interventions don't re-fire.
  React.useEffect(() => {
    if (!dailyState) return;
    if (dailyState.primaryFocus && dailyState.primaryFocus !== "continuity_support") {
      const focusToType: Partial<Record<string, InterventionType>> = {
        hydration: "hydration",
        fueling: "protein_fueling",
        recovery: "recovery_rest",
        symptom_relief: "symptom_monitoring",
      };
      const t = focusToType[dailyState.primaryFocus];
      if (t) {
        logIntervention({
          surface: "Today",
          interventionType: t,
          title: `today:${dailyState.primaryFocus}`,
          rationale: dailyState.rationale?.join(" | ") ?? null,
          state: dailyState,
        });
        // Care-events stream: one row per (date|surface|focus). Funnel
        // uses this as "Viva surfaced an actionable rec today".
        logCareEventDeduped(
          "recommendation_shown",
          `Today|${dailyState.primaryFocus}`,
          { surface: "Today", focus: dailyState.primaryFocus },
        );
      }
    }
    if (dailyState.escalationNeed === "clinician") {
      logIntervention({
        surface: "Today",
        interventionType: "clinician_escalation",
        title: "today:clinician_escalation",
        rationale: dailyState.rationale?.join(" | ") ?? null,
        state: dailyState,
      });
    }
    for (const tip of symptomTips) {
      logIntervention({
        surface: "Today",
        interventionType: "symptom_monitoring",
        title: tip.title,
        rationale: tip.symptom,
        state: dailyState,
      });
    }
  }, [dailyState, symptomTips]);

  // Today-tab contextual escalation CTA. Shown only when the daily
  // state surfaces a clinician-grade signal (escalationNeed clinician
  // OR symptomBurden high) and the patient hasn't already requested
  // a review this session. One-shot per session keeps the screen calm
  // after the patient has already pinged the care team. Backend dedupe
  // is the source of truth across sessions; this is just UI quieting.
  const [todayEscalationSent, setTodayEscalationSent] = React.useState(false);
  const showTodayEscalationCta = React.useMemo(() => {
    if (!dailyState) return false;
    if (todayEscalationSent) return false;
    return (
      dailyState.escalationNeed === "clinician" ||
      dailyState.symptomBurden === "high"
    );
  }, [dailyState, todayEscalationSent]);
  const requestTodayReview = React.useCallback(() => {
    const fire = async () => {
      const result = await logCareEventImmediate("escalation_requested", {
        source: "today",
      });
      // Only quiet the CTA on success. On failure we leave it visible
      // so the patient can retry without re-triggering the underlying
      // dailyState condition. Server-side dedupe still protects against
      // a true double-tap inside the same minute.
      if (result === "ok") setTodayEscalationSent(true);
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
        try { (globalThis as any).alert?.(`${title}\n\n${body}`); } catch {}
      } else {
        Alert.alert(title, body);
      }
    };
    if (Platform.OS === "web") {
      const yes = (globalThis as any).confirm?.(
        "Flag this for your doctor?",
      );
      if (yes) void fire();
      return;
    }
    Alert.alert(
      "Want us to flag this for your doctor?",
      "We'll let your care team know what you're seeing today. They'll follow up with you.",
      [
        { text: "Not now", style: "cancel" },
        { text: "Request review", onPress: () => void fire() },
      ],
    );
  }, []);

  const onAckSymptomTip = React.useCallback(
    (
      symptom: SymptomKind,
      interventionTitle: string,
      interventionCta: string,
      interventionSummary: string,
    ) => {
      // Snapshot the current severity at ack time so the re-trigger
      // logic above can compare against it. The selector reflects
      // "what was true the moment the patient tapped the CTA" since
      // dailyState is recomputed every render.
      const snap = dailyState ? selectActiveInterventionForAck(dailyState, symptom) : null;
      const severity: 1 | 2 | 3 = snap?.severity ?? 1;
      setDismissedTips((prev) => {
        const next = new Map(prev);
        next.set(symptom, { severity, ackedAt: Date.now() });
        return next;
      });
      // Delegate the server mirror (and queued retry on 404) to
      // AppContext so the ack survives the "patient dismisses tip
      // before today's check-in row exists" race. Pass the title so
      // the followup card tomorrow can quote the intervention the
      // patient actually saw.
      acknowledgeSymptomTip(
        symptom,
        interventionTitle,
        interventionCta,
        interventionSummary,
      );
    },
    [acknowledgeSymptomTip, dailyState],
  );

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const openMetric = (key: MetricKey) => {
    haptic();
    router.push({ pathname: "/metric-detail", params: { key, source: "today" } });
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

  // Map the InputRow's "yes"/"no" key to the boolean stored in
  // AppContext, with a tap on the already-selected option clearing
  // back to null (matching the toggle behavior of the other rows).
  const bowelSelectedKey: "yes" | "no" | null =
    bowelMovementToday === true
      ? "yes"
      : bowelMovementToday === false
        ? "no"
        : null;
  const selectBowelMovement = (k: "yes" | "no") => {
    const next = k === "yes";
    setBowelMovementToday(bowelSelectedKey === k ? null : next);
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

    let healthContext: unknown;
    try {
      healthContext = buildCoachContext(
        todayMetrics, metrics, profile, dailyState, insights,
        medicationLog,
        { energy: glp1Energy, appetite, nausea, digestion },
        { feeling, energy, stress, hydration, trainingIntent },
        streakDays, weeklyConsistency, todayCompletionRate,
        null,
      );
    } catch (e: any) {
      if (typeof __DEV__ !== "undefined" && __DEV__) console.log("[Coach] buildCoachContext threw:", e);
      healthContext = undefined;
    }

    try {
      const { content } = await sendCoachMessage({
        message: text.trim(),
        healthContext,
        conversationHistory,
      });
      const assistantMsg: ChatMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content,
        timestamp: Date.now(),
      };
      setAskMessages((prev) => [...prev, assistantMsg]);
      addChatMessage(assistantMsg);
    } catch (err: any) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.log("[Coach] error:", { kind: err?.kind, status: err?.status, message: err?.message, body: err?.body });
      }
      const userMessage = err instanceof CoachRequestError
        ? describeCoachError(err)
        : `Something went wrong. ${err?.message || ""}`.trim();
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
    { key: "activeCalories", label: "Active Cal", value: `${Math.round(todayMetrics.activeCalories || 0)}`, unit: "kcal", requiredType: "calories" },
    { key: "restingHR", label: "Heart Rate", value: typeof todayMetrics.restingHeartRate === "number" ? `${todayMetrics.restingHeartRate}` : "--", unit: "bpm", requiredType: "heartRate" },
  ];
  const metricItems = allMetricItems.filter(item => availableMetricTypes.includes(item.requiredType as any));

  // Status chip + hero come from the central selectors. They
  // automatically degrade to a calm "Set up your day" / "Tell us how
  // today is going" prompt when sufficiency is too low for a
  // confident plan, replacing the historical 70% silent fallback.
  const statusChip: StatusChip = dailyState
    ? selectStatusChip(dailyState)
    : { label: dailyPlan.statusLabel, tone: "accent" };
  const statusColor = (TONE_COLOR[statusChip.tone] ?? ((cc) => cc.accent))(c);
  const hero = dailyState
    ? selectHero(dailyState)
    : { headline: dailyPlan.headline, drivers: dailyPlan.statusDrivers };

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
              <Text
                style={[styles.statusLabel, { color: statusColor }]}
                numberOfLines={2}
                ellipsizeMode="tail"
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                allowFontScaling
                maxFontSizeMultiplier={1.3}
              >
                {statusChip.label}
              </Text>
            </View>
          </View>
          <Text style={[styles.headline, { color: c.foreground }]} numberOfLines={2} adjustsFontSizeToFit>{hero.headline}</Text>
          <Text style={[styles.driversInline, { color: c.mutedForeground }]} numberOfLines={2}>
            {hero.drivers.join(" · ")}
          </Text>
          {insufficientNotice ? (
            // Insufficient-data prompt. Replaces the historical silent
            // 70% readiness fallback: we now openly tell the patient
            // we don't have enough signal yet and point them at the
            // 30-second check-in directly below.
            <View style={[styles.insufficientNotice, { backgroundColor: c.background, borderColor: c.border }]}>
              <Text style={[styles.insufficientBody, { color: c.mutedForeground }]}>
                {insufficientNotice.body}
              </Text>
            </View>
          ) : null}
          {todayCompletionRate > 0 && (
            <View style={styles.progressBarWrap}>
              <View style={[styles.progressBarBg, { backgroundColor: c.border + "40" }]}>
                <View style={[styles.progressBarFill, { backgroundColor: c.success, width: `${todayCompletionRate}%` }]} />
              </View>
            </View>
          )}
        </View>

        {/* The standalone "Request review" / "Heads up" care-team CTA
            that used to live here has been removed. The intervention
            card below now owns escalation -- when symptoms are
            severe it surfaces a single "Ask my care team to review"
            button right inside "Symptom support", which keeps
            the page focused with one clear escalation action
            instead of two competing orange prompts. The supporting
            state (showTodayEscalationCta, requestTodayReview) is
            kept in the component so we can re-surface this CTA
            elsewhere later without rewiring. */}

        {/* AI-personalized micro-interventions ("Symptom support").
            Positioned directly under the top status card so the
            patient sees what to DO immediately after seeing what
            Viva NOTICED. This is the headline value of the Today
            tab, so it sits above Treatment / insights / check-in /
            Plan. Renders only once the patient has met the minimum
            check-in (energy + nausea, see hasMinSymptomData) and an
            active intervention exists; the fallback slot lower in
            the screen handles the unusual no-min-data case. */}
        {activeInterventions.length > 0 && hasMinSymptomData && (
          <View style={{ marginBottom: 12, gap: 14 }}>
            {activeInterventions.map((iv) => (
              <InterventionCard
                key={iv.id}
                intervention={iv}
                navy={c.foreground}
                accent={c.accent}
                cardBg={c.card}
                background={c.background}
                mutedForeground={c.mutedForeground}
                warning={c.warning}
                hasHealthData={hasHealthData}
                liveCheckin={{
                  nausea,
                  appetite,
                  energy: glp1Energy,
                  digestion,
                  bowel: bowelSelectedKey,
                }}
                onAccept={onInterventionAccept}
                onDismiss={onInterventionDismiss}
                onFeedback={onInterventionFeedback}
                onEscalate={onInterventionEscalate}
              />
            ))}
          </View>
        )}

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
                  <Text style={[styles.treatmentTitle, { color: c.foreground }]}>Your treatment</Text>
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
              <Feather name="bar-chart-2" size={14} color={c.accent} />
              <Text style={[styles.insightsTitle, { color: c.foreground }]}>Recent patterns</Text>
            </View>
            <Text style={[styles.sectionSubtitle, { color: c.mutedForeground }]}>
              Patterns from your recent check-ins
            </Text>
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
              <Text style={[styles.chatHeaderTitle, { color: c.foreground }]}>Your viva Coach</Text>
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
            <Text style={[styles.inputTitle, { color: c.foreground }]}>Today&apos;s check-in</Text>
          </View>
          <Text style={[styles.sectionSubtitle, { color: c.mutedForeground }]}>
            Log today&apos;s symptoms to personalize support
          </Text>
          {inputSummary ? (
            <Text style={[styles.inputSummaryText, { color: c.mutedForeground }]}>{inputSummary}</Text>
          ) : null}
          <View style={styles.inputRows}>
            <InputRow label="Energy" options={ENERGY_OPTIONS} selected={glp1Energy} onSelect={selectGlp1Energy} containerBg={c.background} />
            <InputRow label="Appetite" options={APPETITE_OPTIONS} selected={appetite} onSelect={selectAppetite} containerBg={c.background} />
            <InputRow label="Nausea" options={NAUSEA_OPTIONS} selected={nausea} onSelect={selectNausea} containerBg={c.background} />
            <InputRow label="Digestion" options={DIGESTION_OPTIONS} selected={digestion} onSelect={selectDigestion} containerBg={c.background} />
            <InputRow label="Bowel movement today" options={BOWEL_OPTIONS} selected={bowelSelectedKey} onSelect={selectBowelMovement} containerBg={c.background} />
          </View>
        </View>

        {/* Fallback intervention slot. Only used when an intervention
            has been generated WITHOUT the patient having met the min
            check-in threshold (an unusual but possible state, e.g. a
            persisted/legacy active row from a prior session). In the
            normal flow the card above this comment renders instead. */}
        {activeInterventions.length > 0 && !hasMinSymptomData && (
          <View style={{ marginTop: 8, marginBottom: 20, gap: 14 }}>
            {activeInterventions.map((iv) => (
              <InterventionCard
                key={iv.id}
                intervention={iv}
                navy={c.foreground}
                accent={c.accent}
                cardBg={c.card}
                background={c.background}
                mutedForeground={c.mutedForeground}
                warning={c.warning}
                hasHealthData={hasHealthData}
                liveCheckin={{
                  nausea,
                  appetite,
                  energy: glp1Energy,
                  digestion,
                  bowel: bowelSelectedKey,
                }}
                onAccept={onInterventionAccept}
                onDismiss={onInterventionDismiss}
                onFeedback={onInterventionFeedback}
                onEscalate={onInterventionEscalate}
              />
            ))}
          </View>
        )}

        {/* Pilot empty-state. The legacy SymptomTipCard fallback has
            been removed from the Today tab so the patient never sees
            generic static tips ("Ease your nausea", "Stand up and
            stretch", etc.) alongside the AI-personalized loop. When
            no active personalized intervention exists, we show a
            single short prompt directing the patient to complete
            today's check-in -- saving the check-in fires /generate,
            which spawns the new "Personalized check-in" card. While
            /active is still loading on first paint, we render
            nothing to avoid a flicker between empty-state prompt
            and card. */}
        {activeLoaded && activeInterventions.length === 0 && !hasMinSymptomData && (
          <View
            style={[
              styles.dayCard,
              { backgroundColor: c.card, marginBottom: 12 },
            ]}
          >
            <Text style={[styles.dayTitle, { color: c.foreground, marginBottom: 6 }]}>
              Personalized check-in
            </Text>
            <Text style={{ color: c.mutedForeground, lineHeight: 20 }}>
              Complete today's check-in to get a personalized recommendation.
            </Text>
          </View>
        )}

        <View style={[styles.dayCard, { backgroundColor: c.card }]}>
          <View style={styles.dayHeader}>
            <View style={styles.dayTitleRow}>
              <Feather name="check-square" size={14} color={c.accent} />
              <Text style={[styles.dayTitle, { color: c.foreground }]}>Your plan</Text>
            </View>
            <Text style={[styles.dayProgress, { color: c.mutedForeground }]}>
              {completedCount}/{totalActions}
            </Text>
          </View>
          <Text style={[styles.sectionSubtitle, { color: c.mutedForeground }]}>
            Small actions that support progress
          </Text>
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

        {/* Pilot focus: behavioral signals, personalized interventions,
            and care-team escalation -- not chatbot coaching. The
            standalone "Your Coach" section is intentionally hidden
            from the Today feed for now. The underlying chat code
            (sendCoachMessage, summarizeCoachThread, the /coach tab,
            askMessages/chatMessages state) remains intact and
            available; we're only removing the Today-tab surface so
            we can re-enable it later without rebuilding it. */}
        {false && (
        <View style={[styles.askCard, { backgroundColor: c.card }]}>
          {/* Always-on section header so the chat bar below never floats
              without context. Order: header → short dynamic coach summary
              → optional prior-conversation preview → chat input. */}
          <View style={styles.insightsHeader}>
            <Feather name="message-circle" size={14} color={c.accent} />
            <Text style={[styles.insightsTitle, { color: c.foreground }]}>Your Coach</Text>
          </View>

          {(() => {
            // Short dynamic coach summary. Prefer the context-aware lead
            // phrase from planEngine (statusLabel) as the single-line
            // opener, then optionally the richer coachInsight paragraph
            // underneath when HealthKit data is available. Avoids the
            // bubble appearing empty when coachInsight has no signal.
            const lead = dailyPlan?.statusLabel?.trim();
            const detail = coachInsight?.trim();
            if (!lead && !detail) return null;
            return (
              <View style={{ gap: 6 }}>
                {lead ? (
                  <Text style={[styles.coachLeadText, { color: c.foreground }]}>{lead}</Text>
                ) : null}
                {detail && detail !== lead ? (
                  <Text style={[styles.coachInsightText, { color: c.mutedForeground }]}>{detail}</Text>
                ) : null}
              </View>
            );
          })()}

          {chatMessages.length > 0 && !showChat && (() => {
            const summary = summarizeCoachThread(chatMessages);
            if (!summary) return null;
            // Non-null assertion: this code path is currently dead
            // (the parent View is wrapped in {false && (...)} while
            // the Today coach surface is hidden for the pilot), and
            // TS narrowing of `summary` from the `if (!summary)`
            // guard is not flowing into the destructure on this
            // build. The `!` is a small, contained workaround and
            // disappears once we re-enable the coach surface.
            const { topic, takeaway, nextStep, exchangeCount } = summary!;
            return (
              <Pressable onPress={() => { haptic(); router.push("/(tabs)/coach"); }}>
                <View style={[styles.askBubble, { backgroundColor: c.background, gap: 6 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="message-square" size={11} color={c.accent} />
                    <Text style={{ color: c.accent, fontFamily: "Montserrat_600SemiBold", fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase" }} numberOfLines={1}>
                      {topic}
                    </Text>
                    <Text style={{ color: c.mutedForeground, fontFamily: "Montserrat_500Medium", fontSize: 11 }}>
                      {String.fromCharCode(183)} {exchangeCount} {exchangeCount === 1 ? "msg" : "msgs"}
                    </Text>
                  </View>
                  <Text style={[styles.askMsgText, { color: c.foreground }]} numberOfLines={2}>
                    {takeaway}
                  </Text>
                  {nextStep ? (
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 2 }}>
                      <Feather name="arrow-right" size={12} color={c.accent} style={{ marginTop: 3 }} />
                      <Text style={{ color: c.mutedForeground, fontFamily: "Montserrat_500Medium", fontSize: 13, flex: 1 }} numberOfLines={2}>
                        {nextStep}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.chatViewAll, { color: c.accent }]}>View conversation</Text>
              </Pressable>
            );
          })()}

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
            <Feather
              name={checkinSyncStatus === "failed" ? "wifi-off" : "check-circle"}
              size={14}
              color={checkinSyncStatus === "failed" ? c.mutedForeground : c.success}
            />
            <Text style={[styles.checkInDoneText, { color: c.mutedForeground }]}>
              {checkinSyncStatus === "failed"
                ? "Saved on this device — we'll sync when you're back online"
                : checkinSyncStatus === "pending"
                ? "Reflection saved · syncing…"
                : "Reflection saved"}
            </Text>
            {checkinSyncStatus === "failed" && (
              <Pressable
                onPress={() => { haptic(); void flushCheckinSync(); }}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginLeft: 4 })}
              >
                <Text style={[styles.checkInDoneText, { color: c.accent, fontWeight: "600" }]}>
                  Retry now
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {hasHealthData && metricItems.length > 0 ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            <View style={{ gap: 4 }}>
              <Text style={[styles.todayMetricsTitle, { color: c.foreground }]}>Today's Key Metrics</Text>
              <Text style={[styles.todayMetricsSub, { color: c.mutedForeground }]}>Today's values from Apple Health</Text>
            </View>
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
              Unlock more personalized support with sleep, steps and heart rate.
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
                  { key: "low" as const, label: "Low", tint: TINT_AMBER_SOFT },
                  { key: "burnt_out" as const, label: "Burnt out", tint: TINT_AMBER },
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
      <WeightLogModal
        visible={weightModalOpen}
        daysSinceLast={weightDaysSince}
        initialValue={latestWeightLbs}
        onClose={() => setWeightModalOpen(false)}
        onLogged={(w) => {
          setLatestWeightLbs(w);
          setWeightDaysSince(0);
          updateProfileForWeightSync({ weight: w });
        }}
      />
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
    // Logo / greeting / status card read as one vertical stack at the
    // top of the screen. We want the greeting to sit visually centered
    // between the logo above and the gray card below.
    //   gap above greeting = ScreenHeader.paddingBottom (8) + this marginTop
    //   gap below greeting = this marginBottom
    // Set both to land at ~26pt so the eye reads even spacing.
    marginTop: 18,
    marginBottom: 26,
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
    maxWidth: "92%",
    flexShrink: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  statusLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.3,
    flexShrink: 1,
    textAlign: "center",
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
  insufficientNotice: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  insufficientBody: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 18,
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
    marginBottom: 4,
  },
  // Title + matching section icon row, used inside dayHeader so the
  // plan section reads with the same icon-prefixed treatment as the
  // other Today-tab section headers (treatment, recent patterns,
  // today's check-in).
  dayTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dayTitle: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.1,
  },
  // Shared subtitle for section headers across the Today tab. Sits
  // directly under the icon + title row and gives every section a
  // one-liner that explains its role -- "Patterns from your recent
  // check-ins", "Log today's symptoms to personalize support",
  // "Small actions that support progress" -- so the page reads as a
  // hierarchy of clearly-different surfaces.
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: "Montserrat_500Medium",
    marginBottom: 10,
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
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  todayMetricsTitle: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: -0.3,
  },
  todayMetricsSub: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    marginBottom: 2,
    opacity: 0.7,
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
  // Lead phrase sits under the "Your Coach" header and acts as the one-line
  // dynamic coach summary. Slightly heavier weight + tighter tracking than
  // the detail paragraph to read as the primary line.
  coachLeadText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
    lineHeight: 22,
    letterSpacing: -0.2,
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
