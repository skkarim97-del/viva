import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export default function SettingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { profile, integrations, toggleIntegration } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const tierLabel =
    profile.tier === "premium_plus"
      ? "Premium Plus"
      : profile.tier === "premium"
      ? "Premium"
      : "Free";

  const handleUpgrade = () => {
    router.push("/subscription");
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: c.foreground }]}>Settings</Text>

      <View style={[styles.profileCard, { backgroundColor: c.card }]}>
        <View style={[styles.profileAvatar, { backgroundColor: c.primary + "12" }]}>
          <Text style={[styles.profileInitial, { color: c.primary }]}>
            {profile.name ? profile.name[0].toUpperCase() : "P"}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: c.foreground }]}>
            {profile.name || "Viva User"}
          </Text>
          <View style={[styles.tierBadge, { backgroundColor: c.primary + "10" }]}>
            <Text style={[styles.tierText, { color: c.primary }]}>{tierLabel}</Text>
          </View>
        </View>
        {profile.tier === "free" ? (
          <Pressable onPress={handleUpgrade} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Feather name="arrow-up-circle" size={22} color={c.primary} />
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Connected Devices</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        {integrations.map((integration, i) => (
          <Pressable
            key={integration.id}
            onPress={() => toggleIntegration(integration.id)}
            style={({ pressed }) => [
              styles.settingRow,
              i < integrations.length - 1 && [styles.settingRowBorder, { borderBottomColor: c.background }],
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={[styles.settingIcon, { backgroundColor: c.primary + "10" }]}>
              <Feather name={integration.icon as keyof typeof Feather.glyphMap} size={16} color={c.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: c.foreground }]}>{integration.name}</Text>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: integration.connected ? c.success : c.muted },
              ]}
            />
            <Text style={[styles.statusText, { color: c.mutedForeground }]}>
              {integration.connected ? "Connected" : "Off"}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Profile</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        {[
          { label: "Weight", value: `${profile.weight} lbs`, icon: "trending-down" as const },
          { label: "Goal Weight", value: `${profile.goalWeight} lbs`, icon: "target" as const },
          { label: "Training Days", value: `${profile.daysAvailableToTrain}/week`, icon: "calendar" as const },
          {
            label: "Goals",
            value: profile.goals.map((g) => g.replace("_", " ")).join(", ") || "Not set",
            icon: "flag" as const,
          },
        ].map((item, i) => (
          <View
            key={item.label}
            style={[
              styles.settingRow,
              i < 3 && [styles.settingRowBorder, { borderBottomColor: c.background }],
            ]}
          >
            <View style={[styles.settingIcon, { backgroundColor: c.primary + "10" }]}>
              <Feather name={item.icon} size={16} color={c.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: c.foreground }]}>{item.label}</Text>
            <Text style={[styles.settingValue, { color: c.mutedForeground }]} numberOfLines={1}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Preferences</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        {[
          { label: "Units", value: profile.units === "imperial" ? "Imperial" : "Metric", icon: "sliders" as const },
          { label: "Coaching Tone", value: profile.coachingTone, icon: "mic" as const },
          { label: "Fasting", value: profile.fastingEnabled ? "Enabled" : "Disabled", icon: "clock" as const },
        ].map((item, i) => (
          <View
            key={item.label}
            style={[
              styles.settingRow,
              i < 2 && [styles.settingRowBorder, { borderBottomColor: c.background }],
            ]}
          >
            <View style={[styles.settingIcon, { backgroundColor: c.primary + "10" }]}>
              <Feather name={item.icon} size={16} color={c.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: c.foreground }]}>{item.label}</Text>
            <Text style={[styles.settingValue, { color: c.mutedForeground }]}>{item.value}</Text>
          </View>
        ))}
      </View>

      <Pressable onPress={handleUpgrade} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
        <View style={[styles.upgradeCard, { backgroundColor: c.primary }]}>
          <Feather name="star" size={18} color={c.primaryForeground} />
          <View style={styles.upgradeInfo}>
            <Text style={[styles.upgradeTitle, { color: c.primaryForeground }]}>
              {profile.tier === "free" ? "Upgrade to Premium" : "Manage Subscription"}
            </Text>
            <Text style={[styles.upgradeDesc, { color: c.primaryForeground + "BB" }]}>
              {profile.tier === "free"
                ? "Full AI coaching, weekly plans, and more"
                : "View or change your current plan"}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={c.primaryForeground + "80"} />
        </View>
      </Pressable>

      <Text style={[styles.disclaimer, { color: c.mutedForeground }]}>
        Viva is for wellness purposes only and does not provide medical advice.
      </Text>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    gap: 14,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitial: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  profileName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  tierBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tierText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
    paddingLeft: 4,
  },
  section: {
    borderRadius: 16,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  settingRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  settingValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    maxWidth: 140,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    gap: 14,
    marginTop: 4,
  },
  upgradeInfo: {
    flex: 1,
    gap: 3,
  },
  upgradeTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  upgradeDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  disclaimer: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 20,
    marginTop: 12,
    opacity: 0.6,
  },
});
