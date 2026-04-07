import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import {
  defaultProfile,
  generateMockMetrics,
  generateMockWorkouts,
  generateDailyPlan,
  generateWeeklyPlan,
  generateTrendData,
  integrations as defaultIntegrations,
} from "@/data/mockData";
import { computeInsights, type DailyInsights } from "@/data/insights";
import type {
  UserProfile,
  HealthMetrics,
  DailyPlan,
  WeeklyPlan,
  TrendData,
  WorkoutEntry,
  ChatMessage,
  IntegrationStatus,
  HealthGoal,
  SubscriptionTier,
  FeelingType,
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const PROFILE_KEY = "@pulsepilot_profile";
const CHAT_KEY = "@pulsepilot_chat";
const FEELING_KEY = "@pulsepilot_feeling";

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
  const [metricsRef, setMetricsRef] = useState<HealthMetrics | null>(null);

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

      const savedFeeling = await AsyncStorage.getItem(FEELING_KEY);
      const todayDate = new Date().toISOString().split("T")[0];
      let currentFeeling: FeelingType = null;
      if (savedFeeling) {
        const parsed = JSON.parse(savedFeeling);
        if (parsed.date === todayDate) {
          currentFeeling = parsed.feeling;
          setFeelingState(currentFeeling);
        }
      }

      const allMetrics = generateMockMetrics(30);
      setMetrics(allMetrics);

      const today = allMetrics[allMetrics.length - 1];
      setTodayMetrics(today);
      setMetricsRef(today);
      setDailyPlan(generateDailyPlan(today, currentFeeling));
      setWeeklyPlan(generateWeeklyPlan());
      setTrends(generateTrendData());
      const allWorkouts = generateMockWorkouts();
      setWorkouts(allWorkouts);

      const savedProfileData = savedProfile ? JSON.parse(savedProfile) : defaultProfile;
      setInsights(computeInsights(allMetrics, today, allWorkouts, savedProfileData));
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const setFeeling = useCallback((newFeeling: FeelingType) => {
    setFeelingState(newFeeling);
    const todayDate = new Date().toISOString().split("T")[0];
    AsyncStorage.setItem(FEELING_KEY, JSON.stringify({ date: todayDate, feeling: newFeeling }));

    if (metricsRef) {
      setDailyPlan(generateDailyPlan(metricsRef, newFeeling));
    }
  }, [metricsRef]);

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

  const toggleIntegration = useCallback((id: string) => {
    setIntegrationsState((prev) =>
      prev.map((i) => (i.id === id ? { ...i, connected: !i.connected } : i))
    );
  }, []);

  const upgradeTier = useCallback(
    (tier: SubscriptionTier) => {
      updateProfile({ tier });
    },
    [updateProfile]
  );

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
