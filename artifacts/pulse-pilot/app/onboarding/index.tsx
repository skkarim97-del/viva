import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  Animated,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { VivaSymbol } from "@/components/VivaSymbol";
import { useColors } from "@/hooks/useColors";
import type { HealthGoal } from "@/types";

const STEPS = [
  "welcome",
  "goals",
  "profile",
  "activity",
  "training",
  "energy",
  "sleep",
  "integrations",
  "summary",
] as const;
type Step = (typeof STEPS)[number];

const GOAL_OPTIONS: { id: HealthGoal; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: "fat_loss", label: "Lose weight", icon: "trending-down" },
  { id: "muscle_gain", label: "Build muscle", icon: "zap" },
  { id: "improve_fitness", label: "Improve fitness", icon: "activity" },
  { id: "improved_energy", label: "Increase energy", icon: "sun" },
  { id: "better_sleep", label: "Sleep better", icon: "moon" },
  { id: "reduce_stress", label: "Reduce stress", icon: "wind" },
  { id: "stay_consistent", label: "Stay consistent", icon: "check-circle" },
  { id: "general_wellness", label: "General health", icon: "heart" },
];

const ACTIVITY_OPTIONS = [
  { key: "inactive" as const, label: "Mostly inactive", sub: "Desk job, minimal exercise" },
  { key: "light" as const, label: "Lightly active", sub: "Walking, occasional workouts" },
  { key: "moderate" as const, label: "Moderately active", sub: "3-4 workouts per week" },
  { key: "very_active" as const, label: "Very active", sub: "5+ workouts per week" },
];

const TRAINING_OPTIONS = [
  { key: "under_30" as const, label: "Under 30 min/day" },
  { key: "30_60" as const, label: "30-60 min/day" },
  { key: "60_90" as const, label: "60-90 min/day" },
  { key: "90_plus" as const, label: "90+ min/day" },
];

const ENERGY_OPTIONS = [
  { key: "energized" as const, label: "Consistently energized", icon: "zap" as const },
  { key: "good" as const, label: "Generally good", icon: "sun" as const },
  { key: "tired" as const, label: "Often tired", icon: "cloud" as const },
  { key: "stressed" as const, label: "Frequently stressed", icon: "alert-circle" as const },
  { key: "burnt_out" as const, label: "Burnt out", icon: "battery" as const },
];

const SLEEP_OPTIONS = [
  { key: "7_8" as const, label: "7-8 hours consistently" },
  { key: "6_7" as const, label: "6-7 hours" },
  { key: "under_6" as const, label: "Under 6 hours" },
  { key: "inconsistent" as const, label: "Inconsistent schedule" },
];

const BEDTIME_OPTIONS = ["9:00 PM", "9:30 PM", "10:00 PM", "10:30 PM", "11:00 PM", "11:30 PM", "12:00 AM", "12:30 AM"];
const WAKE_OPTIONS = ["5:00 AM", "5:30 AM", "6:00 AM", "6:30 AM", "7:00 AM", "7:30 AM", "8:00 AM", "8:30 AM"];

export default function OnboardingScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { updateProfile, completeOnboarding, toggleIntegration, integrations } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [selectedGoals, setSelectedGoals] = useState<HealthGoal[]>([]);
  const [age, setAge] = useState("32");
  const [sex, setSex] = useState<"male" | "female" | "other">("male");
  const [heightFeet, setHeightFeet] = useState("5");
  const [heightInches, setHeightInches] = useState("10");
  const [weight, setWeight] = useState("185");
  const [goalWeight, setGoalWeight] = useState("170");
  const [activityLevel, setActivityLevel] = useState<"inactive" | "light" | "moderate" | "very_active" | null>(null);
  const [trainingTime, setTrainingTime] = useState<"under_30" | "30_60" | "60_90" | "90_plus" | null>(null);
  const [energyBaseline, setEnergyBaseline] = useState<"energized" | "good" | "tired" | "stressed" | "burnt_out" | null>(null);
  const [sleepHabit, setSleepHabit] = useState<"7_8" | "6_7" | "under_6" | "inconsistent" | null>(null);
  const [bedtime, setBedtime] = useState<string | null>(null);
  const [wakeTime, setWakeTime] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const currentIndex = STEPS.indexOf(step);

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const animateTransition = (nextStep: Step) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setStep(nextStep);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const next = () => {
    haptic();
    if (currentIndex < STEPS.length - 1) {
      animateTransition(STEPS[currentIndex + 1]);
    } else {
      finishOnboarding();
    }
  };

  const back = () => {
    haptic();
    if (currentIndex > 0) {
      animateTransition(STEPS[currentIndex - 1]);
    }
  };

  const finishOnboarding = () => {
    const showGoalWeight = selectedGoals.includes("fat_loss") || selectedGoals.includes("muscle_gain");
    const daysMap: Record<string, number> = { under_30: 3, "30_60": 4, "60_90": 5, "90_plus": 6 };
    const timeMap: Record<string, number> = { under_30: 25, "30_60": 45, "60_90": 75, "90_plus": 100 };

    updateProfile({
      age: parseInt(age) || 32,
      sex,
      height: ((parseInt(heightFeet) || 5) * 12) + (parseInt(heightInches) || 10),
      weight: parseInt(weight) || 185,
      goalWeight: showGoalWeight ? (parseInt(goalWeight) || 170) : parseInt(weight) || 185,
      goals: selectedGoals.length > 0 ? selectedGoals : ["general_wellness"],
      activityLevel: activityLevel || "moderate",
      trainingTime: trainingTime || "30_60",
      energyBaseline: energyBaseline || "good",
      sleepHabit: sleepHabit || "6_7",
      usualBedtime: bedtime || undefined,
      usualWakeTime: wakeTime || undefined,
      daysAvailableToTrain: daysMap[trainingTime || "30_60"] || 4,
      availableWorkoutTime: timeMap[trainingTime || "30_60"] || 45,
      onboardingComplete: true,
    });
    completeOnboarding();
    router.replace("/(tabs)");
  };

  const toggleGoal = (g: HealthGoal) => {
    haptic();
    setSelectedGoals((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  const showGoalWeight = selectedGoals.includes("fat_loss") || selectedGoals.includes("muscle_gain");

  const canProceed = () => {
    switch (step) {
      case "goals": return selectedGoals.length > 0;
      case "profile": return true;
      case "activity": return activityLevel !== null;
      case "training": return trainingTime !== null;
      case "energy": return energyBaseline !== null;
      case "sleep": return sleepHabit !== null;
      default: return true;
    }
  };

  const getSummaryGoals = () => {
    const goalLabels: Record<string, string> = {
      fat_loss: "Lose weight",
      muscle_gain: "Build muscle",
      improve_fitness: "Improve fitness",
      improved_energy: "Increase energy",
      better_sleep: "Sleep better",
      reduce_stress: "Reduce stress",
      stay_consistent: "Stay consistent",
      general_wellness: "General health",
    };
    return selectedGoals.map((g) => goalLabels[g] || g).join(", ");
  };

  const getSummaryPlan = () => {
    const intensityLabel = activityLevel === "very_active" ? "Active" : activityLevel === "moderate" ? "Moderate" : "Building up";
    const timeLabel = trainingTime === "90_plus" ? "90+ min sessions" : trainingTime === "60_90" ? "60-90 min sessions" : trainingTime === "30_60" ? "30-60 min sessions" : "Short sessions";
    return `${intensityLabel} training, ${timeLabel.toLowerCase()}`;
  };

  const getSummaryFocus = () => {
    if (energyBaseline === "burnt_out" || energyBaseline === "stressed") return "Rebuild energy and reduce stress first";
    if (energyBaseline === "tired") return "Gradually increase activity with rest priority";
    if (selectedGoals.includes("fat_loss")) return "Sustainable fat loss with consistent habits";
    if (selectedGoals.includes("muscle_gain")) return "Progressive training with recovery focus";
    if (selectedGoals.includes("better_sleep")) return "Optimize sleep quality and consistency";
    return "Build sustainable daily wellness habits";
  };

  const ctaText = step === "welcome" ? "Get Started"
    : step === "summary" ? "Start Your Plan"
    : step === "integrations" ? "Continue"
    : "Continue";

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: bottomPad }]}>
      {step !== "welcome" && (
        <View style={styles.header}>
          {currentIndex > 0 && step !== "summary" && (
            <Pressable onPress={back} style={styles.backBtn} hitSlop={12}>
              <Feather name="arrow-left" size={20} color={c.foreground} />
            </Pressable>
          )}
          <View style={styles.progressBar}>
            <View style={[styles.progressTrack, { backgroundColor: c.muted }]}>
              <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${((currentIndex) / (STEPS.length - 1)) * 100}%` }]} />
            </View>
          </View>
          <View style={{ width: 32 }} />
        </View>
      )}

      <Animated.View style={[styles.contentWrap, { opacity: fadeAnim }]}>
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.contentInner}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === "welcome" && (
            <View style={styles.welcomeSection}>
              <View style={[styles.heroIcon, { backgroundColor: c.foreground + "08" }]}>
                <VivaSymbol size={56} color={c.foreground} />
              </View>
              <Text style={[styles.welcomeTitle, { color: c.foreground }]}>V I V A</Text>
              <Text style={[styles.welcomeTagline, { color: c.foreground }]}>Your Ai Health Coach</Text>
              <Text style={[styles.welcomeSub, { color: c.mutedForeground + "CC" }]}>
                Personalized daily guidance for your body, mind, and habits.
              </Text>
            </View>
          )}

          {step === "goals" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>What do you want{"\n"}to improve?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Select all that apply</Text>
              <View style={styles.goalGrid}>
                {GOAL_OPTIONS.map((goal) => {
                  const selected = selectedGoals.includes(goal.id);
                  return (
                    <Pressable
                      key={goal.id}
                      onPress={() => toggleGoal(goal.id)}
                      style={({ pressed }) => [
                        styles.goalCard,
                        {
                          backgroundColor: selected ? c.primary + "12" : c.card,
                          borderColor: selected ? c.primary : "transparent",
                          borderWidth: selected ? 1.5 : 1.5,
                          opacity: pressed ? 0.8 : 1,
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                        },
                      ]}
                    >
                      <View style={[styles.goalIconWrap, { backgroundColor: selected ? c.primary + "18" : c.muted }]}>
                        <Feather name={goal.icon} size={18} color={selected ? c.primary : c.mutedForeground} />
                      </View>
                      <Text style={[styles.goalLabel, { color: selected ? c.primary : c.foreground }]}>{goal.label}</Text>
                      {selected && (
                        <View style={[styles.goalCheck, { backgroundColor: c.primary }]}>
                          <Feather name="check" size={10} color={c.primaryForeground} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {step === "profile" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Set your starting point</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>We'll adapt this over time</Text>

              <View style={styles.profileGroup}>
                <View style={styles.sexRow}>
                  {(["male", "female", "other"] as const).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => { haptic(); setSex(s); }}
                      style={[styles.sexChip, { backgroundColor: sex === s ? c.primary : c.card }]}
                    >
                      <Text style={[styles.sexLabel, { color: sex === s ? c.primaryForeground : c.foreground }]}>
                        {s === "male" ? "Male" : s === "female" ? "Female" : "Other"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <ProfileInput label="Age" value={age} onChange={setAge} unit="" colors={c} optional />
                <View style={styles.heightRow}>
                  <View style={{ flex: 1 }}>
                    <ProfileInput label="Height" value={heightFeet} onChange={setHeightFeet} unit="ft" colors={c} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ProfileInput label="" value={heightInches} onChange={setHeightInches} unit="in" colors={c} />
                  </View>
                </View>
                <ProfileInput label="Current weight" value={weight} onChange={setWeight} unit="lbs" colors={c} />
                {showGoalWeight && (
                  <ProfileInput label="Goal weight" value={goalWeight} onChange={setGoalWeight} unit="lbs" colors={c} />
                )}
              </View>
            </View>
          )}

          {step === "activity" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>How active are you{"\n"}right now?</Text>
              <View style={styles.optionList}>
                {ACTIVITY_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setActivityLevel(opt.key); }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: activityLevel === opt.key ? c.primary + "10" : c.card,
                        borderColor: activityLevel === opt.key ? c.primary : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View style={styles.optionContent}>
                      <Text style={[styles.optionLabel, { color: activityLevel === opt.key ? c.primary : c.foreground }]}>{opt.label}</Text>
                      <Text style={[styles.optionSub, { color: c.mutedForeground }]}>{opt.sub}</Text>
                    </View>
                    {activityLevel === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.primary }]}>
                        <Feather name="check" size={12} color={c.primaryForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "training" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>How much time can{"\n"}you train?</Text>
              <View style={styles.optionList}>
                {TRAINING_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setTrainingTime(opt.key); }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: trainingTime === opt.key ? c.primary + "10" : c.card,
                        borderColor: trainingTime === opt.key ? c.primary : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.optionLabel, { color: trainingTime === opt.key ? c.primary : c.foreground }]}>{opt.label}</Text>
                    {trainingTime === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.primary }]}>
                        <Feather name="check" size={12} color={c.primaryForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "energy" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>How have you been{"\n"}feeling recently?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>This helps us understand your baseline</Text>
              <View style={styles.optionList}>
                {ENERGY_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setEnergyBaseline(opt.key); }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: energyBaseline === opt.key ? c.primary + "10" : c.card,
                        borderColor: energyBaseline === opt.key ? c.primary : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.energyIcon, { backgroundColor: energyBaseline === opt.key ? c.primary + "18" : c.muted }]}>
                      <Feather name={opt.icon} size={16} color={energyBaseline === opt.key ? c.primary : c.mutedForeground} />
                    </View>
                    <Text style={[styles.optionLabel, { color: energyBaseline === opt.key ? c.primary : c.foreground, flex: 1 }]}>{opt.label}</Text>
                    {energyBaseline === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.primary }]}>
                        <Feather name="check" size={12} color={c.primaryForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "sleep" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>What does your sleep{"\n"}look like?</Text>
              <View style={styles.optionList}>
                {SLEEP_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setSleepHabit(opt.key); }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: sleepHabit === opt.key ? c.primary + "10" : c.card,
                        borderColor: sleepHabit === opt.key ? c.primary : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.optionLabel, { color: sleepHabit === opt.key ? c.primary : c.foreground }]}>{opt.label}</Text>
                    {sleepHabit === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.primary }]}>
                        <Feather name="check" size={12} color={c.primaryForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.timeLabel, { color: c.mutedForeground }]}>Typical bedtime</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeScroll}>
                <View style={styles.timeRow}>
                  {BEDTIME_OPTIONS.map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => { haptic(); setBedtime(bedtime === t ? null : t); }}
                      style={[styles.timeChip, { backgroundColor: bedtime === t ? c.primary : c.card }]}
                    >
                      <Text style={[styles.timeChipText, { color: bedtime === t ? c.primaryForeground : c.foreground }]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <Text style={[styles.timeLabel, { color: c.mutedForeground }]}>Typical wake time</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeScroll}>
                <View style={styles.timeRow}>
                  {WAKE_OPTIONS.map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => { haptic(); setWakeTime(wakeTime === t ? null : t); }}
                      style={[styles.timeChip, { backgroundColor: wakeTime === t ? c.primary : c.card }]}
                    >
                      <Text style={[styles.timeChipText, { color: wakeTime === t ? c.primaryForeground : c.foreground }]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {step === "integrations" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Connect your{"\n"}wearable data</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>
                Viva learns your patterns from real data. Sleep, heart rate, activity, and recovery all help us give you smarter daily insights.
              </Text>
              <View style={styles.optionList}>
                {integrations.map((integration) => (
                  <Pressable
                    key={integration.id}
                    onPress={() => { haptic(); toggleIntegration(integration.id); }}
                    style={[
                      styles.integrationCard,
                      {
                        backgroundColor: integration.connected ? c.primary + "10" : c.card,
                        borderColor: integration.connected ? c.primary : "transparent",
                        borderWidth: 1.5,
                      },
                    ]}
                  >
                    <View style={[styles.integrationIcon, { backgroundColor: c.primary + "12" }]}>
                      <Feather name={integration.icon as keyof typeof Feather.glyphMap} size={20} color={c.primary} />
                    </View>
                    <Text style={[styles.optionLabel, { color: c.foreground, flex: 1 }]}>{integration.name}</Text>
                    <Feather
                      name={integration.connected ? "check-circle" : "plus-circle"}
                      size={20}
                      color={integration.connected ? c.success : c.mutedForeground}
                    />
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={next} style={styles.skipBtn}>
                <Text style={[styles.skipText, { color: c.mutedForeground }]}>Skip for now</Text>
              </Pressable>
            </View>
          )}

          {step === "summary" && (
            <View style={styles.summarySection}>
              <View style={[styles.summaryIconWrap, { backgroundColor: c.success + "15" }]}>
                <Feather name="check" size={36} color={c.success} />
              </View>
              <Text style={[styles.summaryTitle, { color: c.foreground }]}>You're set up</Text>
              <Text style={[styles.summarySub, { color: c.mutedForeground }]}>Here's your personalized starting point</Text>

              <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
                <SummaryRow label="Goals" value={getSummaryGoals()} colors={c} />
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                <SummaryRow label="Plan" value={getSummaryPlan()} colors={c} />
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                <SummaryRow label="Focus" value={getSummaryFocus()} colors={c} />
              </View>

              <Text style={[styles.summaryNote, { color: c.mutedForeground }]}>
                Your plan will adapt as we learn more about your body and habits.
              </Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>

      <Pressable
        onPress={next}
        disabled={!canProceed()}
        style={({ pressed }) => [
          styles.ctaButton,
          {
            backgroundColor: canProceed() ? c.primary : c.muted,
            opacity: pressed && canProceed() ? 0.9 : 1,
            transform: [{ scale: pressed && canProceed() ? 0.98 : 1 }],
          },
        ]}
      >
        <Text style={[styles.ctaText, { color: canProceed() ? c.primaryForeground : c.mutedForeground }]}>
          {ctaText}
        </Text>
        {step !== "summary" && <Feather name="arrow-right" size={18} color={canProceed() ? c.primaryForeground : c.mutedForeground} />}
      </Pressable>
    </View>
  );
}

function ProfileInput({ label, value, onChange, unit, colors: c, optional }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  optional?: boolean;
}) {
  return (
    <View style={[pStyles.field, { backgroundColor: c.card }]}>
      <Text style={[pStyles.fieldLabel, { color: c.mutedForeground }]}>
        {label}{optional ? " (optional)" : ""}
      </Text>
      <View style={pStyles.fieldRight}>
        <TextInput
          style={[pStyles.fieldInput, { color: c.foreground }]}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          selectTextOnFocus
        />
        {unit ? <Text style={[pStyles.fieldUnit, { color: c.mutedForeground }]}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function SummaryRow({ label, value, colors: c }: {
  label: string;
  value: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={sumStyles.row}>
      <Text style={[sumStyles.label, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[sumStyles.value, { color: c.foreground }]}>{value}</Text>
    </View>
  );
}

const pStyles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  fieldLabel: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  fieldRight: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  fieldInput: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "right",
    minWidth: 50,
    paddingVertical: 0,
  },
  fieldUnit: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});

const sumStyles = StyleSheet.create({
  row: {
    gap: 4,
    paddingVertical: 2,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    lineHeight: 22,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBar: {
    flex: 1,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  contentWrap: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },

  welcomeSection: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 10,
    paddingTop: 40,
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  welcomeTitle: {
    fontSize: 24,
    fontFamily: "Inter_500Medium",
    letterSpacing: 8,
  },
  welcomeTagline: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 38,
    letterSpacing: -0.5,
    marginTop: 6,
  },
  welcomeSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 24,
    marginTop: 6,
  },

  section: {
    gap: 16,
    paddingTop: 8,
  },
  stepTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    lineHeight: 36,
    letterSpacing: -0.4,
  },
  stepSub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginTop: -8,
  },

  goalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  goalCard: {
    width: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    gap: 10,
  },
  goalIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  goalLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  goalCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },

  profileGroup: {
    gap: 8,
  },
  heightRow: {
    flexDirection: "row",
    gap: 8,
  },
  sexRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  sexChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  sexLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },

  optionList: {
    gap: 8,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    gap: 12,
  },
  optionContent: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  optionSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  optionCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  energyIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  timeLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
  },
  timeScroll: {
    marginHorizontal: -24,
    paddingHorizontal: 0,
  },
  timeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 4,
  },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  timeChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },

  integrationCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  integrationIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  skipBtn: {
    alignSelf: "center",
    paddingVertical: 8,
    marginTop: 4,
  },
  skipText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },

  summarySection: {
    alignItems: "center",
    gap: 16,
    paddingTop: 40,
  },
  summaryIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  summarySub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginTop: -8,
  },
  summaryCard: {
    width: "100%",
    borderRadius: 20,
    padding: 20,
    gap: 14,
    marginTop: 8,
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
  },
  summaryNote: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 20,
    marginTop: 8,
  },

  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 16,
    paddingVertical: 16,
    borderRadius: 16,
  },
  ctaText: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
});
