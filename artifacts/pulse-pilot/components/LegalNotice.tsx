import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LEGAL } from "@/lib/legal";

// Reusable legal and clinical responsibility notice components for Viva Care.
// Kept minimal — only the surfaces that warrant contextual notices use these.
// The global anchor lives in Settings; everything else is supplemental.

interface ContainerStyle {
  style?: ViewStyle;
}

export function EmergencyNotice({ style }: ContainerStyle) {
  return (
    <View style={[styles.emergencyContainer, style]}>
      <Feather name="alert-circle" size={12} color="#C2620A" style={{ marginTop: 1 }} />
      <Text style={styles.emergencyText}>{LEGAL.EMERGENCY_NOTICE}</Text>
    </View>
  );
}

export function DataSignalNotice({ style }: ContainerStyle) {
  return (
    <Text style={[styles.mutedText, style]}>{LEGAL.DATA_SIGNAL_NOTICE}</Text>
  );
}

const styles = StyleSheet.create({
  emergencyContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(217,119,6,0.08)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.22)",
  },
  emergencyText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
    color: "#7A4000",
    lineHeight: 17,
  },
  mutedText: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    color: "#8A9BB8",
    lineHeight: 16,
  },
});
