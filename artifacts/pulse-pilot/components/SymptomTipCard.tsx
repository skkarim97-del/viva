// Today-tab tip card driven by the local symptom rules. Appears when
// the patient logs a relevant symptom (nausea / constipation / low
// appetite) and disappears when they tap an action button -- which
// also mirrors the choice to the server so the doctor dashboard can
// show what the patient did.
//
// Three modes:
//   * mode="ack"      First time we're showing guidance for this
//                     symptom -- single "Got it" button.
//   * mode="followup" Same symptom recurred the day after guidance
//                     was acknowledged -- ask "Better / Same / Worse"
//                     so the closed-loop escalation logic can decide
//                     whether self-management is working.
//
// Both modes also expose a low-emphasis "Let my clinician know" link
// so the patient can ALWAYS escalate themselves without having to
// wait for the rules engine to catch up.
//
// Tone is short and supportive per the symptom spec. We deliberately
// avoid medical disclaimers ("consult your doctor") -- the doctor
// dashboard is the escalation channel, not an alarming patient toast.

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { SymptomKind, SymptomTip } from "@/lib/symptomTips";

export type TipCardMode = "ack" | "followup";
export type TrendResponse = "better" | "same" | "worse";

interface SymptomTipCardProps {
  tip: SymptomTip;
  mode: TipCardMode;
  // True after the patient explicitly tapped "Let my clinician know"
  // for this symptom in the current session. Replaces the link with a
  // disabled "Clinician notified" confirmation.
  clinicianNotified: boolean;
  navy: string;
  accent: string;
  cardBg: string;
  background: string;
  mutedForeground: string;
  onAcknowledge: (symptom: SymptomKind) => void;
  onTrendResponse: (symptom: SymptomKind, response: TrendResponse) => void;
  onRequestClinician: (symptom: SymptomKind) => void;
}

export function SymptomTipCard(props: SymptomTipCardProps) {
  const {
    tip,
    mode,
    clinicianNotified,
    navy,
    accent,
    cardBg,
    background,
    mutedForeground,
    onAcknowledge,
    onTrendResponse,
    onRequestClinician,
  } = props;

  const icon = useMemo(() => {
    if (tip.symptom === "nausea") return "alert-circle" as const;
    if (tip.symptom === "constipation") return "activity" as const;
    return "coffee" as const;
  }, [tip.symptom]);

  const followupTitle =
    tip.symptom === "constipation"
      ? "How are things today?"
      : "How are you feeling today?";

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
          {mode === "followup" ? followupTitle : tip.title}
        </Text>
      </View>
      <Text style={[styles.body, { color: navy }]}>
        {mode === "followup"
          ? "You tried the suggestions yesterday -- is this better, the same, or worse than before?"
          : tip.body}
      </Text>
      {mode === "ack" && tip.factors.length > 0 && (
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

      {mode === "followup" ? (
        <View style={styles.trendRow}>
          {(["better", "same", "worse"] as const).map((r) => {
            const tint =
              r === "better" ? "#1E8E3E" : r === "same" ? navy : "#B5251D";
            return (
              <Pressable
                key={r}
                onPress={() => onTrendResponse(tip.symptom, r)}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${tip.symptom.replace("_", " ")} as ${r}`}
                style={({ pressed }) => [
                  styles.trendBtn,
                  {
                    backgroundColor: background,
                    borderColor: tint + "40",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.trendBtnText, { color: tint }]}>
                  {r === "better" ? "Better" : r === "same" ? "Same" : "Worse"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
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
      )}

      {/* Patient-side escalation -- always available so a worried
          patient never has to wait for the rules engine. */}
      <View style={styles.escalateRow}>
        {clinicianNotified ? (
          <View
            style={[
              styles.escalateConfirm,
              { backgroundColor: background },
            ]}
          >
            <Feather name="check" size={12} color={accent} />
            <Text
              style={[styles.escalateConfirmText, { color: mutedForeground }]}
            >
              Clinician will see this
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => onRequestClinician(tip.symptom)}
            accessibilityRole="button"
            accessibilityLabel="Let my clinician know about this symptom"
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.escalateLink, { color: accent }]}>
              Let my clinician know
            </Text>
          </Pressable>
        )}
      </View>
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
  trendRow: {
    flexDirection: "row",
    gap: 8,
  },
  trendBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  trendBtnText: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 13,
  },
  escalateRow: {
    marginTop: 10,
    flexDirection: "row",
  },
  escalateLink: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 12,
  },
  escalateConfirm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  escalateConfirmText: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 11,
  },
});
