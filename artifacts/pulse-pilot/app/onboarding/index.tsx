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
import type { HealthGoal, SideEffectType } from "@/types";

const STEPS = [
  "welcome",
  "goals",
  "glp1_context",
  "side_effects",
  "nutrition",
  "activity",
  "integrations",
  "summary",
] as const;
type Step = (typeof STEPS)[number];

const GOAL_OPTIONS: { id: HealthGoal; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: "fat_loss", label: "Lose weight", icon: "trending-down" },
  { id: "metabolic_health", label: "Improve metabolic health", icon: "activity" },
  { id: "preserve_muscle", label: "Preserve muscle", icon: "zap" },
  { id: "improved_energy", label: "Maintain energy", icon: "sun" },
  { id: "stay_consistent", label: "Stay consistent on treatment", icon: "check-circle" },
  { id: "general_wellness", label: "General health", icon: "heart" },
];

const MEDICATION_OPTIONS = [
  { key: "semaglutide" as const, label: "Semaglutide (Ozempic, Wegovy)" },
  { key: "tirzepatide" as const, label: "Tirzepatide (Mounjaro, Zepbound)" },
  { key: "liraglutide" as const, label: "Liraglutide (Saxenda, Victoza)" },
  { key: "other" as const, label: "Other" },
];

const REASON_OPTIONS = [
  { key: "weight_loss" as const, label: "Weight loss" },
  { key: "metabolic_health" as const, label: "Metabolic health" },
  { key: "diabetes" as const, label: "Diabetes management" },
  { key: "other" as const, label: "Other" },
];

const DURATION_OPTIONS = [
  { key: "less_1_month" as const, label: "Less than 1 month" },
  { key: "1_3_months" as const, label: "1-3 months" },
  { key: "3_6_months" as const, label: "3-6 months" },
  { key: "6_plus_months" as const, label: "6+ months" },
];

const SIDE_EFFECT_OPTIONS: { key: SideEffectType; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "nausea", label: "Nausea", icon: "frown" },
  { key: "fatigue", label: "Fatigue", icon: "battery" },
  { key: "constipation", label: "Constipation", icon: "alert-circle" },
  { key: "poor_appetite", label: "Poor appetite", icon: "minus-circle" },
  { key: "dizziness", label: "Dizziness or weakness", icon: "wind" },
  { key: "sleep_disruption", label: "Sleep disruption", icon: "moon" },
  { key: "none", label: "None or minimal", icon: "check-circle" },
];

const CONFIDENCE_OPTIONS = [
  { key: "low" as const, label: "Low" },
  { key: "medium" as const, label: "Medium" },
  { key: "high" as const, label: "High" },
];

const STRENGTH_OPTIONS = [
  { key: "yes" as const, label: "Yes, regularly" },
  { key: "sometimes" as const, label: "Sometimes" },
  { key: "no" as const, label: "No" },
];

const ACTIVITY_OPTIONS = [
  { key: "inactive" as const, label: "Mostly inactive", sub: "Desk job, minimal movement" },
  { key: "light" as const, label: "Lightly active", sub: "Walking, occasional movement" },
  { key: "moderate" as const, label: "Moderately active", sub: "Regular walks, some strength" },
  { key: "very_active" as const, label: "Very active", sub: "Daily exercise or physical job" },
];

const INJECTION_DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function OnboardingScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { updateProfile, completeOnboarding, toggleIntegration, integrations } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [selectedGoals, setSelectedGoals] = useState<HealthGoal[]>([]);

  const [medication, setMedication] = useState<"semaglutide" | "tirzepatide" | "liraglutide" | "other" | null>(null);
  const [reason, setReason] = useState<"weight_loss" | "metabolic_health" | "diabetes" | "other" | null>(null);
  const [duration, setDuration] = useState<"less_1_month" | "1_3_months" | "3_6_months" | "6_plus_months" | null>(null);
  const [dose, setDose] = useState("");
  const [injectionDay, setInjectionDay] = useState<string | null>(null);

  const [selectedSideEffects, setSelectedSideEffects] = useState<SideEffectType[]>([]);

  const [proteinConf, setProteinConf] = useState<"low" | "medium" | "high" | null>(null);
  const [hydrationConf, setHydrationConf] = useState<"low" | "medium" | "high" | null>(null);
  const [mealsPerDay, setMealsPerDay] = useState("3");
  const [underEating, setUnderEating] = useState<boolean | null>(null);
  const [strengthTraining, setStrengthTraining] = useState<"yes" | "sometimes" | "no" | null>(null);

  const [activityLevel, setActivityLevel] = useState<"inactive" | "light" | "moderate" | "very_active" | null>(null);

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
    updateProfile({
      goals: selectedGoals.length > 0 ? selectedGoals : ["stay_consistent"],
      glp1Medication: medication || undefined,
      glp1Reason: reason || undefined,
      glp1Duration: duration || undefined,
      glp1DoseOptional: dose.trim() || undefined,
      glp1InjectionDayOptional: injectionDay || undefined,
      baselineSideEffects: selectedSideEffects.length > 0 ? selectedSideEffects : undefined,
      proteinConfidence: proteinConf || undefined,
      hydrationConfidence: hydrationConf || undefined,
      mealsPerDay: parseInt(mealsPerDay) || 3,
      underEatingConcern: underEating ?? false,
      strengthTrainingBaseline: strengthTraining || "no",
      activityLevel: activityLevel || "light",
      daysAvailableToTrain: activityLevel === "very_active" ? 5 : activityLevel === "moderate" ? 3 : 2,
      availableWorkoutTime: 30,
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

  const toggleSideEffect = (s: SideEffectType) => {
    haptic();
    if (s === "none") {
      setSelectedSideEffects(["none"]);
      return;
    }
    setSelectedSideEffects((prev) => {
      const filtered = prev.filter(x => x !== "none");
      return filtered.includes(s) ? filtered.filter(x => x !== s) : [...filtered, s];
    });
  };

  const canProceed = () => {
    switch (step) {
      case "goals": return selectedGoals.length > 0;
      case "glp1_context": return medication !== null;
      case "side_effects": return selectedSideEffects.length > 0;
      case "nutrition": return proteinConf !== null && hydrationConf !== null;
      case "activity": return activityLevel !== null;
      default: return true;
    }
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
                Stay on track between visits. Viva combines wearable data with simple daily check-ins to help you feel your best on GLP-1.
              </Text>
            </View>
          )}

          {step === "goals" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>What matters most{"\n"}to you?</Text>
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
                          borderWidth: 1.5,
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

          {step === "glp1_context" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Your GLP-1{"\n"}treatment</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>This helps us personalize your support</Text>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Medication</Text>
              <View style={styles.optionList}>
                {MEDICATION_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setMedication(opt.key); }}
                    style={[styles.optionCard, {
                      backgroundColor: medication === opt.key ? c.primary + "10" : c.card,
                      borderColor: medication === opt.key ? c.primary : "transparent",
                      borderWidth: 1.5,
                    }]}
                  >
                    <Text style={[styles.optionLabel, { color: medication === opt.key ? c.primary : c.foreground, flex: 1 }]}>{opt.label}</Text>
                    {medication === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.primary }]}>
                        <Feather name="check" size={12} color={c.primaryForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Reason for taking it</Text>
              <View style={styles.chipRow}>
                {REASON_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setReason(opt.key); }}
                    style={[styles.chip, { backgroundColor: reason === opt.key ? c.primary : c.card }]}
                  >
                    <Text style={[styles.chipText, { color: reason === opt.key ? c.primaryForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>How long on treatment</Text>
              <View style={styles.chipRow}>
                {DURATION_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setDuration(opt.key); }}
                    style={[styles.chip, { backgroundColor: duration === opt.key ? c.primary : c.card }]}
                  >
                    <Text style={[styles.chipText, { color: duration === opt.key ? c.primaryForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={[styles.inlineField, { backgroundColor: c.card, borderRadius: 14 }]}>
                <Text style={[styles.inlineLabel, { color: c.mutedForeground }]}>Current dose (optional)</Text>
                <TextInput
                  value={dose}
                  onChangeText={setDose}
                  placeholder="e.g. 0.5mg"
                  placeholderTextColor={c.mutedForeground + "60"}
                  style={[styles.inlineInput, { color: c.foreground }]}
                />
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Injection day (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
                <View style={styles.dayRow}>
                  {INJECTION_DAY_OPTIONS.map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => { haptic(); setInjectionDay(injectionDay === d ? null : d); }}
                      style={[styles.dayChip, { backgroundColor: injectionDay === d ? c.primary : c.card }]}
                    >
                      <Text style={[styles.dayChipText, { color: injectionDay === d ? c.primaryForeground : c.foreground }]}>{d.slice(0, 3)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {step === "side_effects" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Any side effects{"\n"}you typically get?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Select all that apply. This helps us support you better.</Text>
              <View style={styles.goalGrid}>
                {SIDE_EFFECT_OPTIONS.map((opt) => {
                  const selected = selectedSideEffects.includes(opt.key);
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => toggleSideEffect(opt.key)}
                      style={({ pressed }) => [
                        styles.goalCard,
                        {
                          backgroundColor: selected ? c.primary + "12" : c.card,
                          borderColor: selected ? c.primary : "transparent",
                          borderWidth: 1.5,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.goalIconWrap, { backgroundColor: selected ? c.primary + "18" : c.muted }]}>
                        <Feather name={opt.icon} size={16} color={selected ? c.primary : c.mutedForeground} />
                      </View>
                      <Text style={[styles.goalLabel, { color: selected ? c.primary : c.foreground }]}>{opt.label}</Text>
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

          {step === "nutrition" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Nutrition and{"\n"}recovery baseline</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>No right or wrong answers. This helps us meet you where you are.</Text>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Protein confidence</Text>
              <View style={styles.segmentRow}>
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setProteinConf(opt.key); }}
                    style={[styles.segment, { backgroundColor: proteinConf === opt.key ? c.primary : c.card }]}
                  >
                    <Text style={[styles.segmentText, { color: proteinConf === opt.key ? c.primaryForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Hydration confidence</Text>
              <View style={styles.segmentRow}>
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setHydrationConf(opt.key); }}
                    style={[styles.segment, { backgroundColor: hydrationConf === opt.key ? c.primary : c.card }]}
                  >
                    <Text style={[styles.segmentText, { color: hydrationConf === opt.key ? c.primaryForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={[styles.inlineField, { backgroundColor: c.card, borderRadius: 14 }]}>
                <Text style={[styles.inlineLabel, { color: c.mutedForeground }]}>Meals per day</Text>
                <TextInput
                  value={mealsPerDay}
                  onChangeText={setMealsPerDay}
                  keyboardType="numeric"
                  style={[styles.inlineInput, { color: c.foreground }]}
                  selectTextOnFocus
                />
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Concerned about under-eating?</Text>
              <View style={styles.segmentRow}>
                <Pressable
                  onPress={() => { haptic(); setUnderEating(true); }}
                  style={[styles.segment, { backgroundColor: underEating === true ? c.primary : c.card }]}
                >
                  <Text style={[styles.segmentText, { color: underEating === true ? c.primaryForeground : c.foreground }]}>Yes</Text>
                </Pressable>
                <Pressable
                  onPress={() => { haptic(); setUnderEating(false); }}
                  style={[styles.segment, { backgroundColor: underEating === false ? c.primary : c.card }]}
                >
                  <Text style={[styles.segmentText, { color: underEating === false ? c.primaryForeground : c.foreground }]}>No</Text>
                </Pressable>
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Do you do any strength exercises?</Text>
              <View style={styles.segmentRow}>
                {STRENGTH_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setStrengthTraining(opt.key); }}
                    style={[styles.segment, { backgroundColor: strengthTraining === opt.key ? c.primary : c.card }]}
                  >
                    <Text style={[styles.segmentText, { color: strengthTraining === opt.key ? c.primaryForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
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

          {step === "integrations" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Connect your{"\n"}wearable data</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>
                More data means more personalized support. Sleep, heart rate, and activity all help Viva give you better daily guidance.
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
              <Text style={[styles.summaryTitle, { color: c.foreground }]}>You're all set</Text>
              <Text style={[styles.summarySub, { color: c.mutedForeground }]}>Here's what Viva will help you with</Text>

              <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
                <SummaryRow label="Treatment" value={medication ? MEDICATION_OPTIONS.find(m => m.key === medication)?.label || medication : "Not specified"} colors={c} />
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                <SummaryRow label="Your focus" value={selectedGoals.map(g => GOAL_OPTIONS.find(o => o.id === g)?.label || g).slice(0, 3).join(", ")} colors={c} />
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                <SummaryRow label="Daily support" value="Recovery, movement, appetite, symptoms, protein, hydration, and consistency" colors={c} />
              </View>

              <Text style={[styles.summaryNote, { color: c.mutedForeground }]}>
                Viva will help you stay on track between visits by monitoring your patterns and giving you simple daily guidance.
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

const sumStyles = StyleSheet.create({
  row: { gap: 4, paddingVertical: 2 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },
  value: { fontSize: 15, fontFamily: "Inter_500Medium", lineHeight: 22 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  progressBar: { flex: 1 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  contentWrap: { flex: 1 },
  scrollContent: { flex: 1 },
  contentInner: { paddingHorizontal: 24, paddingBottom: 24 },
  welcomeSection: { alignItems: "center", justifyContent: "center", flex: 1, gap: 10, paddingTop: 40 },
  heroIcon: { width: 88, height: 88, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  welcomeTitle: { fontSize: 24, fontFamily: "Inter_500Medium", letterSpacing: 8 },
  welcomeTagline: { fontSize: 30, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 38, letterSpacing: -0.5, marginTop: 6 },
  welcomeSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, paddingHorizontal: 24, marginTop: 6 },
  section: { gap: 16, paddingTop: 8 },
  stepTitle: { fontSize: 28, fontFamily: "Inter_700Bold", lineHeight: 36, letterSpacing: -0.4 },
  stepSub: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, marginTop: -8 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  goalCard: { width: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 14, borderRadius: 16, gap: 10 },
  goalIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  goalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  goalCheck: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  optionList: { gap: 8 },
  optionCard: { flexDirection: "row", alignItems: "center", paddingVertical: 16, paddingHorizontal: 16, borderRadius: 16, gap: 12 },
  optionContent: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  optionSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  optionCheck: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: "center" },
  segmentText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  inlineField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  inlineLabel: { fontSize: 15, fontFamily: "Inter_400Regular" },
  inlineInput: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "right", minWidth: 60, paddingVertical: 0 },
  dayScroll: { marginHorizontal: -24 },
  dayRow: { flexDirection: "row", gap: 8, paddingHorizontal: 24, paddingVertical: 4 },
  dayChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  dayChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  integrationCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, gap: 12 },
  integrationIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  skipBtn: { alignSelf: "center", paddingVertical: 8, marginTop: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  summarySection: { alignItems: "center", gap: 16, paddingTop: 40 },
  summaryIconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  summarySub: { fontSize: 15, fontFamily: "Inter_400Regular", marginTop: -8 },
  summaryCard: { width: "100%", borderRadius: 20, padding: 20, gap: 14, marginTop: 8 },
  summaryDivider: { height: StyleSheet.hairlineWidth },
  summaryNote: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, paddingHorizontal: 20, marginTop: 8 },
  ctaButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 24, marginBottom: 16, paddingVertical: 16, borderRadius: 16 },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
});
