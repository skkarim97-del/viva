// Patient-side client for the AI-personalized micro-intervention loop
// (IV05 endpoints). Mirrors the bearer-token pattern used by the rest
// of the mobile app; never touches cookies, never times out forever.
//
// All requests are best-effort from the UI perspective: a network
// failure must NEVER block the rest of the Today screen from
// rendering. Callers should swallow errors and log them.

import { API_BASE } from "@/lib/apiConfig";
import { sessionApi } from "@/lib/api/sessionClient";

// Status states match the server enum in lib/db/src/schema/patientInterventions.
// After /feedback the row transitions to feedback_collected (better/
// same/didnt_try) or escalated (worse, auto-escalate). There is NO
// per-feedback-result status -- the card inspects feedbackResult
// directly to render the thank-you copy.
export type InterventionStatus =
  | "shown"
  | "accepted"
  | "dismissed"
  | "pending_feedback"
  | "feedback_collected"
  | "resolved"
  | "escalated"
  | "expired";

export type InterventionTriggerType =
  | "nausea"
  | "constipation"
  | "low_energy"
  | "low_hydration"
  | "low_food_intake"
  | "missed_checkin"
  | "rapid_weight_change"
  | "worsening_symptom"
  | "repeated_symptom"
  | "patient_requested_review";

export type RecommendationCategory =
  | "hydration"
  | "activity"
  | "protein"
  | "fiber"
  | "small_meal"
  | "rest"
  | "tracking"
  | "care_team_review";

export type FeedbackResult = "better" | "same" | "worse" | "didnt_try";

// Reasons the CLIENT sends on POST /escalate. Distinct from
// `PatientIntervention.escalationReason` (typed `string | null` below)
// because the SERVER also writes engine-emitted reasons that aren't
// part of this user-facing list -- e.g. "patient_feedback_worse"
// (auto-escalate path), "patient_requested" (the escalate route's
// fallback), and dismiss reasons that flow through escalationReason
// for analytics (e.g. "not_relevant", "not_now"). We type the read
// side as open string to mirror the server's actual emission.
export type EscalationReason =
  | "want_to_talk_to_doctor"
  | "symptom_severe"
  | "symptom_persistent"
  | "other";

export type InterventionRiskLevel = "low" | "moderate" | "elevated";
export type InterventionGeneratedBy =
  | "rules_ai_deidentified"
  | "rules_fallback"
  | "rules_only";

// We only render the fields the card actually needs; the server may
// return many more (deidentified payloads, context summary, etc.) but
// we keep the type loose so a server-side addition never breaks the
// client.
export interface PatientIntervention {
  id: number;
  patientUserId: number;
  doctorId: number | null;
  triggerType: InterventionTriggerType;
  symptomType: string | null;
  severity: number | null;
  status: InterventionStatus;
  riskLevel: InterventionRiskLevel;
  whatWeNoticed: string;
  recommendation: string;
  followUpQuestion: string | null;
  recommendationCategory: RecommendationCategory;
  feedbackResult: FeedbackResult | null;
  patientNote: string | null;
  // Server-emitted reason text. Open string because the server's
  // vocabulary is broader than the client-side EscalationReason set
  // -- see the comment on EscalationReason above for details.
  escalationReason: string | null;
  generatedBy: InterventionGeneratedBy;
  acceptedAt: string | null;
  feedbackRequestedAt: string | null;
  feedbackCollectedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GenerateSource = "checkin" | "manual" | "scheduled";

interface ActiveResponse {
  interventions: PatientIntervention[];
}

interface SingleResponse {
  intervention: PatientIntervention | null;
  reason?: string | null;
}

class InterventionsHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await sessionApi.getStoredToken().catch(() => null);
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new InterventionsHttpError(res.status, text || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      throw new InterventionsHttpError(0, "request_timeout");
    }
    if (e instanceof InterventionsHttpError) throw e;
    throw new InterventionsHttpError(0, (e as Error)?.message || "network_error");
  } finally {
    clearTimeout(timer);
  }
}

export const interventionsApi = {
  // GET /api/patient/interventions/active
  // Returns currently surface-able interventions (shown / accepted /
  // pending_feedback / escalated). Empty array is a normal state.
  active: async (): Promise<PatientIntervention[]> => {
    try {
      const r = await request<ActiveResponse>(
        "GET",
        "/patient/interventions/active",
      );
      return r.interventions ?? [];
    } catch {
      return [];
    }
  },

  // POST /api/patient/interventions/generate
  // Triggered after a daily check-in and from "Ask my care team".
  // Returns null when the engine decided no new intervention was
  // warranted (or duplicated an active one); the caller should treat
  // null as a no-op.
  generate: async (input?: {
    source?: GenerateSource;
    symptomType?: string | null;
    severity?: number | null;
    triggerType?: InterventionTriggerType | null;
  }): Promise<PatientIntervention | null> => {
    try {
      const r = await request<SingleResponse>(
        "POST",
        "/patient/interventions/generate",
        input ?? {},
      );
      return r.intervention ?? null;
    } catch {
      return null;
    }
  },

  accept: (id: number) =>
    request<SingleResponse>(
      "POST",
      `/patient/interventions/${id}/accept`,
    ),

  dismiss: (id: number) =>
    request<SingleResponse>(
      "POST",
      `/patient/interventions/${id}/dismiss`,
    ),

  feedback: (
    id: number,
    feedbackResult: FeedbackResult,
    patientNote?: string | null,
  ) =>
    request<SingleResponse>(
      "POST",
      `/patient/interventions/${id}/feedback`,
      // Per the privacy spec, free-text patient notes are stored on
      // patient_interventions.patient_note but never forwarded to
      // OpenAI. Empty / undefined notes are sent as null.
      {
        feedbackResult,
        patientNote: patientNote && patientNote.trim().length > 0
          ? patientNote.trim()
          : null,
      },
    ),

  escalate: (id: number, escalationReason: EscalationReason) =>
    request<SingleResponse>(
      "POST",
      `/patient/interventions/${id}/escalate`,
      { escalationReason },
    ),
};

export { InterventionsHttpError };
