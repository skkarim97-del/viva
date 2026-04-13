import { Feather } from "@expo/vector-icons";
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";

import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface SubscriptionCardProps {
  title: string;
  price: string;
  features: string[];
  isActive: boolean;
  isRecommended?: boolean;
  onSelect: () => void;
}

export function SubscriptionCard({
  title,
  price,
  features,
  isActive,
  isRecommended,
  onSelect,
}: SubscriptionCardProps) {
  const c = useColors();

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: isActive ? c.accent + "10" : c.card,
          borderColor: isActive ? c.accent : c.border,
          borderWidth: isActive ? 2 : 1,
          opacity: pressed ? 0.95 : 1,
        },
      ]}
    >
      {isRecommended ? (
        <View style={[styles.recommendedBadge, { backgroundColor: c.primary }]}>
          <Text style={[styles.recommendedText, { color: c.primaryForeground }]}>Recommended</Text>
        </View>
      ) : null}
      <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      <Text style={[styles.price, { color: c.accent }]}>{price}</Text>
      <View style={styles.features}>
        {features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Feather name="check" size={16} color={c.success} />
            <Text style={[styles.featureText, { color: c.foreground }]}>{f}</Text>
          </View>
        ))}
      </View>
      {isActive ? (
        <View style={[styles.activeButton, { backgroundColor: c.primary }]}>
          <Text style={[styles.activeButtonText, { color: c.primaryForeground }]}>Current Plan</Text>
        </View>
      ) : (
        <View style={[styles.selectButton, { borderColor: c.accent }]}>
          <Text style={[styles.selectButtonText, { color: c.accent }]}>Select Plan</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: colors.radius,
    gap: 12,
    position: "relative",
    overflow: "hidden",
  },
  recommendedBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
  },
  recommendedText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
  },
  title: {
    fontSize: 20,
    fontFamily: "Montserrat_700Bold",
  },
  price: {
    fontSize: 28,
    fontFamily: "Montserrat_700Bold",
  },
  features: {
    gap: 8,
    marginTop: 4,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  featureText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    flex: 1,
  },
  activeButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  activeButtonText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
  },
  selectButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1.5,
    marginTop: 8,
  },
  selectButtonText: {
    fontSize: 15,
    fontFamily: "Montserrat_600SemiBold",
  },
});
