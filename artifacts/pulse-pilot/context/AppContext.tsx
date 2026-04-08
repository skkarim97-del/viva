import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import {
  defaultProfile,
  generateMockMetrics,
  generateMockWorkouts,
  generateDailyPlan,
  generateWeeklyPlan,
  generateTrendData,
  generateTrendDataFromMetrics,
  integrations as defaultIntegrations,
} from "@/data/mockData";
import { computeInsights, type DailyInsights } from "@/data/insights";
import { fetchHealthData } from "@/data/healthProviders";
import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  WeeklyPlan,
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
} from "@/types";

interface AppContextType {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
  completeOnboarding: () => void;
  metrics: HealthMetrics[];
  todayMetrics: HealthMetrics | null;
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
  completionHistory: CompletionRecord[];
  weeklyConsistency: number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const PROFILE_KEY = "@viva_profile";
const CHAT_KEY = "@viva_chat";
const WELLNESS_KEY = "@viva_wellness";
const COMPLETION_KEY = "@viva_completions";
const INTEGRATIONS_KEY = "@viva_integrations";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [metrics, setMetrics] = useState<HealthMetrics[]>([]);
  const [todayMetrics, setTodayMetrics] = useState<HealthMetrics | null>(null);
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const savedProfile = await AsyncStorage.getItem(PROFILE_KEY);
      if (savedProfile) {
        setProfile(JSON.parse(savedProfile));
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

      let loadedHistory: CompletionRecord[] = [];
      const savedCompletions = await AsyncStorage.getItem(COMPLETION_KEY);
      if (savedCompletions) {
        loadedHistory = JSON.parse(savedCompletions);
        setCompletionHistory(loadedHistory);
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

      let allMetrics: HealthMetrics[];
      let dataSource: string | null = null;

      if (connectedIds.length > 0) {
        const result = await fetchHealthData(connectedIds, 28);
        if (result.metrics.length > 0) {
          allMetrics = result.metrics;
          dataSource = result.source;
        } else {
          allMetrics = generateMockMetrics(28);
        }
      } else {
        allMetrics = generateMockMetrics(28);
      }

      setMetrics(allMetrics);

      if (dataSource) {
        setIntegrationsState((prev) =>
          prev.map((i) =>
            i.id === dataSource
              ? { ...i, connected: true, lastSync: new Date().toLocaleTimeString() }
              : i
          )
        );
      }

      const today = allMetrics[allMetrics.length - 1];
      setTodayMetrics(today);
      setMetricsRef(today);
      const plan = generateDailyPlan(today, { feeling: currentFeeling, energy: currentEnergy, stress: currentStress, hydration: currentHydration, trainingIntent: currentTrainingIntent }, loadedHistory);
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
      setWeeklyPlan(generateWeeklyPlan());
      setTrends(generateTrendDataFromMetrics(allMetrics));
      const allWorkouts = generateMockWorkouts();
      setWorkouts(allWorkouts);

      const savedProfileData = savedProfile ? JSON.parse(savedProfile) : defaultProfile;
      setInsights(computeInsights(allMetrics, today, allWorkouts, savedProfileData));
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const saveWellness = useCallback((f: FeelingType, e: EnergyLevel, s: StressLevel, h: HydrationLevel, ti: TrainingIntent) => {
    const todayDate = new Date().toISOString().split("T")[0];
    AsyncStorage.setItem(WELLNESS_KEY, JSON.stringify({ date: todayDate, feeling: f, energy: e, stress: s, hydration: h, trainingIntent: ti }));
  }, []);

  const regeneratePlan = useCallback((f: FeelingType, e: EnergyLevel, s: StressLevel, h: HydrationLevel, ti: TrainingIntent) => {
    if (metricsRef) {
      const newPlan = generateDailyPlan(metricsRef, { feeling: f, energy: e, stress: s, hydration: h, trainingIntent: ti }, completionHistory);
      const todayDate = new Date().toISOString().split("T")[0];
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
  }, [metricsRef, completionHistory]);

  const toggleAction = useCallback((actionId: string) => {
    setDailyPlan(prev => {
      if (!prev) return prev;
      const updatedActions = prev.actions.map(a =>
        a.id === actionId ? { ...a, completed: !a.completed } : a
      );
      const todayDate = new Date().toISOString().split("T")[0];
      const completedCount = updatedActions.filter(a => a.completed).length;
      const completionRate = Math.round((completedCount / updatedActions.length) * 100);
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
      return { ...prev, actions: updatedActions };
    });
  }, []);

  const editAction = useCallback((actionId: string, newText: string) => {
    setDailyPlan(prev => {
      if (!prev) return prev;
      const updatedActions = prev.actions.map(a =>
        a.id === actionId ? { ...a, text: newText } : a
      );
      const todayDate = new Date().toISOString().split("T")[0];
      const completedCount = updatedActions.filter(a => a.completed).length;
      const completionRate = Math.round((completedCount / updatedActions.length) * 100);
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
      return { ...prev, actions: updatedActions };
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

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setProfile((prev) => {
      const updated = { ...prev, ...updates };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

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
      const mockMetrics = generateMockMetrics(28);
      setMetrics(mockMetrics);
      setTodayMetrics(mockMetrics[mockMetrics.length - 1]);
      setTrends(generateTrendDataFromMetrics(mockMetrics));
      return;
    }
    try {
      const result = await fetchHealthData(connectedIds, 28);
      if (result.metrics.length > 0) {
        setMetrics(result.metrics);
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
      }
    } catch {
    }
  }, []);

  const toggleIntegration = useCallback((id: string) => {
    setIntegrationsState((prev) => {
      const updated = prev.map((i) => (i.id === id ? { ...i, connected: !i.connected } : i));
      AsyncStorage.setItem(INTEGRATIONS_KEY, JSON.stringify(updated.map((i) => ({ id: i.id, connected: i.connected }))));
      syncHealthData(updated);
      return updated;
    });
  }, [syncHealthData]);

  const upgradeTier = useCallback(
    (tier: SubscriptionTier) => {
      updateProfile({ tier });
    },
    [updateProfile]
  );

  const weeklyConsistency = (() => {
    const recent = completionHistory.slice(-7);
    if (recent.length === 0) return -1;
    return Math.round(recent.reduce((sum, r) => sum + r.completionRate, 0) / recent.length);
  })();

  return (
    <AppContext.Provider
      value={{
        profile,
        updateProfile,
        completeOnboarding,
        metrics,
        todayMetrics,
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
        completionHistory,
        weeklyConsistency,
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
