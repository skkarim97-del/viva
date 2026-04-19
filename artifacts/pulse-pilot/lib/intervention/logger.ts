import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/lib/apiConfig";
import { sessionApi } from "@/lib/api/sessionClient";
import type { DailyTreatmentState } from "@/lib/engine/dailyState";

// Stable surface labels matching INTERVENTION_SURFACES in the shared
// db schema. Hard-coded as a const tuple so misuses caught at compile.
export type InterventionSurface = "Today" | "WeeklyPlan" | "Coach";

// Stable type catalog matching INTERVENTION_TYPES in the shared db
// schema. Same tuple intent.
export type InterventionType =
  | "hydration"
  | "protein_fueling"
  | "light_movement"
  | "recovery_rest"
  | "symptom_monitoring"
  | "clinician_escalation"
  | "dose_day_caution"
  | "adherence_checkin";

export interface InterventionLogInput {
  surface: InterventionSurface;
  interventionType: InterventionType;
  title: string;
  rationale?: string | null;
  state: DailyTreatmentState;
}

interface QueuedEvent {
  occurredOn: string;
  surface: InterventionSurface;
  interventionType: InterventionType;
  title: string;
  rationale: string | null;
  treatmentStateSnapshot: {
    primaryFocus: string;
    escalationNeed: "none" | "monitor" | "clinician";
    treatmentStage: string;
    treatmentDailyState: string;
    communicationMode: string;
    dataTier: "self_report" | "phone_health" | "wearable";
    recentTitration: boolean;
    symptomBurden: "low" | "moderate" | "high";
    adherenceSignal: "stable" | "attention" | "rising";
    insufficientForPlan: boolean;
  };
  claimsPolicySummary: {
    canCiteSleep: boolean;
    canCiteHRV: boolean;
    canCiteRecovery: boolean;
    canCiteSteps: boolean;
    physiologicalClaimsAllowed: boolean;
    narrativeConfidence: "low" | "moderate" | "high";
  };
  signalConfidenceSummary: {
    hrv: "none" | "low" | "medium" | "high";
    rhr: "none" | "low" | "medium" | "high";
    sleepDuration: "none" | "low" | "medium" | "high";
    sleepQuality: "none" | "low" | "medium" | "high";
    recovery: "none" | "low" | "medium" | "high";
    activity: "none" | "low" | "medium" | "high";
  };
}

// In-memory dedupe key set. Each (date|surface|type|title) tuple
// posts at most once per day per app session. Without this, a single
// React re-render storm would balloon the row count.
const seenThisSession = new Set<string>();

// Persistent dedupe across cold launches. Keyed by occurredOn so the
// set self-cleans the next day.
const PERSIST_KEY_PREFIX = "@viva_intv_seen_";

let pendingQueue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadPersistentSeen(occurredOn: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(PERSIST_KEY_PREFIX + occurredOn);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function persistSeen(
  occurredOn: string,
  set: Set<string>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PERSIST_KEY_PREFIX + occurredOn,
      JSON.stringify([...set]),
    );
  } catch {
    /* swallow -- worst case we double-log on next cold launch */
  }
}

function snapshotFromState(state: DailyTreatmentState): {
  treatmentStateSnapshot: QueuedEvent["treatmentStateSnapshot"];
  claimsPolicySummary: QueuedEvent["claimsPolicySummary"];
  signalConfidenceSummary: QueuedEvent["signalConfidenceSummary"];
} {
  const sc = state.claimsPolicy.signalConfidence;
  return {
    treatmentStateSnapshot: {
      primaryFocus: state.primaryFocus,
      escalationNeed: state.escalationNeed,
      treatmentStage: state.treatmentStage,
      treatmentDailyState: state.treatmentDailyState,
      communicationMode: state.communicationMode ?? "simplify",
      dataTier: state.dataTier,
      recentTitration: state.recentTitration,
      symptomBurden: state.symptomBurden,
      adherenceSignal: state.adherenceSignal,
      insufficientForPlan: state.dataSufficiency.insufficientForPlan,
    },
    claimsPolicySummary: {
      canCiteSleep: state.claimsPolicy.canCiteSleep,
      canCiteHRV: state.claimsPolicy.canCiteHRV,
      canCiteRecovery: state.claimsPolicy.canCiteRecovery,
      canCiteSteps: state.claimsPolicy.canCiteSteps,
      physiologicalClaimsAllowed:
        state.claimsPolicy.physiologicalClaimsAllowed,
      narrativeConfidence: state.claimsPolicy.narrativeConfidence,
    },
    signalConfidenceSummary: {
      hrv: sc.hrv.confidenceLevel,
      rhr: sc.rhr.confidenceLevel,
      sleepDuration: sc.sleepDuration.confidenceLevel,
      sleepQuality: sc.sleepQuality.confidenceLevel,
      recovery: sc.recovery.confidenceLevel,
      activity: sc.activity.confidenceLevel,
    },
  };
}

async function flushNow(): Promise<void> {
  flushTimer = null;
  if (pendingQueue.length === 0) return;
  // Snapshot + clear so re-entrant logIntervention() calls during the
  // network round trip don't lose events on failure.
  const batch = pendingQueue;
  pendingQueue = [];
  try {
    const token = await sessionApi.getStoredToken();
    if (!token) return; // Anonymous / pre-activation; drop on the floor.
    const res = await fetch(`${API_BASE}/interventions/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) {
      // Best-effort. Do not re-queue on 4xx to avoid loops; do not
      // re-queue on 5xx either, because intervention rendering is the
      // source of truth and missed log rows skew analytics far less
      // than a backed-up retry storm would skew the device's memory.
    }
  } catch {
    /* swallow -- analytics is best-effort */
  }
}

/**
 * Log a rendered intervention. Idempotent per
 * (date|surface|type|title): calling it on every render is safe and
 * intended. Posts batched after a short debounce so a Today screen
 * mount doesn't fire one request per card.
 */
export function logIntervention(input: InterventionLogInput): void {
  const occurredOn = ymdLocal(new Date());
  const dedupeKey = `${occurredOn}|${input.surface}|${input.interventionType}|${input.title}`;
  if (seenThisSession.has(dedupeKey)) return;
  seenThisSession.add(dedupeKey);

  // Persistent dedupe is async + best-effort; gate the queue add on it.
  // We DO add to the in-memory set above first to prevent the double-
  // dispatch race when two callers fire on the same render frame.
  void (async () => {
    const persisted = await loadPersistentSeen(occurredOn);
    if (persisted.has(dedupeKey)) return;
    persisted.add(dedupeKey);
    await persistSeen(occurredOn, persisted);

    const snap = snapshotFromState(input.state);
    pendingQueue.push({
      occurredOn,
      surface: input.surface,
      interventionType: input.interventionType,
      title: input.title,
      rationale: input.rationale ?? null,
      ...snap,
    });

    // Cap the in-flight queue so a runaway logger can't pin memory.
    // 50 matches the server-side z.array(...).max(50) so the next
    // flush stays under the limit.
    if (pendingQueue.length >= 50) {
      void flushNow();
      return;
    }
    if (flushTimer == null) {
      flushTimer = setTimeout(() => {
        void flushNow();
      }, 1500);
    }
  })();
}

// Test / debug hook: force-flush from outside (e.g. on app
// background) so events aren't lost when the user closes the app.
export async function flushInterventionLog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushNow();
}
