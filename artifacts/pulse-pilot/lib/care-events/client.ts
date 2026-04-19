import { API_BASE } from "@/lib/apiConfig";
import { sessionApi } from "@/lib/api/sessionClient";

// ----------------------------------------------------------------------
// Care-events client. Fire-and-forget POSTs to /care-events for the
// dual-layer intervention loop. Distinct from the older intervention-
// log client (lib/intervention/logger.ts) which writes the heavier
// AI-coach analytics rows -- careEvents are the actor-level stream
// (viva, patient, doctor) used by the funnel.
// ----------------------------------------------------------------------

export type PatientCareEventType =
  | "coach_message"
  | "recommendation_shown"
  | "escalation_requested";

interface QueuedEvent {
  type: PatientCareEventType;
  metadata?: Record<string, unknown> | null;
}

// Per-session de-dupe so a screen render storm doesn't write 20 rows.
// Key shape: `${type}|${dateYmd}|${dedupeKey}` (caller-provided).
const seenThisSession = new Set<string>();

let pendingQueue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function flushNow(): Promise<void> {
  flushTimer = null;
  if (pendingQueue.length === 0) return;
  const batch = pendingQueue;
  pendingQueue = [];
  try {
    const token = await sessionApi.getStoredToken();
    if (!token) return; // Anonymous; drop on the floor.
    await fetch(`${API_BASE}/care-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    /* swallow -- best-effort */
  }
}

/**
 * Log a care event without de-dupe. Use for one-shot user actions
 * (e.g. patient pressed Need more support) where every press should
 * count. Resolves to true iff the network round-trip succeeded.
 */
export async function logCareEventImmediate(
  type: PatientCareEventType,
  metadata?: Record<string, unknown> | null,
): Promise<boolean> {
  try {
    const token = await sessionApi.getStoredToken();
    if (!token) return false;
    const res = await fetch(`${API_BASE}/care-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: [{ type, metadata: metadata ?? null }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * De-duped per-session log. Use for "I rendered something" signals
 * (coach_message, recommendation_shown). The `dedupeKey` distinguishes
 * different surfaces / cards so the funnel still sees one event per
 * meaningful render, but a re-render storm only writes one row per
 * session per surface per day.
 */
export function logCareEventDeduped(
  type: PatientCareEventType,
  dedupeKey: string,
  metadata?: Record<string, unknown> | null,
): void {
  const key = `${type}|${ymdLocal(new Date())}|${dedupeKey}`;
  if (seenThisSession.has(key)) return;
  seenThisSession.add(key);
  pendingQueue.push({ type, metadata: metadata ?? null });
  if (pendingQueue.length >= 20) {
    void flushNow();
    return;
  }
  if (flushTimer == null) {
    flushTimer = setTimeout(() => void flushNow(), 1500);
  }
}
