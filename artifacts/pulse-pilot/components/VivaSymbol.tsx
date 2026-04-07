import React from "react";
import Svg, { Path } from "react-native-svg";

interface VivaSymbolProps {
  size?: number;
  color?: string;
}

export function VivaSymbol({ size = 24, color = "#1A1A1A" }: VivaSymbolProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M6 8L14.5 24.5C15 25.5 15.5 25.5 16 25.5C16.5 25.5 17 25.5 17.5 24.5L20.5 18"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M20.5 18L22 14.5L24 18L26 12"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
