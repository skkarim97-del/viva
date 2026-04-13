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
                  backgroundColor: isSelected ? color + "12" : unselectedBg,
                  borderWidth: 1,
                  borderColor: isSelected ? color + "28" : c.border + "20",
                  opacity: pressed ? 0.8 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  {
                    color: isSelected ? color : c.mutedForeground + "90",
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
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 6,
  },
  option: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    fontSize: 13,
  },
});
