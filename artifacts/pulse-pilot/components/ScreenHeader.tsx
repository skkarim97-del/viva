import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VivaWordmark } from "@/components/VivaWordmark";

export function ScreenHeader() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 60 : insets.top;

  return (
    <View style={[styles.header, { paddingTop: topPad + 12 }]}>
      <VivaWordmark size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 4,
  },
});
