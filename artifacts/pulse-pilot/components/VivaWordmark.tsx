import React from "react";
import { Image, StyleSheet, View } from "react-native";

interface VivaWordmarkProps {
  size?: "small" | "medium" | "large";
  showSymbol?: boolean;
}

const logoSource = require("@/assets/viva-logo-cropped.png");

export function VivaWordmark({ size = "small" }: VivaWordmarkProps) {
  const width = size === "large" ? 200 : size === "medium" ? 120 : 80;
  const height = Math.round(width * (1068 / 2318));

  return (
    <View style={styles.container}>
      <Image
        source={logoSource}
        style={{ width, height }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
