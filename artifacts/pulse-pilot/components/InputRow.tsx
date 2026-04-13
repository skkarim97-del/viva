import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";

interface InputOption<T extends string> {
  key: T;
  label: string;
  tint?: string;
}

interface InputRowProps<T extends string> {
  label: string;
  options: InputOption<T>[];
  selected: T | null;
  onSelect: (key: T) => void;
  containerBg?: string;
}

export function InputRow<T extends string>({ label, options, selected, onSelect, containerBg }: InputRowProps<T>) {
  const c = useColors();

  const handlePress = (key: T) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onSelect(key);
  };

  const unselectedBg = containerBg ?? c.card;

  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      <View style={styles.optionsRow}>
        {options.map(({ key, label: optLabel, tint }) => {
          const isSelected = selected === key;
          const color = tint ?? c.primary;
          return (
            <Pressable
              key={key}
              onPress={() => handlePress(key)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isSelected ? color + "16" : unselectedBg,
                  borderWidth: 1.5,
                  borderColor: isSelected ? color + "30" : "transparent",
                  opacity: pressed ? 0.8 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  {
                    color: isSelected ? color : c.mutedForeground,
                    fontFamily: isSelected ? "Montserrat_600SemiBold" : "Montserrat_500Medium",
                  },
                ]}
                numberOfLines={1}
              >
                {optLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    fontSize: 13,
  },
});
