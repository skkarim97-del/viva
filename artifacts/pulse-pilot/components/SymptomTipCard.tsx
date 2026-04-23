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
  // Amber/warning hue used for the urgency cue (severity badge / dot).
  // Passed in from the theme so dark mode and brand tweaks stay
  // centralized.
  warning: string;
  onAcknowledge: (
    symptom: SymptomKind,
    interventionTitle: string,
    interventionCta: string,
    interventionSummary: string,
  ) => void;
  onTrendResponse: (
    symptom: SymptomKind,
    response: TrendResponse,
    interventionTitle: string,
  ) => void;
  onRequestClinician: (symptom: SymptomKind) => void;
  // Title of the intervention the patient actually acknowledged
  // yesterday. Only meaningful in followup mode. Falls back to the
  // current `tip.title` if absent (e.g. legacy AsyncStorage state
  // from before we recorded titles at ack time). This is what makes
  // the followup card unambiguous when the symptom severity has
  // shifted since yesterday and the derived title would otherwise
  // refer to a different intervention than the one that was acked.
  ackedInterventionTitle?: string;
  // Instruction sentence (the `cta`) the patient actually saw and
  // acknowledged. Captured for completeness / future debugging;
  // not currently rendered (the followup subtext uses the shorter
  // `followupSummary` instead).
  ackedInterventionCta?: string;
  // Short, natural recap of what the patient tried (gerund phrase,
  // no period). Captured at ack time so the followup card can quote
  // a brief, conversational summary without re-presenting the full
  // instruction. Falls back to the current tip.followupSummary if
  // absent (legacy state).
  ackedInterventionSummary?: string;
}

// User-facing label for each symptom in the followup question
// "Did this help your <X>?". For constipation we use "digestion"
// because that's the lay framing the patient sees on the check-in
// screen and on the tip card itself ("Get things moving" is about
// digestive movement); "constipation" reads as too clinical here.
const SYMPTOM_OUTCOME_LABEL: Record<SymptomKind, string> = {
  nausea: "nausea",
  constipation: "digestion",
  low_appetite: "appetite",
};

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
    warning,
    onAcknowledge,
    onTrendResponse,
    onRequestClinician,
    ackedInterventionTitle,
    ackedInterventionCta,
    ackedInterventionSummary,
  } = props;
  // Touch the cta-acked prop so it stays in the public API for
  // care-team-side analytics and future debugging tooling without
  // tripping unused-var lint. Not currently rendered (the followup
  // subtext uses the shorter `followupSummary` instead).
  void ackedInterventionCta;

  // Title + summary to attribute the followup question to. Prefer
  // the values we captured at ack time so the prompt always refers
  // to exactly what the patient saw and tapped. Fall back to the
  // currently-derived tip values only if we have no record (legacy
  // state, or first run after an upgrade).
  const followupInterventionTitle = ackedInterventionTitle ?? tip.title;
  const followupInterventionSummary =
    ackedInterventionSummary ?? tip.followupSummary;

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

  // Followup question is intentionally light and conversational --
  // it should read like a quick check-in, not a clinical survey.
  // The title anchors to the symptom; the subtext is a short,
  // natural recap of what the patient actually did, suffixed with
  // " yesterday" since followup mode is by definition the day after
  // the ack (gated on lastAck === yesterdayYmd).
  const followupTitle = `Did this help your ${SYMPTOM_OUTCOME_LABEL[tip.symptom]} at all?`;
  const followupSubtext = `${followupInterventionSummary} yesterday`;

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
      onAcknowledge(tip.symptom, tip.title, tip.cta, tip.followupSummary);
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
              // Type scale: primary title = 17, secondary title = 15.
              // Same role across cards; emphasis differential lives in
              // size + the implicit weight from Montserrat_600SemiBold.
              fontSize: isPrimary ? 17 : 15,
              lineHeight: isPrimary ? 22 : 20,
            },
          ]}
          numberOfLines={2}
        >
          {mode === "followup" ? followupTitle : tip.title}
        </Text>
        {/* Urgency cue. Only on the primary ack card so secondaries
            stay quiet. Severe symptoms get an amber "Act now" pill;
            moderate symptoms get a single amber dot next to the
            title. Mild signals stay un-marked (the title + CTA are
            enough). Calm amber, never red -- this is a nudge, not an
            ER alert. */}
        {mode === "ack" && isPrimary && tip.severity >= 3 && (
          <View
            style={[
              styles.urgencyPill,
              // Solid (not tinted) amber so the pill clearly reads as
              // a status flag rather than blending in with the factor
              // chips that share a pill shape further down the card.
              { backgroundColor: warning },
            ]}
            accessible
            accessibilityLabel="Act now: high urgency"
          >
            <Feather name="alert-triangle" size={11} color="#FFFFFF" />
            <Text style={styles.urgencyPillText}>Act now</Text>
          </View>
        )}
        {mode === "ack" && isPrimary && tip.severity === 2 && (
          <View
            style={[styles.urgencyDot, { backgroundColor: warning }]}
            accessible
            accessibilityLabel="Moderate urgency"
          />
        )}
      </View>

      {/* Body line under the title. In ack mode this is the urgency
          ("Do this in the next 15 minutes..."). In followup mode it
          is the intervention attribution ("After trying Settle your
          stomach"), which together with the title above makes the
          question unambiguous: which symptom + which intervention. */}
      <Text
        style={[
          styles.urgency,
          // Body text is a single role at fontSize 13 across every
          // card. Hierarchy comes from the title above, not from
          // shrinking the body on secondary cards.
          { color: mutedForeground, fontSize: 13 },
        ]}
      >
        {mode === "followup" ? followupSubtext : tip.urgency}
      </Text>

      {/* Action sentence + a parenthetical example line. The action
          sentence is the specific thing to do (with standard units);
          the example line gives 2-4 familiar items so the action is
          easy to picture. Rendered together so there's no extra UI
          step before the patient hits Done. Example only appears in
          ack mode -- the followup branch is asking a different
          question entirely. */}
      {mode === "ack" && (
        <View style={styles.actionBlock}>
          <Text style={[styles.actionSentence, { color: navy }]}>
            {tip.cta}
          </Text>
          {tip.example && (
            <Text style={[styles.exampleLine, { color: mutedForeground }]}>
              {tip.example}
            </Text>
          )}
        </View>
      )}

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
            // Wire values stay better/same/worse so risk engine,
            // sync queue, and care_event metadata don't have to
            // change. Only the visible label is being updated to
            // the more outcome-anchored Improved / No change / Worse.
            const tint =
              r === "better" ? "#1E8E3E" : r === "same" ? navy : "#B5251D";
            const label =
              r === "better" ? "Improved" : r === "same" ? "No change" : "Worse";
            return (
              <Pressable
                key={r}
                onPress={() =>
                  onTrendResponse(tip.symptom, r, followupInterventionTitle)
                }
                accessibilityRole="button"
                accessibilityLabel={`Mark ${SYMPTOM_OUTCOME_LABEL[tip.symptom]} as ${label.toLowerCase()} after trying ${followupInterventionTitle}`}
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
                  {label}
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
            <Text style={styles.ctaPrimaryText}>
              {tip.ctaLabel ?? "Done"}
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
            {tip.ctaLabel ?? "Done"}
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
    marginBottom: 10,
  },
  actionBlock: {
    marginBottom: 12,
  },
  actionSentence: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 14,
    lineHeight: 19,
  },
  exampleLine: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    fontStyle: "italic",
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
    // CTA role is fontSize 13 across primary and secondary cards.
    // Secondary's lower emphasis comes from the ghost border + tighter
    // padding, not from shrinking the label.
    fontSize: 13,
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
    // Confirmation copy replaces the CTA in the same slot, so it shares
    // the CTA role's fontSize 13 to keep the type scale consistent.
    fontSize: 13,
  },
  accountabilityText: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
  },
  urgencyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  urgencyPillText: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 11,
    letterSpacing: 0.4,
    color: "#FFFFFF",
    textTransform: "uppercase",
  },
  urgencyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
