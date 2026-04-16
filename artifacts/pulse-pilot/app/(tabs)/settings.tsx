import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  Platform,
} from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { getDoseOptions, type MedicationBrand } from "@/data/medicationData";
import { getHealthDebugInfo } from "@/data/healthProviders";

const GOAL_LABELS: Record<string, string> = {
  fat_loss: "Weight Loss",
  stay_consistent: "Stay Consistent",
  muscle_preservation: "Preserve Muscle",
  energy: "More Energy",
  metabolic_health: "Metabolic Health",
  general_wellness: "General Wellness",
};

export default function SettingsScreen() {
  const c = useColors();
  const { profile, updateProfile, integrations, toggleIntegration } = useApp();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const tierLabel =
    profile.tier === "premium_plus"
      ? "Premium Plus"
      : profile.tier === "premium"
      ? "Premium"
      : "Free";

  const handleUpgrade = () => {
    router.push("/subscription");
  };

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const saveEdit = () => {
    if (!editingField || !editValue.trim()) {
      setEditingField(null);
      return;
    }
    if (editingField === "weight") {
      const w = parseFloat(editValue);
      if (!isNaN(w) && w > 0) updateProfile({ weight: w });
    } else if (editingField === "goalWeight") {
      const w = parseFloat(editValue);
      if (!isNaN(w) && w > 0) updateProfile({ goalWeight: w });
    }
    setEditingField(null);
  };

  const medProfile = profile.medicationProfile;
  const doseDisplay = medProfile
    ? `${medProfile.doseValue} ${medProfile.doseUnit} ${medProfile.frequency}`
    : "Not set";
  const medicationDisplay = medProfile?.medicationBrand || "Not set";
  const goalsDisplay = profile.goals.length > 0
    ? profile.goals.map(g => GOAL_LABELS[g] || g.replace(/_/g, " ")).join(", ")
    : "Not set";
  const weightUnit = profile.units === "imperial" ? "lbs" : "kg";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: 0 }]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader />
      <Text style={[styles.title, { color: c.foreground }]}>Settings</Text>

      <View style={[styles.profileCard, { backgroundColor: c.card }]}>
        <View style={[styles.profileAvatar, { backgroundColor: c.accent + "12" }]}>
          <Text style={[styles.profileInitial, { color: c.accent }]}>
            {profile.name ? profile.name[0].toUpperCase() : "V"}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: c.foreground }]}>
            {profile.name || "Viva User"}
          </Text>
          <View style={[styles.tierBadge, { backgroundColor: c.accent + "10" }]}>
            <Text style={[styles.tierText, { color: c.accent }]}>{tierLabel}</Text>
          </View>
        </View>
        {profile.tier === "free" ? (
          <Pressable onPress={handleUpgrade} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Feather name="arrow-up-circle" size={22} color={c.accent} />
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Treatment</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        {[
          { label: "Medication", value: medicationDisplay, icon: "package" as const, editable: false },
          { label: "Dosage", value: doseDisplay, icon: "thermometer" as const, editable: false },
        ].map((item, i) => (
          <View
            key={item.label}
            style={[
              styles.settingRow,
              i < 1 && [styles.settingRowBorder, { borderBottomColor: c.background }],
            ]}
          >
            <View style={[styles.settingIcon, { backgroundColor: c.accent + "10" }]}>
              <Feather name={item.icon} size={16} color={c.accent} />
            </View>
            <Text style={[styles.settingLabel, { color: c.foreground }]}>{item.label}</Text>
            <Text style={[styles.settingValue, { color: c.mutedForeground }]} numberOfLines={1}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Profile</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        {[
          { label: "Current Weight", value: `${profile.weight} ${weightUnit}`, icon: "trending-down" as const, field: "weight" },
          { label: "Goal Weight", value: `${profile.goalWeight} ${weightUnit}`, icon: "target" as const, field: "goalWeight" },
          { label: "Goals", value: goalsDisplay, icon: "flag" as const, field: null },
        ].map((item, i) => (
          <Pressable
            key={item.label}
            onPress={item.field ? () => startEdit(item.field, item.field === "weight" ? `${profile.weight}` : `${profile.goalWeight}`) : undefined}
            style={({ pressed }) => [
              styles.settingRow,
              i < 2 && [styles.settingRowBorder, { borderBottomColor: c.background }],
              { opacity: pressed && item.field ? 0.7 : 1 },
            ]}
          >
            <View style={[styles.settingIcon, { backgroundColor: c.accent + "10" }]}>
              <Feather name={item.icon} size={16} color={c.accent} />
            </View>
            <Text style={[styles.settingLabel, { color: c.foreground }]}>{item.label}</Text>
            <Text style={[styles.settingValue, { color: c.mutedForeground }]} numberOfLines={1}>
              {item.value}
            </Text>
            {item.field && <Feather name="edit-2" size={13} color={c.mutedForeground + "60"} />}
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Apple Health</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        {integrations.map((integration, i) => {
          const isConnecting = integration.lastSync === "Connecting..." || integration.lastSync === "Syncing...";
          const isSyncFailed = integration.lastSync === "Sync failed";
          const isUnavailable = integration.lastSync === "Not available on this device";
          const isError = !isConnecting && !isSyncFailed && !isUnavailable && !integration.connected && integration.lastSync && integration.lastSync !== undefined;
          const dotColor = isConnecting
            ? c.warning || "#F59E0B"
            : isSyncFailed || isUnavailable || isError
            ? c.destructive || "#EF4444"
            : integration.connected
            ? c.success
            : c.muted;
          const statusText = isConnecting
            ? integration.lastSync!
            : isSyncFailed
            ? "Sync failed"
            : isUnavailable
            ? "Not available"
            : isError
            ? integration.lastSync!
            : integration.connected
            ? integration.lastSync
              ? `Synced ${integration.lastSync}`
              : "Connected"
            : "Tap to connect";

          return (
          <React.Fragment key={integration.id}>
            <Pressable
              onPress={() => !isUnavailable && toggleIntegration(integration.id)}
              style={({ pressed }) => [
                styles.settingRow,
                i < integrations.length - 1 && !isSyncFailed && [styles.settingRowBorder, { borderBottomColor: c.background }],
                { opacity: isUnavailable ? 0.5 : pressed ? 0.8 : 1 },
              ]}
            >
              <View style={[styles.settingIcon, { backgroundColor: c.accent + "10" }]}>
                <Feather name={integration.icon as keyof typeof Feather.glyphMap} size={16} color={c.accent} />
              </View>
              <Text style={[styles.settingLabel, { color: c.foreground }]}>{integration.name}</Text>
              <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
              <Text style={[styles.statusText, { color: c.mutedForeground }]}>
                {statusText}
              </Text>
            </Pressable>
            {(isUnavailable || isError) && (
              <View style={styles.inlineNotice}>
                <Text style={[styles.inlineNoticeText, { color: c.mutedForeground }]}>
                  {isUnavailable
                    ? "Apple Health isn't available on this device. You can still use Viva with manual inputs."
                    : integration.lastSync}
                </Text>
                {isError && (
                  <Pressable
                    onPress={() => toggleIntegration(integration.id)}
                    style={({ pressed }) => [styles.retryButton, { backgroundColor: c.accent + "15", opacity: pressed ? 0.7 : 1, marginTop: 6 }]}
                  >
                    <Feather name="refresh-cw" size={12} color={c.accent} />
                    <Text style={[styles.retryText, { color: c.accent }]}>Try again</Text>
                  </Pressable>
                )}
              </View>
            )}
            {isSyncFailed && (
              <Pressable
                onPress={() => toggleIntegration(integration.id)}
                style={({ pressed }) => [styles.retryButton, { backgroundColor: c.accent + "15", opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="refresh-cw" size={12} color={c.accent} />
                <Text style={[styles.retryText, { color: c.accent }]}>Retry sync</Text>
              </Pressable>
            )}
          </React.Fragment>
          );
        })}
      </View>

      {Platform.OS === "ios" && (() => {
        const dbg = getHealthDebugInfo();
        return (
          <View style={[styles.section, { backgroundColor: c.card, padding: 16 }]}>
            <Text style={{ color: c.foreground, fontFamily: "Montserrat_700Bold", fontSize: 13, marginBottom: 10 }}>HealthKit Debug</Text>
            <Text style={{ color: c.mutedForeground, fontFamily: "Montserrat_500Medium", fontSize: 12, lineHeight: 20 }}>
              {`health data available: ${dbg.healthDataAvailable ?? "not checked"}\nauthorization attempted: ${dbg.authorizationAttempted}\nauthorization success: ${dbg.authorizationSuccess ?? "n/a"}\nraw error: ${dbg.rawAuthError ?? "none"}\nlast attempt: ${dbg.lastAttemptTimestamp ?? "never"}`}
            </Text>
          </View>
        );
      })()}

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
        Viva is for informational purposes only and does not provide medical advice.
      </Text>

      <View style={{ height: 100 }} />

      <Modal visible={editingField !== null} transparent animationType="fade" onRequestClose={() => setEditingField(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setEditingField(null)}>
          <Pressable style={[styles.modalContent, { backgroundColor: c.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: c.foreground }]}>
              {editingField === "weight" ? "Current Weight" : "Goal Weight"}
            </Text>
            <TextInput
              style={[styles.modalInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.background }]}
              value={editValue}
              onChangeText={setEditValue}
              keyboardType="numeric"
              autoFocus
              placeholder={`Enter ${weightUnit}`}
              placeholderTextColor={c.mutedForeground + "60"}
            />
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setEditingField(null)} style={[styles.modalButton, { backgroundColor: c.background }]}>
                <Text style={[styles.modalButtonText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveEdit} style={[styles.modalButton, { backgroundColor: c.accent }]}>
                <Text style={[styles.modalButtonText, { color: "#fff" }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    fontFamily: "Montserrat_700Bold",
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
    fontFamily: "Montserrat_700Bold",
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  profileName: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
  },
  tierBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tierText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
    paddingLeft: 4,
  },
  section: {
    borderRadius: 20,
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
    fontFamily: "Montserrat_500Medium",
    flex: 1,
  },
  settingValue: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    maxWidth: 160,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
  },
  inlineNotice: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    paddingTop: 2,
  },
  inlineNoticeText: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 17,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  retryText: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
  },
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    gap: 14,
    marginTop: 4,
  },
  upgradeInfo: {
    flex: 1,
    gap: 3,
  },
  upgradeTitle: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
  },
  upgradeDesc: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
  },
  disclaimer: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 20,
    marginTop: 12,
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Montserrat_600SemiBold",
    textAlign: "center",
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    fontFamily: "Montserrat_500Medium",
    textAlign: "center",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalButtonText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
  },
});
