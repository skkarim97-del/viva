// Today-tab card that surfaces an AI-personalized micro-intervention.
//
// Patient-facing UX (simplified rework):
//   Title:    "Today's next steps"
//   Subtitle: "Based on your check-in, here's what may help today."
//   Section:  "What we noticed"
//             A short, plain-language sentence built from the symptom
//             categories present in the synthesized recommendation.
//   Primary:  One prominent action card for the highest-priority
//             symptom. Action-oriented title (e.g. "Eat something
//             light and sip water slowly"), short body, helper line,
//             and two buttons: "I'll try this" / "Another idea".
//             "Another idea" toggles the body to a category fallback
//             alternate and changes the buttons to
//             "I'll try this" / "Back".
//   Section:  "Other things that may help today" -- compact secondary
//             rows for the remaining symptoms with a small "Try this"
//             button each.
//   Footer:   Subtle clinical guardrail copy.
//
// Per-row state machine (preserved from the prior rework):
//   default   -> "I'll try this" (+ "Another idea" on primary)
//   committed -> "How do you feel after trying it?" ->
//                 Better / About the same / Worse
//   better    -> "Glad that helped" + change-response link
//   no_change -> "Thanks -- we'll keep watching this." + link
//   worse     -> "Sorry that didn't help. Would you like another
//                 suggestion or support from your care team?" ->
//                 "Try another idea" / "Ask my care team"
//
// Server contract (preserved):
//   - First per-row "I'll try this" tap fires onAccept ONCE per
//     session (shown -> pending_feedback). Subsequent commits don't
//     re-fire.
//   - "Ask my care team" from the worse panel is the SINGLE point
//     that calls onFeedback("worse"); the server treats that as the
//     auto-escalation signal. Per-row Better/Same outcomes stay
//     LOCAL so one row's Better never overwrites another row's
//     Worse in flight.
//   - All network calls are best-effort; errors leave the card in
//     its current state.

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
// Recommendation parsing
// =====================================================================
// The backend `recommendation` field is plain text, optionally
// composed of multiple `\n\n`-separated sections shaped as
// "<Label>: <body>". We surface each as a row with its own state.

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
// Category mapping, priority, friendly copy
// =====================================================================
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

// Priority rank: lower = more urgent. Severity (numeric, higher =
// more severe) bumps nausea + intake categories.
function priorityRank(cat: RecCategory, severity: number | null | undefined): number {
  const sev = typeof severity === "number" ? severity : 0;
  const isSevere = sev >= 4;
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

// Action-oriented headline for the primary card. Replaces the
// clinical "Nausea support"-style label with something a patient can
// act on.
const ACTION_TITLE: Record<RecCategory, string> = {
  nausea: "Eat something light and sip water slowly",
  appetite: "Add a protein-rich snack later",
  energy: "Take a short break to rest",
  constipation: "Add fiber and keep sipping water",
  hydration: "Sip water steadily through the day",
  other: "Try a small step that feels manageable",
};

// Short title for compact secondary rows. Same plain language style.
const SHORT_TITLE: Record<RecCategory, string> = {
  nausea: "Eat something light",
  appetite: "Add a protein-rich snack later",
  energy: "Take a short break to rest",
  constipation: "Add fiber and keep sipping water",
  hydration: "Sip water steadily",
  other: "Try a small supportive step",
};

// One-line "this may help with..." line shown beneath the primary
// card body. Kept warm and non-clinical.
const HELPER_LINE: Record<RecCategory, string> = {
  nausea: "This may help with nausea and make eating feel easier.",
  appetite: "This may help your energy and recovery between meals.",
  energy: "This may help your energy through the day.",
  constipation: "This may help things feel more comfortable.",
  hydration: "Steady sips help most other symptoms feel easier.",
  other: "Small steps can add up across the day.",
};

// Plain-language fragment used to compose the "What we noticed"
// sentence. Joined with commas + "and" before the last item.
const NOTICED_PHRASE: Record<RecCategory, string> = {
  nausea: "nausea",
  appetite: "low appetite",
  energy: "low energy",
  constipation: "constipation",
  hydration: "low hydration",
  other: "some symptoms",
};

// Single fallback alternate per category. "Another idea" toggles to
// this copy and changes the buttons to "I'll try this" / "Back".
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

// Per-row state machine. Each row drives its own progression.
type SectionStatus =
  | "committed"
  | "not_for_me"
  | "skipped"
  | "better"
  | "no_change"
  | "worse";

// Statuses that have a render branch in the simplified UX. Legacy
// values from the prior rework ("not_for_me", "skipped") and the
// even-older "did/skipped" model are intentionally NOT in this set --
// they have no panel in the new flow, so a row stuck in one of them
// would render body text with no actionable controls. We coerce them
// to null on hydration so the row falls back to the default
// "I'll try this / Another idea" state.
const VALID_STATUSES: ReadonlySet<string> = new Set([
  "committed",
  "better",
  "no_change",
  "worse",
]);

function coercePersistedStatus(raw: string | null): SectionStatus | null {
  if (!raw) return null;
  if (VALID_STATUSES.has(raw)) return raw as SectionStatus;
  if (raw === "did") return "committed";
  // Legacy "not_for_me" / "skipped" -> drop back to default so the
  // row stays interactive instead of dead-ending the patient.
  return null;
}

// Returns true when the row should expose the "Ask my care team"
// affordance. Currently fires on "worse" only.
// TODO: when historical patient_intervention data is wired in, also
// escalate when the same category has been "no_change" repeatedly or
// "not_for_me" multiple times across recent check-ins.
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

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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
// Primary action card surface (white, soft shadow) reads as the most
// important next step without screaming.
const PRIMARY_SURFACE = "#FFFFFF";
const PRIMARY_BORDER = "#7FB0E8";
// Secondary row: compact, muted; less surface area = less clutter.
const SECONDARY_SURFACE = "#F5F8FC";
const SECONDARY_BORDER = "#D5E1F0";
const START_HERE_BG = "#1F4F8A";
const START_HERE_FG = "#FFFFFF";
const SUCCESS_FG = "#1F8A3F";

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
    /* analytics is fire-and-forget */
  }
}

export function InterventionCard({
  intervention,
  // Theme `navy` / `mutedForeground` / `background` are intentionally
  // shadowed because the featured card uses a fixed light blue
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

  // -- Section parsing + sorting ------------------------------------
  const sections = useMemo(
    () => parseRecommendationSections(intervention.recommendation),
    [intervention.recommendation],
  );
  const sectionKeys = useMemo(
    () => buildRowKeys(intervention.id, sections),
    [intervention.id, sections],
  );

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

  // -- Per-row local state ------------------------------------------
  const [sectionStatus, setSectionStatus] = useState<
    Record<string, SectionStatus>
  >({});
  const [sectionAlt, setSectionAlt] = useState<Record<string, boolean>>({});

  // Race-safety for AsyncStorage:
  //   (a) Hydration race -- multiGet may resolve AFTER a user tap.
  //       Hydration only fills keys the user hasn't touched.
  //   (b) Rapid-tap write race -- writes are serialized per key via
  //       a promise chain so the LAST tap's value is always what
  //       ends up persisted.
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
  // this card during this session. First commit transitions the
  // intervention server-side from "shown" -> "pending_feedback".
  const acceptFiredRef = useRef(false);
  // Card-level "fired worse to server" tracker. Independent of the
  // per-row state machine.
  const escalateFiredRef = useRef(false);
  // Fire `intervention_plan_viewed` once per intervention id.
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
      // Apply in-memory state immediately.
      setSectionStatus((prev) => {
        const next = { ...prev };
        if (value == null) delete next[key];
        else next[key] = value;
        return next;
      });
      // Serialize the persistence write behind any prior in-flight
      // write on the same key so out-of-order setItem awaits don't
      // leave stale data on disk.
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
        // If the call FAILS and the server is still "shown", clear
        // the guard so a later commit (or the worse-panel pre-accept
        // path) can retry.
        if (intervention.status === "shown") {
          acceptFiredRef.current = false;
        }
      }
    },
    [setRowStatus, intervention.id, intervention.status, onAccept],
  );

  const handleRowOutcome = useCallback(
    (key: string, outcome: "better" | "no_change" | "worse") => {
      void setRowStatus(key, outcome);
      if (outcome === "better") safeLog("intervention_feedback_better");
      else if (outcome === "no_change") safeLog("intervention_feedback_no_change");
      else safeLog("intervention_feedback_worse");
    },
    [setRowStatus],
  );

  const handleRowReset = useCallback(
    (key: string) => {
      void setRowStatus(key, null);
    },
    [setRowStatus],
  );

  const handleRowToggleAlternate = useCallback(
    (key: string) => {
      setSectionAlt((prev) => {
        const wasShowing = !!prev[key];
        if (!wasShowing) safeLog("intervention_alternative_requested");
        return { ...prev, [key]: !wasShowing };
      });
      // Reset the row to default so the patient can tap "I'll try
      // this" on the alternate copy.
      void setRowStatus(key, null);
    },
    [setRowStatus],
  );

  const handleRowAskCareTeam = useCallback(
    async (_key: string) => {
      if (intervention.status === "escalated") return;
      if (escalateFiredRef.current) return;
      escalateFiredRef.current = true;
      safeLog("care_team_escalation_requested");
      try {
        // /feedback's status guard requires accepted/pending_feedback.
        // If the card is still "shown", pre-accept first so the
        // /feedback below doesn't 409.
        if (intervention.status === "shown") {
          acceptFiredRef.current = true;
          try {
            await onAccept(intervention.id);
          } catch {
            /* /feedback below will surface the real error */
          }
        }
        await onFeedback(intervention.id, "worse");
      } catch {
        escalateFiredRef.current = false;
      }
    },
    [intervention.id, intervention.status, onAccept, onFeedback],
  );

  // "What we noticed" -- short plain-language sentence built from the
  // categories present in this intervention. Falls back to the
  // server's text only when we couldn't resolve any rows.
  // NOTE: declared BEFORE any conditional early return so the hook
  // count stays stable across renders (status transitions to
  // resolved/expired/dismissed return null below).
  const noticedSentence = useMemo(() => {
    if (orderedRows.length === 0) {
      return (intervention.whatWeNoticed ?? "").trim();
    }
    // De-dupe categories (a category should only appear once in the
    // sentence even if the synthesizer surfaced two rows for it).
    const phrases: string[] = [];
    const seen = new Set<RecCategory>();
    for (const r of orderedRows) {
      if (seen.has(r.category)) continue;
      seen.add(r.category);
      phrases.push(NOTICED_PHRASE[r.category]);
    }
    return `You reported ${joinList(phrases)} today.`;
  }, [orderedRows, intervention.whatWeNoticed]);

  // Reference unused legacy props/state so TS stays quiet.
  void onDismiss;
  void onEscalate;
  void busy;
  void setBusy;

  if (status === "resolved" || status === "expired" || status === "dismissed") {
    return null;
  }

  // -- Derived view-model -------------------------------------------
  const primary = orderedRows[0];
  const secondaries = orderedRows.slice(1);

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
            Today&apos;s next steps
          </Text>
          <Text style={[styles.subtitle, { color: mutedForeground }]}>
            Based on your check-in, here&apos;s what may help today.
          </Text>
        </View>
      </View>

      {/* -- What we noticed --------------------------------------- */}
      {noticedSentence.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: mutedForeground }]}>
            What we noticed
          </Text>
          <Text style={[styles.sectionBody, { color: navy }]}>
            {noticedSentence}
          </Text>
        </View>
      )}

      {/* -- Primary action ---------------------------------------- */}
      {primary && (
        <PrimaryActionCard
          category={primary.category}
          originalBody={primary.section.body}
          showingAlternate={!!sectionAlt[primary.key]}
          status={sectionStatus[primary.key] ?? null}
          navy={navy}
          mutedForeground={mutedForeground}
          border={background}
          accent={accent}
          warning={warning}
          onCommit={() => handleRowCommit(primary.key)}
          onToggleAlternate={() => handleRowToggleAlternate(primary.key)}
          onOutcome={(outcome) => handleRowOutcome(primary.key, outcome)}
          onReset={() => handleRowReset(primary.key)}
          onAskCareTeam={() => handleRowAskCareTeam(primary.key)}
        />
      )}

      {/* -- Secondary rows ---------------------------------------- */}
      {secondaries.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: mutedForeground }]}>
            Other things that may help today
          </Text>
          <View style={styles.rowsWrap}>
            {secondaries.map((r) => (
              <SecondaryActionRow
                key={r.key}
                category={r.category}
                originalBody={r.section.body}
                showingAlternate={!!sectionAlt[r.key]}
                status={sectionStatus[r.key] ?? null}
                navy={navy}
                mutedForeground={mutedForeground}
                border={background}
                accent={accent}
                warning={warning}
                onCommit={() => handleRowCommit(r.key)}
                onToggleAlternate={() => handleRowToggleAlternate(r.key)}
                onOutcome={(outcome) => handleRowOutcome(r.key, outcome)}
                onReset={() => handleRowReset(r.key)}
                onAskCareTeam={() => handleRowAskCareTeam(r.key)}
              />
            ))}
          </View>
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

      {/* -- Subtle clinical guardrail footer ---------------------- */}
      <Text style={[styles.guardrail, { color: mutedForeground }]}>
        Viva supports between-visit care. If symptoms feel severe or
        urgent, contact your care team or seek medical help.
      </Text>
    </Animated.View>
  );
}

// =====================================================================
// PrimaryActionCard -- the prominent "Start with this" card.
// =====================================================================
interface ActionRowProps {
  category: RecCategory;
  originalBody: string;
  showingAlternate: boolean;
  status: SectionStatus | null;
  navy: string;
  mutedForeground: string;
  border: string;
  accent: string;
  warning: string;
  onCommit: () => void;
  onToggleAlternate: () => void;
  onOutcome: (outcome: "better" | "no_change" | "worse") => void;
  onReset: () => void;
  onAskCareTeam: () => void;
}

function tap(): void {
  try {
    Haptics.selectionAsync();
  } catch {
    /* best-effort */
  }
}

function PrimaryActionCard({
  category,
  originalBody,
  showingAlternate,
  status,
  navy,
  mutedForeground,
  border,
  accent,
  warning,
  onCommit,
  onToggleAlternate,
  onOutcome,
  onReset,
  onAskCareTeam,
}: ActionRowProps) {
  const title = ACTION_TITLE[category];
  const helper = HELPER_LINE[category];
  const body = showingAlternate ? FALLBACK_ALTERNATES[category] : originalBody;
  const titleA11y = title.toLowerCase();
  const offerEscalation = shouldOfferEscalation(category, status);

  return (
    <View
      style={[
        styles.primaryCard,
        { borderColor: PRIMARY_BORDER, backgroundColor: PRIMARY_SURFACE },
      ]}
    >
      <View style={styles.startHerePillRow}>
        <View style={[styles.startHerePill, { backgroundColor: START_HERE_BG }]}>
          <Feather name="zap" size={10} color={START_HERE_FG} />
          <Text style={[styles.startHerePillText, { color: START_HERE_FG }]}>
            Start with this
          </Text>
        </View>
      </View>

      <Text style={[styles.primaryTitle, { color: navy }]}>{title}</Text>
      <Text style={[styles.primaryBody, { color: navy }]}>{body}</Text>

      {/* Helper line only on the default state -- once the patient
          has acted, the row becomes a feedback prompt and we keep
          the surface uncluttered. */}
      {status == null && (
        <Text style={[styles.helperLine, { color: mutedForeground }]}>
          {helper}
        </Text>
      )}

      {/* -- Default: I'll try this / Another idea (or Back) ------- */}
      {status == null && (
        <View style={styles.btnRow}>
          <Pressable
            onPress={() => {
              tap();
              onCommit();
            }}
            accessibilityRole="button"
            accessibilityLabel={`I will try this: ${titleA11y}`}
            style={({ pressed }) => [
              styles.btnPrimary,
              {
                borderColor: accent,
                backgroundColor: accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="check" size={13} color="#FFFFFF" />
            <Text style={[styles.btnText, { color: "#FFFFFF", fontWeight: "700" }]}>
              I&apos;ll try this
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tap();
              onToggleAlternate();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              showingAlternate
                ? `Go back to original suggestion for ${titleA11y}`
                : `Show another idea for ${titleA11y}`
            }
            style={({ pressed }) => [
              styles.btnSecondary,
              { borderColor: border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={[styles.btnText, { color: mutedForeground, fontWeight: "600" }]}>
              {showingAlternate ? "Back" : "Another idea"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* -- Committed: outcome prompt ----------------------------- */}
      {status === "committed" && (
        <View style={styles.outcomeWrap}>
          <Text style={[styles.outcomePrompt, { color: navy }]}>
            How do you feel after trying it?
          </Text>
          <View style={styles.outcomeRow}>
            <OutcomeButton
              label="Better"
              icon="smile"
              tint={SUCCESS_FG}
              border={border}
              onPress={() => {
                tap();
                onOutcome("better");
              }}
              accessibilityLabel={`Feeling better after ${titleA11y}`}
            />
            <OutcomeButton
              label="About the same"
              icon="meh"
              tint={mutedForeground}
              border={border}
              onPress={() => {
                tap();
                onOutcome("no_change");
              }}
              accessibilityLabel={`About the same after ${titleA11y}`}
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
              accessibilityLabel={`Worse after ${titleA11y}`}
            />
          </View>
        </View>
      )}

      {/* -- Better -- quiet acknowledgement ----------------------- */}
      {status === "better" && (
        <AcknowledgeRow
          icon="smile"
          tint={SUCCESS_FG}
          text="Glad that helped."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {/* -- About the same -- quiet acknowledgement --------------- */}
      {status === "no_change" && (
        <AcknowledgeRow
          icon="meh"
          tint={mutedForeground}
          text="Thanks -- we'll keep watching this."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {/* -- Worse: escalation panel (only path to care team) ------ */}
      {status === "worse" && offerEscalation && (
        <View style={styles.escalateWrap}>
          <Text style={[styles.escalateCopy, { color: navy }]}>
            Sorry that didn&apos;t help. Would you like another suggestion or
            support from your care team?
          </Text>
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => {
                tap();
                onToggleAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Try another idea for ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnSecondary,
                { borderColor: border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Feather name="refresh-cw" size={12} color={mutedForeground} />
              <Text style={[styles.btnText, { color: mutedForeground, fontWeight: "600" }]}>
                Try another idea
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onAskCareTeam();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ask my care team about ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnPrimary,
                {
                  borderColor: warning,
                  backgroundColor: warning,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="message-circle" size={13} color="#FFFFFF" />
              <Text style={[styles.btnText, { color: "#FFFFFF", fontWeight: "700" }]}>
                Ask my care team
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// =====================================================================
// SecondaryActionRow -- compact row for "Other things that may help".
// Same state machine, much lighter visual treatment.
// =====================================================================
function SecondaryActionRow({
  category,
  originalBody,
  showingAlternate,
  status,
  navy,
  mutedForeground,
  border,
  accent,
  warning,
  onCommit,
  onToggleAlternate,
  onOutcome,
  onReset,
  onAskCareTeam,
}: ActionRowProps) {
  const title = SHORT_TITLE[category];
  const body = showingAlternate ? FALLBACK_ALTERNATES[category] : originalBody;
  const titleA11y = title.toLowerCase();
  const offerEscalation = shouldOfferEscalation(category, status);

  return (
    <View
      style={[
        styles.secondaryRow,
        { borderColor: SECONDARY_BORDER, backgroundColor: SECONDARY_SURFACE },
      ]}
    >
      <Text style={[styles.secondaryTitle, { color: navy }]}>{title}</Text>
      <Text style={[styles.secondaryBody, { color: mutedForeground }]}>
        {body}
      </Text>

      {/* -- Default: single small "Try this" button --------------- */}
      {status == null && (
        <Pressable
          onPress={() => {
            tap();
            onCommit();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Try this: ${titleA11y}`}
          style={({ pressed }) => [
            styles.smallBtn,
            {
              borderColor: accent,
              backgroundColor: "#FFFFFF",
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Feather name="check" size={12} color={accent} />
          <Text style={[styles.smallBtnText, { color: accent }]}>
            Try this
          </Text>
        </Pressable>
      )}

      {/* -- Committed: outcome prompt ----------------------------- */}
      {status === "committed" && (
        <View style={styles.outcomeWrap}>
          <Text style={[styles.outcomePromptSmall, { color: navy }]}>
            How do you feel after trying it?
          </Text>
          <View style={styles.outcomeRow}>
            <OutcomeButton
              label="Better"
              icon="smile"
              tint={SUCCESS_FG}
              border={border}
              onPress={() => {
                tap();
                onOutcome("better");
              }}
              accessibilityLabel={`Feeling better after ${titleA11y}`}
            />
            <OutcomeButton
              label="Same"
              icon="meh"
              tint={mutedForeground}
              border={border}
              onPress={() => {
                tap();
                onOutcome("no_change");
              }}
              accessibilityLabel={`About the same after ${titleA11y}`}
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
              accessibilityLabel={`Worse after ${titleA11y}`}
            />
          </View>
        </View>
      )}

      {status === "better" && (
        <AcknowledgeRow
          icon="smile"
          tint={SUCCESS_FG}
          text="Glad that helped."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {status === "no_change" && (
        <AcknowledgeRow
          icon="meh"
          tint={mutedForeground}
          text="Thanks -- we'll keep watching this."
          onReset={onReset}
          mutedForeground={mutedForeground}
          a11y={titleA11y}
        />
      )}

      {status === "worse" && offerEscalation && (
        <View style={styles.escalateWrap}>
          <Text style={[styles.escalateCopy, { color: navy }]}>
            Sorry that didn&apos;t help. Would you like another suggestion or
            support from your care team?
          </Text>
          <View style={styles.btnRow}>
            <Pressable
              onPress={() => {
                tap();
                onToggleAlternate();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Try another idea for ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnSecondary,
                { borderColor: border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Feather name="refresh-cw" size={12} color={mutedForeground} />
              <Text style={[styles.btnText, { color: mutedForeground, fontWeight: "600" }]}>
                Try another idea
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                onAskCareTeam();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ask my care team about ${titleA11y}`}
              style={({ pressed }) => [
                styles.btnPrimary,
                {
                  borderColor: warning,
                  backgroundColor: warning,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="message-circle" size={13} color="#FFFFFF" />
              <Text style={[styles.btnText, { color: "#FFFFFF", fontWeight: "700" }]}>
                Ask my care team
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// =====================================================================
// Small helpers
// =====================================================================
interface AcknowledgeRowProps {
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  text: string;
  onReset: () => void;
  mutedForeground: string;
  a11y: string;
}

function AcknowledgeRow({
  icon,
  tint,
  text,
  onReset,
  mutedForeground,
  a11y,
}: AcknowledgeRowProps) {
  return (
    <View style={styles.ackRow}>
      <View style={styles.ackTextRow}>
        <Feather name={icon} size={13} color={tint} />
        <Text style={[styles.ackText, { color: tint }]}>{text}</Text>
      </View>
      <Pressable
        onPress={() => {
          tap();
          onReset();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Change response for ${a11y}`}
        style={({ pressed }) => [
          styles.changeLink,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.changeLinkText, { color: mutedForeground }]}>
          Change response
        </Text>
      </Pressable>
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
        styles.outcomeBtn,
        { borderColor: border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Feather name={icon} size={13} color={tint} />
      <Text style={[styles.outcomeBtnText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
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
  // -- Header -------------------------------------------------------
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
    fontSize: 13,
    fontWeight: "500",
    marginTop: 3,
    lineHeight: 17,
  },
  // -- Sections -----------------------------------------------------
  section: {
    gap: 6,
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
  // -- Primary action card ------------------------------------------
  primaryCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 13,
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
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22,
  },
  primaryBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  helperLine: {
    fontSize: 12,
    lineHeight: 16,
    fontStyle: "italic",
  },
  // -- Secondary rows -----------------------------------------------
  rowsWrap: {
    gap: 6,
  },
  secondaryRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  secondaryTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  secondaryBody: {
    fontSize: 12,
    lineHeight: 17,
  },
  smallBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  // -- Buttons (shared) --------------------------------------------
  btnRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  btnText: {
    fontSize: 13,
  },
  // -- Outcome ------------------------------------------------------
  outcomeWrap: {
    gap: 6,
    marginTop: 2,
  },
  outcomePrompt: {
    fontSize: 13,
    fontWeight: "600",
  },
  outcomePromptSmall: {
    fontSize: 12,
    fontWeight: "600",
  },
  outcomeRow: {
    flexDirection: "row",
    gap: 6,
  },
  outcomeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  outcomeBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  // -- Acknowledgement (better / no_change) -------------------------
  ackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    gap: 8,
  },
  ackTextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  ackText: {
    fontSize: 12,
    fontWeight: "600",
  },
  changeLink: {
    paddingVertical: 2,
  },
  changeLinkText: {
    fontSize: 11,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  // -- Worse / escalation panel -------------------------------------
  escalateWrap: {
    gap: 8,
    marginTop: 2,
  },
  escalateCopy: {
    fontSize: 13,
    lineHeight: 18,
  },
  // -- Card-level escalation banner ---------------------------------
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
  // -- Clinical guardrail footer ------------------------------------
  guardrail: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
    fontStyle: "italic",
  },
});
