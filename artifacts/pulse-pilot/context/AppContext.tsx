import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";

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
} from "@/lib/engine";
import { computeInsights, type DailyInsights } from "@/data/insights";
import type { UserPatterns, AdaptiveInsight } from "@/types";
import { fetchHealthData, connectProvider, type AvailableMetricType } from "@/data/healthProviders";
import { Platform } from "react-native";
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

const EXPO_PUBLIC_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "";
const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${EXPO_PUBLIC_DOMAIN}/api`;

interface AppContextType {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
  completeOnboarding: () => void;
  metrics: HealthMetrics[];
  todayMetrics: HealthMetrics | null;
  hasHealthData: boolean;
  availableMetricTypes: AvailableMetricType[];
  dailyPlan: DailyPlan | null;
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
  glp1Energy: EnergyDaily;
  setGlp1Energy: (v: EnergyDaily) => void;
  appetite: AppetiteLevel;
  setAppetite: (v: AppetiteLevel) => void;
  nausea: NauseaLevel;
  setNausea: (v: NauseaLevel) => void;
  digestion: DigestionStatus;
  setDigestion: (v: DigestionStatus) => void;
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
  const [riskResult, setRiskResult] = useState<DropoutRiskResult | null>(null);
  const [glp1InputHistory, setGlp1InputHistory] = useState<GLP1DailyInputs[]>([]);
  const [medicationLog, setMedicationLog] = useState<MedicationLogEntry[]>([]);
  const [inputAnalytics, setInputAnalytics] = useState<InputAnalytics | null>(null);
  const [patientSummary, setPatientSummary] = useState<PatientSummary | null>(null);
  const [userPatterns, setUserPatterns] = useState<UserPatterns | null>(null);
  const [adaptiveInsights, setAdaptiveInsights] = useState<AdaptiveInsight[]>([]);
  const baselineWeeklyPlanRef = useRef<WeeklyPlan | null>(null);

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

  const computeRisk = useCallback((allMetrics: HealthMetrics[], inputHistory: GLP1DailyInputs[], history: CompletionRecord[], medProfile?: MedicationProfile) => {
    try {
      const result = calculateDropoutRisk({
        recentMetrics: allMetrics,
        dailyInputs: inputHistory,
        completionHistory: history,
        medicationProfile: medProfile,
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

      const neutralMetrics: HealthMetrics = {
        date: todayDate,
        steps: 0,
        caloriesBurned: 0,
        activeCalories: 0,
        restingHeartRate: 0,
        hrv: 0,
        weight: savedProfileData?.weight ?? 0,
        sleepDuration: 0,
        sleepQuality: 0,
        recoveryScore: 0,
        strain: 0,
        vo2Max: 0,
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
        healthDataFound
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
    en: EnergyDaily, ap: AppetiteLevel, na: NauseaLevel, di: DigestionStatus
  ) => {
    const todayDate = new Date().toISOString().split("T")[0];
    const inputs: GLP1DailyInputs = {
      date: todayDate, energy: en, appetite: ap, nausea: na, digestion: di,
    };
    AsyncStorage.setItem(GLP1_INPUTS_KEY, JSON.stringify(inputs));

    setGlp1InputHistory(prev => {
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
      const newPlan = generateDailyPlan(metricsRef, { feeling: f, energy: e, stress: s, hydration: h, trainingIntent: ti }, completionHistory, metrics, currentGlp1, profile.medicationProfile, medicationLog, freshPatterns ?? undefined, currentMental, hasHealthData);
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
      const newPlan = generateDailyPlan(metricsRef, { feeling, energy, stress, hydration, trainingIntent }, completionHistory, metrics, currentGlp1, profile.medicationProfile, medicationLog, freshPatterns ?? undefined, currentMental2, hasHealthData);
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
      if (result.metrics.length > 0) {
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

  const saveDailyCheckIn = useCallback(async (checkIn: DailyCheckIn) => {
    const updated = [...checkInHistory.filter(c => c.date !== checkIn.date), checkIn].slice(-30);
    setCheckInHistory(updated);
    await AsyncStorage.setItem(CHECKIN_KEY, JSON.stringify(updated));

    if (metricsRef) {
      const todayDate = new Date().toISOString().split("T")[0];
      const currentGlp1: GLP1DailyInputs = {
        date: todayDate, energy: glp1Energy, appetite, nausea, digestion,
      };
      const freshPatterns = recomputeAnalytics(glp1InputHistory, profile.medicationProfile, medicationLog, completionHistory);
      const newPlan = generateDailyPlan(metricsRef, { feeling, energy, stress, hydration, trainingIntent }, completionHistory, metrics, currentGlp1, profile.medicationProfile, medicationLog, freshPatterns ?? undefined, checkIn.mentalState ?? undefined, hasHealthData);
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
        todayCheckIn,
        glp1Energy,
        setGlp1Energy,
        appetite,
        setAppetite,
        nausea,
        setNausea,
        digestion,
        setDigestion,
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
