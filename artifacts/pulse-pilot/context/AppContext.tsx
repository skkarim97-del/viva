import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";

import {
  defaultProfile,
  generateTrendDataFromMetrics,
  integrations as defaultIntegrations,
} from "@/data/mockData";
import {
  generateDailyPlan,
  generateWeeklyPlan,
  calculateDropoutRisk,
  computeInputAnalytics,
  buildPatientSummary,
  computeUserPatterns,
  generateAdaptiveInsights,
  computeInternalSeverity,
  applyAdaptiveOverrides,
  selectDailyTreatmentState,
  type DailyTreatmentState,
} from "@/lib/engine";
import { computeInsights, type DailyInsights } from "@/data/insights";
import type { UserPatterns, AdaptiveInsight } from "@/types";
import { fetchHealthData, connectProvider, type AvailableMetricType } from "@/data/healthProviders";
import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  DailyAction,
  WeeklyPlan,
  WeeklyPlanDay,
  WeeklyDayAction,
  TrendData,
  WorkoutEntry,
  ChatMessage,
  IntegrationStatus,
  SubscriptionTier,
  FeelingType,
  EnergyLevel,
  StressLevel,
  HydrationLevel,
  TrainingIntent,
  CompletionRecord,
  ActionCategory,
  DailyCheckIn,
  GLP1DailyInputs,
  AppetiteLevel,
  NauseaLevel,
  DigestionStatus,
  EnergyDaily,
  DropoutRiskResult,
  MedicationLogEntry,
  MedicationProfile,
  InputAnalytics,
  PatientSummary,
} from "@/types";

import { API_BASE } from "@/lib/apiConfig";
import { sessionApi } from "@/lib/api/sessionClient";
import { checkinSync, type SyncStatus } from "@/lib/sync/checkinSync";
import { logCareEventImmediate } from "@/lib/care-events/client";

interface AppContextType {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
  completeOnboarding: () => void;
  metrics: HealthMetrics[];
  todayMetrics: HealthMetrics | null;
  hasHealthData: boolean;
  availableMetricTypes: AvailableMetricType[];
  dailyPlan: DailyPlan | null;
  // Central daily treatment state. New surfaces should consume this
  // (via selectors in lib/engine/selectors) instead of reading
  // dailyPlan directly. dailyPlan stays exposed during the migration
  // window so legacy consumers (workout card, action toggles, why-
  // this-plan modal) keep working without changes.
  dailyState: DailyTreatmentState | null;
  weeklyPlan: WeeklyPlan | null;
  trends: TrendData[];
  workouts: WorkoutEntry[];
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  integrations: IntegrationStatus[];
  toggleIntegration: (id: string) => void;
  isLoading: boolean;
  upgradeTier: (tier: SubscriptionTier) => void;
  insights: DailyInsights | null;
  feeling: FeelingType;
  setFeeling: (feeling: FeelingType) => void;
  energy: EnergyLevel;
  setEnergy: (energy: EnergyLevel) => void;
  stress: StressLevel;
  setStress: (stress: StressLevel) => void;
  hydration: HydrationLevel;
  setHydration: (hydration: HydrationLevel) => void;
  trainingIntent: TrainingIntent;
  setTrainingIntent: (trainingIntent: TrainingIntent) => void;
  toggleAction: (actionId: string) => void;
  editAction: (actionId: string, newText: string) => void;
  editWeeklyAction: (date: string, category: ActionCategory, newText: string) => void;
  toggleWeeklyAction: (date: string, category: ActionCategory) => void;
  completionHistory: CompletionRecord[];
  weeklyConsistency: number;
  weeklyDaysCompleted: number;
  streakDays: number;
  todayCompletionRate: number;
  lastCompletionFeedback: string | null;
  clearCompletionFeedback: () => void;
  checkInHistory: DailyCheckIn[];
  saveDailyCheckIn: (checkIn: DailyCheckIn) => void;
  todayCheckIn: DailyCheckIn | null;
  // Mark a symptom-tip as acknowledged for today. Mirrors to the
  // server when today's check-in row exists; otherwise queues the ack
  // and replays it after the next saveDailyCheckIn.
  acknowledgeSymptomTip: (
    symptom: import("@/lib/symptomTips").SymptomKind,
    interventionTitle: string,
    interventionCta: string,
    interventionSummary: string,
  ) => void;
  // Day-after follow-up answer (Better/Same/Worse). Mirrors to the
  // server and dismisses the tip card locally.
  recordSymptomTrend: (
    symptom: import("@/lib/symptomTips").SymptomKind,
    response: "better" | "same" | "worse",
    interventionTitle: string,
  ) => void;
  // Patient explicitly asked the clinician to be aware. Mirrors to the
  // server (sticky on the most recent check-in row).
  requestClinicianForSymptom: (
    symptom: import("@/lib/symptomTips").SymptomKind,
  ) => void;
  // Per-symptom YYYY-MM-DD of the most recent guidance ack. Used by
  // the Today tab to decide whether to show the day-after follow-up
  // question when the same symptom recurs.
  guidanceAckHistory: Partial<Record<import("@/lib/symptomTips").SymptomKind, string>>;
  // Most recently acked intervention title per symptom. Used by the
  // Today tab to render the followup card with the title the patient
  // actually saw, not whatever today's derived tip happens to be.
  guidanceAckTitleHistory: Partial<
    Record<
      import("@/lib/symptomTips").SymptomKind,
      { date: string; title: string; cta?: string; summary?: string }
    >
  >;
  // Per-symptom set of "patient asked clinician for awareness today"
  // -- drives the inline confirmation on the tip card.
  clinicianRequestedToday: Partial<Record<import("@/lib/symptomTips").SymptomKind, true>>;
  // Background-sync state for the daily check-in mirror. The Today
  // tab shows a small fallback line when status === "failed" so the
  // patient knows their data is safe locally and will sync later.
  // "synced" is the resting state when the queue is empty; "pending"
  // is in flight; "failed" means the last drain attempt left items
  // queued (network down, server 5xx, timeout).
  checkinSyncStatus: SyncStatus;
  checkinLastSyncAt: string | null;
  // Manual retry hook. Wired to AppState "active" transitions and
  // can be exposed via a "Retry sync" UI affordance later.
  flushCheckinSync: () => Promise<void>;
  glp1Energy: EnergyDaily;
  setGlp1Energy: (v: EnergyDaily) => void;
  appetite: AppetiteLevel;
  setAppetite: (v: AppetiteLevel) => void;
  nausea: NauseaLevel;
  setNausea: (v: NauseaLevel) => void;
  digestion: DigestionStatus;
  setDigestion: (v: DigestionStatus) => void;
  bowelMovementToday: boolean | null;
  setBowelMovementToday: (v: boolean | null) => void;
  riskResult: DropoutRiskResult | null;
  glp1InputHistory: GLP1DailyInputs[];
  medicationLog: MedicationLogEntry[];
  logMedicationDose: (entry: MedicationLogEntry) => void;
  removeMedicationDose: (entryId: string) => void;
  inputAnalytics: InputAnalytics | null;
  patientSummary: PatientSummary | null;
  userPatterns: UserPatterns | null;
  adaptiveInsights: AdaptiveInsight[];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const PROFILE_KEY = "@viva_profile";
const CHAT_KEY = "@viva_chat";
const WELLNESS_KEY = "@viva_wellness";
const COMPLETION_KEY = "@viva_completions";
const INTEGRATIONS_KEY = "@viva_integrations";
const WEEKLY_PLAN_KEY = "@viva_weekly_plan";
const CHECKIN_KEY = "@viva_checkins";
const GLP1_INPUTS_KEY = "@viva_glp1_inputs";
const GLP1_HISTORY_KEY = "@viva_glp1_history";
const MED_LOG_KEY = "@viva_med_log";
const GUIDANCE_ACK_HISTORY_KEY = "@viva_guidance_ack_history";
const GUIDANCE_ACK_TITLE_HISTORY_KEY = "@viva_guidance_ack_title_history";
// Per-symptom most-recent intervention feedback (better/same/worse)
// plus its timestamp. Used by the local risk engine to apply a
// small +/-5 nudge on the score so the patient sees their own
// signal reflected in the support headline.
const LAST_INTERVENTION_FEEDBACK_KEY = "@viva_last_intervention_feedback";
type InterventionFeedbackResponse = "better" | "same" | "worse";
type LastInterventionFeedbackMap = Partial<
  Record<
    import("@/lib/symptomTips").SymptomKind,
    { response: InterventionFeedbackResponse; ts: number }
  >
>;
const CLINICIAN_REQUESTED_DATES_KEY = "@viva_clinician_requested_dates";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [metrics, setMetrics] = useState<HealthMetrics[]>([]);
  const [todayMetrics, setTodayMetrics] = useState<HealthMetrics | null>(null);
  const [hasHealthData, setHasHealthData] = useState(false);
  const [availableMetricTypes, setAvailableMetricTypes] = useState<AvailableMetricType[]>([]);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [integrationsState, setIntegrationsState] = useState<IntegrationStatus[]>(defaultIntegrations);
  const [isLoading, setIsLoading] = useState(true);
  const [insights, setInsights] = useState<DailyInsights | null>(null);
  const [feeling, setFeelingState] = useState<FeelingType>(null);
  const [energy, setEnergyState] = useState<EnergyLevel>(null);
  const [stress, setStressState] = useState<StressLevel>(null);
  const [hydration, setHydrationState] = useState<HydrationLevel>(null);
  const [trainingIntent, setTrainingIntentState] = useState<TrainingIntent>(null);
  const [metricsRef, setMetricsRef] = useState<HealthMetrics | null>(null);
  const [completionHistory, setCompletionHistory] = useState<CompletionRecord[]>([]);
  const [lastCompletionFeedback, setLastCompletionFeedback] = useState<string | null>(null);
  const [checkInHistory, setCheckInHistory] = useState<DailyCheckIn[]>([]);

  const [glp1Energy, setGlp1EnergyState] = useState<EnergyDaily>(null);
  const [appetite, setAppetiteState] = useState<AppetiteLevel>(null);
  const [nausea, setNauseaState] = useState<NauseaLevel>(null);
  const [digestion, setDigestionState] = useState<DigestionStatus>(null);
  const [bowelMovementToday, setBowelMovementTodayState] = useState<boolean | null>(null);
  const [riskResult, setRiskResult] = useState<DropoutRiskResult | null>(null);
  const [glp1InputHistory, setGlp1InputHistory] = useState<GLP1DailyInputs[]>([]);
  const [medicationLog, setMedicationLog] = useState<MedicationLogEntry[]>([]);
  const [inputAnalytics, setInputAnalytics] = useState<InputAnalytics | null>(null);
  const [patientSummary, setPatientSummary] = useState<PatientSummary | null>(null);
  const [userPatterns, setUserPatterns] = useState<UserPatterns | null>(null);
  const [adaptiveInsights, setAdaptiveInsights] = useState<AdaptiveInsight[]>([]);
  const baselineWeeklyPlanRef = useRef<WeeklyPlan | null>(null);
  // Background sync state for the daily check-in mirror. Mirrored
  // from `checkinSync` (the persistent queue) via subscribe() so the
  // Today tab can render a small fallback indicator when the last
  // drain attempt left items queued. The persistent queue itself is
  // the source of truth for what's pending; these state values are
  // for rendering only.
  const [checkinSyncStatus, setCheckinSyncStatus] = useState<SyncStatus>("synced");
  const [checkinLastSyncAt, setCheckinLastSyncAt] = useState<string | null>(null);
  useEffect(() => {
    const unsub = checkinSync.subscribe((status, lastSyncAt) => {
      setCheckinSyncStatus(status);
      setCheckinLastSyncAt(lastSyncAt);
    });
    // Drain on mount so a check-in queued during the previous session
    // (or while offline) is mirrored as soon as the app boots with a
    // valid bearer token. Errors are absorbed by the queue.
    void checkinSync.flush();
    return unsub;
  }, []);
  const flushCheckinSync = useCallback(async () => {
    await checkinSync.flush();
  }, []);

  // Persisted: per-symptom date of the most recent guidance ack. The
  // Today tab compares this to today's date to decide whether to
  // promote the tip card from "Got it" to "Better / Same / Worse".
  const [guidanceAckHistory, setGuidanceAckHistory] = useState<
    Partial<Record<import("@/lib/symptomTips").SymptomKind, string>>
  >({});
  // Per-symptom { date, title } of the most recent guidance ack. Used
  // by the followup card to quote the intervention the patient
  // actually saw yesterday, not whatever today's deriveSymptomTips()
  // happens to produce (relevant for nausea where the title varies
  // by severity). Fallback to the current tip title at render time
  // covers legacy state from before this map existed.
  const [guidanceAckTitleHistory, setGuidanceAckTitleHistory] = useState<
    Partial<
      Record<
        import("@/lib/symptomTips").SymptomKind,
        { date: string; title: string; cta?: string; summary?: string }
      >
    >
  >({});
  // Per-symptom YYYY-MM-DD of the most recent "Let my clinician know"
  // tap. Persisted alongside guidanceAckHistory so the inline
  // confirmation chip survives a backgrounded app, but day-scoped
  // (not sticky) so it auto-resets at midnight without leaking the
  // previous day's escalation prompt into a new day's UX.
  const [clinicianRequestedDates, setClinicianRequestedDates] = useState<
    Partial<Record<import("@/lib/symptomTips").SymptomKind, string>>
  >({});
  const [lastInterventionFeedback, setLastInterventionFeedback] =
    useState<LastInterventionFeedbackMap>({});

  // Keep the weekly plan's "today" day in sync with the actual daily plan.
  // generateWeeklyPlan() uses a static rotation that is disconnected from
  // the live daily check-in, so without this patch the Plan tab shows
  // stale guidance for today while the Today tab shows the real state.
  useEffect(() => {
    if (!dailyPlan) return;
    const todayDate = new Date().toISOString().split("T")[0];
    setWeeklyPlan(prev => {
      if (!prev) return prev;
      const idx = prev.days.findIndex(d => d.date === todayDate);
      if (idx === -1) return prev;
      const existing = prev.days[idx];
      const liveActions: WeeklyDayAction[] = dailyPlan.actions
        .filter(a => a.category !== "consistent")
        .map(a => ({
          category: a.category,
          recommended: a.recommended,
          chosen: a.text !== a.recommended ? a.text : a.recommended,
          completed: a.completed,
        }));
      const nextFocus = dailyPlan.dailyFocus || existing.focusArea;
      const nextAdaptive = dailyPlan.headline;
      const sameFocus = existing.focusArea === nextFocus;
      const sameNote = existing.adaptiveNote === nextAdaptive;
      const sameActions = existing.actions.length === liveActions.length &&
        existing.actions.every((a, i) =>
          a.category === liveActions[i].category &&
          a.recommended === liveActions[i].recommended &&
          a.chosen === liveActions[i].chosen &&
          a.completed === liveActions[i].completed,
        );
      if (sameFocus && sameNote && sameActions) return prev;
      const newDay: WeeklyPlanDay = {
        ...existing,
        focusArea: nextFocus,
        actions: liveActions,
        adaptiveNote: nextAdaptive,
        isAdapted: true,
      };
      const newDays = prev.days.slice();
      newDays[idx] = newDay;
      return { ...prev, days: newDays };
    });
  }, [dailyPlan]);

  const setBaselineAndAdapt = useCallback((
    basePlan: WeeklyPlan,
    inputHistory: GLP1DailyInputs[],
    checkIns: DailyCheckIn[],
    allMetrics: HealthMetrics[],
    medProfile?: MedicationProfile,
    medLog?: MedicationLogEntry[],
  ) => {
    baselineWeeklyPlanRef.current = basePlan;
    const severityResult = computeInternalSeverity({
      recentInputs: inputHistory.slice(-7),
      recentCheckIns: checkIns.slice(-7),
      recentMetrics: allMetrics.slice(-7),
      medicationProfile: medProfile,
      medicationLog: medLog,
      completionHistory: [],
      hasHealthData,
    });
    const adapted = applyAdaptiveOverrides(basePlan, severityResult);
    setWeeklyPlan(adapted);
  }, [hasHealthData]);

  const setBaselineAndAdaptWithFlag = useCallback((
    basePlan: WeeklyPlan,
    inputHistory: GLP1DailyInputs[],
    checkIns: DailyCheckIn[],
    allMetrics: HealthMetrics[],
    medProfile?: MedicationProfile,
    medLog?: MedicationLogEntry[],
    healthFlag?: boolean,
  ) => {
    baselineWeeklyPlanRef.current = basePlan;
    const severityResult = computeInternalSeverity({
      recentInputs: inputHistory.slice(-7),
      recentCheckIns: checkIns.slice(-7),
      recentMetrics: allMetrics.slice(-7),
      medicationProfile: medProfile,
      medicationLog: medLog,
      completionHistory: [],
      hasHealthData: healthFlag,
    });
    const adapted = applyAdaptiveOverrides(basePlan, severityResult);
    setWeeklyPlan(adapted);
  }, []);

  const recomputeAdaptation = useCallback((
    inputHistory: GLP1DailyInputs[],
    checkIns: DailyCheckIn[],
    allMetrics: HealthMetrics[],
    medProfile?: MedicationProfile,
    medLog?: MedicationLogEntry[],
  ) => {
    const baseline = baselineWeeklyPlanRef.current;
    if (!baseline) return;
    const severityResult = computeInternalSeverity({
      recentInputs: inputHistory.slice(-7),
      recentCheckIns: checkIns.slice(-7),
      recentMetrics: allMetrics.slice(-7),
      medicationProfile: medProfile,
      medicationLog: medLog,
      completionHistory: [],
      hasHealthData,
    });
    const adapted = applyAdaptiveOverrides(baseline, severityResult);
    setWeeklyPlan(adapted);
  }, [hasHealthData]);

  useEffect(() => {
    loadData();
  }, []);

  const fetchAIWeeklyPlan = async (allMetrics: HealthMetrics[], userProfile: UserProfile, history: CompletionRecord[]) => {
    try {
      const res = await fetch(`${API_BASE}/coach/weekly-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          healthContext: {
            recentMetrics: allMetrics.slice(-14),
            profile: {
              age: userProfile.age,
              sex: userProfile.sex,
              goals: userProfile.goals,
              daysAvailableToTrain: userProfile.daysAvailableToTrain,
              availableWorkoutTime: userProfile.availableWorkoutTime,
              glp1Medication: userProfile.glp1Medication,
              glp1Duration: userProfile.glp1Duration,
              proteinConfidence: userProfile.proteinConfidence,
              strengthTrainingBaseline: userProfile.strengthTrainingBaseline,
            },
            completionHistory: history.slice(-7),
          },
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.days || !Array.isArray(data.days)) return;

      const today = new Date();
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
      const weekStartDate = monday.toISOString().split("T")[0];
      const categories: ActionCategory[] = ["move", "fuel", "hydrate", "recover", "consistent"];

      const aiDays: WeeklyPlanDay[] = data.days.map((d: any, i: number) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        return {
          dayOfWeek: d.dayOfWeek || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i],
          date: date.toISOString().split("T")[0],
          focusArea: d.focusArea || "",
          actions: categories.map((cat): WeeklyDayAction => ({
            category: cat,
            recommended: d[cat] || "",
            chosen: d[cat] || "",
            completed: false,
          })),
        };
      });

      const aiPlan: WeeklyPlan = {
        weekStartDate,
        weekSummary: data.weekSummary || "",
        days: aiDays,
        adjustmentNote: data.adjustmentNote,
      };

      const prevBaseline = baselineWeeklyPlanRef.current;
      let newBaseline: WeeklyPlan;
      if (prevBaseline && prevBaseline.weekStartDate === weekStartDate) {
        newBaseline = {
          ...aiPlan,
          days: aiPlan.days.map((aiDay) => {
            const existingDay = prevBaseline.days.find(d => d.date === aiDay.date);
            if (!existingDay) return aiDay;
            const hasEdits = existingDay.actions.some(a => a.chosen !== a.recommended || a.completed);
            if (hasEdits) return existingDay;
            return aiDay;
          }),
        };
      } else {
        newBaseline = aiPlan;
      }
      AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(newBaseline));
      baselineWeeklyPlanRef.current = newBaseline;
      const severityResult = computeInternalSeverity({
        recentInputs: [],
        recentCheckIns: [],
        recentMetrics: allMetrics.slice(-7),
        completionHistory: [],
        hasHealthData: true,
      });
      setWeeklyPlan(applyAdaptiveOverrides(newBaseline, severityResult));
    } catch {}
  };

  // Snapshot of the latest per-symptom feedback. Held in a ref so
  // `computeRisk` (whose stable identity matters for downstream
  // useEffect deps) can read the freshest value without us having
  // to thread it through every call site.
  const lastInterventionFeedbackRef = useRef<LastInterventionFeedbackMap>({});
  useEffect(() => {
    lastInterventionFeedbackRef.current = lastInterventionFeedback;
  }, [lastInterventionFeedback]);

  const computeRisk = useCallback((allMetrics: HealthMetrics[], inputHistory: GLP1DailyInputs[], history: CompletionRecord[], medProfile?: MedicationProfile) => {
    try {
      // Pick the freshest feedback across all symptoms, but only if
      // it's recent enough to still be relevant (24h window). Older
      // answers shouldn't keep nudging today's score.
      const FEEDBACK_TTL_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      let freshest: { response: InterventionFeedbackResponse; ts: number } | null = null;
      for (const v of Object.values(lastInterventionFeedbackRef.current)) {
        if (!v) continue;
        if (now - v.ts > FEEDBACK_TTL_MS) continue;
        if (!freshest || v.ts > freshest.ts) freshest = v;
      }
      const result = calculateDropoutRisk({
        recentMetrics: allMetrics,
        dailyInputs: inputHistory,
        completionHistory: history,
        medicationProfile: medProfile,
        lastInterventionFeedback: freshest?.response ?? null,
      });
      setRiskResult(result);
    } catch {}
  }, []);

  const recomputeAnalytics = useCallback((inputHistory: GLP1DailyInputs[], medProfile?: MedicationProfile, medLog?: MedicationLogEntry[], completions?: CompletionRecord[]): UserPatterns | null => {
    try {
      const analytics = computeInputAnalytics(inputHistory);
      setInputAnalytics(analytics);
      const patterns = computeUserPatterns(inputHistory, medLog ?? [], completions ?? []);
      setUserPatterns(patterns);
      const insights = generateAdaptiveInsights(patterns);
      setAdaptiveInsights(insights);
      const summary = buildPatientSummary(inputHistory, medProfile, medLog ?? [], completions ?? [], patterns);
      setPatientSummary(summary);
      return patterns;
    } catch {}
    return null;
  }, []);

  const loadData = async () => {
    try {
      const savedProfile = await AsyncStorage.getItem(PROFILE_KEY);
      if (savedProfile) {
        const parsed = JSON.parse(savedProfile);
        if (parsed.onboardingComplete && !parsed.medicationProfile && defaultProfile.medicationProfile) {
          parsed.medicationProfile = defaultProfile.medicationProfile;
        }
        setProfile(parsed);
      }

      const savedChat = await AsyncStorage.getItem(CHAT_KEY);
      if (savedChat) {
        setChatMessages(JSON.parse(savedChat));
      }

      const todayDate = new Date().toISOString().split("T")[0];
      let currentFeeling: FeelingType = null;
      let currentEnergy: EnergyLevel = null;
      let currentStress: StressLevel = null;
      let currentHydration: HydrationLevel = null;
      let currentTrainingIntent: TrainingIntent = null;
      const savedWellness = await AsyncStorage.getItem(WELLNESS_KEY);
      // Restore the per-symptom guidance ack history. Used by the
      // Today tab to flip the tip card into "Better/Same/Worse"
      // mode the day after the patient acknowledged guidance.
      try {
        const savedAckHist = await AsyncStorage.getItem(GUIDANCE_ACK_HISTORY_KEY);
        if (savedAckHist) setGuidanceAckHistory(JSON.parse(savedAckHist));
        const savedAckTitleHist = await AsyncStorage.getItem(GUIDANCE_ACK_TITLE_HISTORY_KEY);
        if (savedAckTitleHist) setGuidanceAckTitleHistory(JSON.parse(savedAckTitleHist));
        const savedClinReq = await AsyncStorage.getItem(CLINICIAN_REQUESTED_DATES_KEY);
        if (savedClinReq) setClinicianRequestedDates(JSON.parse(savedClinReq));
        const savedFb = await AsyncStorage.getItem(LAST_INTERVENTION_FEEDBACK_KEY);
        if (savedFb) setLastInterventionFeedback(JSON.parse(savedFb));
      } catch { /* ignore corrupt cache */ }

      if (savedWellness) {
        const parsed = JSON.parse(savedWellness);
        if (parsed.date === todayDate) {
          currentFeeling = parsed.feeling ?? null;
          currentEnergy = parsed.energy ?? null;
          currentStress = parsed.stress ?? null;
          currentHydration = parsed.hydration ?? null;
          currentTrainingIntent = parsed.trainingIntent ?? null;
          setFeelingState(currentFeeling);
          setEnergyState(currentEnergy);
          setStressState(currentStress);
          setHydrationState(currentHydration);
          setTrainingIntentState(currentTrainingIntent);
        }
      }

      let currentGlp1Inputs: GLP1DailyInputs | null = null;
      const savedGlp1 = await AsyncStorage.getItem(GLP1_INPUTS_KEY);
      if (savedGlp1) {
        const parsed = JSON.parse(savedGlp1);
        if (parsed.date === todayDate) {
          currentGlp1Inputs = parsed;
          setGlp1EnergyState(parsed.energy ?? null);
          setAppetiteState(parsed.appetite ?? null);
          setNauseaState(parsed.nausea ?? null);
          setDigestionState(parsed.digestion ?? null);
          setBowelMovementTodayState(parsed.bowelMovementToday ?? null);
        }
      }

      let loadedGlp1History: GLP1DailyInputs[] = [];
      const savedGlp1History = await AsyncStorage.getItem(GLP1_HISTORY_KEY);
      if (savedGlp1History) {
        loadedGlp1History = JSON.parse(savedGlp1History);
        setGlp1InputHistory(loadedGlp1History);
      }

      let loadedHistory: CompletionRecord[] = [];
      const savedCompletions = await AsyncStorage.getItem(COMPLETION_KEY);
      if (savedCompletions) {
        loadedHistory = JSON.parse(savedCompletions);
        setCompletionHistory(loadedHistory);
      }

      let loadedCheckIns: import("@/types").DailyCheckIn[] = [];
      const savedCheckIns = await AsyncStorage.getItem(CHECKIN_KEY);
      if (savedCheckIns) {
        const raw = JSON.parse(savedCheckIns) as any[];
        loadedCheckIns = raw.map((c: any) => ({
          date: c.date,
          mentalState: c.mentalState ?? null,
        }));
        setCheckInHistory(loadedCheckIns);
        await AsyncStorage.setItem(CHECKIN_KEY, JSON.stringify(loadedCheckIns));
      }

      let loadedMedLog: import("@/types").MedicationLogEntry[] = [];
      const savedMedLog = await AsyncStorage.getItem(MED_LOG_KEY);
      if (savedMedLog) {
        loadedMedLog = JSON.parse(savedMedLog);
        setMedicationLog(loadedMedLog);
      }

      const savedIntegrations = await AsyncStorage.getItem(INTEGRATIONS_KEY);
      let currentIntegrations = integrationsState;
      if (savedIntegrations) {
        const parsed = JSON.parse(savedIntegrations);
        currentIntegrations = integrationsState.map((i) => {
          const saved = parsed.find((s: any) => s.id === i.id);
          return saved ? { ...i, connected: saved.connected } : i;
        });
        setIntegrationsState(currentIntegrations);
      }

      const connectedIds = currentIntegrations
        .filter((i) => i.connected)
        .map((i) => i.id);

      let allMetrics: HealthMetrics[] = [];
      let dataSource: string | null = null;
      let healthDataFound = false;

      let loadedAvailableTypes: AvailableMetricType[] = [];
      if (connectedIds.length > 0) {
        const result = await fetchHealthData(connectedIds, 28);
        if (result.metrics.length > 0) {
          allMetrics = result.metrics;
          dataSource = result.source;
          healthDataFound = true;
          loadedAvailableTypes = result.availableTypes;
        }
      }

      setMetrics(allMetrics);
      setHasHealthData(healthDataFound);
      setAvailableMetricTypes(loadedAvailableTypes);

      if (dataSource) {
        setIntegrationsState((prev) =>
          prev.map((i) =>
            i.id === dataSource
              ? { ...i, connected: true, lastSync: new Date().toLocaleTimeString() }
              : i
          )
        );
      }

      let savedProfileData = savedProfile ? JSON.parse(savedProfile) : defaultProfile;
      if (savedProfileData.onboardingComplete && !savedProfileData.medicationProfile && defaultProfile.medicationProfile) {
        savedProfileData = { ...savedProfileData, medicationProfile: defaultProfile.medicationProfile };
      }

      // Nullable fields MUST be null when no wearable data exists. Using 0
      // causes downstream engines, detail views, and correlation cards to
      // render phantom "recovery is low" / "HRV has been low" copy from a
      // fake zero. Leave steps / calories / sleepDuration as 0 since those
      // are non-nullable in the type and 0 is a legitimate reading.
      const neutralMetrics: HealthMetrics = {
        date: todayDate,
        steps: 0,
        caloriesBurned: 0,
        activeCalories: 0,
        restingHeartRate: null,
        hrv: null,
        weight: savedProfileData?.weight ?? null,
        sleepDuration: 0,
        sleepQuality: null,
        recoveryScore: null,
        strain: null,
      };

      const today = healthDataFound ? allMetrics[allMetrics.length - 1] : neutralMetrics;
      setTodayMetrics(today);
      setMetricsRef(today);

      let loadedPatterns: UserPatterns | undefined;
      try {
        loadedPatterns = computeUserPatterns(loadedGlp1History, loadedMedLog, loadedHistory);
        setUserPatterns(loadedPatterns);
        const patternInsights = generateAdaptiveInsights(loadedPatterns);
        setAdaptiveInsights(patternInsights);
      } catch {}

      const initCheckIn = loadedCheckIns.find(c => c.date === todayDate);
      const metricsForPlan = healthDataFound ? allMetrics : [neutralMetrics];
      const plan = generateDailyPlan(
        today,
        { feeling: currentFeeling, energy: currentEnergy, stress: currentStress, hydration: currentHydration, trainingIntent: currentTrainingIntent },
        loadedHistory,
        metricsForPlan,
        currentGlp1Inputs ?? undefined,
        savedProfileData.medicationProfile,
        loadedMedLog,
        loadedPatterns,
        initCheckIn?.mentalState ?? undefined,
        healthDataFound,
        loadedAvailableTypes,
      );
      const todayCompletion = loadedHistory.find(r => r.date === todayDate);
      if (todayCompletion) {
        for (const a of plan.actions) {
          const saved = todayCompletion.actions.find(sa => sa.id === a.id);
          if (saved) {
            a.completed = saved.completed;
            if (saved.chosen) a.text = saved.chosen;
          }
        }
      }
      setDailyPlan(plan);
      const savedWeeklyPlan = await AsyncStorage.getItem(WEEKLY_PLAN_KEY);
      const generatedWeekly = generateWeeklyPlan();
      let baseWeekly: WeeklyPlan;
      if (savedWeeklyPlan) {
        const parsed = JSON.parse(savedWeeklyPlan);
        baseWeekly = parsed.weekStartDate === generatedWeekly.weekStartDate ? parsed : generatedWeekly;
      } else {
        baseWeekly = generatedWeekly;
      }
      setBaselineAndAdaptWithFlag(baseWeekly, loadedGlp1History, loadedCheckIns, metricsForPlan, savedProfileData.medicationProfile, loadedMedLog, healthDataFound);

      if (healthDataFound) {
        fetchAIWeeklyPlan(allMetrics, savedProfileData, loadedHistory);
        setTrends(generateTrendDataFromMetrics(allMetrics));
        setInsights(computeInsights(allMetrics, today, [], savedProfileData, loadedHistory));
      } else {
        setTrends([]);
        setInsights(null);
      }
      setWorkouts([]);

      computeRisk(allMetrics, loadedGlp1History, loadedHistory, savedProfileData.medicationProfile);
      recomputeAnalytics(loadedGlp1History, savedProfileData.medicationProfile, loadedMedLog, loadedHistory);
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const saveGlp1Inputs = useCallback((
    en: EnergyDaily, ap: AppetiteLevel, na: NauseaLevel, di: DigestionStatus,
    bm: boolean | null = bowelMovementToday,
  ) => {
    const todayDate = new Date().toISOString().split("T")[0];

    setGlp1InputHistory(prev => {
      // Same-day "previous value" capture. If the patient already
      // saved a row for today, snapshot whichever fields actually
      // changed -- this gives downstream features ("Energy worsened
      // today", smarter re-trigger) an intra-day deterioration signal
      // without ever storing a second trend datapoint. Strict !== so
      // a no-op edit doesn't pretend to be a change.
      const existing = prev.find(i => i.date === todayDate);
      const previousEnergy = existing && existing.energy !== en ? existing.energy : null;
      const previousAppetite = existing && existing.appetite !== ap ? existing.appetite : null;
      const previousNausea = existing && existing.nausea !== na ? existing.nausea : null;
      const previousDigestion = existing && existing.digestion !== di ? existing.digestion : null;

      const inputs: GLP1DailyInputs = {
        date: todayDate, energy: en, appetite: ap, nausea: na, digestion: di,
        bowelMovementToday: bm,
        previousEnergy, previousAppetite, previousNausea, previousDigestion,
      };
      AsyncStorage.setItem(GLP1_INPUTS_KEY, JSON.stringify(inputs));

      const filtered = prev.filter(i => i.date !== todayDate);
      const updated = [...filtered, inputs].slice(-30);
      AsyncStorage.setItem(GLP1_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const saveWellness = useCallback((f: FeelingType, e: EnergyLevel, s: StressLevel, h: HydrationLevel, ti: TrainingIntent) => {
    const todayDate = new Date().toISOString().split("T")[0];
    AsyncStorage.setItem(WELLNESS_KEY, JSON.stringify({ date: todayDate, feeling: f, energy: e, stress: s, hydration: h, trainingIntent: ti }));
  }, []);

  const regeneratePlan = useCallback((f: FeelingType, e: EnergyLevel, s: StressLevel, h: HydrationLevel, ti: TrainingIntent) => {
    if (metricsRef) {
      const todayDate = new Date().toISOString().split("T")[0];
      const currentGlp1: GLP1DailyInputs = {
        date: todayDate,
        energy: glp1Energy,
        appetite,
        nausea,
        digestion,
      };
      computeRisk(metrics, glp1InputHistory, completionHistory, profile.medicationProfile);
      const freshPatterns = recomputeAnalytics(glp1InputHistory, profile.medicationProfile, medicationLog, completionHistory);

      const currentMental = checkInHistory.find(c => c.date === todayDate)?.mentalState ?? undefined;
      const newPlan = generateDailyPlan(metricsRef, { feeling: f, energy: e, stress: s, hydration: h, trainingIntent: ti }, completionHistory, metrics, currentGlp1, profile.medicationProfile, medicationLog, freshPatterns ?? undefined, currentMental, hasHealthData, availableMetricTypes);
      const todayCompletion = completionHistory.find(r => r.date === todayDate);
      if (todayCompletion) {
        for (const a of newPlan.actions) {
          const saved = todayCompletion.actions.find(sa => sa.id === a.id);
          if (saved) {
            a.completed = saved.completed;
            if (saved.chosen) a.text = saved.chosen;
          }
        }
      }
      setDailyPlan(newPlan);
    }
  }, [metricsRef, completionHistory, metrics, glp1Energy, appetite, nausea, digestion, glp1InputHistory, computeRisk, recomputeAnalytics, profile.medicationProfile, medicationLog, checkInHistory]);

  const regenerateFromGlp1 = useCallback(() => {
    if (metricsRef) {
      const todayDate = new Date().toISOString().split("T")[0];
      const currentGlp1: GLP1DailyInputs = {
        date: todayDate,
        energy: glp1Energy,
        appetite,
        nausea,
        digestion,
      };
      computeRisk(metrics, glp1InputHistory, completionHistory, profile.medicationProfile);
      const freshPatterns = recomputeAnalytics(glp1InputHistory, profile.medicationProfile, medicationLog, completionHistory);

      const currentMental2 = checkInHistory.find(c => c.date === todayDate)?.mentalState ?? undefined;
      const newPlan = generateDailyPlan(metricsRef, { feeling, energy, stress, hydration, trainingIntent }, completionHistory, metrics, currentGlp1, profile.medicationProfile, medicationLog, freshPatterns ?? undefined, currentMental2, hasHealthData, availableMetricTypes);
      const todayCompletion = completionHistory.find(r => r.date === todayDate);
      if (todayCompletion) {
        for (const a of newPlan.actions) {
          const saved = todayCompletion.actions.find(sa => sa.id === a.id);
          if (saved) {
            a.completed = saved.completed;
            if (saved.chosen) a.text = saved.chosen;
          }
        }
      }
      setDailyPlan(newPlan);

      recomputeAdaptation(glp1InputHistory, checkInHistory, metrics, profile.medicationProfile, medicationLog);
    }
  }, [metricsRef, feeling, energy, stress, hydration, trainingIntent, completionHistory, metrics, glp1Energy, appetite, nausea, digestion, glp1InputHistory, computeRisk, recomputeAnalytics, profile.medicationProfile, medicationLog, checkInHistory, recomputeAdaptation]);

  const generateCompletionFeedback = (action: DailyAction, completed: boolean, completedCount: number, total: number): string | null => {
    if (!completed) return null;
    const categoryFeedback: Record<string, string[]> = {
      move: ["Movement done for the day", "Activity checked off", "Every step supports your journey"],
      fuel: ["Fueling on track today", "Good nutrition supports your treatment", "Protein goal noted"],
      hydrate: ["Hydration is on track", "Water intake looking good", "Staying hydrated helps with side effects"],
      recover: ["Recovery action logged", "Rest noted", "Your body will thank you"],
    };
    const options = categoryFeedback[action.category] || ["Done"];
    const msg = options[Math.floor(Math.random() * options.length)];
    if (completedCount === total) return "All actions complete today. Strong day.";
    if (completedCount >= 3) return `${msg}. ${completedCount} of ${total} done today.`;
    return msg;
  };

  const toggleAction = useCallback((actionId: string) => {
    setDailyPlan(prev => {
      if (!prev) return prev;
      const updatedActions = prev.actions.map(a =>
        a.id === actionId ? { ...a, completed: !a.completed } : a
      );
      const todayDate = new Date().toISOString().split("T")[0];
      const supportActions = updatedActions.filter(a => a.category !== "consistent");
      const completedCount = supportActions.filter(a => a.completed).length;
      const completionRate = supportActions.length > 0 ? Math.round((completedCount / supportActions.length) * 100) : 0;
      const todayRecord: CompletionRecord = {
        date: todayDate,
        actions: updatedActions.map(a => ({ id: a.id, category: a.category, completed: a.completed, recommended: a.recommended, chosen: a.text !== a.recommended ? a.text : undefined })),
        completionRate,
      };

      const toggledAction = updatedActions.find(a => a.id === actionId);
      if (toggledAction) {
        const fb = generateCompletionFeedback(toggledAction, toggledAction.completed, completedCount, supportActions.length);
        if (fb) setLastCompletionFeedback(fb);
      }

      setCompletionHistory(prevHistory => {
        const filtered = prevHistory.filter(r => r.date !== todayDate);
        const updated = [...filtered, todayRecord];
        AsyncStorage.setItem(COMPLETION_KEY, JSON.stringify(updated));
        recomputeAnalytics(glp1InputHistory, profile.medicationProfile, medicationLog, updated);
        return updated;
      });

      if (toggledAction) {
        const updateDays = (days: WeeklyPlanDay[]) => days.map(d => {
          if (d.date !== todayDate) return d;
          return {
            ...d,
            actions: d.actions.map(a =>
              a.category === toggledAction.category ? { ...a, completed: toggledAction.completed } : a
            ),
          };
        });
        if (baselineWeeklyPlanRef.current) {
          baselineWeeklyPlanRef.current = {
            ...baselineWeeklyPlanRef.current,
            days: updateDays(baselineWeeklyPlanRef.current.days),
          };
          AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(baselineWeeklyPlanRef.current));
        }
        setWeeklyPlan(wp => {
          if (!wp) return wp;
          return { ...wp, days: updateDays(wp.days) };
        });
      }

      return { ...prev, actions: updatedActions };
    });
  }, [glp1InputHistory, profile.medicationProfile, medicationLog, recomputeAnalytics]);

  const editAction = useCallback((actionId: string, newText: string) => {
    setDailyPlan(prev => {
      if (!prev) return prev;
      const updatedActions = prev.actions.map(a =>
        a.id === actionId ? { ...a, text: newText } : a
      );
      const todayDate = new Date().toISOString().split("T")[0];
      const sa = updatedActions.filter(a => a.category !== "consistent");
      const completedCount = sa.filter(a => a.completed).length;
      const completionRate = sa.length > 0 ? Math.round((completedCount / sa.length) * 100) : 0;
      const todayRecord: CompletionRecord = {
        date: todayDate,
        actions: updatedActions.map(a => ({ id: a.id, category: a.category, completed: a.completed, recommended: a.recommended, chosen: a.text !== a.recommended ? a.text : undefined })),
        completionRate,
      };
      setCompletionHistory(prevHistory => {
        const filtered = prevHistory.filter(r => r.date !== todayDate);
        const updated = [...filtered, todayRecord];
        AsyncStorage.setItem(COMPLETION_KEY, JSON.stringify(updated));
        return updated;
      });

      const editedAction = updatedActions.find(a => a.id === actionId);
      if (editedAction) {
        const editActionDays = (days: WeeklyPlanDay[]) => days.map(d => {
          if (d.date !== todayDate) return d;
          return {
            ...d,
            actions: d.actions.map(a =>
              a.category === editedAction.category ? { ...a, chosen: newText } : a
            ),
          };
        });
        if (baselineWeeklyPlanRef.current) {
          baselineWeeklyPlanRef.current = { ...baselineWeeklyPlanRef.current, days: editActionDays(baselineWeeklyPlanRef.current.days) };
          AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(baselineWeeklyPlanRef.current));
        }
        setWeeklyPlan(wp => {
          if (!wp) return wp;
          return { ...wp, days: editActionDays(wp.days) };
        });
      }

      return { ...prev, actions: updatedActions };
    });
  }, []);

  const editWeeklyAction = useCallback((date: string, category: ActionCategory, newText: string) => {
    const editDays = (days: WeeklyPlanDay[]) => days.map(d => {
      if (d.date !== date) return d;
      return {
        ...d,
        actions: d.actions.map(a =>
          a.category === category ? { ...a, chosen: newText } : a
        ),
      };
    });
    if (baselineWeeklyPlanRef.current) {
      baselineWeeklyPlanRef.current = { ...baselineWeeklyPlanRef.current, days: editDays(baselineWeeklyPlanRef.current.days) };
      AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(baselineWeeklyPlanRef.current));
    }
    setWeeklyPlan(prev => {
      if (!prev) return prev;
      const updated = { ...prev, days: editDays(prev.days) };

      const todayDate = new Date().toISOString().split("T")[0];
      if (date === todayDate) {
        setDailyPlan(prevPlan => {
          if (!prevPlan) return prevPlan;
          return {
            ...prevPlan,
            actions: prevPlan.actions.map(a =>
              a.category === category ? { ...a, text: newText } : a
            ),
          };
        });
      }
      return updated;
    });
  }, []);

  const toggleWeeklyAction = useCallback((date: string, category: ActionCategory) => {
    setWeeklyPlan(prev => {
      if (!prev) return prev;
      const dayData = prev.days.find(d => d.date === date);
      const actionData = dayData?.actions.find(a => a.category === category);
      const newCompleted = actionData ? !actionData.completed : true;

      const toggleDays = (days: WeeklyPlanDay[]) => days.map(d => {
        if (d.date !== date) return d;
        return {
          ...d,
          actions: d.actions.map(a =>
            a.category === category ? { ...a, completed: newCompleted } : a
          ),
        };
      });
      if (baselineWeeklyPlanRef.current) {
        baselineWeeklyPlanRef.current = { ...baselineWeeklyPlanRef.current, days: toggleDays(baselineWeeklyPlanRef.current.days) };
        AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(baselineWeeklyPlanRef.current));
      }
      const updated = { ...prev, days: toggleDays(prev.days) };

      const todayDate = new Date().toISOString().split("T")[0];
      if (date === todayDate) {
        setDailyPlan(prevPlan => {
          if (!prevPlan) return prevPlan;
          const updatedActions = prevPlan.actions.map(a =>
            a.category === category ? { ...a, completed: newCompleted } : a
          );
          const sa2 = updatedActions.filter(a => a.category !== "consistent");
          const completedCount = sa2.filter(a => a.completed).length;
          const completionRate = sa2.length > 0 ? Math.round((completedCount / sa2.length) * 100) : 0;
          const todayRecord: CompletionRecord = {
            date: todayDate,
            actions: updatedActions.map(a => ({ id: a.id, category: a.category, completed: a.completed, recommended: a.recommended, chosen: a.text !== a.recommended ? a.text : undefined })),
            completionRate,
          };
          setCompletionHistory(prevHistory => {
            const filtered = prevHistory.filter(r => r.date !== todayDate);
            const hist = [...filtered, todayRecord];
            AsyncStorage.setItem(COMPLETION_KEY, JSON.stringify(hist));
            return hist;
          });
          return { ...prevPlan, actions: updatedActions };
        });
      }

      return updated;
    });
  }, []);

  const setFeeling = useCallback((newFeeling: FeelingType) => {
    setFeelingState(newFeeling);
    saveWellness(newFeeling, energy, stress, hydration, trainingIntent);
    regeneratePlan(newFeeling, energy, stress, hydration, trainingIntent);
  }, [energy, stress, hydration, trainingIntent, saveWellness, regeneratePlan]);

  const setEnergy = useCallback((newEnergy: EnergyLevel) => {
    setEnergyState(newEnergy);
    saveWellness(feeling, newEnergy, stress, hydration, trainingIntent);
    regeneratePlan(feeling, newEnergy, stress, hydration, trainingIntent);
  }, [feeling, stress, hydration, trainingIntent, saveWellness, regeneratePlan]);

  const setStress = useCallback((newStress: StressLevel) => {
    setStressState(newStress);
    saveWellness(feeling, energy, newStress, hydration, trainingIntent);
    regeneratePlan(feeling, energy, newStress, hydration, trainingIntent);
  }, [feeling, energy, hydration, trainingIntent, saveWellness, regeneratePlan]);

  const setHydration = useCallback((newHydration: HydrationLevel) => {
    setHydrationState(newHydration);
    saveWellness(feeling, energy, stress, newHydration, trainingIntent);
    regeneratePlan(feeling, energy, stress, newHydration, trainingIntent);
  }, [feeling, energy, stress, trainingIntent, saveWellness, regeneratePlan]);

  const setTrainingIntent = useCallback((newTrainingIntent: TrainingIntent) => {
    setTrainingIntentState(newTrainingIntent);
    saveWellness(feeling, energy, stress, hydration, newTrainingIntent);
    regeneratePlan(feeling, energy, stress, hydration, newTrainingIntent);
  }, [feeling, energy, stress, hydration, saveWellness, regeneratePlan]);

  const setGlp1Energy = useCallback((v: EnergyDaily) => {
    setGlp1EnergyState(v);
    saveGlp1Inputs(v, appetite, nausea, digestion);
    setTimeout(regenerateFromGlp1, 0);
  }, [appetite, nausea, digestion, saveGlp1Inputs, regenerateFromGlp1]);

  const setAppetite = useCallback((v: AppetiteLevel) => {
    setAppetiteState(v);
    saveGlp1Inputs(glp1Energy, v, nausea, digestion);
    setTimeout(regenerateFromGlp1, 0);
  }, [glp1Energy, nausea, digestion, saveGlp1Inputs, regenerateFromGlp1]);

  const setNausea = useCallback((v: NauseaLevel) => {
    setNauseaState(v);
    saveGlp1Inputs(glp1Energy, appetite, v, digestion);
    setTimeout(regenerateFromGlp1, 0);
  }, [glp1Energy, appetite, digestion, saveGlp1Inputs, regenerateFromGlp1]);

  const setDigestion = useCallback((v: DigestionStatus) => {
    setDigestionState(v);
    saveGlp1Inputs(glp1Energy, appetite, nausea, v);
    setTimeout(regenerateFromGlp1, 0);
  }, [glp1Energy, appetite, nausea, saveGlp1Inputs, regenerateFromGlp1]);

  const setBowelMovementToday = useCallback((v: boolean | null) => {
    setBowelMovementTodayState(v);
    saveGlp1Inputs(glp1Energy, appetite, nausea, digestion, v);
  }, [glp1Energy, appetite, nausea, digestion, saveGlp1Inputs]);

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setProfile((prev) => {
      const updated = { ...prev, ...updates };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
      return updated;
    });
    if (updates.medicationProfile) {
      setTimeout(regenerateFromGlp1, 0);
    }
  }, [regenerateFromGlp1]);

  const completeOnboarding = useCallback(() => {
    updateProfile({ onboardingComplete: true });
  }, [updateProfile]);

  const addChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => {
      const updated = [...prev, msg];
      AsyncStorage.setItem(CHAT_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const syncHealthData = useCallback(async (integrations: IntegrationStatus[]) => {
    const connectedIds = integrations.filter((i) => i.connected).map((i) => i.id);
    if (connectedIds.length === 0) {
      setMetrics([]);
      setHasHealthData(false);
      setAvailableMetricTypes([]);
      setTrends([]);
      return;
    }
    try {
      const result = await fetchHealthData(connectedIds, 28);
      console.log("[AppContext] fetchHealthData returned:", {
        metricsLength: result.metrics.length,
        availableTypes: result.availableTypes,
        source: result.source,
        last3Days: result.metrics.slice(-3),
      });
      if (result.metrics.length > 0) {
        console.log("[AppContext] setMetrics() called with", result.metrics.length, "days, setAvailableMetricTypes=", result.availableTypes);
        setMetrics(result.metrics);
        setHasHealthData(true);
        setAvailableMetricTypes(result.availableTypes);
        setTodayMetrics(result.metrics[result.metrics.length - 1]);
        setTrends(generateTrendDataFromMetrics(result.metrics));
        if (result.source) {
          setIntegrationsState((prev) =>
            prev.map((i) =>
              i.id === result.source
                ? { ...i, lastSync: new Date().toLocaleTimeString() }
                : i
            )
          );
        }
      } else {
        setHasHealthData(false);
        setAvailableMetricTypes([]);
        setTrends([]);
      }
    } catch {
    }
  }, []);

  const toggleIntegration = useCallback(async (id: string) => {
    const current = integrationsState.find((i) => i.id === id);
    if (!current) return;

    const isSyncFailed = current.lastSync === "Sync failed";

    if (current.connected && !isSyncFailed) {
      setIntegrationsState((prev) => {
        const updated = prev.map((i) =>
          i.id === id ? { ...i, connected: false, lastSync: undefined } : i
        );
        AsyncStorage.setItem(INTEGRATIONS_KEY, JSON.stringify(updated.map((i) => ({ id: i.id, connected: i.connected }))));
        syncHealthData(updated);
        return updated;
      });
      return;
    }

    if (!isSyncFailed) {
      setIntegrationsState((prev) =>
        prev.map((i) => (i.id === id ? { ...i, lastSync: "Connecting..." } : i))
      );

      const result = await connectProvider(id);

      if (!result.success) {
        const statusMsg = result.unavailable
          ? "Not available on this device"
          : result.error || "Connection failed";
        setIntegrationsState((prev) =>
          prev.map((i) => (i.id === id ? { ...i, lastSync: statusMsg } : i))
        );
        return;
      }

      setIntegrationsState((prev) => {
        const updated = prev.map((i) =>
          i.id === id ? { ...i, connected: true, lastSync: "Syncing..." } : i
        );
        AsyncStorage.setItem(INTEGRATIONS_KEY, JSON.stringify(updated.map((i) => ({ id: i.id, connected: i.connected }))));
        return updated;
      });
    } else {
      setIntegrationsState((prev) =>
        prev.map((i) => (i.id === id ? { ...i, lastSync: "Syncing..." } : i))
      );
    }

    const connectedIds = integrationsState
      .filter((i) => i.connected || i.id === id)
      .map((i) => i.id);

    try {
      const data = await fetchHealthData(connectedIds, 28);
      if (data.metrics.length > 0) {
        setMetrics(data.metrics);
        setHasHealthData(true);
        setAvailableMetricTypes(data.availableTypes);
        setTodayMetrics(data.metrics[data.metrics.length - 1]);
        setTrends(generateTrendDataFromMetrics(data.metrics));
      } else {
        setHasHealthData(false);
        setAvailableMetricTypes([]);
      }
      setIntegrationsState((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, connected: true, lastSync: new Date().toLocaleTimeString() }
            : i
        )
      );
    } catch {
      setIntegrationsState((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, connected: true, lastSync: "Sync failed" }
            : i
        )
      );
    }
  }, [integrationsState, syncHealthData]);

  const upgradeTier = useCallback(
    (tier: SubscriptionTier) => {
      updateProfile({ tier });
    },
    [updateProfile]
  );

  const weeklyDaysCompleted = (() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(monday.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().split("T")[0];

    const thisWeekRecords = completionHistory.filter(r => r.date >= mondayStr && r.completionRate >= 40);
    return thisWeekRecords.length;
  })();

  const weeklyConsistency = weeklyDaysCompleted > 0 ? Math.round((weeklyDaysCompleted / 7) * 100) : 0;

  const streakDays = (() => {
    if (completionHistory.length === 0) return 0;
    const sorted = [...completionHistory].sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    const todayDate = new Date().toISOString().split("T")[0];
    for (let i = 0; i < sorted.length; i++) {
      const checkDate = new Date();
      checkDate.setDate(checkDate.getDate() - i);
      const expected = checkDate.toISOString().split("T")[0];
      const record = sorted.find(r => r.date === expected);
      if (record && record.completionRate >= 40) {
        streak++;
      } else if (expected === todayDate) {
        continue;
      } else {
        break;
      }
    }
    return streak;
  })();

  const todayCompletionRate = (() => {
    if (!dailyPlan) return 0;
    const supportActions = dailyPlan.actions.filter(a => a.category !== "consistent");
    const completed = supportActions.filter(a => a.completed).length;
    return supportActions.length > 0 ? Math.round((completed / supportActions.length) * 100) : 0;
  })();

  const clearCompletionFeedback = useCallback(() => {
    setLastCompletionFeedback(null);
  }, []);

  const acknowledgeSymptomTip = useCallback(
    (
      symptom: import("@/lib/symptomTips").SymptomKind,
      interventionTitle: string,
      interventionCta: string,
      interventionSummary: string,
    ) => {
      const today = new Date().toISOString().split("T")[0]!;
      // Persist "the patient acknowledged guidance for this symptom
      // on this date" locally so tomorrow we can offer the follow-up
      // question even if the network is down. We also record the
      // exact title of the intervention that was acked, so the
      // followup card tomorrow can quote the intervention the
      // patient actually saw -- not whatever today's derived tip
      // happens to be (relevant for nausea, where the title varies
      // by severity).
      setGuidanceAckHistory((prev) => {
        const next = { ...prev, [symptom]: today };
        AsyncStorage.setItem(GUIDANCE_ACK_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      setGuidanceAckTitleHistory((prev) => {
        const next = {
          ...prev,
          [symptom]: {
            date: today,
            title: interventionTitle,
            cta: interventionCta,
            summary: interventionSummary,
          },
        };
        AsyncStorage.setItem(GUIDANCE_ACK_TITLE_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      // Persistent queue handles dedupe, retry on transient errors,
      // and survives cold start. Returns 404 server-side when the
      // check-in row for `today` doesn't exist yet -- the queue
      // treats that as a non-retriable drop because the same patient
      // tap also enqueues the check-in (drained first within the
      // same flush).
      void checkinSync.enqueueGuidanceAck(today, symptom);
    },
    [],
  );

  // Patient answered the day-after follow-up. Treat as an implicit
  // ack (so the tip card dismisses), refresh the ack-history date
  // (don't re-prompt tomorrow), and queue both the trend response
  // AND the implicit guidance ack to the persistent sync queue.
  const recordSymptomTrend = useCallback(
    (
      symptom: import("@/lib/symptomTips").SymptomKind,
      response: "better" | "same" | "worse",
      interventionTitle: string,
    ) => {
      const today = new Date().toISOString().split("T")[0]!;
      setGuidanceAckHistory((prev) => {
        const next = { ...prev, [symptom]: today };
        AsyncStorage.setItem(GUIDANCE_ACK_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      void checkinSync.enqueueTrendResponse(today, symptom, response);
      void checkinSync.enqueueGuidanceAck(today, symptom);
      // Persist the per-intervention feedback as a care_event row so
      // the care team can see how each suggestion is landing and so
      // the local risk engine can apply a small nudge. Fire and
      // forget -- failure does not block the UX dismissal above.
      void logCareEventImmediate("intervention_feedback", {
        intervention_id: symptom,
        intervention_title: interventionTitle,
        response,
        source: "today",
      });
      // Cache the latest answer (per symptom) so the next risk
      // recompute can apply the better/same/worse nudge without
      // having to round-trip through the server.
      setLastInterventionFeedback((prev) => {
        const next = { ...prev, [symptom]: { response, ts: Date.now() } };
        AsyncStorage.setItem(LAST_INTERVENTION_FEEDBACK_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const requestClinicianForSymptom = useCallback(
    (symptom: import("@/lib/symptomTips").SymptomKind) => {
      const today = new Date().toISOString().split("T")[0]!;
      setClinicianRequestedDates((prev) => {
        const next = { ...prev, [symptom]: today };
        AsyncStorage.setItem(CLINICIAN_REQUESTED_DATES_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      void checkinSync.enqueueClinicianRequest(today, symptom);
    },
    [],
  );

  // Day-scoped derived view of "did the patient escalate this
  // symptom today?", computed fresh each render so a midnight
  // rollover automatically clears the inline confirmation pill
  // without us having to listen for date-change events.
  const clinicianRequestedToday = useMemo(() => {
    const todayYmd = new Date().toISOString().split("T")[0]!;
    const out: Partial<Record<import("@/lib/symptomTips").SymptomKind, true>> = {};
    for (const [k, v] of Object.entries(clinicianRequestedDates)) {
      if (v === todayYmd) out[k as import("@/lib/symptomTips").SymptomKind] = true;
    }
    return out;
  }, [clinicianRequestedDates]);

  const saveDailyCheckIn = useCallback(async (checkIn: DailyCheckIn) => {
    const updated = [...checkInHistory.filter(c => c.date !== checkIn.date), checkIn].slice(-30);
    setCheckInHistory(updated);
    await AsyncStorage.setItem(CHECKIN_KEY, JSON.stringify(updated));

    // Mirror to the shared backend so the doctor dashboard sees this
    // patient's daily state. The /me/checkins endpoint upserts by
    // (patient_user_id, date), so re-saving a day is naturally
    // idempotent. We capture a SNAPSHOT of the symptom-management
    // inputs at save time and hand it to the persistent sync queue;
    // a later retry sends what the patient actually saw, never a
    // re-derived payload from whatever state happens to be in memory
    // when the network recovers.
    //
    // The server requires non-null energy/nausea. If either is
    // missing we skip the mirror; the next save (after the patient
    // fills them in) will both update the local row AND enqueue a
    // fresh snapshot, overwriting any prior pending entry for the
    // same date.
    if (glp1Energy && nausea) {
      const moodMap: Record<string, number> = {
        focused: 5, good: 4, low: 2, burnt_out: 1,
      };
      const mood = checkIn.mentalState ? moodMap[checkIn.mentalState] ?? 3 : 3;
      void checkinSync.enqueueCheckin({
        date: checkIn.date,
        energy: glp1Energy,
        nausea,
        mood,
        notes: null,
        appetite: appetite ?? null,
        digestion: digestion ?? null,
        hydration: hydration ?? null,
        bowelMovement: bowelMovementToday,
      });
    }

    // Pilot analytics: record that a check-in was successfully
    // submitted from the patient's perspective. Imported lazily so a
    // stripped-down test environment (no fetch / no AsyncStorage)
    // doesn't pull the analytics module just to render AppContext.
    try {
      const analytics = await import("@/lib/analytics/client");
      void analytics.logEvent("checkin_completed");
    } catch {
      /* analytics module unavailable */
    }

    // Recompute the local reminder schedule. Today's check-in just
    // landed, so the noon and 7pm slots should drop off the queue.
    // Imported lazily so unit-test environments without expo-notifications
    // continue to load AppContext without pulling the native module.
    try {
      const reminders = await import("@/lib/reminders");
      const enabled = await reminders.getRemindersEnabled();
      reminders.rescheduleReminders({ enabled, hasCheckedInToday: true }).catch(() => {});
    } catch {
      /* reminders module unavailable in this environment */
    }

    if (metricsRef) {
      const todayDate = new Date().toISOString().split("T")[0];
      const currentGlp1: GLP1DailyInputs = {
        date: todayDate, energy: glp1Energy, appetite, nausea, digestion,
      };
      const freshPatterns = recomputeAnalytics(glp1InputHistory, profile.medicationProfile, medicationLog, completionHistory);
      const newPlan = generateDailyPlan(metricsRef, { feeling, energy, stress, hydration, trainingIntent }, completionHistory, metrics, currentGlp1, profile.medicationProfile, medicationLog, freshPatterns ?? undefined, checkIn.mentalState ?? undefined, hasHealthData, availableMetricTypes);
      const todayCompletion = completionHistory.find(r => r.date === todayDate);
      if (todayCompletion) {
        for (const a of newPlan.actions) {
          const saved = todayCompletion.actions.find(sa => sa.id === a.id);
          if (saved) {
            a.completed = saved.completed;
            if (saved.chosen) a.text = saved.chosen;
          }
        }
      }
      setDailyPlan(newPlan);

      recomputeAdaptation(glp1InputHistory, updated, metrics, profile.medicationProfile, medicationLog);
    }
  }, [checkInHistory, metricsRef, feeling, energy, stress, hydration, trainingIntent, completionHistory, metrics, glp1Energy, appetite, nausea, digestion, glp1InputHistory, recomputeAnalytics, profile.medicationProfile, medicationLog, recomputeAdaptation]);

  const logMedicationDose = useCallback(async (entry: MedicationLogEntry) => {
    setMedicationLog(prev => {
      const filtered = prev.filter(e => e.date !== entry.date);
      const updated = [...filtered, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      AsyncStorage.setItem(MED_LOG_KEY, JSON.stringify(updated));
      recomputeAnalytics(glp1InputHistory, profile.medicationProfile, updated, completionHistory);
      return updated;
    });
    if (profile.medicationProfile) {
      updateProfile({
        medicationProfile: {
          ...profile.medicationProfile,
          lastInjectionDate: entry.status === "taken" ? entry.date : profile.medicationProfile.lastInjectionDate,
        },
      });
    }
  }, [profile, updateProfile, glp1InputHistory, completionHistory, recomputeAnalytics]);

  const removeMedicationDose = useCallback(async (entryId: string) => {
    setMedicationLog(prev => {
      const updated = prev.filter(e => e.id !== entryId);
      AsyncStorage.setItem(MED_LOG_KEY, JSON.stringify(updated));
      recomputeAnalytics(glp1InputHistory, profile.medicationProfile, updated, completionHistory);
      return updated;
    });
  }, [glp1InputHistory, profile.medicationProfile, completionHistory, recomputeAnalytics]);

  // Single source of truth for the Today experience. Wraps the
  // existing dailyPlan with treatment-aware lenses, claims policy,
  // sufficiency markers, and the day's symptom interventions. The
  // dismissed-tips suppression filter is applied at the consumer
  // (Today screen) since it owns that ephemeral state.
  const dailyState: DailyTreatmentState | null = useMemo(() => {
    if (!dailyPlan || !todayMetrics) return null;
    const todayDate = new Date().toISOString().split("T")[0];
    const currentGlp1: GLP1DailyInputs | undefined = (glp1Energy || appetite || nausea || digestion || bowelMovementToday !== null)
      ? { date: todayDate, energy: glp1Energy, appetite, nausea, digestion, bowelMovementToday }
      : undefined;
    return selectDailyTreatmentState({
      plan: dailyPlan,
      todayMetrics,
      recentMetrics: metrics,
      inputs: { feeling, energy, stress, hydration, trainingIntent },
      glp1Inputs: currentGlp1,
      hydration,
      bowelMovementToday,
      profile,
      medicationLog,
      hasHealthData,
      availableMetricTypes,
      completionHistory,
    });
  }, [
    dailyPlan, todayMetrics, metrics,
    feeling, energy, stress, hydration, trainingIntent,
    glp1Energy, appetite, nausea, digestion, bowelMovementToday,
    profile, medicationLog, hasHealthData, availableMetricTypes, completionHistory,
  ]);

  const todayCheckIn = (() => {
    const todayDate = new Date().toISOString().split("T")[0];
    const found = checkInHistory.find(c => c.date === todayDate);
    if (found && found.mentalState) return found;
    return null;
  })();

  return (
    <AppContext.Provider
      value={{
        profile,
        updateProfile,
        completeOnboarding,
        metrics,
        todayMetrics,
        hasHealthData,
        availableMetricTypes,
        dailyPlan,
        dailyState,
        weeklyPlan,
        trends,
        workouts,
        chatMessages,
        addChatMessage,
        integrations: integrationsState,
        toggleIntegration,
        isLoading,
        upgradeTier,
        insights,
        feeling,
        setFeeling,
        energy,
        setEnergy,
        stress,
        setStress,
        hydration,
        setHydration,
        trainingIntent,
        setTrainingIntent,
        toggleAction,
        editAction,
        editWeeklyAction,
        toggleWeeklyAction,
        completionHistory,
        weeklyConsistency,
        weeklyDaysCompleted,
        streakDays,
        todayCompletionRate,
        lastCompletionFeedback,
        clearCompletionFeedback,
        checkInHistory,
        saveDailyCheckIn,
        acknowledgeSymptomTip,
        recordSymptomTrend,
        requestClinicianForSymptom,
        guidanceAckHistory,
        guidanceAckTitleHistory,
        clinicianRequestedToday,
        checkinSyncStatus,
        checkinLastSyncAt,
        flushCheckinSync,
        todayCheckIn,
        glp1Energy,
        setGlp1Energy,
        appetite,
        setAppetite,
        nausea,
        setNausea,
        digestion,
        setDigestion,
        bowelMovementToday,
        setBowelMovementToday,
        riskResult,
        glp1InputHistory,
        medicationLog,
        logMedicationDose,
        removeMedicationDose,
        inputAnalytics,
        patientSummary,
        userPatterns,
        adaptiveInsights,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
