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
  streakDays: number;
  todayCompletionRate: number;
  lastCompletionFeedback: string | null;
  clearCompletionFeedback: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const PROFILE_KEY = "@viva_profile";
const CHAT_KEY = "@viva_chat";
const WELLNESS_KEY = "@viva_wellness";
const COMPLETION_KEY = "@viva_completions";
const INTEGRATIONS_KEY = "@viva_integrations";
const WEEKLY_PLAN_KEY = "@viva_weekly_plan";

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
  const [lastCompletionFeedback, setLastCompletionFeedback] = useState<string | null>(null);

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
      const categories: ActionCategory[] = ["move", "fuel", "hydrate", "recover", "mind"];

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

      setWeeklyPlan((prev) => {
        if (prev && prev.weekStartDate === weekStartDate) {
          const merged: WeeklyPlan = {
            ...aiPlan,
            days: aiPlan.days.map((aiDay) => {
              const existingDay = prev.days.find(d => d.date === aiDay.date);
              if (!existingDay) return aiDay;
              const hasEdits = existingDay.actions.some(a => a.chosen !== a.recommended || a.completed);
              if (hasEdits) return existingDay;
              return aiDay;
            }),
          };
          AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(merged));
          return merged;
        }
        AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(aiPlan));
        return aiPlan;
      });
    } catch {}
  };

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
      const savedWeeklyPlan = await AsyncStorage.getItem(WEEKLY_PLAN_KEY);
      const generatedWeekly = generateWeeklyPlan();
      if (savedWeeklyPlan) {
        const parsed = JSON.parse(savedWeeklyPlan);
        if (parsed.weekStartDate === generatedWeekly.weekStartDate) {
          setWeeklyPlan(parsed);
        } else {
          setWeeklyPlan(generatedWeekly);
        }
      } else {
        setWeeklyPlan(generatedWeekly);
      }

      fetchAIWeeklyPlan(allMetrics, savedProfile ? JSON.parse(savedProfile) : defaultProfile, loadedHistory);
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

  const generateCompletionFeedback = (action: DailyAction, completed: boolean, completedCount: number, total: number): string | null => {
    if (!completed) return null;
    const categoryFeedback: Record<string, string[]> = {
      move: ["Movement done for the day", "Activity goal checked off", "Your body will feel this tomorrow"],
      fuel: ["Nutrition on track today", "Good fuel supports everything else", "Nutrition goal complete"],
      hydrate: ["Hydration is on track for the day", "Water intake looking good", "Staying hydrated helps everything else"],
      recover: ["Recovery action logged", "Rest and recovery noted", "Your body will thank you tonight"],
      mind: ["Mental wellness checked off", "That small investment in your mind matters", "Mindfulness goal complete"],
    };
    const options = categoryFeedback[action.category] || ["Done"];
    const msg = options[Math.floor(Math.random() * options.length)];
    if (completedCount === total) return "All 5 actions complete today. Strong day.";
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
      const completedCount = updatedActions.filter(a => a.completed).length;
      const completionRate = Math.round((completedCount / updatedActions.length) * 100);
      const todayRecord: CompletionRecord = {
        date: todayDate,
        actions: updatedActions.map(a => ({ id: a.id, category: a.category, completed: a.completed, recommended: a.recommended, chosen: a.text !== a.recommended ? a.text : undefined })),
        completionRate,
      };

      const toggledAction = updatedActions.find(a => a.id === actionId);
      if (toggledAction) {
        const fb = generateCompletionFeedback(toggledAction, toggledAction.completed, completedCount, updatedActions.length);
        if (fb) setLastCompletionFeedback(fb);
      }

      setCompletionHistory(prevHistory => {
        const filtered = prevHistory.filter(r => r.date !== todayDate);
        const updated = [...filtered, todayRecord];
        AsyncStorage.setItem(COMPLETION_KEY, JSON.stringify(updated));
        return updated;
      });

      if (toggledAction) {
        setWeeklyPlan(wp => {
          if (!wp) return wp;
          const updatedWp = {
            ...wp,
            days: wp.days.map(d => {
              if (d.date !== todayDate) return d;
              return {
                ...d,
                actions: d.actions.map(a =>
                  a.category === toggledAction.category ? { ...a, completed: toggledAction.completed } : a
                ),
              };
            }),
          };
          AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(updatedWp));
          return updatedWp;
        });
      }

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

      const editedAction = updatedActions.find(a => a.id === actionId);
      if (editedAction) {
        setWeeklyPlan(wp => {
          if (!wp) return wp;
          const updatedWp = {
            ...wp,
            days: wp.days.map(d => {
              if (d.date !== todayDate) return d;
              return {
                ...d,
                actions: d.actions.map(a =>
                  a.category === editedAction.category ? { ...a, chosen: newText } : a
                ),
              };
            }),
          };
          AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(updatedWp));
          return updatedWp;
        });
      }

      return { ...prev, actions: updatedActions };
    });
  }, []);

  const editWeeklyAction = useCallback((date: string, category: ActionCategory, newText: string) => {
    setWeeklyPlan(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        days: prev.days.map(d => {
          if (d.date !== date) return d;
          return {
            ...d,
            actions: d.actions.map(a =>
              a.category === category ? { ...a, chosen: newText } : a
            ),
          };
        }),
      };
      AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(updated));

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

      const updated = {
        ...prev,
        days: prev.days.map(d => {
          if (d.date !== date) return d;
          return {
            ...d,
            actions: d.actions.map(a =>
              a.category === category ? { ...a, completed: newCompleted } : a
            ),
          };
        }),
      };
      AsyncStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(updated));

      const todayDate = new Date().toISOString().split("T")[0];
      if (date === todayDate) {
        setDailyPlan(prevPlan => {
          if (!prevPlan) return prevPlan;
          const updatedActions = prevPlan.actions.map(a =>
            a.category === category ? { ...a, completed: newCompleted } : a
          );
          const completedCount = updatedActions.filter(a => a.completed).length;
          const completionRate = Math.round((completedCount / updatedActions.length) * 100);
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
    const completed = dailyPlan.actions.filter(a => a.completed).length;
    return Math.round((completed / dailyPlan.actions.length) * 100);
  })();

  const clearCompletionFeedback = useCallback(() => {
    setLastCompletionFeedback(null);
  }, []);

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
        editWeeklyAction,
        toggleWeeklyAction,
        completionHistory,
        weeklyConsistency,
        streakDays,
        todayCompletionRate,
        lastCompletionFeedback,
        clearCompletionFeedback,
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
