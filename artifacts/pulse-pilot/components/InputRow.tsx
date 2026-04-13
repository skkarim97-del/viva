import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";

interface InputOption<T extends string> {
  key: T;
  label: string;
}

interface InputRowProps<T extends string> {
  label: string;
  options: InputOption<T>[];
  selected: T | null;
  onSelect: (key: T) => void;
}

export function InputRow<T extends string>({ label, options, selected, onSelect }: InputRowProps<T>) {
  const c = useColors();

  const handlePress = (key: T) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onSelect(key);
  };

  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      <View style={styles.optionsRow}>
        {options.map(({ key, label: optLabel }) => {
          const isSelected = selected === key;
          return (
            <Pressable
              key={key}
              onPress={() => handlePress(key)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isSelected ? c.primary : c.card,
                  opacity: pressed ? 0.8 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  { color: isSelected ? c.primaryForeground : c.foreground },
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
    fontFamily: "Montserrat_500Medium",
  },
});
