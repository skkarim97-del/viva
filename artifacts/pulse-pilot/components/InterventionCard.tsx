// Today-tab card that surfaces an AI-personalized micro-intervention
// (Phase 3 of the intervention loop). When this card is rendering, the
// legacy SymptomTipCard layer is intentionally suppressed by the
// parent so the patient sees ONE prioritized recommendation that
// references their own signals, instead of a generic static tip on
// top of the personalized one.
//
// Visible structure (rework spec):
//   Title:   "Today's support plan"
//   Subtitle:"Viva prioritized the steps most likely to help based on
//             today's check-in."
//   Section: "What Viva noticed"   -> intervention.whatWeNoticed
//                                    + computed "X is the best place
//                                    to start because..." sentence.
//   Module:  Issue summary chips (X surfaced / 1 needs attention now /
//                                 N supportive steps)
//   Module:  Progress tracker ("X of N steps started")
//   Primary: "Start here" card for the highest-priority symptom
//            (priority order: severe nausea -> moderate nausea ->
//             very low/low appetite -> very low/low energy ->
//             constipation -> hydration).
//   Rows:    Compact secondary rows for the remaining symptoms
//   Footer:  Clinical guardrail (small subtle helper text)
//
// Per-row state machine (preserved across the rework):
//   default      -> "I'll try this" / "Not for me"
//   committed    -> "Once you've tried it, how do you feel?" ->
//                    Better / No change / Worse
//   not_for_me   -> "Got it. Want a different option?" ->
//                    "Show another option" (cycles fallback alt) /
//                    "Skip for today" (-> skipped)
//   skipped      -> dim "Skipped" pill (terminal local state)
//   better       -> "Helped" pill (terminal local state)
//   no_change    -> "Still tracking" pill +
//                    "Try another step" / "Keep tracking"
//   worse        -> "Needs follow-up" pill +
//                    "Try another step" / "Ask my care team"
//
// Server contract (preserved): only the FIRST per-row commit fires
// onAccept (intervention shown -> pending_feedback). Only "Ask my
// care team" from the worse panel fires onFeedback("worse"), which
// the server treats as the auto-escalation signal. Per-row Better /
// No change outcomes stay local.
//
// Network calls are best-effort: errors are swallowed and the card
// stays in its current state. The parent owns refetch cadence.

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
import { logEvent } from "@/lib/analytics/client";

// =====================================================================
// Per-row recommendation parsing + local completion state
// =====================================================================
// The backend `recommendation` field is plain text, optionally
// composed of multiple `\n\n`-separated sections shaped as
// "<Label>: <body>". When 2+ sections are present we surface each
// one as an interactive row with its own state machine.
//
// Completion state per row is persisted to AsyncStorage keyed by
// (intervention id + section label). Keying on label rather than
// index keeps the user's choice stable across live slider updates --
// the same card row is updated in place when symptoms change and the
// order of sections may shift, but a row labeled "Nausea support"
// stays the same target.

interface RecommendationSection {
  label: string | null;
  body: string;
}

function parseRecommendationSections(
  recommendation: string,
): RecommendationSection[] {
  const text = (recommendation ?? "").trim();
  if (!text) return [];
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (blocks.length <= 1) {
    return [{ label: null, body: text }];
  }
  return blocks.map((block) => {
    const m = block.match(/^([^\n:]{1,30}):\s*([\s\S]+)$/);
    if (!m) return { label: null, body: block };
    return { label: m[1]!.trim(), body: m[2]!.trim() };
  });
}

// =====================================================================
// Category mapping, priority ranking, fallback alternates
// =====================================================================
// Sections come back from the synthesizer with category-shaped labels
// ("Nausea support", "Appetite support", ...). categoryFromLabel maps
// those into a small enum so we can attach timing badges, rationale
// copy, fallback alternate text, and a numeric priority for sorting.
//
// For unlabeled single-section recommendations (single-symptom path)
// we fall back to the intervention-level recommendationCategory.

type RecCategory =
  | "nausea"
  | "appetite"
  | "energy"
  | "constipation"
  | "hydration"
  | "other";

function categoryFromLabel(
  label: string | null,
  fallback: PatientIntervention["recommendationCategory"],
): RecCategory {
  const l = (label ?? "").toLowerCase();
  if (l.includes("nausea")) return "nausea";
  if (l.includes("appetite")) return "appetite";
  if (l.includes("energy")) return "energy";
  if (l.includes("constipation") || l.includes("digestion")) return "constipation";
  if (l.includes("hydration") || l.includes("fluid")) return "hydration";
  switch (fallback) {
    case "hydration":
      return "hydration";
    case "small_meal":
    case "protein":
      return "appetite";
    case "rest":
      return "energy";
    case "fiber":
      return "constipation";
    default:
      return "other";
  }
}

// Priority rank: lower number = more urgent. Severity (server-side
// numeric, higher = more severe) lets us split severe vs moderate
// nausea and very low vs low appetite/energy per the rework spec.
function priorityRank(cat: RecCategory, severity: number | null | undefined): number {
  const sev = typeof severity === "number" ? severity : 0;
  const isSevere = sev >= 4; // numeric scale: severe nausea / very low intake
  switch (cat) {
    case "nausea":
      return isSevere ? 1 : 2;
    case "appetite":
      return isSevere ? 3 : 4;
    case "energy":
      return isSevere ? 5 : 6;
    case "constipation":
      return 7;
    case "hydration":
      return 8;
    default:
      return 9;
  }
}

// Single fallback alternate per category. "Show another option" on a
// declined row toggles the displayed body to this alt copy and resets
// the row to the default state so the patient can try the alternate.
const FALLBACK_ALTERNATES: Record<RecCategory, string> = {
  nausea:
    "Try ginger tea, crackers or another bland snack, and avoid large portions for now.",
  appetite:
    "Try a few bites of something easy to tolerate, like yogurt, tofu, soup or a smoothie.",
  energy: "Take a short rest, hydrate slowly and add protein when you can.",
  constipation:
    "Try a fiber-rich food like berries, chia, beans or vegetables, and keep sipping water.",
  hydration: "Take a few small sips every 5 to 10 minutes for the next hour.",
  other: "Try a small step that feels manageable right now and check back in later.",
};

// Timing badge per category, displayed as a small pill on each row.
const TIMING_BY_CATEGORY: Record<RecCategory, string> = {
  nausea: "Try within the next hour",
  appetite: "Next meal",
  energy: "Helpful today",
  constipation: "This afternoon",
  hydration: "Next hour",
  other: "Today",
};

// One-sentence rationale displayed below the body on the primary card.
const RATIONALE_BY_CATEGORY: Record<RecCategory, string> = {
  nausea:
    "Why this matters: nausea and low intake can make it harder to stay on track today.",
  appetite:
    "Why this matters: steady protein helps energy and recovery between meals.",
  energy:
    "Why this matters: small protein + rest cycles help carry you through the day.",
  constipation:
    "Why this matters: fiber and steady fluids help keep things moving comfortably.",
  hydration:
    "Why this matters: steady sips help most other symptoms feel a little easier.",
  other:
    "Why this matters: small steps add up across the day.",
};

// Reason fragment used to upgrade the "What Viva noticed" sentence
// from a flat list of symptoms into "<Label> is the best place to
// start because <reason>." Ties the observation to the support plan.
const BEST_PLACE_REASON: Record<RecCategory, string> = {
  nausea: "it can affect food intake and energy",
  appetite: "steady intake supports energy and recovery",
  energy: "stabilizing energy supports the rest of the day",
  constipation: "comfort here helps appetite and rest",
  hydration: "hydration supports nearly every other symptom",
  other: "small steps add up across the day",
};

const FRIENDLY_TITLE: Record<RecCategory, string> = {
  nausea: "Nausea support",
  appetite: "Appetite support",
  energy: "Energy support",
  constipation: "Constipation support",
  hydration: "Hydration support",
  other: "Recommended",
};

const SHORT_NOUN: Record<RecCategory, string> = {
  nausea: "Nausea",
  appetite: "Appetite",
  energy: "Energy",
  constipation: "Constipation",
  hydration: "Hydration",
  other: "This step",
};

// Per-row state machine. Each recommendation row drives its own
// progression independently:
//   default      -> "I'll try this" / "Not for me"
//   committed    -> "Once you've tried it, how do you feel?" ->
//                    Better / No change / Worse
//   not_for_me   -> intermediate "Skipped" panel:
//                    "Show another option" (cycles to fallback) /
//                    "Skip for today" (-> skipped terminal)
//   skipped      -> dim "Skipped" pill (terminal local state)
//   better       -> "Helped" pill (terminal local state)
//   no_change    -> "Still tracking" pill + supportive next-step panel
//   worse        -> "Needs follow-up" pill + escalation panel:
//                    "Try another step" / "Ask my care team"
// Only "worse" surfaces an "Ask my care team" affordance; default and
// other states never expose escalation. Tapping "Ask my care team"
// from the worse panel is the SINGLE point that triggers a server-
// side escalation via onFeedback("worse").
type SectionStatus =
  | "committed"
  | "not_for_me"
  | "skipped"
  | "better"
  | "no_change"
  | "worse";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "committed",
  "not_for_me",
  "skipped",
  "better",
  "no_change",
  "worse",
]);

// Migrate legacy persisted values from the prior "did/skipped" model
// so users with in-flight state don't see their row silently reset.
function coercePersistedStatus(raw: string | null): SectionStatus | null {
  if (!raw) return null;
  if (VALID_STATUSES.has(raw)) return raw as SectionStatus;
  if (raw === "did") return "committed";
  return null;
}

// =====================================================================
// Escalation gating (UI-ready). Returns true when the row should
// expose an "Ask my care team" path. Currently fires on "worse" only.
// TODO: when historical patient_intervention data is plumbed through,
// also escalate when the same category has been "no_change" across
// multiple check-ins, or "not_for_me" repeatedly without resolution.
// =====================================================================
export function shouldOfferEscalation(
  _category: RecCategory,
  rowState: SectionStatus | null,
  _history?: { sameCategoryUnresolvedCount?: number },
): boolean {
  if (rowState === "worse") return true;
  // TODO: if (history && (history.sameCategoryUnresolvedCount ?? 0) >= 3) return true;
  return false;
}

function rowKey(interventionId: number, label: string | null, index: number): string {
  const tag = label ? `label:${label.toLowerCase()}` : `idx:${index}`;
  return `pulsepilot.intervention.${interventionId}.row.${tag}`;
}

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

// =====================================================================
// Visual tokens. Light, fixed surface so contrast stays correct in
// dark mode (the theme's `cardBg`/`navy` would produce light-on-light).
// =====================================================================
const FEATURED_TINT = "#E8F1FB";
const FEATURED_BORDER = "#BFD7F0";
const FEATURED_BADGE_BG = "#DCE9F7";
const FEATURED_BADGE_FG = "#1F4F8A";
const FEATURED_TEXT = "#142240";
const FEATURED_MUTED = "#5A6A82";
// Softer surface for compact secondary rows so they read as supporting
// content beneath the primary "Start here" card.
const SECONDARY_SURFACE = "#F5F8FC";
const SECONDARY_BORDER = "#D5E1F0";
// Stronger surface + accent for the primary "Start here" card so it
// scans as the most important next step.
const PRIMARY_SURFACE = "#FFFFFF";
const PRIMARY_BORDER = "#7FB0E8";
const START_HERE_BG = "#1F4F8A";
const START_HERE_FG = "#FFFFFF";
// Status chip palette. Ready/Skipped use the muted slate; Started uses
// the accent; Helped uses success green; Still tracking uses neutral;
// Needs follow-up uses the warning color.
const CHIP_READY_BG = "#E1E8F1";
const CHIP_READY_FG = "#5A6A82";
const CHIP_HELPED_BG = "#34C75922";
const CHIP_HELPED_FG = "#1F8A3F";
const CHIP_TRACKING_BG = "#E1E8F1";
const CHIP_TRACKING_FG = "#5A6A82";

interface InterventionCardProps {
  intervention: PatientIntervention;
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

function safeLog(name: string): void {
  try {
    void logEvent(name);
  } catch {
    /* analytics is fire-and-forget; never break product flow */
  }
}

export function InterventionCard({
  intervention,
  // Theme `navy` / `mutedForeground` / `background` are intentionally
  // shadowed below because the featured card uses a fixed light blue
  // surface in BOTH light and dark mode.
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
  const sectionKeys = useMemo(
    () => buildRowKeys(intervention.id, sections),
    [intervention.id, sections],
  );

  // Sort sections by category priority and project the sorted order
  // into a small struct that carries the per-row metadata derived from
  // the category mapping. The first entry becomes the primary "Start
  // here" card; the rest render as compact secondary rows.
  const orderedRows = useMemo(() => {
    const enriched = sections.map((s, i) => {
      const category = categoryFromLabel(
        s.label,
        intervention.recommendationCategory,
      );
      return {
        section: s,
        index: i,
        key: sectionKeys[i]!,
        category,
        rank: priorityRank(category, intervention.severity),
        title: s.label ?? FRIENDLY_TITLE[category],
      };
    });
    enriched.sort((a, b) => a.rank - b.rank || a.index - b.index);
    return enriched;
  }, [
    sections,
    sectionKeys,
    intervention.recommendationCategory,
    intervention.severity,
  ]);

  // sectionStatus[key] = SectionStatus. Hydrated from AsyncStorage on
  // mount / when sections change so the patient's prior taps stick
  // across reloads and across live slider-driven card updates.
  const [sectionStatus, setSectionStatus] = useState<
    Record<string, SectionStatus>
  >({});
  // Per-row "alternate text shown" flag. Toggled by "Show another
  // option" / "Try another step" so the displayed body cycles to the
  // category fallback copy. Not persisted -- a fresh session resets
  // to the canonical recommendation.
  const [sectionAlt, setSectionAlt] = useState<Record<string, boolean>>({});
  // Per-row "outcome acknowledged" flag for the no_change branch.
  // After "Keep tracking", the row keeps its "Still tracking" chip but
  // dismisses the action panel so the screen stays calm.
  const [outcomeAck, setOutcomeAck] = useState<Record<string, boolean>>({});

  // Race-safety for AsyncStorage:
  //   (a) Hydration race -- multiGet may resolve AFTER a user tap. We
  //       merge hydrated values in only for keys the user hasn't
  //       touched (`touchedKeysRef`). Any in-memory entry wins.
  //   (b) Rapid-tap write race -- if the user taps Did then Skipped
  //       within a few ms, we must guarantee that the LAST tap's
  //       value is what ends up persisted, regardless of which
  //       setItem awaits resolves first. We do this by serializing
  //       writes per key via a promise chain: each new write waits
  //       for the prior write on the same key before issuing its own
  //       setItem/removeItem. Tap order in -> persistence order out.
  const touchedKeysRef = useRef<Set<string>>(new Set());
  const writeChainRef = useRef<Record<string, Promise<unknown>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pairs = await AsyncStorage.multiGet(sectionKeys);
        if (cancelled) return;
        setSectionStatus((prev) => {
          const next = { ...prev };
          for (const [k, v] of pairs) {
            if (touchedKeysRef.current.has(k)) continue;
            if (k in next) continue;
            const coerced = coercePersistedStatus(v);
            if (coerced != null) next[k] = coerced;
          }
          return next;
        });
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionKeys]);

  // Tracks whether we've already issued the server `accept` call for
  // this card during this session. The first row a user commits to
  // transitions the intervention server-side from "shown" ->
  // "pending_feedback". Subsequent commits don't re-fire.
  const acceptFiredRef = useRef(false);
  // Card-level "fired worse to server" tracker. Independent of the
  // per-row local state machine.
  const escalateFiredRef = useRef(false);
  // Fire `intervention_plan_viewed` exactly once per intervention id
  // when the card mounts / when a new intervention swaps in.
  const viewLoggedRef = useRef<number | null>(null);
  useEffect(() => {
    if (viewLoggedRef.current === intervention.id) return;
    viewLoggedRef.current = intervention.id;
    safeLog("intervention_plan_viewed");
  }, [intervention.id]);

  const setRowStatus = useCallback(
    async (key: string, value: SectionStatus | null) => {
      // Mark the key as user-touched so a late hydration won't
      // clobber it with the persisted snapshot.
      touchedKeysRef.current.add(key);
      // Apply in-memory state immediately so the UI updates without
      // waiting on persistence.
      setSectionStatus((prev) => {
        const next = { ...prev };
        if (value == null) delete next[key];
        else next[key] = value;
        return next;
      });
      // Serialize the persistence write behind any prior in-flight
      // write on the same key. This guarantees that even if setItem
      // calls resolve out of order, the LAST queued write is the
      // value that ends up on disk -- so a fast Did -> Skipped tap
      // sequence persists "skipped", never the stale "did".
      const prior = writeChainRef.current[key] ?? Promise.resolve();
      const next = prior
        .catch(() => undefined)
        .then(async () => {
          try {
            if (value == null) await AsyncStorage.removeItem(key);
            else await AsyncStorage.setItem(key, value);
          } catch {
            /* best-effort persistence */
          }
        });
      writeChainRef.current[key] = next;
      await next;
    },
    [],
  );

  // Subtle entrance animation. Declared BEFORE any conditional early
  // return so the hook count stays stable when status transitions.
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

  // -- Per-row action handlers --------------------------------------
  const handleRowCommit = useCallback(
    async (key: string) => {
      void setRowStatus(key, "committed");
      // Clear any prior outcome-ack so re-engaging shows the prompt.
      setOutcomeAck((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      safeLog("intervention_started");
      if (acceptFiredRef.current) return;
      if (intervention.status !== "shown") {
        acceptFiredRef.current = true;
        return;
      }
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
      safeLog("intervention_skipped");
    },
    [setRowStatus],
  );

  const handleRowOutcome = useCallback(
    (key: string, outcome: "better" | "no_change" | "worse") => {
      void setRowStatus(key, outcome);
      // Reset outcome-ack so the no_change branch shows its panel
      // again on a fresh transition.
      setOutcomeAck((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (outcome === "better") safeLog("intervention_feedback_better");
      else if (outcome === "no_change") safeLog("intervention_feedback_no_change");
      else safeLog("intervention_feedback_worse");
    },
    [setRowStatus],
  );

  const handleRowTryAnother = useCallback(
    (key: string) => {
      void setRowStatus(key, null);
      setOutcomeAck((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [setRowStatus],
  );

  const handleRowShowAlternate = useCallback(
    (key: string) => {
      setSectionAlt((prev) => ({ ...prev, [key]: !prev[key] }));
      void setRowStatus(key, null);
      setOutcomeAck((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      safeLog("intervention_alternative_requested");
    },
    [setRowStatus],
  );

  const handleRowSkipForToday = useCallback(
    (key: string) => {
      void setRowStatus(key, "skipped");
    },
    [setRowStatus],
  );

  const handleRowKeepTracking = useCallback((key: string) => {
    setOutcomeAck((prev) => ({ ...prev, [key]: true }));
  }, []);

  const handleRowAskCareTeam = useCallback(
    async (_key: string) => {
      if (intervention.status === "escalated") return;
      if (escalateFiredRef.current) return;
      escalateFiredRef.current = true;
      safeLog("care_team_escalation_requested");
      try {
        if (intervention.status === "shown") {
          acceptFiredRef.current = true;
          try {
            await onAccept(intervention.id);
          } catch {
            /* best-effort; /feedback below will surface real error */
          }
        }
        await onFeedback(intervention.id, "worse");
      } catch {
        escalateFiredRef.current = false;
      }
    },
    [intervention.id, intervention.status, onAccept, onFeedback],
  );

  // Reference unused legacy handlers + state so TS stays quiet.
  void onDismiss;
  void onEscalate;
  void busy;
  void setBusy;

  if (status === "resolved" || status === "expired" || status === "dismissed") {
    return null;
  }

  // -- Derived view-model -------------------------------------------
  const totalRows = orderedRows.length;
  const startedRows = orderedRows.filter((r) => {
    const s = sectionStatus[r.key];
    return s === "committed" || s === "better" || s === "no_change" || s === "worse";
  }).length;

  const primary = orderedRows[0];
  const secondaries = orderedRows.slice(1);

  // "What Viva noticed" upgrade: append a "<Symptom> is the best place
  // to start because <reason>." sentence using the primary category.
  // Falls back to the server's text alone if there are no rows.
  const noticedText = useMemo(() => {
    const base = (intervention.whatWeNoticed ?? "").trim();
    if (!primary) return base;
    const noun = SHORT_NOUN[primary.category];
    const reason = BEST_PLACE_REASON[primary.category];
    const suffix = ` ${noun} is the best place to start because ${reason}.`;
    return base ? `${base}${suffix}` : suffix.trim();
  }, [intervention.whatWeNoticed, primary]);

  const supportiveCount = Math.max(totalRows - 1, 0);
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
      {/* -- Header ------------------------------------------------- */}
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
            Today&apos;s support plan
          </Text>
          <Text style={[styles.subtitle, { color: mutedForeground }]}>
            Viva prioritized the steps most likely to help based on
            today&apos;s check-in.
          </Text>
        </View>
      </View>

      {/* -- What Viva noticed ------------------------------------- */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: mutedForeground }]}>
          What Viva noticed
        </Text>
        <Text style={[styles.sectionBody, { color: navy }]}>
          {noticedText}
        </Text>
      </View>

      {/* -- Issue summary chips ----------------------------------- */}
      {totalRows > 0 && (
        <View
          style={styles.summaryRow}
          accessibilityRole="summary"
          accessibilityLabel={`${totalRows} issues surfaced. 1 needs attention now. ${supportiveCount} supportive ${supportiveCount === 1 ? "step" : "steps"}.`}
        >
          <SummaryChip
            value={String(totalRows)}
            label={totalRows === 1 ? "issue surfaced" : "issues surfaced"}
            tone="neutral"
            mutedForeground={mutedForeground}
            navy={navy}
          />
          <SummaryChip
            value="1"
            label="needs attention now"
            tone="primary"
            mutedForeground={mutedForeground}
            navy={navy}
          />
          <SummaryChip
            value={String(supportiveCount)}
            label={supportiveCount === 1 ? "supportive step" : "supportive steps"}
            tone="neutral"
            mutedForeground={mutedForeground}
            navy={navy}
          />
        </View>
      )}

      {/* -- Progress tracker -------------------------------------- */}
      {totalRows > 0 && (
        <View
          style={styles.progressWrap}
          accessibilityRole="progressbar"
          accessibilityLabel={`${startedRows} of ${totalRows} steps started`}
          accessibilityValue={{ min: 0, max: totalRows, now: startedRows }}
        >
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: mutedForeground }]}>
              {startedRows} of {totalRows} steps started
            </Text>
          </View>
          <View
            style={[styles.progressTrack, { backgroundColor: FEATURED_BORDER }]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: accent,
                  width: `${totalRows > 0 ? (startedRows / totalRows) * 100 : 0}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* -- Primary "Start here" card ------------------------------ */}
      {primary && (
        <RecommendationRow
          variant="primary"
          label={primary.title}
          body={
            sectionAlt[primary.key]
              ? FALLBACK_ALTERNATES[primary.category]
              : primary.section.body
          }
          isAlternate={!!sectionAlt[primary.key]}
          category={primary.category}
          status={sectionStatus[primary.key] ?? null}
          outcomeAcknowledged={!!outcomeAck[primary.key]}
          navy={navy}
          mutedForeground={mutedForeground}
          border={background}
          accent={accent}
          warning={warning}
          onCommit={() => handleRowCommit(primary.key)}
          onDecline={() => handleRowDecline(primary.key)}
          onOutcome={(outcome) => handleRowOutcome(primary.key, outcome)}
          onTryAnother={() => handleRowTryAnother(primary.key)}
          onShowAlternate={() => handleRowShowAlternate(primary.key)}
          onSkipForToday={() => handleRowSkipForToday(primary.key)}
          onKeepTracking={() => handleRowKeepTracking(primary.key)}
          onAskCareTeam={() => handleRowAskCareTeam(primary.key)}
        />
      )}

      {/* -- Secondary compact rows -------------------------------- */}
      {secondaries.length > 0 && (
        <View style={styles.rowsWrap}>
          {secondaries.map((r) => (
            <RecommendationRow
              key={r.key}
              variant="secondary"
              label={r.title}
              body={
                sectionAlt[r.key]
                  ? FALLBACK_ALTERNATES[r.category]
                  : r.section.body
              }
              isAlternate={!!sectionAlt[r.key]}
              category={r.category}
              status={sectionStatus[r.key] ?? null}
              outcomeAcknowledged={!!outcomeAck[r.key]}
              navy={navy}
              mutedForeground={mutedForeground}
              border={background}
              accent={accent}
              warning={warning}
              onCommit={() => handleRowCommit(r.key)}
              onDecline={() => handleRowDecline(r.key)}
              onOutcome={(outcome) => handleRowOutcome(r.key, outcome)}
              onTryAnother={() => handleRowTryAnother(r.key)}
              onShowAlternate={() => handleRowShowAlternate(r.key)}
              onSkipForToday={() => handleRowSkipForToday(r.key)}
              onKeepTracking={() => handleRowKeepTracking(r.key)}
              onAskCareTeam={() => handleRowAskCareTeam(r.key)}
            />
          ))}
        </View>
      )}

      {status === "escalated" && (
        <View style={styles.escalatedRow}>
          <Feather name="alert-circle" size={14} color={warning} />
          <Text style={[styles.escalatedText, { color: warning }]}>
            Your care team will follow up.
          </Text>
        </View>
      )}

      {/* -- Clinical guardrail footer ----------------------------- */}
      <Text
        style={[styles.guardrail, { color: mutedForeground }]}
        accessibilityRole="text"
      >
        Viva supports between-visit care. If symptoms feel severe or
        urgent, contact your care team or seek medical help.
      </Text>
    </Animated.View>
  );
}

// =====================================================================
// SummaryChip -- compact stat chip in the issue summary module.
// =====================================================================
interface SummaryChipProps {
  value: string;
  label: string;
  tone: "primary" | "neutral";
  navy: string;
  mutedForeground: string;
}

function SummaryChip({
  value,
  label,
  tone,
  navy,
  mutedForeground,
}: SummaryChipProps) {
  const isPrimary = tone === "primary";
  return (
    <View
      style={[
        styles.summaryChip,
        {
          backgroundColor: isPrimary ? FEATURED_BADGE_BG : "#FFFFFF",
          borderColor: isPrimary ? PRIMARY_BORDER : FEATURED_BORDER,
        },
      ]}
    >
      <Text
        style={[
          styles.summaryChipValue,
          { color: isPrimary ? FEATURED_BADGE_FG : navy },
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.summaryChipLabel,
          { color: isPrimary ? FEATURED_BADGE_FG : mutedForeground },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

// =====================================================================
// RecommendationRow -- one labeled support row inside the master card.
// Renders as either the primary "Start here" card or a compact
// secondary row, sharing the per-row state machine + handlers.
// =====================================================================
interface RecommendationRowProps {
  variant: "primary" | "secondary";
  label: string;
  body: string;
  isAlternate: boolean;
  category: RecCategory;
  status: SectionStatus | null;
  outcomeAcknowledged: boolean;
  navy: string;
  mutedForeground: string;
  border: string;
  accent: string;
  warning: string;
  onCommit: () => void;
  onDecline: () => void;
  onOutcome: (outcome: "better" | "no_change" | "worse") => void;
  onTryAnother: () => void;
  onShowAlternate: () => void;
  onSkipForToday: () => void;
  onKeepTracking: () => void;
  onAskCareTeam: () => void;
}

function statusChip(status: SectionStatus | null, warning: string, accent: string): {
  label: string;
  bg: string;
  fg: string;
  icon: keyof typeof Feather.glyphMap;
} {
  switch (status) {
    case "committed":
      return { label: "Started", bg: accent + "22", fg: accent, icon: "play" };
    case "not_for_me":
      return {
        label: "Skipped",
        bg: CHIP_TRACKING_BG,
        fg: CHIP_TRACKING_FG,
        icon: "x",
      };
    case "skipped":
      return {
        label: "Skipped",
        bg: CHIP_TRACKING_BG,
        fg: CHIP_TRACKING_FG,
        icon: "x",
      };
    case "better":
      return {
        label: "Helped",
        bg: CHIP_HELPED_BG,
        fg: CHIP_HELPED_FG,
        icon: "smile",
      };
    case "no_change":
      return {
        label: "Still tracking",
        bg: CHIP_TRACKING_BG,
        fg: CHIP_TRACKING_FG,
        icon: "meh",
      };
    case "worse":
      return {
        label: "Needs follow-up",
        bg: warning + "22",
        fg: warning,
        icon: "alert-circle",
      };
    default:
      return { label: "Ready", bg: CHIP_READY_BG, fg: CHIP_READY_FG, icon: "circle" };
  }
}

function RecommendationRow({
  variant,
  label,
  body,
  isAlternate,
  category,
  status,
  outcomeAcknowledged,
  navy,
  mutedForeground,
  border,
  accent,
  warning,
  onCommit,
  onDecline,
  onOutcome,
  onTryAnother,
  onShowAlternate,
  onSkipForToday,
  onKeepTracking,
  onAskCareTeam,
}: RecommendationRowProps) {
  const tap = () => {
    try {
      Haptics.selectionAsync();
    } catch {
      /* best-effort */
    }
  };

  const isPrimary = variant === "primary";
  const titleA11y = label.toLowerCase();
  const chip = statusChip(status, warning, accent);
  const timing = TIMING_BY_CATEGORY[category];
  const rationale = RATIONALE_BY_CATEGORY[category];

  // Surface tint reflects state; primary always uses the white
  // foreground surface for emphasis, secondary uses the soft slate.
  const baseSurface = isPrimary ? PRIMARY_SURFACE : SECONDARY_SURFACE;
  const baseBorder = isPrimary ? PRIMARY_BORDER : SECONDARY_BORDER;
  const surfaceTint =
    status === "worse"
      ? warning + "12"
      : status === "better"
        ? "#34C7591A"
        : status === "committed"
          ? accent + "0E"
          : status === "no_change"
            ? mutedForeground + "0E"
            : status === "not_for_me" || status === "skipped"
              ? mutedForeground + "08"
              : baseSurface;
  const surfaceBorder =
    status === "worse"
      ? warning + "66"
      : status === "better"
        ? "#34C75955"
        : status === "committed"
          ? accent + "44"
          : status === "not_for_me" || status === "no_change" || status === "skipped"
            ? mutedForeground + "33"
            : baseBorder;

  const offerEscalation = shouldOfferEscalation(category, status);

  return (
    <View
      style={[
        isPrimary ? styles.primaryCard : styles.recRow,
        { borderColor: surfaceBorder, backgroundColor: surfaceTint },
      ]}
    >
      {/* Primary: "Start here" badge above title */}
      {isPrimary && (
        <View style={styles.startHerePillRow}>
          <View
            style={[
              styles.startHerePill,
              { backgroundColor: START_HERE_BG },
            ]}
          >
            <Feather name="zap" size={10} color={START_HERE_FG} />
            <Text style={[styles.startHerePillText, { color: START_HERE_FG }]}>
              Start here
            </Text>
          </View>
        </View>
      )}

      <View style={styles.recHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[
              isPrimary ? styles.primaryTitle : styles.recLabel,
              {
                color: navy,
                opacity: status === "not_for_me" || status === "skipped" ? 0.7 : 1,
              },
            ]}
          >
            {label}
          </Text>
          {isPrimary && (
            <Text
              style={[styles.primarySubtitle, { color: mutedForeground }]}
            >
              Most important next step
            </Text>
          )}
        </View>
        <View
          style={[styles.recStatusPill, { backgroundColor: chip.bg }]}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${titleA11y} status: ${chip.label}`}
        >
          <Feather name={chip.icon} size={10} color={chip.fg} />
          <Text style={[styles.recStatusText, { color: chip.fg }]}>
            {chip.label}
          </Text>
        </View>
      </View>

      {/* Timing badge -- compact pill on the row */}
      <View style={styles.timingRow}>
        <View
          style={[
            styles.timingPill,
            { borderColor: border, backgroundColor: "#FFFFFF" },
          ]}
        >
          <Feather name="clock" size={10} color={mutedForeground} />
          <Text style={[styles.timingText, { color: mutedForeground }]}>
            {timing}
          </Text>
        </View>
        {isAlternate && (
          <View
            style={[
              styles.altPill,
              { borderColor: border, backgroundColor: "#FFFFFF" },
            ]}
          >
            <Feather name="refresh-cw" size={10} color={mutedForeground} />
            <Text style={[styles.timingText, { color: mutedForeground }]}>
              Alternate
            </Text>
          </View>
        )}
      </View>

      <Text
        style={[
          isPrimary ? styles.primaryBody : styles.recBody,
          {
            color: navy,
            opacity: status === "not_for_me" || status === "skipped" ? 0.65 : 1,
          },
        ]}
      >
        {body}
      </Text>

      {/* Primary card carries the rationale + time cue lines */}
      {isPrimary && status == null && (
        <>
          <Text style={[styles.primaryRationale, { color: mutedForeground }]}>
            {rationale}
          </Text>
        </>
      )}

      {/* -- Default: I'll try this / Not for me ---------------------- */}
      {status == null && (
        <View style={styles.recButtonRow}>
          <Pressable
            onPress={() => {
              tap();
              onCommit();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Start ${titleA11y}`}
            style={({ pressed }) => [
              styles.recButton,
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
              I&apos;ll try this
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tap();
              onDecline();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Skip ${titleA11y}`}
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

      {/* -- Committed: outcome prompt -------------------------------- */}
      {status === "committed" && (
        <View style={styles.recOutcomeWrap}>
          <Text style={[styles.recOutcomePrompt, { color: navy }]}>
            Once you&apos;ve tried it, how do you feel?
          </Text>
          <View style={styles.recOutcomeRow}>
            <OutcomeButton
              label="Better"
              icon="smile"
              tint={CHIP_HELPED_FG}
              border={border}
              onPress={() => {
                tap();
                onOutcome("better");
              }}
              accessibilityLabel={`${titleA11y} helped`}
            />
            <OutcomeButton
              label="No change"
              icon="meh"
              tint={mutedForeground}
              border={border}
              onPress={() => {
                tap();
                onOutcome("no_change");
              }}
              accessibilityLabel={`No change after ${titleA11y}`}
            />
            <OutcomeButton
              label="Worse"
              icon="frown"
              tint={warning}
              border={border}
              onPress={() => {
                tap();
                onOutcome("worse");
              }}
              accessibilityLabel={`${titleA11y} got worse`}
            />
          </View>
          <Text style={[styles.helperCopy, { color: mutedForeground }]}>
            Viva will use this to personalize your next step.
          </Text>
        </View>
      )}

      {/* -- Not for me: alternate / skip-for-today panel -------------- */}
      {status === "not_for_me" && (
        <View style={styles.recOutcomeWrap}>
          <Text style={[styles.recOutcomePrompt, { color: navy }]}>
            Got it. Want a different option?
          </Text>
          <View style={styles.recButtonRow}>
            <Pressable
              onPress={() => {
                tap();
                onShowAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Show another option for ${titleA11y}`}
              style={({ pressed }) => [
                styles.recButton,
                {
                  borderColor: accent,
                  backgroundColor: accent,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="refresh-cw" size={12} color="#FFFFFF" />
              <Text
                style={[
                  styles.recButtonText,
                  { color: "#FFFFFF", fontWeight: "700" },
                ]}
              >
                Show another option
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onSkipForToday();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Skip ${titleA11y} for today`}
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
                Skip for today
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* -- No change: supportive next-step panel -------------------- */}
      {status === "no_change" && !outcomeAcknowledged && (
        <View style={styles.recOutcomeWrap}>
          <Text style={[styles.recOutcomePrompt, { color: navy }]}>
            Thanks. Let&apos;s keep watching this today.
          </Text>
          <View style={styles.recButtonRow}>
            <Pressable
              onPress={() => {
                tap();
                onShowAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Try another step for ${titleA11y}`}
              style={({ pressed }) => [
                styles.recButton,
                {
                  borderColor: accent,
                  backgroundColor: accent,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="refresh-cw" size={12} color="#FFFFFF" />
              <Text
                style={[
                  styles.recButtonText,
                  { color: "#FFFFFF", fontWeight: "700" },
                ]}
              >
                Try another step
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onKeepTracking();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Keep tracking ${titleA11y}`}
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
                Keep tracking
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* -- Worse: escalation panel (only path to care team) --------- */}
      {status === "worse" && offerEscalation && (
        <View style={styles.recEscalateWrap}>
          <Text style={[styles.recEscalateCopy, { color: navy }]}>
            Sorry that got worse. Viva can suggest another step now or
            flag this for your care team.
          </Text>
          <View style={styles.recButtonRow}>
            <Pressable
              onPress={() => {
                tap();
                onShowAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Try another step for ${titleA11y}`}
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
                Try another step
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onAskCareTeam();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ask care team about ${titleA11y}`}
              style={({ pressed }) => [
                styles.recButton,
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

      {/* -- Terminal positive / declined / acknowledged: undo affordance ----- */}
      {(status === "better" ||
        status === "skipped" ||
        (status === "no_change" && outcomeAcknowledged)) && (
        <Pressable
          onPress={() => {
            tap();
            onTryAnother();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Change response for ${titleA11y}`}
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
    padding: 16,
    gap: 12,
    borderWidth: 1,
  },
  cardFeatured: {
    borderWidth: 1.5,
    ...Platform.select({
      web: {
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
    lineHeight: 16,
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
  // -- Issue summary chips ------------------------------------------
  summaryRow: {
    flexDirection: "row",
    gap: 6,
  },
  summaryChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  summaryChipValue: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  summaryChipLabel: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 12,
  },
  // -- Progress tracker ---------------------------------------------
  progressWrap: {
    gap: 6,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  // -- Escalation row at the card level -----------------------------
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
  // -- Secondary rows -----------------------------------------------
  rowsWrap: {
    gap: 6,
  },
  recRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 6,
  },
  // -- Primary "Start here" card ------------------------------------
  primaryCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    ...Platform.select({
      web: {
        boxShadow: "0 2px 8px rgba(31, 79, 138, 0.08)",
      },
      default: {
        shadowColor: "#1F4F8A",
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      },
    }),
  },
  startHerePillRow: {
    flexDirection: "row",
  },
  startHerePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  startHerePillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  primaryTitle: {
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 20,
  },
  primarySubtitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  primaryBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  primaryRationale: {
    fontSize: 12,
    lineHeight: 16,
    fontStyle: "italic",
  },
  // -- Row header / chips -------------------------------------------
  recHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
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
  // -- Timing / alternate pill row ----------------------------------
  timingRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  timingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  altPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  timingText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  // -- Buttons ------------------------------------------------------
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
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  recButtonText: {
    fontSize: 12,
  },
  // -- Status pill --------------------------------------------------
  recStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  recStatusText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  // -- Outcome ------------------------------------------------------
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
  helperCopy: {
    fontSize: 11,
    lineHeight: 14,
    fontStyle: "italic",
  },
  // -- Worse panel --------------------------------------------------
  recEscalateWrap: {
    gap: 8,
    marginTop: 2,
  },
  recEscalateCopy: {
    fontSize: 12,
    lineHeight: 17,
  },
  // -- Undo affordance ----------------------------------------------
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
  // -- Clinical guardrail footer ------------------------------------
  guardrail: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
    fontStyle: "italic",
  },
});
