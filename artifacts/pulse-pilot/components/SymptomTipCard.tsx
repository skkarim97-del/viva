// Today-tab symptom action card. Each card surfaces ONE concrete,
// time-sensitive action the patient can complete in <10 minutes (the
// CTA), driven by what they just logged. Tapping the CTA both marks
// the action as done for the day AND mirrors the choice to the server
// so the doctor dashboard reflects what the patient actually did.
//
// Two modes:
//   * mode="ack"      First time we're showing guidance for this
//                     symptom -- single verb-led CTA. Tap CTA -> brief
//                     completed state -> card dismissed.
//   * mode="followup" Same symptom recurred the day after guidance was
//                     acknowledged -- ask "Better / Same / Worse" so
//                     the closed-loop escalation logic can decide
//                     whether self-management is working.
//
// Cards are also visually prioritized: the FIRST active tip renders as
// "primary" (filled CTA, full emphasis); subsequent tips render as
// "secondary" (ghost CTA, slightly muted) so the patient's attention
// goes to one action at a time.
//
// A low-emphasis "Let my clinician know" link is always available so a
// worried patient never has to wait for the rules engine to escalate.

import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { SymptomKind, SymptomTip } from "@/lib/symptomTips";

export type TipCardMode = "ack" | "followup";
export type TipCardPriority = "primary" | "secondary";
export type TrendResponse = "better" | "same" | "worse";

interface SymptomTipCardProps {
  tip: SymptomTip;
  mode: TipCardMode;
  // "primary" gets a filled accent CTA + factor chips; "secondary" is
  // a quieter ghost CTA without chips. Determined by position in the
  // active tips list (top tip = primary).
  priority: TipCardPriority;
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

// Delay (ms) between the patient tapping the CTA and the card being
// dismissed by the parent. Tuned to ~6s so a quick "tap-without-doing"
// still has to sit with the confirmation for a moment (a small dose
// of friction that nudges actually-doing-the-thing) -- but short
// enough not to feel sticky or broken.
const COMPLETION_HOLD_MS = 6000;

export function SymptomTipCard(props: SymptomTipCardProps) {
  const {
    tip,
    mode,
    priority,
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

  // Local "I tapped the CTA" state. We hold the card in a completed
  // visual state for COMPLETION_HOLD_MS so the patient gets clear
  // feedback before the parent dismisses it. Held in a ref so we can
  // cancel the timeout if the component unmounts mid-hold.
  const [completed, setCompleted] = useState(false);
  const completionFade = useRef(new Animated.Value(1)).current;
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  const isPrimary = priority === "primary";

  const icon =
    tip.symptom === "nausea"
      ? ("alert-circle" as const)
      : tip.symptom === "constipation"
      ? ("activity" as const)
      : ("coffee" as const);

  const followupTitle =
    tip.symptom === "constipation"
      ? "How are things today?"
      : "How are you feeling today?";

  const handleCtaPress = () => {
    if (completed) return;
    setCompleted(true);
    // Soften the card while the confirmation is visible.
    Animated.timing(completionFade, {
      toValue: 0.7,
      duration: 200,
      useNativeDriver: true,
    }).start();
    dismissTimeoutRef.current = setTimeout(() => {
      onAcknowledge(tip.symptom);
    }, COMPLETION_HOLD_MS);
  };

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          opacity: completionFade,
          // Secondary cards sit slightly inset and quieter so the eye
          // lands on the primary tip first.
          paddingVertical: isPrimary ? 18 : 14,
          paddingHorizontal: isPrimary ? 18 : 16,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: background,
              width: isPrimary ? 30 : 26,
              height: isPrimary ? 30 : 26,
              borderRadius: isPrimary ? 15 : 13,
            },
          ]}
          accessible={false}
        >
          <Feather name={icon} size={isPrimary ? 16 : 14} color={accent} />
        </View>
        <Text
          style={[
            styles.title,
            {
              color: navy,
              fontSize: isPrimary ? 17 : 14,
              lineHeight: isPrimary ? 22 : 18,
            },
          ]}
          numberOfLines={2}
        >
          {mode === "followup" ? followupTitle : tip.title}
        </Text>
      </View>

      {/* Urgency line -- the "when" that nudges follow-through.
          Replaced the old multi-suggestion body so a single decision
          stays in front of the patient. */}
      <Text
        style={[
          styles.urgency,
          { color: mutedForeground, fontSize: isPrimary ? 13 : 12 },
        ]}
      >
        {mode === "followup"
          ? "You tried the suggestion yesterday -- is this better, the same, or worse?"
          : tip.urgency}
      </Text>

      {/* Factor chips: only on the primary card. Secondary tips stay
          minimal so the page doesn't feel cluttered. */}
      {mode === "ack" && isPrimary && tip.factors.length > 0 && (
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
      ) : completed ? (
        <View>
          <View style={[styles.completedRow, { backgroundColor: background }]}>
            <View
              style={[
                styles.completedCheck,
                { backgroundColor: accent + "22" },
              ]}
            >
              <Feather name="check" size={13} color={accent} />
            </View>
            <Text style={[styles.completedText, { color: navy }]}>
              {tip.ctaCompleted}
            </Text>
          </View>
          {/* Subtle accountability line on completion -- "shared
              care" framing, never surveillance. */}
          <Text style={[styles.accountabilityText, { color: mutedForeground }]}>
            Your clinician can see this.
          </Text>
        </View>
      ) : isPrimary ? (
        <View>
          <Pressable
            onPress={handleCtaPress}
            accessibilityRole="button"
            accessibilityLabel={`${tip.cta}, mark as done`}
            style={({ pressed }) => [
              styles.ctaPrimary,
              {
                backgroundColor: navy,
                paddingHorizontal: 18,
                paddingVertical: 11,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="check-circle" size={15} color="#FFFFFF" />
            <Text style={[styles.ctaPrimaryText, { fontSize: 14 }]}>
              {tip.cta}
            </Text>
          </Pressable>
          {/* Quiet accountability subtext under the primary CTA only.
              Reinforces that completion is visible to the care team
              without crowding secondary cards. */}
          <Text style={[styles.accountabilityText, { color: mutedForeground }]}>
            Your clinician can see when you complete this.
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={handleCtaPress}
          accessibilityRole="button"
          accessibilityLabel={`${tip.cta}, mark as done`}
          style={({ pressed }) => [
            styles.ctaSecondary,
            { borderColor: navy + "33", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="check-circle" size={13} color={navy} />
          <Text style={[styles.ctaSecondaryText, { color: navy }]}>
            {tip.cta}
          </Text>
        </Pressable>
      )}

      {/* Patient-side escalation -- always available so a worried
          patient never has to wait for the rules engine. */}
      <View style={styles.escalateRow}>
        {clinicianNotified ? (
          <View
            style={[styles.escalateConfirm, { backgroundColor: background }]}
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
            disabled={completed}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.escalateLink, { color: accent }]}>
              Let my clinician know
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  iconCircle: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontFamily: "Montserrat_600SemiBold",
  },
  urgency: {
    fontFamily: "Montserrat_500Medium",
    lineHeight: 18,
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
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  ctaPrimaryText: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 13,
    color: "#FFFFFF",
  },
  ctaSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  ctaSecondaryText: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 12,
  },
  completedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  completedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  completedText: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 12,
  },
  accountabilityText: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
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
