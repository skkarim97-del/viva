// Today-tab card that surfaces an AI-personalized micro-intervention
// (Phase 3 of the intervention loop). When this card is rendering, the
// legacy SymptomTipCard layer is intentionally suppressed by the
// parent so the patient sees ONE prioritized recommendation that
// references their own signals, instead of a generic static tip on
// top of the personalized one.
//
// Visible structure (spec):
//   Title:   "Personalized check-in"
//   Section: "What Viva noticed"   -> intervention.whatWeNoticed
//   Section: "Try this today"      -> intervention.recommendation
//   Section: "Check back later"    -> intervention.followUpQuestion
//
// State machine:
//   shown              -> "I'll do this" / "Not now" / "Ask my care team"
//   accepted           -> "Got it - we'll check in later" pill
//   pending_feedback   -> "Pending feedback" pill +
//                         Better / Same / Worse / "I didn't try it"
//                         (worse server-side AUTO-ESCALATES the row to
//                          status="escalated" on /feedback; the card
//                          does NOT issue a separate /escalate call.)
//   feedback_collected -> brief thank-you keyed off feedbackResult;
//                         dismisses on next active poll
//   escalated          -> "Care team notified" confirmation
//   resolved/expired   -> not rendered
//
// All network calls are best-effort: errors are swallowed and the
// card stays in its current state. The parent owns refetch cadence.

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import {
  type FeedbackResult,
  type PatientIntervention,
} from "@/lib/api/interventionsClient";

interface InterventionCardProps {
  intervention: PatientIntervention;
  // Theme tokens, threaded the same way SymptomTipCard receives them
  // so this card stays consistent with the surrounding Today screen.
  navy: string;
  accent: string;
  cardBg: string;
  background: string;
  mutedForeground: string;
  warning: string;

  onAccept: (id: number) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  onFeedback: (id: number, result: FeedbackResult) => Promise<void>;
  onEscalate: (id: number) => Promise<void>;
}

function categoryIcon(
  category: PatientIntervention["recommendationCategory"],
): keyof typeof Feather.glyphMap {
  // Maps the canonical PATIENT_INTERVENTION_RECOMMENDATION_CATEGORIES
  // (lib/db) to Feather glyphs. New categories on the server fall
  // through to the heart default rather than rendering an empty box.
  switch (category) {
    case "hydration":
      return "droplet";
    case "activity":
      return "activity";
    case "protein":
      return "award";
    case "fiber":
      return "feather";
    case "small_meal":
      return "coffee";
    case "rest":
      return "moon";
    case "tracking":
      return "edit-3";
    case "care_team_review":
      return "message-circle";
    default:
      return "heart";
  }
}

// Default copy for the "Check back later" line when the engine
// returned a row without a follow-up question. This is rare -- all
// fallback templates in templates.ts ship with a question -- but we
// fail safe so the section never renders blank.
const DEFAULT_FOLLOWUP =
  "After you try it, tell us if it feels better, the same or worse.";

export function InterventionCard({
  intervention,
  navy,
  accent,
  cardBg,
  background,
  mutedForeground,
  warning,
  onAccept,
  onDismiss,
  onFeedback,
  onEscalate,
}: InterventionCardProps) {
  const [busy, setBusy] = useState<
    null | "accept" | "dismiss" | "feedback" | "escalate"
  >(null);

  const status = intervention.status;
  const icon = useMemo(
    () => categoryIcon(intervention.recommendationCategory),
    [intervention.recommendationCategory],
  );

  const haptic = () => {
    try { Haptics.selectionAsync(); } catch { /* best-effort */ }
  };

  const handleAccept = async () => {
    if (busy) return;
    setBusy("accept");
    haptic();
    try { await onAccept(intervention.id); } finally { setBusy(null); }
  };
  const handleDismiss = async () => {
    if (busy) return;
    setBusy("dismiss");
    haptic();
    try { await onDismiss(intervention.id); } finally { setBusy(null); }
  };
  const handleEscalate = async () => {
    if (busy) return;
    setBusy("escalate");
    haptic();
    try { await onEscalate(intervention.id); } finally { setBusy(null); }
  };
  const handleFeedback = async (result: FeedbackResult) => {
    if (busy) return;
    setBusy("feedback");
    haptic();
    try {
      // "worse" AUTO-ESCALATES on the server inside the same
      // /feedback handler -- it sets status=escalated and writes the
      // escalation_requested care_event in one transaction. We must
      // NOT also call /escalate here: that endpoint requires status
      // in {shown,accepted,pending_feedback}, so the second call
      // would 409 (status is already "escalated") and pollute logs.
      // The active poll will refresh the card into the escalated
      // state on the next tick.
      await onFeedback(intervention.id, result);
    } finally {
      setBusy(null);
    }
  };

  // Skip rendering for terminal states the parent should have filtered
  // out -- defense in depth.
  if (status === "resolved" || status === "expired" || status === "dismissed") {
    return null;
  }

  const followUpText = intervention.followUpQuestion?.trim()
    ? intervention.followUpQuestion
    : DEFAULT_FOLLOWUP;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor: status === "escalated" ? warning : background,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: accent + "18" }]}>
          <Feather name={icon} size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: mutedForeground }]}>
            {status === "escalated" ? "CARE TEAM NOTIFIED" : "FOR YOU TODAY"}
          </Text>
          <Text style={[styles.title, { color: navy }]}>
            Personalized check-in
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: mutedForeground }]}>
          What Viva noticed
        </Text>
        <Text style={[styles.sectionBody, { color: navy }]}>
          {intervention.whatWeNoticed}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: mutedForeground }]}>
          Try this today
        </Text>
        <Text style={[styles.sectionBody, { color: navy, fontWeight: "600" }]}>
          {intervention.recommendation}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: mutedForeground }]}>
          Check back later
        </Text>
        <Text style={[styles.sectionBody, { color: navy }]}>
          {followUpText}
        </Text>
      </View>

      {status === "shown" && (
        <View style={styles.shownActions}>
          <Pressable
            onPress={handleAccept}
            disabled={!!busy}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: accent, opacity: pressed || busy ? 0.85 : 1 },
            ]}
          >
            {busy === "accept" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="check" size={14} color="#fff" />
                <Text style={styles.primaryButtonText}>I'll do this</Text>
              </>
            )}
          </Pressable>
          <View style={styles.secondaryRow}>
            <Pressable
              onPress={handleDismiss}
              disabled={!!busy}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: background, opacity: pressed || busy ? 0.7 : 1 },
              ]}
            >
              {busy === "dismiss" ? (
                <ActivityIndicator size="small" color={mutedForeground} />
              ) : (
                <Text
                  style={[styles.secondaryButtonText, { color: mutedForeground }]}
                >
                  Not now
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={handleEscalate}
              disabled={!!busy}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: background, opacity: pressed || busy ? 0.7 : 1 },
              ]}
            >
              {busy === "escalate" ? (
                <ActivityIndicator size="small" color={mutedForeground} />
              ) : (
                <View style={styles.iconAndText}>
                  <Feather
                    name="message-circle"
                    size={13}
                    color={mutedForeground}
                  />
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: mutedForeground },
                    ]}
                  >
                    Ask my care team
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {status === "accepted" && (
        <View style={styles.acceptedRow}>
          <View
            style={[
              styles.acceptedPill,
              { backgroundColor: accent + "18" },
            ]}
          >
            <Feather name="check-circle" size={14} color={accent} />
            <Text style={[styles.acceptedPillText, { color: accent }]}>
              Got it -- we'll check in later
            </Text>
          </View>
        </View>
      )}

      {status === "pending_feedback" && (
        <>
          <View style={styles.pendingPillRow}>
            <View
              style={[
                styles.pendingPill,
                { backgroundColor: mutedForeground + "18" },
              ]}
            >
              <Feather name="clock" size={12} color={mutedForeground} />
              <Text
                style={[styles.pendingPillText, { color: mutedForeground }]}
              >
                Pending feedback
              </Text>
            </View>
          </View>
          <Text style={[styles.helperText, { color: mutedForeground }]}>
            How do you feel now?
          </Text>
          <View style={styles.feedbackGrid}>
            <FeedbackButton
              label="Better"
              icon="smile"
              tint="#34C759"
              busy={busy === "feedback"}
              onPress={() => handleFeedback("better")}
              mutedForeground={mutedForeground}
              background={background}
            />
            <FeedbackButton
              label="Same"
              icon="meh"
              tint={mutedForeground}
              busy={busy === "feedback"}
              onPress={() => handleFeedback("same")}
              mutedForeground={mutedForeground}
              background={background}
            />
            <FeedbackButton
              label="Worse"
              icon="frown"
              tint={warning}
              busy={busy === "feedback"}
              onPress={() => handleFeedback("worse")}
              mutedForeground={mutedForeground}
              background={background}
            />
            <FeedbackButton
              label="I didn't try it"
              icon="slash"
              tint={mutedForeground}
              busy={busy === "feedback"}
              onPress={() => handleFeedback("didnt_try")}
              mutedForeground={mutedForeground}
              background={background}
            />
          </View>
        </>
      )}

      {/* Post-feedback thank-you. Status is `feedback_collected` for
          better/same/didnt_try, and `escalated` for worse (auto-
          escalate). We render the warning copy on the escalated path
          below, so feedback_collected always uses the muted variant. */}
      {status === "feedback_collected" && (
        <Text style={[styles.thankyou, { color: mutedForeground }]}>
          Thanks for letting us know.
        </Text>
      )}

      {status === "escalated" && intervention.feedbackResult === "worse" && (
        <Text style={[styles.thankyou, { color: warning }]}>
          Thanks -- your care team has been notified.
        </Text>
      )}

      {status === "escalated" && (
        <View style={styles.escalatedRow}>
          <Feather name="alert-circle" size={14} color={warning} />
          <Text style={[styles.escalatedText, { color: warning }]}>
            Your care team will follow up.
          </Text>
        </View>
      )}
    </View>
  );
}

interface FeedbackButtonProps {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  busy: boolean;
  onPress: () => void;
  mutedForeground: string;
  background: string;
}

function FeedbackButton({
  label,
  icon,
  tint,
  busy,
  onPress,
  mutedForeground,
  background,
}: FeedbackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.feedbackButton,
        {
          borderColor: background,
          opacity: pressed || busy ? 0.7 : 1,
        },
      ]}
    >
      <Feather name={icon} size={16} color={tint} />
      <Text style={[styles.feedbackButtonText, { color: mutedForeground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 18,
    gap: 12,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  section: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  helperText: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  thankyou: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 4,
  },
  shownActions: {
    gap: 8,
    marginTop: 6,
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  iconAndText: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  acceptedRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  acceptedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  acceptedPillText: {
    fontSize: 13,
    fontWeight: "600",
  },
  pendingPillRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  pendingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pendingPillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  feedbackGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  feedbackButton: {
    flexBasis: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  feedbackButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  escalatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  escalatedText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
