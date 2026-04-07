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
  SubscriptionTier,
  FeelingType,
  EnergyLevel,
  StressLevel,
  WellnessInputs,
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const PROFILE_KEY = "@viva_profile";
const CHAT_KEY = "@viva_chat";
const WELLNESS_KEY = "@viva_wellness";

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

      const todayDate = new Date().toISOString().split("T")[0];
      let currentFeeling: FeelingType = null;
      let currentEnergy: EnergyLevel = null;
      let currentStress: StressLevel = null;
      const savedWellness = await AsyncStorage.getItem(WELLNESS_KEY);
      if (savedWellness) {
        const parsed = JSON.parse(savedWellness);
        if (parsed.date === todayDate) {
          currentFeeling = parsed.feeling ?? null;
          currentEnergy = parsed.energy ?? null;
          currentStress = parsed.stress ?? null;
          setFeelingState(currentFeeling);
          setEnergyState(currentEnergy);
          setStressState(currentStress);
        }
      }

      const allMetrics = generateMockMetrics(30);
      setMetrics(allMetrics);

      const today = allMetrics[allMetrics.length - 1];
      setTodayMetrics(today);
      setMetricsRef(today);
      setDailyPlan(generateDailyPlan(today, { feeling: currentFeeling, energy: currentEnergy, stress: currentStress }));
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

  const saveWellness = useCallback((f: FeelingType, e: EnergyLevel, s: StressLevel) => {
    const todayDate = new Date().toISOString().split("T")[0];
    AsyncStorage.setItem(WELLNESS_KEY, JSON.stringify({ date: todayDate, feeling: f, energy: e, stress: s }));
  }, []);

  const regeneratePlan = useCallback((f: FeelingType, e: EnergyLevel, s: StressLevel) => {
    if (metricsRef) {
      setDailyPlan(generateDailyPlan(metricsRef, { feeling: f, energy: e, stress: s }));
    }
  }, [metricsRef]);

  const setFeeling = useCallback((newFeeling: FeelingType) => {
    setFeelingState(newFeeling);
    saveWellness(newFeeling, energy, stress);
    regeneratePlan(newFeeling, energy, stress);
  }, [energy, stress, saveWellness, regeneratePlan]);

  const setEnergy = useCallback((newEnergy: EnergyLevel) => {
    setEnergyState(newEnergy);
    saveWellness(feeling, newEnergy, stress);
    regeneratePlan(feeling, newEnergy, stress);
  }, [feeling, stress, saveWellness, regeneratePlan]);

  const setStress = useCallback((newStress: StressLevel) => {
    setStressState(newStress);
    saveWellness(feeling, energy, newStress);
    regeneratePlan(feeling, energy, newStress);
  }, [feeling, energy, saveWellness, regeneratePlan]);

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
        energy,
        setEnergy,
        stress,
        setStress,
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
