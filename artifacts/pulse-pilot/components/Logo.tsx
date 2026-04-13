import React from "react";
import { Image, StyleSheet, View } from "react-native";

interface LogoProps {
  size?: "small" | "medium" | "large";
}

const logoSource = require("@/assets/viva-logo-cropped.png");

export function Logo({ size = "medium" }: LogoProps) {
  const dimensions = size === "large" ? 200 : size === "medium" ? 140 : 90;
  const height = Math.round(dimensions * (106 / 318));

  return (
    <View style={styles.container}>
      <Image
        source={logoSource}
        style={{ width: dimensions, height }}
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
