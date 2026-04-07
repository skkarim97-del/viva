import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { VivaSymbol } from "@/components/VivaSymbol";
import { useColors } from "@/hooks/useColors";

interface VivaWordmarkProps {
  size?: "small" | "medium" | "large";
  showSymbol?: boolean;
}

export function VivaWordmark({ size = "small", showSymbol = true }: VivaWordmarkProps) {
  const c = useColors();

  const fontSize = size === "large" ? 32 : size === "medium" ? 22 : 16;
  const symbolSize = size === "large" ? 28 : size === "medium" ? 20 : 16;
  const gap = size === "large" ? 8 : size === "medium" ? 6 : 5;
  const letterSpacing = size === "large" ? 6 : size === "medium" ? 4 : 3;

  return (
    <View style={[styles.container, { gap }]}>
      {showSymbol && <VivaSymbol size={symbolSize} color={c.foreground} />}
      <Text
        style={[
          styles.text,
          {
            fontSize,
            letterSpacing,
            color: c.foreground,
          },
        ]}
      >
        VIVA
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  text: {
    fontFamily: "Inter_500Medium",
  },
});
