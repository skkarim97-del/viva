import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

const CARD_TEXT = "#142240";
const CARD_MUTED = "#6B7FA3";
const CARD_BORDER = "#E2E8F0";

interface SupportTriggerCardProps {
  pillLabel: string;
  headline: string;
  chips?: string[];
  onStart: () => void;
}

export function SupportTriggerCard({
  pillLabel,
  headline,
  chips,
  onStart,
}: SupportTriggerCardProps) {
  const visibleChips = chips?.slice(0, 2) ?? [];

  return (
    <View style={styles.card}>
      {/* Status row */}
      <View style={styles.topRow}>
        <View style={styles.pill}>
          <View style={styles.pillDot} />
          <Text style={styles.pillText}>{pillLabel}</Text>
        </View>
      </View>

      {/* Headline */}
      <Text style={styles.headline} numberOfLines={2}>{headline}</Text>

      {/* Context chips (up to 2, conditional) */}
      {visibleChips.length > 0 && (
        <View style={styles.chipsRow}>
          {visibleChips.map((chip) => (
            <View key={chip} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ))}
        </View>
      )}

      {/* CTA */}
      <Pressable
        style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.75 : 1 }]}
        onPress={onStart}
        accessibilityRole="button"
        accessibilityLabel="Start support"
      >
        <Text style={styles.ctaText}>Start support</Text>
        <Feather name="chevron-right" size={14} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: "#F3F8FF",
    borderWidth: 1,
    borderColor: "#D7E8FB",
    borderLeftWidth: 3,
    borderLeftColor: "rgba(51,112,185,0.55)",
    gap: 10,
    ...Platform.select({
      web: { boxShadow: "0 2px 12px rgba(30,60,120,0.08)" },
      default: {
        shadowColor: "#1E3C78",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.09,
        shadowRadius: 10,
        elevation: 3,
      },
    }),
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#3D7CC9",
  },
  pillText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    color: "#4A7AB5",
    letterSpacing: 0.2,
  },
  headline: {
    fontSize: 18,
    fontFamily: "Montserrat_700Bold",
    lineHeight: 25,
    color: CARD_TEXT,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  chip: {
    backgroundColor: "rgba(61,124,201,0.09)",
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 11,
    fontFamily: "Montserrat_500Medium",
    color: "#5A82B0",
    letterSpacing: 0.05,
  },
  cta: {
    backgroundColor: CARD_TEXT,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 2,
  },
  ctaText: {
    fontSize: 14,
    fontFamily: "Montserrat_700Bold",
    color: "#FFFFFF",
    letterSpacing: 0.1,
  },
});
