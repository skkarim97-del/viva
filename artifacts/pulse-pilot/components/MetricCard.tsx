import { Feather } from "@expo/vector-icons";
import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface MetricCardProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  subtitle?: string;
  color?: string;
}

export function MetricCard({ icon, label, value, subtitle, color }: MetricCardProps) {
  const c = useColors();
  const iconColor = color || c.accent;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.iconContainer, { backgroundColor: iconColor + "15" }]}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.value, { color: c.foreground }]}>{value}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 6,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
  },
  value: {
    fontSize: 22,
    fontFamily: "Montserrat_700Bold",
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
  },
});
