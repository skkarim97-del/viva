import { Feather } from "@expo/vector-icons";
import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface PlanCardProps {
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  badges?: string[];
  accentColor?: string;
}

export function PlanCard({ title, description, icon, badges, accentColor }: PlanCardProps) {
  const c = useColors();
  const accent = accentColor || c.accent;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: accent + "15" }]}>
          <Feather name={icon} size={20} color={accent} />
        </View>
        <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      </View>
      <Text style={[styles.description, { color: c.mutedForeground }]}>{description}</Text>
      {badges && badges.length > 0 ? (
        <View style={styles.badges}>
          {badges.map((badge) => (
            <View key={badge} style={[styles.badge, { backgroundColor: accent + "15" }]}>
              <Text style={[styles.badgeText, { color: accent }]}>{badge}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: colors.radius,
    borderWidth: 1,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontFamily: "Montserrat_600SemiBold",
    flex: 1,
  },
  description: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 20,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
  },
});
