import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface ReadinessRingProps {
  score: number;
  label: string;
  size?: number;
}

export function ReadinessRing({ score, label, size = 140 }: ReadinessRingProps) {
  const colors = useColors();
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  const getColor = () => {
    if (score >= 75) return colors.success;
    if (score >= 50) return colors.warning;
    return colors.destructive;
  };

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.muted}
          strokeWidth={strokeWidth}
          fill="none"
          opacity={0.6}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={getColor()}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${progress} ${circumference - progress}`}
          strokeDashoffset={circumference / 4}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.inner}>
        <Text style={[styles.score, { color: colors.foreground, fontSize: size * 0.28 }]}>{score}</Text>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    position: "absolute",
    alignItems: "center",
  },
  score: {
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 1,
    letterSpacing: 0.2,
  },
});
