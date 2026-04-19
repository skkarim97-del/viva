import AsyncStorage from "@react-native-async-storage/async-storage";
import { sessionApi, HttpError, type CheckinPayload, type SymptomKind } from "@/lib/api/sessionClient";

// Single source of truth for "what the patient saved that the server
// has not yet acknowledged". Survives cold start so a check-in
// captured while offline is mirrored on the next launch instead of
// only being replayed when the patient happens to save again.
//
// Design rules:
//   * Check-ins are keyed by date and stored as full snapshots. The
//     server upserts by (patient_user_id, date), so re-sending the
//     same date is naturally idempotent. We store the full payload
//     captured at save time so a later retry sends what the patient
//     actually saw, not whatever AppContext state happens to be in
//     memory when the network recovers.
//   * Symptom-related items (guidance acks, trend responses,
//     escalations) are keyed by (date, symptom). Saving the same
//     pair twice replaces the prior entry, never duplicates.
//   * status reflects the result of the LAST flush attempt and is
//     used by the Today screen to render a fallback indicator.
const STORAGE_KEY = "@viva_checkin_sync_v1";

export type SyncStatus = "synced" | "pending" | "failed";

export type TrendResponse = "better" | "same" | "worse";

interface PendingTrend {
  date: string;
  symptom: SymptomKind;
  response: TrendResponse;
}

interface PendingSymptomFlag {
  date: string;
  symptom: SymptomKind;
}

interface QueueState {
  // date -> snapshot. Newer save for the same date overwrites the
  // older one, matching the server's upsert semantics.
  pendingCheckins: Record<string, CheckinPayload>;
  pendingGuidanceAcks: PendingSymptomFlag[];
  pendingTrendResponses: PendingTrend[];
  pendingClinicianRequests: PendingSymptomFlag[];
  status: SyncStatus;
  lastSyncAt: string | null;
  // Short, machine-readable hint of why the last attempt failed.
  // Surfaced via getStatus() for diagnostics; not currently rendered
  // in UI to keep the patient copy reassuring rather than scary.
  lastError: string | null;
}

const EMPTY_STATE: QueueState = {
  pendingCheckins: {},
  pendingGuidanceAcks: [],
  pendingTrendResponses: [],
  pendingClinicianRequests: [],
  status: "synced",
  lastSyncAt: null,
  lastError: null,
};

let cache: QueueState | null = null;
let loadPromise: Promise<QueueState> | null = null;
// Single-flight guard. Multiple drain triggers (cold start, app
// foreground, user save) can fire in quick succession; we never want
// two flushes racing against the same queue contents.
let inflightFlush: Promise<SyncStatus> | null = null;

type Listener = (status: SyncStatus, lastSyncAt: string | null) => void;
const listeners = new Set<Listener>();

function notify(state: QueueState): void {
  for (const l of listeners) {
    try {
      l(state.status, state.lastSyncAt);
    } catch {
      /* listener errors must not break the queue */
    }
  }
}

async function load(): Promise<QueueState> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        cache = { ...EMPTY_STATE };
        return cache;
      }
      const parsed = JSON.parse(raw) as Partial<QueueState>;
      // Defensive merge so a partial/legacy blob can't crash the app.
      cache = {
        pendingCheckins: parsed.pendingCheckins ?? {},
        pendingGuidanceAcks: parsed.pendingGuidanceAcks ?? [],
        pendingTrendResponses: parsed.pendingTrendResponses ?? [],
        pendingClinicianRequests: parsed.pendingClinicianRequests ?? [],
        status: parsed.status ?? "synced",
        lastSyncAt: parsed.lastSyncAt ?? null,
        lastError: parsed.lastError ?? null,
      };
      return cache;
    } catch {
      cache = { ...EMPTY_STATE };
      return cache;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* AsyncStorage write failure is non-fatal; in-memory cache still
       reflects the latest state and a subsequent persist will retry. */
  }
}

function hasAnyPending(s: QueueState): boolean {
  return (
    Object.keys(s.pendingCheckins).length > 0 ||
    s.pendingGuidanceAcks.length > 0 ||
    s.pendingTrendResponses.length > 0 ||
    s.pendingClinicianRequests.length > 0
  );
}

// Errors we should keep retrying. Anything else (validation, auth,
// missing-row 404 for an ack against a check-in we never persisted)
// will never succeed on retry, so we drop it from the queue to keep
// it from sticking forever.
function isRetriable(e: unknown): boolean {
  if (!(e instanceof HttpError)) return true;
  // status 0 = network/timeout. 5xx = server error. 408/429 = retry.
  if (e.status === 0) return true;
  if (e.status >= 500) return true;
  if (e.status === 408 || e.status === 429) return true;
  return false;
}

export const checkinSync = {
  // Subscribe to status changes. Returns an unsubscribe function.
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    // Fire current state immediately so subscribers don't render
    // stale "synced" until the first change.
    if (cache) listener(cache.status, cache.lastSyncAt);
    return () => {
      listeners.delete(listener);
    };
  },

  async getStatus(): Promise<{
    status: SyncStatus;
    lastSyncAt: string | null;
    pendingCount: number;
  }> {
    const s = await load();
    const pendingCount =
      Object.keys(s.pendingCheckins).length +
      s.pendingGuidanceAcks.length +
      s.pendingTrendResponses.length +
      s.pendingClinicianRequests.length;
    return { status: s.status, lastSyncAt: s.lastSyncAt, pendingCount };
  },

  // Capture a check-in snapshot for `date`. Idempotent: a later save
  // for the same date overwrites the prior snapshot, matching the
  // server's upsert. Marks the queue dirty (status="pending") and
  // kicks off a flush; the caller does NOT need to await flush().
  async enqueueCheckin(payload: CheckinPayload): Promise<void> {
    const s = await load();
    s.pendingCheckins[payload.date] = payload;
    s.status = "pending";
    await persist();
    notify(s);
    // Fire-and-forget flush; errors are absorbed and will be surfaced
    // via the status subscriber.
    void this.flush();
  },

  async enqueueGuidanceAck(date: string, symptom: SymptomKind): Promise<void> {
    const s = await load();
    s.pendingGuidanceAcks = s.pendingGuidanceAcks
      .filter(it => !(it.date === date && it.symptom === symptom))
      .concat({ date, symptom });
    s.status = "pending";
    await persist();
    notify(s);
    void this.flush();
  },

  async enqueueTrendResponse(
    date: string,
    symptom: SymptomKind,
    response: TrendResponse,
  ): Promise<void> {
    const s = await load();
    s.pendingTrendResponses = s.pendingTrendResponses
      .filter(it => !(it.date === date && it.symptom === symptom))
      .concat({ date, symptom, response });
    s.status = "pending";
    await persist();
    notify(s);
    void this.flush();
  },

  async enqueueClinicianRequest(date: string, symptom: SymptomKind): Promise<void> {
    const s = await load();
    s.pendingClinicianRequests = s.pendingClinicianRequests
      .filter(it => !(it.date === date && it.symptom === symptom))
      .concat({ date, symptom });
    s.status = "pending";
    await persist();
    notify(s);
    void this.flush();
  },

  // Drain everything currently queued. Single-flight: concurrent
  // callers receive the in-flight promise rather than racing against
  // it. Returns the post-flush status so callers (cold-start hook,
  // foreground hook) can log or surface it.
  async flush(): Promise<SyncStatus> {
    if (inflightFlush) return inflightFlush;
    inflightFlush = (async () => {
      const s = await load();
      if (!hasAnyPending(s)) {
        s.status = "synced";
        s.lastError = null;
        await persist();
        notify(s);
        return "synced";
      }
      // Cold-start safety: if there's no bearer token (signed-out
      // patient, or token cleared by a prior 401), do NOT attempt
      // the network. An unauthenticated POST would return 401, which
      // we classify as non-retriable, which would silently drop the
      // queued check-in. Hold the items in "pending" instead; the
      // next flush trigger after sign-in will drain them. The user
      // never silently loses data because they were briefly logged
      // out at the moment the drain ran.
      const hasToken = !!(await sessionApi.getStoredToken());
      if (!hasToken) {
        s.status = "pending";
        s.lastError = "no_auth_token";
        await persist();
        notify(s);
        return "pending";
      }

      let anyFatal = false;
      let anyRetriable = false;
      let lastErr: string | null = null;

      // Check-ins first: guidance/trend/escalation acks all 404
      // server-side without a check-in row for the date. Draining
      // check-ins first means a same-call enqueue for date=D plus an
      // ack for date=D succeeds in a single flush.
      for (const date of Object.keys(s.pendingCheckins)) {
        const payload = s.pendingCheckins[date]!;
        try {
          await sessionApi.submitCheckin(payload);
          delete s.pendingCheckins[date];
        } catch (e) {
          if (isRetriable(e)) {
            anyRetriable = true;
            lastErr = (e as Error)?.message ?? "unknown";
          } else {
            // Non-retriable (400 invalid input, 401 auth dead, ...).
            // Drop it so the queue doesn't poison subsequent flushes.
            // The local AsyncStorage check-in history still holds the
            // patient's data; this only means "stop trying to sync
            // this snapshot to the server".
            anyFatal = true;
            lastErr = `checkin_${(e as HttpError).status}`;
            delete s.pendingCheckins[date];
          }
        }
      }

      // 404 on an ack means the check-in row for `date` doesn't
      // exist server-side. That's fatal IF we have nothing left to
      // mirror for that date -- but if the check-in for the same
      // date is still queued (e.g. it failed retriably this round),
      // the ack should ride along with the next flush attempt
      // instead of being silently dropped.
      const isAckRecoverable = (e: unknown, date: string): boolean => {
        if (e instanceof HttpError && e.status === 404) {
          return s.pendingCheckins[date] !== undefined;
        }
        return false;
      };

      const remainingGuidance: PendingSymptomFlag[] = [];
      for (const item of s.pendingGuidanceAcks) {
        try {
          await sessionApi.markGuidanceShown(item.date, item.symptom);
        } catch (e) {
          if (isRetriable(e) || isAckRecoverable(e, item.date)) {
            anyRetriable = true;
            lastErr = (e as Error)?.message ?? "unknown";
            remainingGuidance.push(item);
          } else {
            anyFatal = true;
            lastErr = `guidance_${(e as HttpError).status}`;
            // dropped
          }
        }
      }
      s.pendingGuidanceAcks = remainingGuidance;

      const remainingTrend: PendingTrend[] = [];
      for (const item of s.pendingTrendResponses) {
        try {
          await sessionApi.submitSymptomTrend(item.date, item.symptom, item.response);
        } catch (e) {
          if (isRetriable(e) || isAckRecoverable(e, item.date)) {
            anyRetriable = true;
            lastErr = (e as Error)?.message ?? "unknown";
            remainingTrend.push(item);
          } else {
            anyFatal = true;
            lastErr = `trend_${(e as HttpError).status}`;
          }
        }
      }
      s.pendingTrendResponses = remainingTrend;

      const remainingClin: PendingSymptomFlag[] = [];
      for (const item of s.pendingClinicianRequests) {
        try {
          await sessionApi.requestClinicianForSymptom(item.date, item.symptom);
        } catch (e) {
          if (isRetriable(e) || isAckRecoverable(e, item.date)) {
            anyRetriable = true;
            lastErr = (e as Error)?.message ?? "unknown";
            remainingClin.push(item);
          } else {
            anyFatal = true;
            lastErr = `escalate_${(e as HttpError).status}`;
          }
        }
      }
      s.pendingClinicianRequests = remainingClin;

      const stillPending = hasAnyPending(s);
      // Status precedence:
      //   anything still queued (retriable) -> "failed" (we tried, network dropped)
      //   nothing queued, no errors        -> "synced"
      //   nothing queued, only fatal drops -> "synced" (we gave up, server rejects)
      // anyFatal alone is not a user-visible failure; it's a "we
      // couldn't sync this and never will, but local data is intact".
      let nextStatus: SyncStatus;
      if (stillPending && anyRetriable) nextStatus = "failed";
      else nextStatus = "synced";
      s.status = nextStatus;
      s.lastError = stillPending ? lastErr : null;
      if (nextStatus === "synced") s.lastSyncAt = new Date().toISOString();
      await persist();
      notify(s);
      // Suppress unused-var warning while keeping the variable around
      // for future logging.
      void anyFatal;
      return nextStatus;
    })().finally(() => {
      inflightFlush = null;
    });
    return inflightFlush;
  },

  // Test-only / sign-out hook. Wipes everything, including status.
  async reset(): Promise<void> {
    cache = { ...EMPTY_STATE };
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      /* swallow */
    }
    notify(cache);
  },
};
