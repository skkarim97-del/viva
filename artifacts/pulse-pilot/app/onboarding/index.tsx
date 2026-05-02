import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useRef, useMemo } from "react";
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
import { Logo } from "@/components/Logo";
import { useColors } from "@/hooks/useColors";
import type { HealthGoal, SideEffectType, MedicationProfile } from "@/types";
import {
  BRAND_OPTIONS,
  MEDICATION_DATABASE,
  TELEHEALTH_PLATFORMS,
  TIME_ON_MED_OPTIONS,
  getBrandGeneric,
  getBrandDisplayName,
  getDoseOptions,
  getMedicationFrequency,
  type MedicationBrand,
  type DoseOption,
} from "@/data/medicationData";

const STEPS = [
  "welcome",
  "name",
  "goals",
  "medication",
  "dose",
  "titration",
  "time_on_med",
  "telehealth",
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
  { id: "stay_consistent", label: "Stay on treatment", icon: "check-circle" },
  { id: "general_wellness", label: "Support overall health", icon: "heart" },
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
  const [userName, setUserName] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<HealthGoal[]>([]);

  const [medBrand, setMedBrand] = useState<MedicationBrand | null>(null);
  const [selectedDose, setSelectedDose] = useState<DoseOption | null>(null);
  const [customMedName, setCustomMedName] = useState("");
  const [customDose, setCustomDose] = useState("");
  const [customFrequency, setCustomFrequency] = useState<"weekly" | "daily">("weekly");
  const [injectionDay, setInjectionDay] = useState<string | null>(null);

  const [recentTitration, setRecentTitration] = useState<boolean | null>(null);
  const [previousDose, setPreviousDose] = useState<DoseOption | null>(null);
  const [customPreviousDose, setCustomPreviousDose] = useState("");

  const [timeOnMed, setTimeOnMed] = useState<"less_30_days" | "30_60_days" | "60_90_days" | "3_6_months" | "6_12_months" | "1_2_years" | "2_plus_years" | null>(null);

  const [telehealthPlatform, setTelehealthPlatform] = useState<string | null>(null);
  const [customPlatform, setCustomPlatform] = useState("");
  const [platformSearch, setPlatformSearch] = useState("");

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

  const doseOptions = useMemo(() => {
    if (!medBrand || medBrand === "other") return [];
    return getDoseOptions(medBrand);
  }, [medBrand]);

  const previousDoseOptions = useMemo(() => {
    if (!medBrand || medBrand === "other") return [];
    return getDoseOptions(medBrand).filter(d => selectedDose ? d.value !== selectedDose.value : true);
  }, [medBrand, selectedDose]);

  const filteredPlatforms = useMemo(() => {
    if (!platformSearch.trim()) return TELEHEALTH_PLATFORMS;
    const q = platformSearch.toLowerCase();
    return TELEHEALTH_PLATFORMS.filter(p => p.toLowerCase().includes(q));
  }, [platformSearch]);

  const medFrequency = useMemo(() => {
    if (!medBrand) return "weekly";
    return getMedicationFrequency(medBrand);
  }, [medBrand]);

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

  const buildMedicationProfile = (): MedicationProfile | undefined => {
    if (!medBrand) return undefined;

    if (medBrand === "other") {
      const doseVal = parseFloat(customDose) || 0;
      return {
        medicationBrand: customMedName.trim() || "Other",
        genericName: "unknown",
        indication: "weight loss",
        doseValue: doseVal,
        doseUnit: "mg",
        frequency: customFrequency,
        recentTitration: recentTitration === true,
        previousDoseValue: customPreviousDose ? parseFloat(customPreviousDose) || null : null,
        previousDoseUnit: customPreviousDose ? "mg" : null,
        previousFrequency: customPreviousDose ? customFrequency : null,
        doseChangeDate: null,
        timeOnMedicationBucket: timeOnMed || "3_6_months",
        telehealthPlatform: telehealthPlatform === "Other" ? customPlatform.trim() || "Other" : telehealthPlatform,
        plannedDoseDay: injectionDay,
      };
    }

    return {
      medicationBrand: getBrandDisplayName(medBrand),
      genericName: getBrandGeneric(medBrand),
      indication: "weight loss",
      doseValue: selectedDose?.value || 0,
      doseUnit: selectedDose?.unit || "mg",
      frequency: medFrequency,
      recentTitration: recentTitration === true,
      previousDoseValue: previousDose?.value || null,
      previousDoseUnit: previousDose?.unit || null,
      previousFrequency: previousDose ? medFrequency : null,
      doseChangeDate: null,
      timeOnMedicationBucket: timeOnMed || "3_6_months",
      telehealthPlatform: telehealthPlatform === "Other" ? customPlatform.trim() || "Other" : telehealthPlatform,
      plannedDoseDay: injectionDay,
    };
  };

  const finishOnboarding = () => {
    const medProfile = buildMedicationProfile();
    const legacyMed = medBrand === "other" ? "other" as const
      : medBrand ? (getBrandGeneric(medBrand) as "semaglutide" | "tirzepatide" | "liraglutide")
      : undefined;

    updateProfile({
      name: userName.trim(),
      goals: selectedGoals.length > 0 ? selectedGoals : ["stay_consistent"],
      glp1Medication: legacyMed,
      glp1Duration: timeOnMed || undefined,
      glp1DoseOptional: selectedDose?.label || customDose || undefined,
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
      medicationProfile: medProfile,
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
      case "name": return userName.trim().length > 0;
      case "goals": return selectedGoals.length > 0;
      case "medication": return medBrand !== null;
      case "dose":
        if (medBrand === "other") {
          return customMedName.trim().length > 0 && customDose.trim().length > 0 && !Number.isNaN(parseFloat(customDose));
        }
        return selectedDose !== null;
      case "titration":
        if (recentTitration === null) return false;
        if (recentTitration === true && medBrand === "other") {
          return customPreviousDose.trim().length > 0 && !Number.isNaN(parseFloat(customPreviousDose));
        }
        return true;
      case "time_on_med": return timeOnMed !== null;
      case "telehealth":
        if (telehealthPlatform === "Other") return customPlatform.trim().length > 0;
        return true;
      case "side_effects": return selectedSideEffects.length > 0;
      case "nutrition": {
        const meals = parseInt(mealsPerDay, 10);
        return (
          proteinConf !== null &&
          hydrationConf !== null &&
          underEating !== null &&
          strengthTraining !== null &&
          !Number.isNaN(meals) && meals > 0
        );
      }
      case "activity": return activityLevel !== null;
      default: return true;
    }
  };

  const ctaText = step === "welcome" ? "Get Started"
    : step === "summary" ? "Start Your Plan"
    : step === "integrations" ? "Continue"
    : step === "telehealth" ? (telehealthPlatform ? "Continue" : "Skip")
    : "Continue";

  const medDisplayLabel = useMemo(() => {
    if (!medBrand) return "Not specified";
    if (medBrand === "other") return customMedName.trim() || "Other GLP-1 med";
    return getBrandDisplayName(medBrand);
  }, [medBrand, customMedName]);

  const doseDisplayLabel = useMemo(() => {
    if (medBrand === "other") return customDose ? `${customDose} mg ${customFrequency}` : "";
    return selectedDose?.label || "";
  }, [medBrand, selectedDose, customDose, customFrequency]);

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
              <View style={[styles.progressFill, { backgroundColor: c.accent, width: `${((currentIndex) / (STEPS.length - 1)) * 100}%` }]} />
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
              {/* Brand lockup: viva. wordmark stacked over the
                  product label. Same pattern used by Viva Clinic and
                  Viva Analytics so the three surfaces read as one
                  platform. Inside the actual tab UI we keep just the
                  wordmark — the "Care" label only appears here on
                  the entry / sign-in surface. */}
              <View style={styles.welcomeBrand}>
                <Logo size="large" />
                {/* Center "Care" under the visible "viva." wordmark.
                    The PNG asset has 13.4% / 14.6% transparent
                    padding on left/right; the visual center of the
                    wordmark is therefore within ~1px of the PNG's
                    geometric center, so a plain alignItems:center on
                    the parent column is the closest balanced fit and
                    avoids the previous marginLeft:27 hack (which
                    aligned Care with the LEFT of viva., not the
                    center). */}
                <Text style={[styles.welcomeProduct, { color: c.foreground }]}>Care</Text>
              </View>
              <Text style={[styles.welcomeTagline, { color: c.foreground }]}>Daily support for your GLP-1 journey</Text>
              <Text style={[styles.welcomeSub, { color: c.mutedForeground + "CC" }]}>
                A simple daily check-in plus Apple Health, so your care team sees how you're really doing between visits.
              </Text>
            </View>
          )}

          {step === "name" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>What should we call you?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Your first name is fine</Text>
              <TextInput
                style={[styles.nameInput, { color: c.foreground, backgroundColor: c.card, borderColor: userName.trim() ? c.accent : c.muted }]}
                placeholder="First name"
                placeholderTextColor={c.mutedForeground}
                value={userName}
                onChangeText={setUserName}
                autoFocus
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => { if (userName.trim()) next(); }}
              />
            </View>
          )}

          {step === "goals" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>What matters most during treatment?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Pick the lifestyle and treatment priorities you want Viva to support. Select all that apply.</Text>
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
                          backgroundColor: selected ? c.accent + "12" : c.card,
                          borderColor: selected ? c.accent : "transparent",
                          borderWidth: 1.5,
                          opacity: pressed ? 0.8 : 1,
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                        },
                      ]}
                    >
                      <View style={[styles.goalIconWrap, { backgroundColor: selected ? c.accent + "18" : c.muted }]}>
                        <Feather name={goal.icon} size={18} color={selected ? c.accent : c.mutedForeground} />
                      </View>
                      <Text style={[styles.goalLabel, { color: selected ? c.accent : c.foreground }]}>{goal.label}</Text>
                      {selected && (
                        <View style={[styles.goalCheck, { backgroundColor: c.accent }]}>
                          <Feather name="check" size={10} color={c.accentForeground} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {step === "medication" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Which medication are you taking?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>This helps us personalize your support</Text>
              <View style={styles.optionList}>
                {BRAND_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      haptic();
                      setMedBrand(opt.key);
                      if (opt.key !== medBrand) {
                        setSelectedDose(null);
                        setPreviousDose(null);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: medBrand === opt.key ? c.accent + "10" : c.card,
                        borderColor: medBrand === opt.key ? c.accent : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.optionLabel, { color: medBrand === opt.key ? c.accent : c.foreground, flex: 1 }]}>{opt.label}</Text>
                    {medBrand === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.accent }]}>
                        <Feather name="check" size={12} color={c.accentForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "dose" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>What dose are you on?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Your dose helps us calibrate support</Text>

              {medBrand !== "other" ? (
                <>
                  <View style={styles.optionList}>
                    {doseOptions.map((dose) => (
                      <Pressable
                        key={dose.label}
                        onPress={() => { haptic(); setSelectedDose(dose); }}
                        style={({ pressed }) => [
                          styles.optionCard,
                          {
                            backgroundColor: selectedDose?.value === dose.value ? c.accent + "10" : c.card,
                            borderColor: selectedDose?.value === dose.value ? c.accent : "transparent",
                            borderWidth: 1.5,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.optionLabel, { color: selectedDose?.value === dose.value ? c.accent : c.foreground, flex: 1 }]}>{dose.label}</Text>
                        {selectedDose?.value === dose.value && (
                          <View style={[styles.optionCheck, { backgroundColor: c.accent }]}>
                            <Feather name="check" size={12} color={c.accentForeground} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>

                  {medFrequency === "weekly" && (
                    <>
                      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Injection day (optional)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
                        <View style={styles.dayRow}>
                          {INJECTION_DAY_OPTIONS.map((d) => (
                            <Pressable
                              key={d}
                              onPress={() => { haptic(); setInjectionDay(injectionDay === d ? null : d); }}
                              style={[styles.dayChip, { backgroundColor: injectionDay === d ? c.accent : c.card }]}
                            >
                              <Text style={[styles.dayChipText, { color: injectionDay === d ? c.accentForeground : c.foreground }]}>{d.slice(0, 3)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    </>
                  )}
                </>
              ) : (
                <View style={styles.customFields}>
                  <View style={[styles.inlineField, { backgroundColor: c.card, borderRadius: 14 }]}>
                    <Text style={[styles.inlineLabel, { color: c.mutedForeground }]}>Medication name</Text>
                    <TextInput
                      value={customMedName}
                      onChangeText={setCustomMedName}
                      placeholder="e.g. Compounded semaglutide"
                      placeholderTextColor={c.mutedForeground + "60"}
                      style={[styles.inlineInput, { color: c.foreground, flex: 1, textAlign: "left", marginLeft: 12 }]}
                    />
                  </View>
                  <View style={[styles.inlineField, { backgroundColor: c.card, borderRadius: 14 }]}>
                    <Text style={[styles.inlineLabel, { color: c.mutedForeground }]}>Dose (mg)</Text>
                    <TextInput
                      value={customDose}
                      onChangeText={setCustomDose}
                      placeholder="e.g. 0.5"
                      placeholderTextColor={c.mutedForeground + "60"}
                      keyboardType="decimal-pad"
                      style={[styles.inlineInput, { color: c.foreground }]}
                    />
                  </View>
                  <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Frequency</Text>
                  <View style={styles.segmentRow}>
                    <Pressable
                      onPress={() => { haptic(); setCustomFrequency("weekly"); }}
                      style={[styles.segment, { backgroundColor: customFrequency === "weekly" ? c.accent : c.card }]}
                    >
                      <Text style={[styles.segmentText, { color: customFrequency === "weekly" ? c.accentForeground : c.foreground }]}>Weekly</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { haptic(); setCustomFrequency("daily"); }}
                      style={[styles.segment, { backgroundColor: customFrequency === "daily" ? c.accent : c.card }]}
                    >
                      <Text style={[styles.segmentText, { color: customFrequency === "daily" ? c.accentForeground : c.foreground }]}>Daily</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          )}

          {step === "titration" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Did your dose change in the last 14 days?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Recent changes affect how we support you</Text>
              <View style={styles.segmentRow}>
                <Pressable
                  onPress={() => { haptic(); setRecentTitration(true); }}
                  style={[styles.titrationOption, {
                    backgroundColor: recentTitration === true ? c.accent + "10" : c.card,
                    borderColor: recentTitration === true ? c.accent : "transparent",
                  }]}
                >
                  <Text style={[styles.titrationLabel, { color: recentTitration === true ? c.accent : c.foreground }]}>Yes</Text>
                  <Text style={[styles.titrationSub, { color: c.mutedForeground }]}>Recently changed</Text>
                </Pressable>
                <Pressable
                  onPress={() => { haptic(); setRecentTitration(false); }}
                  style={[styles.titrationOption, {
                    backgroundColor: recentTitration === false ? c.accent + "10" : c.card,
                    borderColor: recentTitration === false ? c.accent : "transparent",
                  }]}
                >
                  <Text style={[styles.titrationLabel, { color: recentTitration === false ? c.accent : c.foreground }]}>No</Text>
                  <Text style={[styles.titrationSub, { color: c.mutedForeground }]}>Same dose</Text>
                </Pressable>
              </View>

              {recentTitration === true && medBrand !== "other" && previousDoseOptions.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Previous dose</Text>
                  <View style={styles.chipRow}>
                    {previousDoseOptions.map((dose) => (
                      <Pressable
                        key={dose.label}
                        onPress={() => { haptic(); setPreviousDose(dose); }}
                        style={[styles.chip, { backgroundColor: previousDose?.value === dose.value ? c.accent : c.card }]}
                      >
                        <Text style={[styles.chipText, { color: previousDose?.value === dose.value ? c.accentForeground : c.foreground }]}>{dose.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {recentTitration === true && medBrand === "other" && (
                <View style={[styles.inlineField, { backgroundColor: c.card, borderRadius: 14 }]}>
                  <Text style={[styles.inlineLabel, { color: c.mutedForeground }]}>Previous dose (mg)</Text>
                  <TextInput
                    value={customPreviousDose}
                    onChangeText={setCustomPreviousDose}
                    placeholder="e.g. 0.25"
                    placeholderTextColor={c.mutedForeground + "60"}
                    keyboardType="decimal-pad"
                    style={[styles.inlineInput, { color: c.foreground }]}
                  />
                </View>
              )}
            </View>
          )}

          {step === "time_on_med" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>How long have you been on this medication?</Text>
              <View style={styles.optionList}>
                {TIME_ON_MED_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setTimeOnMed(opt.key); }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: timeOnMed === opt.key ? c.accent + "10" : c.card,
                        borderColor: timeOnMed === opt.key ? c.accent : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.optionLabel, { color: timeOnMed === opt.key ? c.accent : c.foreground, flex: 1 }]}>{opt.label}</Text>
                    {timeOnMed === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.accent }]}>
                        <Feather name="check" size={12} color={c.accentForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "telehealth" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Where are you getting treatment?</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>Optional. Helps us understand your setup.</Text>

              <TextInput
                style={[styles.searchInput, { color: c.foreground, backgroundColor: c.card, borderColor: c.muted }]}
                placeholder="Search platforms..."
                placeholderTextColor={c.mutedForeground + "80"}
                value={platformSearch}
                onChangeText={setPlatformSearch}
              />

              <View style={styles.platformGrid}>
                {filteredPlatforms.map((platform) => (
                  <Pressable
                    key={platform}
                    onPress={() => {
                      haptic();
                      setTelehealthPlatform(telehealthPlatform === platform ? null : platform);
                    }}
                    style={[styles.platformChip, {
                      backgroundColor: telehealthPlatform === platform ? c.accent + "10" : c.card,
                      borderColor: telehealthPlatform === platform ? c.accent : "transparent",
                    }]}
                  >
                    <Text style={[styles.platformText, {
                      color: telehealthPlatform === platform ? c.accent : c.foreground,
                    }]}>{platform}</Text>
                  </Pressable>
                ))}
              </View>

              {telehealthPlatform === "Other" && (
                <View style={[styles.inlineField, { backgroundColor: c.card, borderRadius: 14 }]}>
                  <Text style={[styles.inlineLabel, { color: c.mutedForeground }]}>Platform name</Text>
                  <TextInput
                    value={customPlatform}
                    onChangeText={setCustomPlatform}
                    placeholder="Enter name"
                    placeholderTextColor={c.mutedForeground + "60"}
                    style={[styles.inlineInput, { color: c.foreground, flex: 1, textAlign: "left", marginLeft: 12 }]}
                  />
                </View>
              )}
            </View>
          )}

          {step === "side_effects" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Any side effects you typically get?</Text>
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
                          backgroundColor: selected ? c.accent + "12" : c.card,
                          borderColor: selected ? c.accent : "transparent",
                          borderWidth: 1.5,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.goalIconWrap, { backgroundColor: selected ? c.accent + "18" : c.muted }]}>
                        <Feather name={opt.icon} size={16} color={selected ? c.accent : c.mutedForeground} />
                      </View>
                      <Text style={[styles.goalLabel, { color: selected ? c.accent : c.foreground }]}>{opt.label}</Text>
                      {selected && (
                        <View style={[styles.goalCheck, { backgroundColor: c.accent }]}>
                          <Feather name="check" size={10} color={c.accentForeground} />
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
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Nutrition and recovery baseline</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>No right or wrong answers. This helps us meet you where you are.</Text>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Protein confidence</Text>
              <View style={styles.segmentRow}>
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setProteinConf(opt.key); }}
                    style={[styles.segment, { backgroundColor: proteinConf === opt.key ? c.accent : c.card }]}
                  >
                    <Text style={[styles.segmentText, { color: proteinConf === opt.key ? c.accentForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Hydration confidence</Text>
              <View style={styles.segmentRow}>
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setHydrationConf(opt.key); }}
                    style={[styles.segment, { backgroundColor: hydrationConf === opt.key ? c.accent : c.card }]}
                  >
                    <Text style={[styles.segmentText, { color: hydrationConf === opt.key ? c.accentForeground : c.foreground }]}>{opt.label}</Text>
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
                  style={[styles.segment, { backgroundColor: underEating === true ? c.accent : c.card }]}
                >
                  <Text style={[styles.segmentText, { color: underEating === true ? c.accentForeground : c.foreground }]}>Yes</Text>
                </Pressable>
                <Pressable
                  onPress={() => { haptic(); setUnderEating(false); }}
                  style={[styles.segment, { backgroundColor: underEating === false ? c.accent : c.card }]}
                >
                  <Text style={[styles.segmentText, { color: underEating === false ? c.accentForeground : c.foreground }]}>No</Text>
                </Pressable>
              </View>

              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Do you do any strength exercises?</Text>
              <View style={styles.segmentRow}>
                {STRENGTH_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setStrengthTraining(opt.key); }}
                    style={[styles.segment, { backgroundColor: strengthTraining === opt.key ? c.accent : c.card }]}
                  >
                    <Text style={[styles.segmentText, { color: strengthTraining === opt.key ? c.accentForeground : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "activity" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>How active are you right now?</Text>
              <View style={styles.optionList}>
                {ACTIVITY_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => { haptic(); setActivityLevel(opt.key); }}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: activityLevel === opt.key ? c.accent + "10" : c.card,
                        borderColor: activityLevel === opt.key ? c.accent : "transparent",
                        borderWidth: 1.5,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View style={styles.optionContent}>
                      <Text style={[styles.optionLabel, { color: activityLevel === opt.key ? c.accent : c.foreground }]}>{opt.label}</Text>
                      <Text style={[styles.optionSub, { color: c.mutedForeground }]}>{opt.sub}</Text>
                    </View>
                    {activityLevel === opt.key && (
                      <View style={[styles.optionCheck, { backgroundColor: c.accent }]}>
                        <Feather name="check" size={12} color={c.accentForeground} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {step === "integrations" && (
            <View style={styles.section}>
              <Text style={[styles.stepTitle, { color: c.foreground }]}>Connect Apple Health</Text>
              <Text style={[styles.stepSub, { color: c.mutedForeground }]}>
                Viva uses your sleep, activity, heart rate, and recovery data from Apple Health for more personalized daily support.
              </Text>
              <View style={styles.optionList}>
                {integrations.map((integration) => (
                  <Pressable
                    key={integration.id}
                    onPress={() => { haptic(); toggleIntegration(integration.id); }}
                    style={[
                      styles.integrationCard,
                      {
                        backgroundColor: integration.connected ? c.accent + "10" : c.card,
                        borderColor: integration.connected ? c.accent : "transparent",
                        borderWidth: 1.5,
                      },
                    ]}
                  >
                    <View style={[styles.integrationIcon, { backgroundColor: c.accent + "12" }]}>
                      <Feather name={integration.icon as keyof typeof Feather.glyphMap} size={20} color={c.accent} />
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
              <Text style={[styles.summaryTitle, { color: c.foreground }]}>{userName.trim() ? `You're all set, ${userName.trim()}` : "You're all set"}</Text>
              <Text style={[styles.summarySub, { color: c.mutedForeground }]}>Here's what Viva will help you with</Text>

              <View style={[styles.summaryCard, { backgroundColor: c.card }]}>
                <SummaryRow label="Medication" value={`${medDisplayLabel}${doseDisplayLabel ? ` \u00B7 ${doseDisplayLabel}` : ""}`} colors={c} />
                <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                {telehealthPlatform && (
                  <>
                    <SummaryRow label="Platform" value={telehealthPlatform === "Other" ? customPlatform.trim() || "Other" : telehealthPlatform} colors={c} />
                    <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
                  </>
                )}
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
  label: { fontSize: 11, fontFamily: "Montserrat_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },
  value: { fontSize: 15, fontFamily: "Montserrat_500Medium", lineHeight: 22 },
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
  welcomeBrand: { flexDirection: "column", alignItems: "center", gap: 0 },
  welcomeProduct: { fontSize: 22, fontFamily: "Montserrat_700Bold", letterSpacing: -0.4, marginTop: -2 },
  heroIcon: { width: 88, height: 88, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  welcomeTitle: { fontSize: 24, fontFamily: "Montserrat_500Medium", letterSpacing: 8 },
  welcomeTagline: { fontSize: 30, fontFamily: "Montserrat_700Bold", textAlign: "center", lineHeight: 38, letterSpacing: -0.5, marginTop: 6 },
  welcomeSub: { fontSize: 14, fontFamily: "Montserrat_400Regular", textAlign: "center", lineHeight: 22, paddingHorizontal: 24, marginTop: 6 },
  section: { gap: 16, paddingTop: 8 },
  stepTitle: { fontSize: 28, fontFamily: "Montserrat_700Bold", lineHeight: 36, letterSpacing: -0.4 },
  stepSub: { fontSize: 15, fontFamily: "Montserrat_400Regular", lineHeight: 22, marginTop: -8 },
  nameInput: { fontSize: 18, fontFamily: "Montserrat_500Medium", paddingVertical: 16, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1.5, marginTop: 8 },
  sectionLabel: { fontSize: 12, fontFamily: "Montserrat_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  // minHeight keeps every card the same vertical size regardless of how
  // its label wraps, so a 1-line "Lose weight" sits flush with a 2-line
  // "Improve metabolic health" and the grid reads as a tidy matrix.
  goalCard: { minWidth: "47%", flexBasis: "47%", flexGrow: 1, flexShrink: 1, minHeight: 76, flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 14, borderRadius: 16, gap: 10 },
  goalIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  goalLabel: { fontSize: 14, fontFamily: "Montserrat_600SemiBold", flex: 1, flexShrink: 1 },
  goalCheck: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  optionList: { gap: 8 },
  optionCard: { flexDirection: "row", alignItems: "center", paddingVertical: 16, paddingHorizontal: 16, borderRadius: 16, gap: 12 },
  optionContent: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 16, fontFamily: "Montserrat_600SemiBold" },
  optionSub: { fontSize: 13, fontFamily: "Montserrat_400Regular" },
  optionCheck: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  chipText: { fontSize: 14, fontFamily: "Montserrat_500Medium" },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: "center" },
  segmentText: { fontSize: 14, fontFamily: "Montserrat_600SemiBold" },
  inlineField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  inlineLabel: { fontSize: 15, fontFamily: "Montserrat_400Regular" },
  inlineInput: { fontSize: 18, fontFamily: "Montserrat_600SemiBold", textAlign: "right", minWidth: 60, paddingVertical: 0 },
  dayScroll: { marginHorizontal: -24 },
  dayRow: { flexDirection: "row", gap: 8, paddingHorizontal: 24, paddingVertical: 4 },
  dayChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  dayChipText: { fontSize: 13, fontFamily: "Montserrat_500Medium" },
  integrationCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, gap: 12 },
  integrationIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  skipBtn: { alignSelf: "center", paddingVertical: 8, marginTop: 4 },
  skipText: { fontSize: 14, fontFamily: "Montserrat_500Medium" },
  summarySection: { alignItems: "center", gap: 16, paddingTop: 40 },
  summaryIconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontSize: 28, fontFamily: "Montserrat_700Bold", letterSpacing: -0.3 },
  summarySub: { fontSize: 15, fontFamily: "Montserrat_400Regular", marginTop: -8 },
  summaryCard: { width: "100%", borderRadius: 20, padding: 20, gap: 14, marginTop: 8 },
  summaryDivider: { height: StyleSheet.hairlineWidth },
  summaryNote: { fontSize: 13, fontFamily: "Montserrat_400Regular", textAlign: "center", lineHeight: 20, paddingHorizontal: 20, marginTop: 8 },
  ctaButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 24, marginBottom: 16, paddingVertical: 16, borderRadius: 16 },
  ctaText: { fontSize: 17, fontFamily: "Montserrat_600SemiBold" },
  customFields: { gap: 12 },
  searchInput: { fontSize: 15, fontFamily: "Montserrat_400Regular", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1 },
  platformGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  platformChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5 },
  platformText: { fontSize: 14, fontFamily: "Montserrat_500Medium" },
  titrationOption: { flex: 1, alignItems: "center", paddingVertical: 20, borderRadius: 16, borderWidth: 1.5, gap: 4 },
  titrationLabel: { fontSize: 18, fontFamily: "Montserrat_700Bold" },
  titrationSub: { fontSize: 13, fontFamily: "Montserrat_400Regular" },
});
