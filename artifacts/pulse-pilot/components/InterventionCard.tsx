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

// Per-row state machine. Each recommendation row drives its own
// progression independently:
//   default      -> "I'll try this" / "Not for me"
//   committed    -> "Did this help?" -> Better / No change / Worse
//   not_for_me   -> dim "Not for me" pill (terminal local state)
//   better       -> "Glad it helped" pill (terminal local state)
//   no_change    -> "Thanks for the update" pill (terminal local state)
//   worse        -> contextual escalation panel:
//                   "Try another suggestion" / "Ask my care team"
// Only "worse" surfaces an "Ask my care team" affordance; default
// rows never show escalation. Tapping "Ask my care team" from the
// worse panel is the SINGLE point that triggers a server-side
// escalation via onFeedback("worse"). "Try another suggestion"
// resets the row to default so the user can pick a different one.
type SectionStatus =
  | "committed"
  | "not_for_me"
  | "better"
  | "no_change"
  | "worse";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "committed",
  "not_for_me",
  "better",
  "no_change",
  "worse",
]);

// Migrate legacy persisted values from the prior "did/skipped" model
// so users who had taps in flight before this rework don't see their
// row state silently reset. did -> committed (they wanted to try),
// skipped -> not_for_me (they declined).
function coercePersistedStatus(raw: string | null): SectionStatus | null {
  if (!raw) return null;
  if (VALID_STATUSES.has(raw)) return raw as SectionStatus;
  if (raw === "did") return "committed";
  if (raw === "skipped") return "not_for_me";
  return null;
}

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
            const coerced = coercePersistedStatus(v);
            if (coerced != null) next[k] = coerced;
          }
          return next;
        });
      } catch {
        // best-effort; an empty map is the right fallback
      }
    })();
    return () => { cancelled = true; };
  }, [sectionKeys]);

  // Tracks whether we've already issued the server `accept` call for
  // this card during this session. The first row a user commits to
  // (taps "I'll try this") transitions the intervention server-side
  // from "shown" -> "pending_feedback" so the dashboard funnel sees
  // engagement. Subsequent row commits don't re-fire -- the card is
  // already accepted. Reset implicitly when the intervention id
  // changes (component unmount + remount).
  const acceptFiredRef = useRef(false);

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

  // Card-level "fired worse to server" tracker. Independent of the
  // per-row local state machine: once any row's worse-panel "Ask my
  // care team" tap reaches the server, the card transitions
  // server-side to escalated. We also remember it locally so a fast
  // double-tap doesn't re-fire onFeedback before the active poll
  // refreshes intervention.status.
  const escalateFiredRef = useRef(false);

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

  // -- Per-row action handlers --------------------------------------
  // The card no longer exposes a card-level "I'll do this" button;
  // every action originates from a row. These handlers wire the row
  // state transitions to the (small set of) server lifecycle calls
  // that still matter:
  //   * First "I'll try this" tap on ANY row -> onAccept (engagement
  //     funnel; shown -> pending_feedback). Idempotent via
  //     acceptFiredRef + the server's own status guard.
  //   * "Ask my care team" tap from a row's worse panel ->
  //     onFeedback("worse"). Server auto-escalates inside the same
  //     /feedback handler, so we do NOT additionally call onEscalate.
  // Per-row better/no_change outcomes stay local: the server only
  // stores ONE feedbackResult per intervention, and we don't want
  // one row's "better" to overwrite another row's "worse" in flight.
  // The user's true escalation intent is the explicit "Ask my care
  // team" tap on the worse panel.
  const handleRowCommit = useCallback(
    async (key: string) => {
      void setRowStatus(key, "committed");
      if (acceptFiredRef.current) return;
      if (intervention.status !== "shown") {
        // Server already past "shown" (e.g. the patient committed on
        // a prior session and the card came back as accepted). No
        // need to re-fire; remember so we skip future attempts too.
        acceptFiredRef.current = true;
        return;
      }
      // Set the in-flight guard so a near-simultaneous tap on a
      // sibling row doesn't double-fire onAccept. If the call FAILS
      // and the server is still in "shown", clear the guard so a
      // later commit (or the worse-panel "Ask my care team" path)
      // can retry. Without this clear, a transient network blip
      // would permanently lock the card out of escalation, and the
      // worse-panel branch would skip its required pre-accept and
      // hit a /feedback 409.
      acceptFiredRef.current = true;
      try {
        await onAccept(intervention.id);
      } catch {
        if (intervention.status === "shown") {
          acceptFiredRef.current = false;
        }
      }
    },
    [setRowStatus, intervention.id, intervention.status, onAccept],
  );

  const handleRowDecline = useCallback(
    (key: string) => {
      void setRowStatus(key, "not_for_me");
    },
    [setRowStatus],
  );

  const handleRowOutcome = useCallback(
    (key: string, outcome: "better" | "no_change" | "worse") => {
      void setRowStatus(key, outcome);
    },
    [setRowStatus],
  );

  const handleRowTryAnother = useCallback(
    (key: string) => {
      // Reset the row to default so the user can re-engage with a
      // different recommendation. Doesn't touch other rows or
      // server state.
      void setRowStatus(key, null);
    },
    [setRowStatus],
  );

  const handleRowAskCareTeam = useCallback(
    async (_key: string) => {
      // Server already escalated (e.g. card refreshed mid-session
      // after a prior worse-feedback). Nothing to send.
      if (intervention.status === "escalated") return;
      if (escalateFiredRef.current) return;
      escalateFiredRef.current = true;
      try {
        // /feedback with "worse" auto-escalates the row server-side
        // (sets status=escalated + writes escalation_requested
        // care_event in one transaction). Server status guard on
        // /feedback requires accepted/pending_feedback, so when the
        // card is still "shown" we MUST issue accept first or the
        // feedback call 409s. Key the pre-accept off live status
        // rather than acceptFiredRef -- the ref can be true even
        // when the server is still "shown" (a prior commit's
        // onAccept failed and we cleared+retry was skipped, or a
        // race set the ref before the network call resolved). If
        // status says "shown", we need to accept regardless of the
        // ref to keep this path correct.
        if (intervention.status === "shown") {
          acceptFiredRef.current = true;
          try {
            await onAccept(intervention.id);
          } catch {
            // best-effort; the server may already have been moved
            // out of "shown" by a concurrent path. /feedback below
            // will surface the real error if the state is wrong.
          }
        }
        await onFeedback(intervention.id, "worse");
      } catch {
        // Allow re-attempt if the call truly failed. The local row
        // stays in "worse" so the user can tap again.
        escalateFiredRef.current = false;
      }
    },
    [intervention.id, intervention.status, onAccept, onFeedback],
  );

  // Reference unused legacy handlers so TS doesn't complain when the
  // card-level action blocks below are removed. onDismiss / onEscalate
  // still arrive from the parent for future surfaces (e.g. a header
  // "x" or a card menu); we deliberately don't surface them in the
  // default-first-layer UX per the rework spec.
  void onDismiss; void onEscalate; void busy; void setBusy;

  // Skip rendering for terminal states the parent should have filtered
  // out -- defense in depth.
  if (status === "resolved" || status === "expired" || status === "dismissed") {
    return null;
  }

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
        <View style={styles.rowsWrap}>
          {sections.map((s, i) => {
            const key = sectionKeys[i]!;
            const rowState = sectionStatus[key] ?? null;
            // Single-section recommendations get a generic "Recommended"
            // label so the row still scans correctly without a per-
            // symptom header. Multi-section labels come straight from
            // the synthesizer ("Nausea support", "Appetite support").
            const label = s.label ?? "Recommended";
            return (
              <RecommendationRow
                key={key}
                label={label}
                body={s.body}
                status={rowState}
                navy={navy}
                mutedForeground={mutedForeground}
                border={background}
                accent={accent}
                warning={warning}
                onCommit={() => handleRowCommit(key)}
                onDecline={() => handleRowDecline(key)}
                onOutcome={(outcome) => handleRowOutcome(key, outcome)}
                onTryAnother={() => handleRowTryAnother(key)}
                onAskCareTeam={() => handleRowAskCareTeam(key)}
              />
            );
          })}
        </View>
      </View>

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
// Per-row state machine progression:
//   default     -> "I'll try this" | "Not for me"
//   committed   -> "Did this help?" -> Better | No change | Worse
//   not_for_me  -> dim "Not for me" pill (terminal)
//   better      -> "Glad it helped" pill (terminal)
//   no_change   -> "Thanks for the update" pill (terminal)
//   worse       -> escalation panel:
//                  "Try another suggestion" | "Ask my care team"
//
// Escalation copy + CTA only ever appears in the worse branch -- the
// default/committed/positive states never expose a path to ping the
// care team, so the card reads as automated first-line support
// rather than a triage shortcut.
interface RecommendationRowProps {
  label: string;
  body: string;
  status: SectionStatus | null;
  navy: string;
  mutedForeground: string;
  border: string;
  accent: string;
  warning: string;
  onCommit: () => void;
  onDecline: () => void;
  onOutcome: (outcome: "better" | "no_change" | "worse") => void;
  onTryAnother: () => void;
  onAskCareTeam: () => void;
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
  onCommit,
  onDecline,
  onOutcome,
  onTryAnother,
  onAskCareTeam,
}: RecommendationRowProps) {
  const tap = () => {
    try { Haptics.selectionAsync(); } catch { /* best-effort */ }
  };

  // Tint the row surface based on terminal/active state. Worse gets a
  // soft warning tint so the escalation panel reads as the most
  // important next step in the card.
  const surfaceTint =
    status === "worse"
      ? warning + "12"
      : status === "better"
        ? "#34C7591A"
        : status === "committed"
          ? accent + "0E"
          : status === "no_change"
            ? mutedForeground + "0E"
            : status === "not_for_me"
              ? mutedForeground + "08"
              : "#FFFFFF";
  const surfaceBorder =
    status === "worse"
      ? warning + "66"
      : status === "better"
        ? "#34C75955"
        : status === "committed"
          ? accent + "44"
          : status === "not_for_me" || status === "no_change"
            ? mutedForeground + "33"
            : border;

  const titleA11y = label.toLowerCase();

  return (
    <View
      style={[
        styles.recRow,
        { borderColor: surfaceBorder, backgroundColor: surfaceTint },
      ]}
    >
      <View style={styles.recHeader}>
        <Text
          style={[
            styles.recLabel,
            {
              color: navy,
              opacity: status === "not_for_me" ? 0.7 : 1,
            },
          ]}
        >
          {label}
        </Text>
        {status === "better" && (
          <View
            style={[styles.recStatusPill, { backgroundColor: "#34C75922" }]}
          >
            <Feather name="smile" size={10} color="#1F8A3F" />
            <Text style={[styles.recStatusText, { color: "#1F8A3F" }]}>
              Better
            </Text>
          </View>
        )}
        {status === "no_change" && (
          <View
            style={[
              styles.recStatusPill,
              { backgroundColor: mutedForeground + "1F" },
            ]}
          >
            <Feather name="meh" size={10} color={mutedForeground} />
            <Text style={[styles.recStatusText, { color: mutedForeground }]}>
              No change
            </Text>
          </View>
        )}
        {status === "not_for_me" && (
          <View
            style={[
              styles.recStatusPill,
              { backgroundColor: mutedForeground + "1F" },
            ]}
          >
            <Feather name="x" size={10} color={mutedForeground} />
            <Text style={[styles.recStatusText, { color: mutedForeground }]}>
              Not for me
            </Text>
          </View>
        )}
        {status === "worse" && (
          <View
            style={[styles.recStatusPill, { backgroundColor: warning + "22" }]}
          >
            <Feather name="alert-circle" size={10} color={warning} />
            <Text style={[styles.recStatusText, { color: warning }]}>
              Worse
            </Text>
          </View>
        )}
      </View>
      <Text
        style={[
          styles.recBody,
          {
            color: navy,
            opacity: status === "not_for_me" ? 0.65 : 1,
          },
        ]}
      >
        {body}
      </Text>

      {/* -- Default: I'll try this / Not for me ---------------------- */}
      {status == null && (
        <View style={styles.recButtonRow}>
          <Pressable
            onPress={() => { tap(); onCommit(); }}
            accessibilityRole="button"
            accessibilityLabel={`I'll try this for ${titleA11y}`}
            style={({ pressed }) => [
              styles.recButton,
              styles.recButtonPrimary,
              {
                borderColor: accent,
                backgroundColor: accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="check" size={12} color="#FFFFFF" />
            <Text
              style={[
                styles.recButtonText,
                { color: "#FFFFFF", fontWeight: "700" },
              ]}
            >
              I'll try this
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { tap(); onDecline(); }}
            accessibilityRole="button"
            accessibilityLabel={`Not for me for ${titleA11y}`}
            style={({ pressed }) => [
              styles.recButton,
              { borderColor: border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text
              style={[
                styles.recButtonText,
                { color: mutedForeground, fontWeight: "500" },
              ]}
            >
              Not for me
            </Text>
          </Pressable>
        </View>
      )}

      {/* -- Committed: ask "Did this help?" -------------------------- */}
      {status === "committed" && (
        <View style={styles.recOutcomeWrap}>
          <Text
            style={[styles.recOutcomePrompt, { color: mutedForeground }]}
          >
            Did this help?
          </Text>
          <View style={styles.recOutcomeRow}>
            <OutcomeButton
              label="Better"
              icon="smile"
              tint="#1F8A3F"
              border={border}
              onPress={() => { tap(); onOutcome("better"); }}
              accessibilityLabel={`Symptoms better after ${titleA11y}`}
            />
            <OutcomeButton
              label="No change"
              icon="meh"
              tint={mutedForeground}
              border={border}
              onPress={() => { tap(); onOutcome("no_change"); }}
              accessibilityLabel={`No change after ${titleA11y}`}
            />
            <OutcomeButton
              label="Worse"
              icon="frown"
              tint={warning}
              border={border}
              onPress={() => { tap(); onOutcome("worse"); }}
              accessibilityLabel={`Symptoms worse after ${titleA11y}`}
            />
          </View>
        </View>
      )}

      {/* -- Worse: contextual escalation panel ----------------------- */}
      {status === "worse" && (
        <View style={styles.recEscalateWrap}>
          <Text style={[styles.recEscalateCopy, { color: navy }]}>
            Got it. Since this got worse, Viva can suggest another step or
            flag this for your care team.
          </Text>
          <View style={styles.recButtonRow}>
            <Pressable
              onPress={() => { tap(); onTryAnother(); }}
              accessibilityRole="button"
              accessibilityLabel={`Try another suggestion for ${titleA11y}`}
              style={({ pressed }) => [
                styles.recButton,
                { borderColor: border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Feather name="refresh-cw" size={12} color={mutedForeground} />
              <Text
                style={[
                  styles.recButtonText,
                  { color: mutedForeground, fontWeight: "600" },
                ]}
              >
                Try another suggestion
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { tap(); onAskCareTeam(); }}
              accessibilityRole="button"
              accessibilityLabel={`Ask my care team about ${titleA11y}`}
              style={({ pressed }) => [
                styles.recButton,
                styles.recButtonPrimary,
                {
                  borderColor: warning,
                  backgroundColor: warning,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="message-circle" size={12} color="#FFFFFF" />
              <Text
                style={[
                  styles.recButtonText,
                  { color: "#FFFFFF", fontWeight: "700" },
                ]}
              >
                Ask my care team
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* -- Terminal positive / declined: small undo affordance ------ */}
      {(status === "better" ||
        status === "no_change" ||
        status === "not_for_me") && (
        <Pressable
          onPress={() => { tap(); onTryAnother(); }}
          accessibilityRole="button"
          accessibilityLabel={`Reset response for ${titleA11y}`}
          style={({ pressed }) => [
            styles.recUndo,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="rotate-ccw" size={11} color={mutedForeground} />
          <Text style={[styles.recUndoText, { color: mutedForeground }]}>
            Change response
          </Text>
        </Pressable>
      )}
    </View>
  );
}

interface OutcomeButtonProps {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  border: string;
  onPress: () => void;
  accessibilityLabel: string;
}

function OutcomeButton({
  label,
  icon,
  tint,
  border,
  onPress,
  accessibilityLabel,
}: OutcomeButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.recOutcomeButton,
        { borderColor: border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Feather name={icon} size={13} color={tint} />
      <Text style={[styles.recOutcomeButtonText, { color: tint }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    // Tightened padding + gap so multiple recommendation rows fit
    // comfortably above the bottom nav without extra scrolling.
    padding: 16,
    gap: 12,
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
  escalatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  escalatedText: {
    fontSize: 13,
    fontWeight: "600",
  },
  rowsWrap: {
    gap: 6,
    marginTop: 2,
  },
  recRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 6,
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
  recButtonPrimary: {
    // Filled CTA shares the same hit-target as recButton; only the
    // background + border colors differ at the call site.
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
  recOutcomeWrap: {
    gap: 6,
    marginTop: 2,
  },
  recOutcomePrompt: {
    fontSize: 12,
    fontWeight: "600",
  },
  recOutcomeRow: {
    flexDirection: "row",
    gap: 6,
  },
  recOutcomeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  recOutcomeButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  recEscalateWrap: {
    gap: 8,
    marginTop: 2,
  },
  recEscalateCopy: {
    fontSize: 12,
    lineHeight: 17,
  },
  recUndo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 2,
    paddingVertical: 2,
  },
  recUndoText: {
    fontSize: 11,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
});
