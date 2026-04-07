import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";
import type { HealthGoal } from "@/types";

const STEPS = ["welcome", "goals", "profile", "integrations"] as const;
type Step = (typeof STEPS)[number];

const goalOptions: { id: HealthGoal; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: "fat_loss", label: "Lose weight", icon: "trending-down" },
  { id: "muscle_gain", label: "Build muscle", icon: "zap" },
  { id: "better_sleep", label: "Sleep better", icon: "moon" },
  { id: "improved_energy", label: "More energy", icon: "sun" },
  { id: "better_recovery", label: "Recover faster", icon: "battery-charging" },
  { id: "general_wellness", label: "General health", icon: "heart" },
  { id: "endurance", label: "Build endurance", icon: "wind" },
];

export default function OnboardingScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { updateProfile, completeOnboarding, toggleIntegration, integrations } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [selectedGoals, setSelectedGoals] = useState<HealthGoal[]>([]);
  const [name, setName] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const currentIndex = STEPS.indexOf(step);

  const next = () => {
    if (currentIndex < STEPS.length - 1) {
      setStep(STEPS[currentIndex + 1]);
    } else {
      updateProfile({ goals: selectedGoals, name, onboardingComplete: true });
      completeOnboarding();
      router.replace("/(tabs)");
    }
  };

  const toggleGoal = (g: HealthGoal) => {
    setSelectedGoals((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View
            key={s}
            style={[
              styles.progressDot,
              {
                backgroundColor: i <= currentIndex ? c.primary : c.muted,
                width: i === currentIndex ? 24 : 8,
              },
            ]}
          />
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        {step === "welcome" && (
          <View style={styles.section}>
            <View style={[styles.heroIcon, { backgroundColor: c.primary + "15" }]}>
              <Feather name="activity" size={48} color={c.primary} />
            </View>
            <Text style={[styles.heroTitle, { color: c.foreground }]}>Welcome to PulsePilot</Text>
            <Text style={[styles.heroSubtitle, { color: c.mutedForeground }]}>
              Your personal AI health coach. We'll translate your body's data into simple, actionable daily guidance.
            </Text>
            <View style={styles.valueProps}>
              {[
                { icon: "compass" as const, text: "Know exactly what to do each day" },
                { icon: "bar-chart-2" as const, text: "Track progress with zero complexity" },
                { icon: "message-circle" as const, text: "Chat with your AI coach anytime" },
              ].map((item) => (
                <View key={item.text} style={styles.valueProp}>
                  <View style={[styles.vpIcon, { backgroundColor: c.primary + "12" }]}>
                    <Feather name={item.icon} size={18} color={c.primary} />
                  </View>
                  <Text style={[styles.vpText, { color: c.foreground }]}>{item.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {step === "goals" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>What are your goals?</Text>
            <Text style={[styles.sectionSubtitle, { color: c.mutedForeground }]}>
              Select all that apply. We'll personalize everything for you.
            </Text>
            <View style={styles.goalGrid}>
              {goalOptions.map((goal) => {
                const selected = selectedGoals.includes(goal.id);
                return (
                  <Pressable
                    key={goal.id}
                    onPress={() => toggleGoal(goal.id)}
                    style={[
                      styles.goalCard,
                      {
                        backgroundColor: selected ? c.primary + "12" : c.card,
                        borderColor: selected ? c.primary : c.border,
                        borderWidth: selected ? 2 : 1,
                      },
                    ]}
                  >
                    <Feather name={goal.icon} size={22} color={selected ? c.primary : c.mutedForeground} />
                    <Text
                      style={[
                        styles.goalLabel,
                        { color: selected ? c.primary : c.foreground },
                      ]}
                    >
                      {goal.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {step === "profile" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Quick profile</Text>
            <Text style={[styles.sectionSubtitle, { color: c.mutedForeground }]}>
              This helps us calibrate your coaching. You can update these anytime.
            </Text>
            <View style={styles.profileFields}>
              {[
                { label: "Age", value: "32", key: "age" },
                { label: "Weight (lbs)", value: "185", key: "weight" },
                { label: "Goal weight (lbs)", value: "170", key: "goalWeight" },
                { label: "Height (inches)", value: "70", key: "height" },
                { label: "Days to train / week", value: "4", key: "daysAvailableToTrain" },
              ].map((field) => (
                <View key={field.key} style={[styles.profileField, { borderColor: c.border }]}>
                  <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{field.label}</Text>
                  <Text style={[styles.fieldValue, { color: c.foreground }]}>{field.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {step === "integrations" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Connect your devices</Text>
            <Text style={[styles.sectionSubtitle, { color: c.mutedForeground }]}>
              Link your wearable for automatic data sync. You can always add these later.
            </Text>
            <View style={styles.integrationList}>
              {integrations.map((integration) => (
                <Pressable
                  key={integration.id}
                  onPress={() => toggleIntegration(integration.id)}
                  style={[
                    styles.integrationCard,
                    {
                      backgroundColor: integration.connected ? c.primary + "10" : c.card,
                      borderColor: integration.connected ? c.primary : c.border,
                    },
                  ]}
                >
                  <View style={[styles.integrationIcon, { backgroundColor: c.primary + "12" }]}>
                    <Feather name={integration.icon as keyof typeof Feather.glyphMap} size={22} color={c.primary} />
                  </View>
                  <View style={styles.integrationInfo}>
                    <Text style={[styles.integrationName, { color: c.foreground }]}>
                      {integration.name}
                    </Text>
                    <Text style={[styles.integrationStatus, { color: c.mutedForeground }]}>
                      {integration.connected ? "Connected" : "Tap to connect"}
                    </Text>
                  </View>
                  <Feather
                    name={integration.connected ? "check-circle" : "plus-circle"}
                    size={22}
                    color={integration.connected ? c.success : c.mutedForeground}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={next}
        style={({ pressed }) => [
          styles.nextButton,
          {
            backgroundColor: c.primary,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <Text style={[styles.nextButtonText, { color: c.primaryForeground }]}>
          {step === "integrations" ? "Get Started" : "Continue"}
        </Text>
        <Feather name="arrow-right" size={18} color={c.primaryForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 16,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  section: {
    gap: 16,
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 24,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 12,
  },
  valueProps: {
    gap: 14,
    marginTop: 20,
  },
  valueProp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  vpIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  vpText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  sectionTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginTop: 12,
  },
  sectionSubtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
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
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: colors.radius,
    alignItems: "center",
    gap: 8,
  },
  goalLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  profileFields: {
    gap: 10,
    marginTop: 4,
  },
  profileField: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: colors.radius,
  },
  fieldLabel: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  fieldValue: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  integrationList: {
    gap: 10,
    marginTop: 4,
  },
  integrationCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 12,
  },
  integrationIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  integrationInfo: {
    flex: 1,
    gap: 2,
  },
  integrationName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  integrationStatus: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 16,
    paddingVertical: 16,
    borderRadius: colors.radius,
  },
  nextButtonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
