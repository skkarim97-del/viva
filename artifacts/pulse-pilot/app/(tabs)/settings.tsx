import { Feather } from "@expo/vector-icons";
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
} from "react-native";

import { router } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  getPermissionState,
  getRemindersEnabled,
  rescheduleReminders,
  requestPermission,
  setRemindersEnabled,
  type PermissionState,
} from "@/lib/reminders";
import { useEffect } from "react";
import { AppState, type AppStateStatus, Linking, Platform } from "react-native";
import {
  BRAND_OPTIONS,
  MEDICATION_DATABASE,
  getDoseOptions,
  getMedicationFrequency,
  normalizeBrand,
  type MedicationBrand,
} from "@/data/medicationData";
import type { MedicationProfile } from "@/types";
import WeightLogModal from "@/components/WeightLogModal";
import { sessionApi } from "@/lib/api/sessionClient";
import { connectAppleHealth } from "@/data/healthProviders";
import { logCareEventImmediate } from "@/lib/care-events/client";
import { Alert } from "react-native";

const GOAL_LABELS: Record<string, string> = {
  fat_loss: "Weight Loss",
  stay_consistent: "Stay Consistent",
  muscle_preservation: "Preserve Muscle",
  energy: "More Energy",
  metabolic_health: "Metabolic Health",
  general_wellness: "General Wellness",
};

type MedDraft = {
  brand: MedicationBrand;
  doseValue: number;
  doseUnit: string;
  frequency: "weekly" | "daily";
  plannedDoseDay: string | null;
};

const DOSE_DAY_OPTIONS: { key: string; label: string }[] = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

export default function SettingsScreen() {
  const c = useColors();
  const { profile, updateProfile, integrations, toggleIntegration } = useApp();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [medDraft, setMedDraft] = useState<MedDraft | null>(null);
  // Server-backed weekly weight log -- the single user-facing weight
  // entry point. The local profile.weight field still exists in the
  // data model (used by BMR / coach context) but is no longer
  // editable here; we mirror the latest server value into it so
  // those consumers stay accurate.
  const [weightLogOpen, setWeightLogOpen] = useState(false);
  const [serverWeight, setServerWeight] = useState<{
    weightLbs: number | null;
    daysSinceLast: number | null;
  }>({ weightLbs: null, daysSinceLast: null });
  useEffect(() => {
    let cancelled = false;
    sessionApi
      .getLatestWeight()
      .then((r) => {
        if (cancelled) return;
        setServerWeight({
          weightLbs: r.latest?.weightLbs ?? null,
          daysSinceLast: r.daysSinceLast,
        });
        if (r.latest?.weightLbs != null) {
          updateProfile({ weight: r.latest.weightLbs });
        }
      })
      .catch(() => {
        // Silent on settings -- the row simply shows "Not logged".
      });
    return () => {
      cancelled = true;
    };
  }, [updateProfile]);

  const handleConnectHealth = useCallback(async () => {
    setConnecting(true);
    const result = await connectAppleHealth();
    setConnecting(false);
    if (result.success) {
      toggleIntegration("apple_health");
    }
  }, [toggleIntegration]);

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

  const openMedEditor = () => {
    try {
      const mp = profile.medicationProfile;
      if (mp) {
        // Brand may have been stored as a display name ("Mounjaro") by an
        // earlier seed/build. Normalize to a known MedicationBrand key so
        // dose options and chip selection work safely.
        setMedDraft({
          brand: normalizeBrand(mp.medicationBrand),
          doseValue: typeof mp.doseValue === "number" ? mp.doseValue : 0.25,
          doseUnit: mp.doseUnit || "mg",
          frequency: (mp.frequency === "daily" ? "daily" : "weekly"),
          plannedDoseDay: mp.plannedDoseDay ?? null,
        });
      } else {
        setMedDraft({
          brand: "wegovy",
          doseValue: 0.25,
          doseUnit: "mg",
          frequency: "weekly",
          plannedDoseDay: null,
        });
      }
      setMedModalOpen(true);
    } catch (e: any) {
      if (typeof __DEV__ !== "undefined" && __DEV__) console.log("[Settings] openMedEditor failed:", e);
      setMedDraft({ brand: "wegovy", doseValue: 0.25, doseUnit: "mg", frequency: "weekly", plannedDoseDay: null });
      setMedModalOpen(true);
    }
  };

  const saveMedDraft = () => {
    if (!medDraft) {
      setMedModalOpen(false);
      return;
    }
    try {
      const existing = profile.medicationProfile;
      const brandKey = medDraft.brand;
      const dbInfo = brandKey !== "other" ? MEDICATION_DATABASE[brandKey] : null;
      const genericName = dbInfo?.genericName ?? existing?.genericName ?? "unknown";
      const indication = dbInfo?.indication ?? existing?.indication ?? "weight loss";

      const next: MedicationProfile = {
        medicationBrand: brandKey,
        genericName,
        indication,
        doseValue: medDraft.doseValue,
        doseUnit: medDraft.doseUnit,
        frequency: medDraft.frequency,
        timeOnMedicationBucket: existing?.timeOnMedicationBucket ?? "less_30_days",
        recentTitration: existing?.recentTitration ?? false,
        weekOnCurrentDose: existing?.weekOnCurrentDose,
        startDate: existing?.startDate ?? null,
        lastInjectionDate: existing?.lastInjectionDate ?? null,
        previousDoseValue: existing?.previousDoseValue ?? null,
        previousDoseUnit: existing?.previousDoseUnit ?? null,
        previousFrequency: existing?.previousFrequency ?? null,
        doseChangeDate: existing?.doseChangeDate ?? null,
        telehealthPlatform: existing?.telehealthPlatform ?? null,
        plannedDoseDay: medDraft.frequency === "weekly" ? medDraft.plannedDoseDay : null,
      };
      updateProfile({ medicationProfile: next });
      setMedModalOpen(false);
      setMedDraft(null);
    } catch (e: any) {
      if (typeof __DEV__ !== "undefined" && __DEV__) console.log("[Settings] saveMedDraft failed:", e);
      setMedModalOpen(false);
      setMedDraft(null);
    }
  };

  const setDraftBrand = (brand: MedicationBrand) => {
    if (!medDraft) return;
    if (brand === "other") {
      setMedDraft({
        brand,
        doseValue: medDraft.doseValue,
        doseUnit: medDraft.doseUnit,
        frequency: medDraft.frequency,
        plannedDoseDay: medDraft.plannedDoseDay,
      });
      return;
    }
    const opts = getDoseOptions(brand);
    const freq = getMedicationFrequency(brand);
    const first = opts[0];
    setMedDraft({
      brand,
      doseValue: first?.value ?? medDraft.doseValue,
      doseUnit: first?.unit ?? medDraft.doseUnit,
      frequency: freq,
      plannedDoseDay: freq === "weekly" ? medDraft.plannedDoseDay : null,
    });
  };

  const medProfile = profile.medicationProfile;
  const doseDisplay = medProfile
    ? `${medProfile.doseValue} ${medProfile.doseUnit} ${medProfile.frequency}`
    : "Not set";
  const medicationDisplay = medProfile?.medicationBrand
    ? medProfile.medicationBrand.charAt(0).toUpperCase() + medProfile.medicationBrand.slice(1)
    : "Not set";
  const goalsDisplay = profile.goals.length > 0
    ? profile.goals.map(g => GOAL_LABELS[g] || g.replace(/_/g, " ")).join(", ")
    : "Not set";
  const weightUnit = profile.units === "imperial" ? "lbs" : "kg";

  const draftDoseOptions = medDraft && medDraft.brand !== "other" ? getDoseOptions(medDraft.brand) : [];

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
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Treatment</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        <Pressable
          onPress={openMedEditor}
          style={({ pressed }) => [
            styles.settingRow,
            styles.settingRowBorder,
            { borderBottomColor: c.background, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={[styles.settingIcon, { backgroundColor: c.accent + "10" }]}>
            <Feather name="package" size={16} color={c.accent} />
          </View>
          <Text style={[styles.settingLabel, { color: c.foreground }]}>Medication</Text>
          <Text style={[styles.settingValue, { color: c.mutedForeground }]} numberOfLines={1}>
            {medicationDisplay}
          </Text>
          <Feather name="edit-2" size={13} color={c.mutedForeground + "60"} />
        </Pressable>
        <Pressable
          onPress={openMedEditor}
          style={({ pressed }) => [styles.settingRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={[styles.settingIcon, { backgroundColor: c.accent + "10" }]}>
            <Feather name="thermometer" size={16} color={c.accent} />
          </View>
          <Text style={[styles.settingLabel, { color: c.foreground }]}>Dosage</Text>
          <Text style={[styles.settingValue, { color: c.mutedForeground }]} numberOfLines={1}>
            {doseDisplay}
          </Text>
          <Feather name="edit-2" size={13} color={c.mutedForeground + "60"} />
        </Pressable>
      </View>

      <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Profile</Text>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        <Pressable
          onPress={() => setWeightLogOpen(true)}
          style={({ pressed }) => [
            styles.settingRow,
            styles.settingRowBorder,
            { borderBottomColor: c.background, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={[styles.settingIcon, { backgroundColor: c.accent + "10" }]}>
            <Feather name="activity" size={16} color={c.accent} />
          </View>
          <Text style={[styles.settingLabel, { color: c.foreground }]}>Weekly weight</Text>
          <Text
            style={[styles.settingValue, { color: c.mutedForeground }]}
            numberOfLines={1}
          >
            {serverWeight.weightLbs == null
              ? "Log now"
              : `${Math.round(serverWeight.weightLbs)} ${weightUnit} - ${
                  serverWeight.daysSinceLast === 0
                    ? "today"
                    : serverWeight.daysSinceLast === 1
                    ? "1d ago"
                    : `${serverWeight.daysSinceLast}d ago`
                }`}
          </Text>
          <Feather name="edit-2" size={13} color={c.mutedForeground + "60"} />
        </Pressable>
        {[
          // "Current Weight" intentionally removed -- the Weekly
          // weight row above is now the single source of truth so
          // patients aren't asked to maintain two weight values.
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
              onPress={() => integration.id === "apple_health" ? handleConnectHealth() : toggleIntegration(integration.id)}
              style={({ pressed }) => [
                styles.settingRow,
                i < integrations.length - 1 && !isSyncFailed && [styles.settingRowBorder, { borderBottomColor: c.background }],
                { opacity: connecting ? 0.5 : pressed ? 0.8 : 1 },
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

      {/* Reminders sit right under Apple Health so the patient sees the
          notification toggle alongside the data integrations -- both
          are "what Viva can do in the background". Previously this
          section was rendered after the disclaimer + a 100pt spacer,
          which left a large dead zone in the middle of the screen and
          buried the reminders below the fold on most devices. */}
      <RemindersSection />

      {__DEV__ && (
        <Pressable
          onPress={() => router.push("/dev-qa")}
          style={({ pressed }) => [
            styles.devQaButton,
            { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="tool" size={14} color="#FF9500" />
          <Text style={[styles.devQaText, { color: c.foreground }]}>Dev QA · Tier debug</Text>
          <Feather name="chevron-right" size={16} color={c.mutedForeground} />
        </Pressable>
      )}

      <Text style={[styles.disclaimer, { color: c.mutedForeground }]}>
        Viva is for informational purposes only and does not provide medical advice.
      </Text>

      <View style={{ height: 24 }} />

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

      <Modal visible={medModalOpen} transparent animationType="fade" onRequestClose={() => setMedModalOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMedModalOpen(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: c.card, maxWidth: 380 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: c.foreground }]}>Edit Medication</Text>

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Medication</Text>
            <View style={styles.chipRow}>
              {BRAND_OPTIONS.map(opt => {
                const selected = medDraft?.brand === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setDraftBrand(opt.key)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: selected ? c.accent : c.background,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: selected ? "#fff" : c.foreground }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {medDraft && medDraft.brand !== "other" && draftDoseOptions.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Dose</Text>
                <View style={styles.chipRow}>
                  {draftDoseOptions.map(opt => {
                    const selected = medDraft.doseValue === opt.value && medDraft.doseUnit === opt.unit;
                    return (
                      <Pressable
                        key={`${opt.value}-${opt.unit}`}
                        onPress={() => setMedDraft({ ...medDraft, doseValue: opt.value, doseUnit: opt.unit })}
                        style={({ pressed }) => [
                          styles.chip,
                          {
                            backgroundColor: selected ? c.accent : c.background,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: selected ? "#fff" : c.foreground }]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {medDraft && medDraft.brand === "other" && (
              <>
                <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Dose value</Text>
                <TextInput
                  style={[styles.modalInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.background }]}
                  value={`${medDraft.doseValue}`}
                  onChangeText={(t) => {
                    const v = parseFloat(t);
                    setMedDraft({ ...medDraft, doseValue: isNaN(v) ? 0 : v });
                  }}
                  keyboardType="numeric"
                  placeholder="e.g. 0.5"
                  placeholderTextColor={c.mutedForeground + "60"}
                />
                <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Dose unit</Text>
                <View style={styles.chipRow}>
                  {["mg", "ml", "units"].map(u => {
                    const selected = medDraft.doseUnit === u;
                    return (
                      <Pressable
                        key={u}
                        onPress={() => setMedDraft({ ...medDraft, doseUnit: u })}
                        style={({ pressed }) => [
                          styles.chip,
                          { backgroundColor: selected ? c.accent : c.background, opacity: pressed ? 0.8 : 1 },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: selected ? "#fff" : c.foreground }]}>{u}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Frequency</Text>
            <View style={styles.chipRow}>
              {(["weekly", "daily"] as const).map(f => {
                const selected = medDraft?.frequency === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => medDraft && setMedDraft({
                      ...medDraft,
                      frequency: f,
                      plannedDoseDay: f === "weekly" ? medDraft.plannedDoseDay : null,
                    })}
                    style={({ pressed }) => [
                      styles.chip,
                      { backgroundColor: selected ? c.accent : c.background, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: selected ? "#fff" : c.foreground }]}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {medDraft?.frequency === "weekly" && (
              <>
                <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Dose day</Text>
                <View style={styles.chipRow}>
                  {DOSE_DAY_OPTIONS.map(opt => {
                    const selected = medDraft.plannedDoseDay === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => setMedDraft({
                          ...medDraft,
                          plannedDoseDay: selected ? null : opt.key,
                        })}
                        style={({ pressed }) => [
                          styles.chip,
                          { backgroundColor: selected ? c.accent : c.background, opacity: pressed ? 0.8 : 1 },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: selected ? "#fff" : c.foreground }]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.modalButtons}>
              <Pressable onPress={() => setMedModalOpen(false)} style={[styles.modalButton, { backgroundColor: c.background }]}>
                <Text style={[styles.modalButtonText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveMedDraft} style={[styles.modalButton, { backgroundColor: c.accent }]}>
                <Text style={[styles.modalButtonText, { color: "#fff" }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {/* RemindersSection moved up beneath the Apple Health section.
          SignOutSection stays anchored at the very bottom of the
          ScrollView so signing out remains the last thing on the page. */}
      <CareTeamReviewSection />
      <SignOutSection />
      <WeightLogModal
        visible={weightLogOpen}
        daysSinceLast={serverWeight.daysSinceLast}
        initialValue={serverWeight.weightLbs}
        onClose={() => setWeightLogOpen(false)}
        onLogged={(w) => {
          setServerWeight({ weightLbs: w, daysSinceLast: 0 });
          updateProfile({ weight: w });
        }}
      />
    </ScrollView>
  );
}

// Daily check-in reminders. Default ON for new installs, but the
// schedule only actually fires once OS notification permission has
// been granted. The toggle below mirrors both pieces of state so the
// patient sees one row and we never present a "enabled but silent"
// inconsistency.
function RemindersSection() {
  const c = useColors();
  const { todayCheckIn } = useApp();
  const [enabled, setEnabled] = useState(true);
  const [perm, setPerm] = useState<PermissionState>("undetermined");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [e, p] = await Promise.all([
        getRemindersEnabled(),
        getPermissionState(),
      ]);
      if (cancelled) return;
      setEnabled(e);
      setPerm(p);
    };
    void refresh();
    // Re-read permission whenever the app returns to the foreground.
    // Covers the "patient tapped Open Settings, granted permission in
    // iOS/Android Settings, came back to the app" path -- without this
    // the toggle would still display the stale "denied" state until the
    // tab unmounted. The actual rescheduling on grant is owned by the
    // root-level useReminderScheduler AppState hook; this listener
    // exists purely so the UI reflects the new permission immediately.
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void refresh();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  if (perm === "unsupported") return null;

  const handleToggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = !enabled;
      // If the patient is turning reminders ON for the first time and
      // we don't yet have permission, ask for it inline. On denial we
      // still flip the setting on so re-enabling permission later in
      // OS Settings just works -- but we surface a hint below.
      if (next && perm !== "granted") {
        const result = await requestPermission();
        setPerm(result);
      }
      setEnabled(next);
      await setRemindersEnabled(next);
      await rescheduleReminders({
        enabled: next,
        hasCheckedInToday: !!todayCheckIn,
      });
    } finally {
      setBusy(false);
    }
  };

  const showOpenSettings = enabled && perm === "denied";

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
      <Text
        style={[
          styles.fieldLabel,
          { color: c.mutedForeground, marginBottom: 8 },
        ]}
      >
        Reminders
      </Text>
      <Pressable
        onPress={handleToggle}
        disabled={busy}
        accessibilityRole="switch"
        accessibilityLabel="Daily check-in reminders"
        accessibilityState={{ checked: enabled, disabled: busy }}
        style={({ pressed }) => ({
          backgroundColor: c.card,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: pressed || busy ? 0.85 : 1,
        })}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text
            style={{
              fontFamily: "Montserrat_600SemiBold",
              fontSize: 15,
              color: c.foreground,
            }}
          >
            Daily check-in reminders
          </Text>
          <Text
            style={{
              fontFamily: "Montserrat_500Medium",
              fontSize: 12,
              color: c.mutedForeground,
              marginTop: 4,
            }}
          >
            12:00 PM and 7:00 PM. Skipped automatically once you check in for the day.
          </Text>
        </View>
        <View
          style={{
            width: 46,
            height: 28,
            borderRadius: 14,
            backgroundColor: enabled ? c.accent || "#38B6FF" : c.border || "#D6D9E0",
            justifyContent: "center",
            paddingHorizontal: 3,
            alignItems: enabled ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: "#fff",
            }}
          />
        </View>
      </Pressable>
      {showOpenSettings && (
        <Pressable
          onPress={() => {
            Linking.openSettings().catch(() => {});
          }}
          style={{ paddingVertical: 8, paddingHorizontal: 4, marginTop: 4 }}
        >
          <Text
            style={{
              fontFamily: "Montserrat_500Medium",
              fontSize: 12,
              color: c.accent || "#38B6FF",
            }}
          >
            Notifications are off in {Platform.OS === "ios" ? "iOS" : "system"} Settings — tap to enable.
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// Quieter, always-discoverable entry point for the patient to ask the
// care team for a closer look. The Coach tab has the contextual entry;
// this one lives here so it's findable from anywhere in the app.
function CareTeamReviewSection() {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const handle = useCallback(() => {
    if (busy) return;
    const fire = async () => {
      setBusy(true);
      try {
        const ok = await logCareEventImmediate("escalation_requested", {
          source: "settings",
        });
        const title = ok ? "Care team notified" : "Could not send right now";
        const body = ok
          ? "Your care team has been notified and will follow up soon."
          : "We couldn't reach the server. Please try again in a moment.";
        if (Platform.OS === "web") {
          try { (globalThis as any).alert?.(`${title}\n\n${body}`); } catch {}
        } else {
          Alert.alert(title, body);
        }
      } finally {
        setBusy(false);
      }
    };
    if (Platform.OS === "web") {
      const yes = (globalThis as any).confirm?.(
        "Notify your care team that you'd like a closer look?",
      );
      if (yes) void fire();
      return;
    }
    Alert.alert(
      "Request care-team review?",
      "We'll let your care team know you'd like a closer look. They'll follow up with you.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Notify care team", onPress: () => void fire() },
      ],
    );
  }, [busy]);
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
      <Text style={[styles.fieldLabel, { color: c.mutedForeground, marginBottom: 8 }]}>
        Care team
      </Text>
      <Pressable
        onPress={handle}
        disabled={busy}
        style={({ pressed }) => ({
          backgroundColor: c.card,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: pressed || busy ? 0.7 : 1,
        })}
      >
        <Feather name="life-buoy" size={16} color={c.accent} />
        <Text
          style={{
            fontFamily: "Montserrat_600SemiBold",
            fontSize: 14,
            color: c.foreground,
            flex: 1,
          }}
        >
          {busy ? "Sending..." : "Request care-team review"}
        </Text>
        <Feather name="chevron-right" size={14} color={c.mutedForeground + "80"} />
      </Pressable>
    </View>
  );
}

// Sits at the very bottom of Settings so the user can clear their bearer
// token and return to the Connect screen. Routing reacts on the next
// render: AuthProvider drops the user, RootLayoutNav re-evaluates and
// pushes /connect.
function SignOutSection() {
  const { signOut, user } = useAuth();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      router.replace("/connect");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 }}>
      <Text
        style={[
          styles.fieldLabel,
          { color: c.mutedForeground, marginBottom: 8 },
        ]}
      >
        Account
      </Text>
      <Text
        style={{
          fontFamily: "Montserrat_500Medium",
          fontSize: 13,
          color: c.mutedForeground,
          marginBottom: 12,
        }}
      >
        Signed in as {user.email}
      </Text>
      <Pressable
        onPress={handle}
        disabled={busy}
        style={({ pressed }) => ({
          backgroundColor: c.background,
          borderWidth: 1,
          borderColor: c.destructive || "#EF4444",
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: "center",
          opacity: pressed || busy ? 0.7 : 1,
        })}
      >
        <Text
          style={{
            fontFamily: "Montserrat_600SemiBold",
            fontSize: 15,
            color: c.destructive || "#EF4444",
          }}
        >
          {busy ? "Signing out..." : "Sign out"}
        </Text>
      </Pressable>
    </View>
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
  devQaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  devQaText: { flex: 1, fontSize: 14, fontWeight: "600" },
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
    gap: 12,
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
    fontSize: 16,
    fontFamily: "Montserrat_500Medium",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
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
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
  },
});
