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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type FeedbackResult,
  type PatientIntervention,
} from "@/lib/api/interventionsClient";

// =====================================================================
// Per-row recommendation parsing + local completion state
// =====================================================================
// The backend `recommendation` field is plain text, optionally
// composed of multiple `\n\n`-separated sections shaped as
// "<Label>: <body>". When 2+ sections are present we surface each
// one as an interactive row with its own "Did this / Didn't do this"
// buttons -- the unified card stays one card but the supports inside
// are individually scannable + actionable.
//
// Completion state per row is persisted to AsyncStorage keyed by
// (intervention id + section label). Keying on label rather than
// index keeps the user's "did this" choice stable across live slider
// updates -- the same card row is updated in place when symptoms
// change and the order of sections may shift, but a row labeled
// "Nausea support" stays the same target. We deliberately keep this
// state local to the device for now (no new API endpoint) since the
// per-row choice is mainly a self-tracking aid; the existing
// Better/Same/Worse feedback still rolls up to the server.

interface RecommendationSection {
  // Section label without the trailing colon ("Nausea support" not
  // "Nausea support:"). null when the recommendation has no labeled
  // sections (single-symptom case) -- in that path we skip the row
  // header and render the body inline.
  label: string | null;
  body: string;
}

function parseRecommendationSections(
  recommendation: string,
): RecommendationSection[] {
  const text = (recommendation ?? "").trim();
  if (!text) return [];
  // Split on blank lines (\n\n). Tolerate Windows line endings and
  // trailing whitespace. Single-symptom output has no \n\n and falls
  // through as a single section.
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (blocks.length <= 1) {
    return [{ label: null, body: text }];
  }
  return blocks.map((block) => {
    // Look for "Label: body" where Label is short (<= 30 chars) and
    // contains no newlines. The colon split is intentionally first-
    // colon-only so body text containing colons stays intact.
    const m = block.match(/^([^\n:]{1,30}):\s*([\s\S]+)$/);
    if (!m) return { label: null, body: block };
    return { label: m[1]!.trim(), body: m[2]!.trim() };
  });
}

type SectionStatus = "did" | "skipped";

function rowKey(interventionId: number, label: string | null, index: number): string {
  // Prefer label-based keying for stability across live updates; fall
  // back to index when a section has no label (single-symptom path,
  // which only ever has one row anyway).
  const tag = label ? `label:${label.toLowerCase()}` : `idx:${index}`;
  return `pulsepilot.intervention.${interventionId}.row.${tag}`;
}

// Compute the per-row storage key for each section, disambiguating
// duplicate labels by appending the section index. Without this guard
// two sections with the same label (rare but possible if templates
// ever overlap) would collide on a single AsyncStorage key AND on the
// React `key` prop, producing both shared completion state and React
// "duplicate key" warnings.
function buildRowKeys(
  interventionId: number,
  sections: RecommendationSection[],
): string[] {
  const seen = new Map<string, number>();
  return sections.map((s, i) => {
    const base = rowKey(interventionId, s.label, i);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

// Soft tint applied behind the card so it reads as the hero output of
// the symptom check-in instead of just another feed card. The card has
// always been the primary action surface for the personalized loop, so
// we lean into a quietly-distinct blue palette that reads as "this is
// for you" without screaming. Stays neutral enough for dark mode by
// keeping the tint very pale and using a saturated foreground only on
// the small badge.
const FEATURED_TINT = "#E8F1FB"; // very light blue
const FEATURED_BORDER = "#BFD7F0"; // soft blue border, ~2 shades darker
const FEATURED_BADGE_BG = "#DCE9F7";
const FEATURED_BADGE_FG = "#1F4F8A";
// The featured surface is always light, so text colors must also be
// fixed (dark) -- using the theme `navy`/`mutedForeground` would
// produce light-on-light text in dark mode. These pair with
// FEATURED_TINT regardless of system theme.
const FEATURED_TEXT = "#142240"; // dark navy body
const FEATURED_MUTED = "#5A6A82"; // muted slate for labels/subtitle

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
  // Theme `navy` / `mutedForeground` / `background` are intentionally
  // shadowed below because the featured card uses a fixed light blue
  // surface in BOTH light and dark mode -- pulling those tokens
  // straight from the theme would produce light-on-light text in dark
  // mode. We keep the prop signature stable for callers and just
  // remap to fixed colors for everything that paints on the card
  // surface. `accent` and `warning` stay theme-aware because they
  // drive icon + escalation states that look correct either way.
  navy: _themeNavy,
  accent,
  cardBg: _cardBg,
  background: _themeBackground,
  mutedForeground: _themeMuted,
  warning,
  onAccept,
  onDismiss,
  onFeedback,
  onEscalate,
}: InterventionCardProps) {
  const navy = FEATURED_TEXT;
  const mutedForeground = FEATURED_MUTED;
  const background = FEATURED_BORDER;
  const [busy, setBusy] = useState<
    null | "accept" | "dismiss" | "feedback" | "escalate"
  >(null);

  const status = intervention.status;
  const icon = useMemo(
    () => categoryIcon(intervention.recommendationCategory),
    [intervention.recommendationCategory],
  );

  // -- Per-row recommendation sections + completion state -----------
  const sections = useMemo(
    () => parseRecommendationSections(intervention.recommendation),
    [intervention.recommendation],
  );
  // Stable AsyncStorage keys per visible row, deduped against label
  // collisions. Recomputed when the section list changes (e.g. live
  // update from a slider tweak adding/removing a symptom).
  const sectionKeys = useMemo(
    () => buildRowKeys(intervention.id, sections),
    [intervention.id, sections],
  );

  // sectionStatus[key] = "did" | "skipped". Hydrated from AsyncStorage
  // on mount / when sections change so the patient's prior taps stick
  // across reloads and across live slider-driven card updates.
  const [sectionStatus, setSectionStatus] = useState<
    Record<string, SectionStatus>
  >({});
  // Tracks user interaction + per-key write versions so we can resolve
  // two race conditions raised by the architect review:
  //   (a) Hydration race: multiGet may resolve AFTER a user tap, in
  //       which case applying the persisted (stale) snapshot would
  //       overwrite the newer in-memory choice. We solve this by
  //       MERGING hydration into the existing state -- in-memory
  //       writes always win over hydrated values.
  //   (b) Rapid-tap write race: if the user taps Did then Skipped
  //       within a few ms, the second AsyncStorage.setItem may resolve
  //       before the first, leaving stale persisted data. We tag every
  //       write with a monotonically increasing version per key and
  //       only persist if our version is still the latest.
  const writeVersionRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pairs = await AsyncStorage.multiGet(sectionKeys);
        if (cancelled) return;
        setSectionStatus((prev) => {
          // Merge: only fill in keys the user hasn't already touched
          // this session. Any in-memory entry (including pending
          // writes tracked via writeVersionRef) wins.
          const next = { ...prev };
          for (const [k, v] of pairs) {
            if (writeVersionRef.current[k] != null) continue;
            if (k in next) continue;
            if (v === "did" || v === "skipped") next[k] = v;
          }
          return next;
        });
      } catch {
        // best-effort; an empty map is the right fallback
      }
    })();
    return () => { cancelled = true; };
  }, [sectionKeys]);

  const setRowStatus = useCallback(
    async (key: string, value: SectionStatus | null) => {
      // Bump version and capture; persistence below only applies if we
      // are still the most-recent write for this key when the await
      // resolves -- guards against out-of-order setItem/removeItem.
      const version = (writeVersionRef.current[key] ?? 0) + 1;
      writeVersionRef.current[key] = version;
      setSectionStatus((prev) => {
        const next = { ...prev };
        if (value == null) delete next[key];
        else next[key] = value;
        return next;
      });
      try {
        if (value == null) await AsyncStorage.removeItem(key);
        else await AsyncStorage.setItem(key, value);
        // If a newer write started while we awaited, drop ours -- the
        // newer call will persist its own value.
        if (writeVersionRef.current[key] !== version) return;
      } catch {
        // best-effort persistence
      }
    },
    [],
  );

  // When the patient marked "Worse" (auto-escalated server-side), we
  // visually emphasize the "Ask my care team" affordance on the
  // shown-state card so the next person in the same situation has a
  // clear next step. Currently the card is in `escalated` status when
  // that happens, so this also shows an emphasized variant in the
  // post-feedback state. We ALSO emphasize when the patient skipped
  // every row -- that's a strong signal nothing landed and they may
  // benefit from human follow-up.
  const allSkipped =
    sections.length >= 2 &&
    sectionKeys.every((k) => sectionStatus[k] === "skipped");
  const emphasizeAskCareTeam =
    intervention.feedbackResult === "worse" || allSkipped;

  // Subtle entrance: fade + slide-up on first mount so the card
  // visibly arrives instead of popping in. Native driver where
  // available; web falls back to the JS driver automatically.
  // IMPORTANT: declared BEFORE any conditional early return so the
  // hook count stays stable if `status` later transitions into a
  // terminal value (resolved/expired/dismissed). Otherwise React
  // would throw "rendered fewer hooks than expected".
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: 60,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [enter]);
  const animatedStyle = {
    opacity: enter,
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

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

  // Badge swaps copy when the card has escalated to the care team so
  // the "FOR YOU TODAY" pill doesn't lie about the current state.
  const badgeLabel = status === "escalated" ? "Care team notified" : "For you today";

  return (
    <Animated.View
      style={[
        styles.card,
        styles.cardFeatured,
        {
          backgroundColor: FEATURED_TINT,
          borderColor: status === "escalated" ? warning : FEATURED_BORDER,
        },
        animatedStyle,
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
          <Feather name={icon} size={18} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    status === "escalated" ? warning + "22" : FEATURED_BADGE_BG,
                },
              ]}
            >
              <Feather
                name={status === "escalated" ? "alert-circle" : "star"}
                size={10}
                color={status === "escalated" ? warning : FEATURED_BADGE_FG}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: status === "escalated" ? warning : FEATURED_BADGE_FG },
                ]}
              >
                {badgeLabel}
              </Text>
            </View>
          </View>
          <Text style={[styles.title, { color: navy }]}>
            Personalized check-in
          </Text>
          <Text style={[styles.subtitle, { color: mutedForeground }]}>
            Based on today's symptoms
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
        {sections.length <= 1 ? (
          // Single-symptom case (no \n\n in recommendation): keep the
          // original inline body so the simpler card stays compact.
          <Text style={[styles.sectionBody, { color: navy, fontWeight: "600" }]}>
            {sections[0]?.body ?? intervention.recommendation}
          </Text>
        ) : (
          <View style={styles.rowsWrap}>
            {sections.map((s, i) => {
              const key = sectionKeys[i]!;
              const rowState = sectionStatus[key] ?? null;
              return (
                <RecommendationRow
                  key={key}
                  label={s.label ?? "Support"}
                  body={s.body}
                  status={rowState}
                  navy={navy}
                  mutedForeground={mutedForeground}
                  border={background}
                  accent={accent}
                  warning={warning}
                  onDid={() =>
                    void setRowStatus(key, rowState === "did" ? null : "did")
                  }
                  onSkip={() =>
                    void setRowStatus(
                      key,
                      rowState === "skipped" ? null : "skipped",
                    )
                  }
                />
              );
            })}
          </View>
        )}
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
              accessibilityRole="button"
              accessibilityLabel="Ask my care team"
              accessibilityHint={
                emphasizeAskCareTeam
                  ? "Recommended next step based on your feedback"
                  : undefined
              }
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: emphasizeAskCareTeam ? warning : background,
                  borderWidth: emphasizeAskCareTeam ? 1.5 : 1,
                  backgroundColor: emphasizeAskCareTeam ? warning + "12" : "transparent",
                  opacity: pressed || busy ? 0.7 : 1,
                },
              ]}
            >
              {busy === "escalate" ? (
                <ActivityIndicator size="small" color={mutedForeground} />
              ) : (
                <View style={styles.iconAndText}>
                  <Feather
                    name="message-circle"
                    size={13}
                    color={emphasizeAskCareTeam ? warning : mutedForeground}
                  />
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      {
                        color: emphasizeAskCareTeam ? warning : mutedForeground,
                        fontWeight: emphasizeAskCareTeam ? "700" : "500",
                      },
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
    </Animated.View>
  );
}

// =====================================================================
// RecommendationRow -- one labeled support row inside the master card
// =====================================================================
// Renders the section's label + body and a compact pair of "Did this"
// / "Didn't do this" toggle buttons. Tapping the same button again
// clears the row back to the neutral state so the patient can change
// their mind without any cost.
interface RecommendationRowProps {
  label: string;
  body: string;
  status: SectionStatus | null;
  navy: string;
  mutedForeground: string;
  border: string;
  accent: string;
  warning: string;
  onDid: () => void;
  onSkip: () => void;
}

function RecommendationRow({
  label,
  body,
  status,
  navy,
  mutedForeground,
  border,
  accent,
  warning,
  onDid,
  onSkip,
}: RecommendationRowProps) {
  const tap = () => {
    try { Haptics.selectionAsync(); } catch { /* best-effort */ }
  };
  const didActive = status === "did";
  const skipActive = status === "skipped";
  return (
    <View
      style={[
        styles.recRow,
        {
          borderColor: didActive
            ? accent + "55"
            : skipActive
              ? mutedForeground + "33"
              : border,
          backgroundColor: didActive
            ? accent + "0F"
            : skipActive
              ? mutedForeground + "0A"
              : "#FFFFFF",
        },
      ]}
    >
      <View style={styles.recHeader}>
        <Text style={[styles.recLabel, { color: navy }]}>{label}</Text>
        {didActive && (
          <View style={[styles.recStatusPill, { backgroundColor: accent + "1F" }]}>
            <Feather name="check" size={10} color={accent} />
            <Text style={[styles.recStatusText, { color: accent }]}>Done</Text>
          </View>
        )}
        {skipActive && (
          <View
            style={[
              styles.recStatusPill,
              { backgroundColor: mutedForeground + "1F" },
            ]}
          >
            <Feather name="x" size={10} color={mutedForeground} />
            <Text style={[styles.recStatusText, { color: mutedForeground }]}>
              Skipped
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.recBody, { color: navy }]}>{body}</Text>
      <View style={styles.recButtonRow}>
        <Pressable
          onPress={() => { tap(); onDid(); }}
          accessibilityRole="button"
          accessibilityLabel={`Did ${label}`}
          accessibilityState={{ selected: didActive }}
          style={({ pressed }) => [
            styles.recButton,
            {
              borderColor: didActive ? accent : border,
              backgroundColor: didActive ? accent : "transparent",
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Feather
            name="check"
            size={12}
            color={didActive ? "#FFFFFF" : accent}
          />
          <Text
            style={[
              styles.recButtonText,
              {
                color: didActive ? "#FFFFFF" : accent,
                fontWeight: didActive ? "700" : "600",
              },
            ]}
          >
            Did this
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { tap(); onSkip(); }}
          accessibilityRole="button"
          accessibilityLabel={`Didn't do ${label}`}
          accessibilityState={{ selected: skipActive }}
          style={({ pressed }) => [
            styles.recButton,
            {
              borderColor: skipActive ? mutedForeground : border,
              backgroundColor: skipActive ? mutedForeground + "18" : "transparent",
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Feather
            name="x"
            size={12}
            color={skipActive ? warning : mutedForeground}
          />
          <Text
            style={[
              styles.recButtonText,
              {
                color: skipActive ? warning : mutedForeground,
                fontWeight: skipActive ? "700" : "500",
              },
            ]}
          >
            Didn't do this
          </Text>
        </Pressable>
      </View>
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
    borderRadius: 20,
    padding: 22,
    gap: 14,
    borderWidth: 1,
  },
  // Featured variant -- thicker border, soft shadow on native, soft
  // box-shadow on web. Lifts the card off the page so it reads as
  // distinct from the surrounding plain cards.
  cardFeatured: {
    borderWidth: 1.5,
    ...Platform.select({
      web: {
        // RN-Web honors boxShadow via style prop on web only.
        boxShadow: "0 6px 18px rgba(31, 79, 138, 0.10)",
      },
      default: {
        shadowColor: "#1F4F8A",
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      },
    }),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
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
  rowsWrap: {
    gap: 8,
    marginTop: 4,
  },
  recRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  recHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  recLabel: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    flex: 1,
  },
  recBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  recButtonRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  recButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  recButtonText: {
    fontSize: 12,
  },
  recStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  recStatusText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
