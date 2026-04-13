import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SubscriptionCard } from "@/components/SubscriptionCard";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

const plans = [
  {
    tier: "free" as const,
    title: "Free",
    price: "$0/mo",
    features: [
      "Basic daily dashboard",
      "Manual data entry",
      "Limited daily coaching",
      "Sample trend insights",
    ],
  },
  {
    tier: "premium" as const,
    title: "Premium",
    price: "$9.99/mo",
    features: [
      "Full wearable integrations",
      "Full AI daily coaching",
      "Weekly movement & recovery plan",
      "Protein & nutrition coaching",
      "GLP-1 side effect guidance",
      "Trend analysis",
      "Chat with AI coach",
      "Smart alerts",
    ],
    isRecommended: true,
  },
  {
    tier: "premium_plus" as const,
    title: "Premium Plus",
    price: "$19.99/mo",
    features: [
      "Everything in Premium",
      "Goal-specific protocols",
      "Advanced personalization",
      "Deeper trend analysis",
      "Proactive coaching",
      "Habit planning & accountability",
      "Advanced recovery logic",
    ],
  },
];

export default function SubscriptionScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { profile, upgradeTier } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleSelect = (tier: "free" | "premium" | "premium_plus") => {
    upgradeTier(tier);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Choose Your Plan</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          Unlock the full Viva experience
        </Text>

        {plans.map((plan) => (
          <SubscriptionCard
            key={plan.tier}
            title={plan.title}
            price={plan.price}
            features={plan.features}
            isActive={profile.tier === plan.tier}
            isRecommended={plan.isRecommended}
            onSelect={() => handleSelect(plan.tier)}
          />
        ))}

        <Text style={[styles.trialNote, { color: c.mutedForeground }]}>
          Start with a 7-day free trial. Cancel anytime.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Montserrat_700Bold",
  },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  trialNote: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
});
