// Today-tab tip card driven by the local symptom rules. Shows up when
// the patient logs a relevant symptom (nausea / constipation / low
// appetite) and disappears when they tap "Got it" -- which also
// mirrors the acknowledgment to the server so the doctor dashboard
// can show "patient has already received basic self-management
// guidance" alongside the corresponding flag.
//
// Tone is short and supportive per the symptom spec. We deliberately
// avoid medical disclaimers ("consult your doctor") -- the escalation
// is handled by the doctor dashboard, not by alarming the patient.

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { SymptomKind, SymptomTip } from "@/lib/symptomTips";

interface SymptomTipCardProps {
  tip: SymptomTip;
  navy: string;
  accent: string;
  cardBg: string;
  background: string;
  mutedForeground: string;
  // Returns true after the ack succeeds locally (server mirror is
  // fire-and-forget). Caller is responsible for hiding the card.
  onAcknowledge: (symptom: SymptomKind) => void;
}

export function SymptomTipCard(props: SymptomTipCardProps) {
  const { tip, navy, accent, cardBg, background, mutedForeground, onAcknowledge } = props;
  const icon = useMemo(() => {
    if (tip.symptom === "nausea") return "alert-circle" as const;
    if (tip.symptom === "constipation") return "activity" as const;
    return "coffee" as const;
  }, [tip.symptom]);

  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      <View style={styles.header}>
        <View
          style={[styles.iconCircle, { backgroundColor: background }]}
          accessible={false}
        >
          <Feather name={icon} size={16} color={accent} />
        </View>
        <Text style={[styles.title, { color: navy }]} numberOfLines={2}>
          {tip.title}
        </Text>
      </View>
      <Text style={[styles.body, { color: navy }]}>{tip.body}</Text>
      {tip.factors.length > 0 && (
        <View style={styles.factors}>
          {tip.factors.map((f) => (
            <View
              key={f}
              style={[styles.factorChip, { backgroundColor: background }]}
            >
              <Text style={[styles.factorText, { color: mutedForeground }]}>
                {f}
              </Text>
            </View>
          ))}
        </View>
      )}
      <Pressable
        onPress={() => onAcknowledge(tip.symptom)}
        accessibilityRole="button"
        accessibilityLabel={`Got it, dismiss ${tip.symptom.replace("_", " ")} tip`}
        style={({ pressed }) => [
          styles.gotIt,
          { backgroundColor: navy, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.gotItText}>Got it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 16,
    lineHeight: 20,
  },
  body: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  factors: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  factorChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  factorText: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 11,
  },
  gotIt: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
  },
  gotItText: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 13,
    color: "#FFFFFF",
  },
});
