/**
 * Tiny typed fetch wrapper. The dashboard talks to the same-origin
 * Express API; cookies (the session) ride along automatically because
 * we set credentials: "include".
 */

export type Role = "doctor" | "patient";

export interface Me {
  id: number;
  email: string;
  name: string;
  role: Role;
  // Doctor-only: name of the practice. Captured during onboarding;
  // null until the wizard is completed.
  clinicName: string | null;
  // Server-derived flag: true when the doctor still needs to set a
  // clinic name OR has zero patients on their panel. Drives the gate
  // that pushes new accounts into the onboarding wizard.
  needsOnboarding: boolean;
}

// "pending" = patient has been invited but has not yet claimed their
// account in the mobile app, so risk is not computed.
export type Action = "needs_followup" | "monitor" | "stable" | "pending";

export interface PatientRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  glp1Drug: string | null;
  dose: string | null;
  startedOn: string | null;
  lastCheckin: string | null;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  // Workflow state computed server-side: needs_followup / monitor / stable.
  action: Action;
  // Lifecycle state independent of risk:
  //   invited     -> doctor sent the link, app not yet claimed
  //   activated   -> patient claimed the account, no check-ins yet
  //   monitoring  -> at least one check-in received
  // Used to give the pending bucket cards distinct copy.
  status: "invited" | "activated" | "monitoring";
  // Up to two short, scannable signals for this patient, primary first.
  // Empty array when no rules fired. The UI joins these with " · " so
  // two patients with the same primary signal don't read as identical.
  signals: string[];
  // ISO timestamp of the most recent care-team note for this patient,
  // or null if nobody has logged an action yet. Used to render
  // "Last note: 2d ago" on the queue so doctors don't double-up calls.
  lastNoteAt: string | null;
  // True until the patient claims their account in the mobile app.
  // While pending, riskScore/signals are placeholders and the queue
  // routes the row into the dedicated "Pending activation" bucket.
  pending: boolean;
  // Single-use activation token for pending patients so the dashboard
  // can render a copyable invite link inline. Null after activation.
  activationToken: string | null;
  // Soft outreach signal: activated patient (active or unknown status)
  // with no check-in in 12+ days. Always false for pending or stopped.
  // Does not affect risk score or treatment status.
  inactive12d?: boolean;
  // Compact symptom indicators emitted by the queue endpoint. Used by
  // the dashboard's IssueType classifier to separate clinical concern
  // from engagement concern without a per-row round trip.
  symptomFlagCount?: number;
  symptomEscalating?: boolean;
  symptomSummary?: string | null;
  // Doctor-owned treatment status, also returned on the queue payload
  // so the dashboard can surface "Treatment stopped" as a clinical
  // signal in the row classifier.
  treatmentStatus?: TreatmentStatus;
  stopReason?: StopReason | null;
  // Hours since the activation token was issued. Only present on
  // pending+invited rows; null for activated patients or when the
  // issuance timestamp is missing on legacy seed rows.
  inviteAgeHours?: number | null;
  // True when the invite was issued 48+ hours ago and the patient
  // still has not claimed their account. Drives the amber nudge on
  // the pending card so doctors can see at a glance which invites
  // are stuck.
  staleInvite?: boolean;
  // True when the patient is treatment-stopped AND has no unresolved
  // workflow items (open escalation or pending follow-up). The
  // dashboard hides archived rows by default; they remain accessible
  // via the "Show archived" toggle and the patient detail page.
  archived?: boolean;
}

export type TreatmentStatus = "active" | "stopped" | "unknown";
export type StopReason =
  | "side_effects"
  | "cost_or_insurance"
  | "lack_of_efficacy"
  | "patient_choice_or_motivation"
  | "other";
export type StopTimingBucket =
  | "d0_30"
  | "d31_60"
  | "d61_90"
  | "d90_plus"
  | "unknown";

export interface PatientDetail {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  glp1Drug: string | null;
  dose: string | null;
  startedOn: string | null;
  treatmentStatus: TreatmentStatus;
  treatmentStatusSource: "doctor" | "patient" | "system" | null;
  stopReason: StopReason | null;
  stopNote: string | null;
  treatmentStatusUpdatedAt: string | null;
  // Both derived server-side from (treatmentStatusUpdatedAt - startedOn)
  // when treatmentStatus = 'stopped'. Bucket is "unknown" otherwise or
  // when startedOn is missing.
  stopTimingBucket: StopTimingBucket;
  daysOnTreatment: number | null;
}

export interface Checkin {
  id: number;
  patientUserId: number;
  date: string;
  energy: "depleted" | "tired" | "good" | "great";
  nausea: "none" | "mild" | "moderate" | "severe";
  mood: number;
  notes: string | null;
  createdAt: string;
  // Extended check-in fields. The backend route returns the full
  // patient_checkins row, so these are always present in practice;
  // they're typed as optional/nullable here to stay tolerant of older
  // rows seeded before the schema was extended.
  appetite?: "strong" | "normal" | "low" | "very_low" | null;
  digestion?: "fine" | "bloated" | "constipated" | "diarrhea" | null;
  bowelMovement?: boolean | null;
}

export interface FiredRule {
  code: string;
  label: string;
  weight: number;
}

export type SymptomKind = "nausea" | "constipation" | "low_appetite";
export type SymptomSeverity = "mild" | "moderate" | "severe";
export type SymptomPersistence = "transient" | "persistent" | "worsening";

export type SymptomTrendResponse = "better" | "same" | "worse";

export interface SymptomFlag {
  symptom: SymptomKind;
  severity: SymptomSeverity;
  persistence: SymptomPersistence;
  daysObserved: number;
  windowDays: number;
  contributors: string[];
  guidanceShown: boolean;
  // Most recent patient-reported trend response within the lookback
  // window. null = not asked or not answered.
  trendResponse: SymptomTrendResponse | null;
  // Patient explicitly asked the clinician to be aware of this symptom.
  clinicianRequested: boolean;
  // Human-readable list of the rules that escalated this case (e.g.
  // "Patient reports worse", "Not improving after guidance"). Empty
  // when suggestFollowup is false.
  escalationReasons: string[];
  suggestFollowup: boolean;
}

export interface Risk {
  score: number;
  band: "low" | "medium" | "high";
  rules: FiredRule[];
  asOf: string;
  action: Action;
  // One-line directive derived from the highest-priority rule, e.g.
  // "Follow up on missed check-ins". Null when no rules fired.
  suggestedAction: string | null;
  // Active symptom-management flags computed by the server's
  // lib/symptoms module. Empty array when no tracked symptom is
  // currently active for this patient.
  symptomFlags: SymptomFlag[];
}

export interface PatientWeightSummary {
  latest: { weightLbs: number; recordedAt: string } | null;
  prior?: { weightLbs: number; recordedAt: string } | null;
  daysSinceLast: number | null;
  // "none" when no prior entry exists to compare against.
  trend: "up" | "down" | "flat" | "none";
}

export interface DoctorNote {
  id: number;
  patientUserId: number;
  doctorUserId: number;
  doctorName: string;
  body: string;
  // Outcome flag captured by the doctor right after the note was saved.
  // true = the action resolved the issue, false = needs more work,
  // null = doctor skipped the question.
  resolved: boolean | null;
  createdAt: string;
}

export type CareEventSource = "viva" | "doctor" | "patient";
export type CareEventType =
  | "coach_message"
  | "recommendation_shown"
  | "escalation_requested"
  | "doctor_reviewed"
  | "doctor_note"
  | "treatment_status_updated"
  | "follow_up_completed";

export interface CareEvent {
  id: number;
  patientUserId: number;
  actorUserId: number | null;
  actorName: string | null;
  source: CareEventSource;
  type: CareEventType;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

export interface CareEventsResponse {
  escalationOpen: boolean;
  lastEscalationAt: string | null;
  lastReviewAt: string | null;
  // Most recent doctor "Follow-up completed" event timestamp (any
  // escalation cycle, all-time). Drives the audit-trail line shown
  // when the most recent escalation has already been followed up.
  lastFollowUpAt: string | null;
  // True iff there's an escalation that hasn't been followed-up on
  // yet -- i.e. lastEscalationAt exists and is newer than
  // lastFollowUpAt. Independent of escalationOpen because reviewed
  // and followed-up are distinct doctor actions.
  followUpPending: boolean;
  events: CareEvent[];
}

// ---- Intervention loop types (clinic side) ---------------------------------
// Mirror the server's patient_interventions schema. We only type the
// fields the dashboard renders; the server may emit additional fields
// (deidentified payloads, full context summaries) that we ignore.

// Mirrors PATIENT_INTERVENTION_STATUSES in lib/db. There is no
// per-feedback-result status -- after /feedback the row goes to
// `feedback_collected` (better/same/didnt_try) or `escalated`
// (worse, auto-escalate). The dashboard inspects feedbackResult
// directly for tone, not status.
export type InterventionStatus =
  | "shown"
  | "accepted"
  | "dismissed"
  | "pending_feedback"
  | "feedback_collected"
  | "resolved"
  | "escalated"
  | "expired";

// Mirrors PATIENT_INTERVENTION_TRIGGER_TYPES in lib/db.
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

export type InterventionFeedbackResult =
  | "better"
  | "same"
  | "worse"
  | "didnt_try";

export type InterventionRiskLevel = "low" | "moderate" | "elevated";

export type InterventionGeneratedBy =
  | "rules_ai_deidentified"
  | "rules_fallback"
  | "rules_only";

export interface ClinicIntervention {
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
  recommendationCategory: string;
  feedbackResult: InterventionFeedbackResult | null;
  patientNote: string | null;
  escalationReason: string | null;
  generatedBy: InterventionGeneratedBy;
  acceptedAt: string | null;
  feedbackCollectedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Worklist payload returned by GET /api/clinic/interventions.
// The server returns a flat list of active interventions (statuses
// shown / accepted / pending_feedback / escalated) joined with the
// patient's display name + email. The dashboard buckets client-side
// in strict priority order (each row goes to the FIRST matching bucket):
//   1. patientRequested  -- triggerType === "patient_requested_review"
//                           ONLY. We do NOT key off escalationReason
//                           because the server auto-sets it to
//                           "patient_feedback_worse" on worse-feedback,
//                           which would otherwise shadow the worse
//                           bucket below.
//   2. worse             -- feedbackResult === "worse" (status will be
//                           "escalated" after auto-escalate, which is
//                           why we don't gate on status).
//   3. elevated          -- riskLevel === "elevated".
//   4. repeated          -- triggerType === "repeated_symptom".
export interface ClinicWorklistIntervention extends ClinicIntervention {
  patient: {
    id: number;
    name: string | null;
    email: string | null;
  };
}

export interface ClinicInterventionsWorklist {
  interventions: ClinicWorklistIntervention[];
}

export interface ClinicPatientInterventionsResponse {
  interventions: ClinicIntervention[];
}

// API base URL is configurable at build time via VITE_API_BASE_URL.
// Default "/api" is what we use in production today: the clinic
// deployment proxies same-origin /api/* requests to the api-server,
// which keeps the session cookie same-origin. Overriding this to a
// cross-origin URL is NOT cookie-compatible with the current api-server
// session config (sameSite: "lax"); changing it is only safe if the
// auth model is moved off cookies or the cookie SameSite policy is
// updated on api-server.
const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface InviteResult {
  id: number;
  name: string;
  phone: string | null;
  inviteLink: string;
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<Me>("POST", "/auth/login", { email, password }),
  signup: (name: string, email: string, password: string) =>
    request<Me>("POST", "/auth/signup", { name, email, password }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/auth/me"),

  // doctor onboarding
  setClinic: (clinicName: string) =>
    request<{ ok: true; clinicName: string }>("PUT", "/patients/clinic", {
      clinicName,
    }),
  invitePatient: (input: {
    name: string;
    phone: string;
    glp1Drug?: string | null;
    dose?: string | null;
  }) => request<InviteResult>("POST", "/patients/invite", input),
  resendInvite: (id: number) =>
    request<{ inviteLink: string }>("POST", `/patients/${id}/resend`),

  // doctor
  patients: (opts?: { includeArchived?: boolean }) =>
    request<PatientRow[]>(
      "GET",
      opts?.includeArchived ? "/patients?includeArchived=true" : "/patients",
    ),
  // Returns null when there are no escalations old enough to evaluate
  // (denominator = 0). Callers must render a placeholder rather than
  // assuming 0% in that case so we don't display a misleading metric.
  doctorStats: () =>
    request<{ followUpRate24h: number | null }>("GET", "/patients/stats"),
  patient: (id: number) => request<PatientDetail>("GET", `/patients/${id}`),
  patientCheckins: (id: number) =>
    request<Checkin[]>("GET", `/patients/${id}/checkins`),
  patientRisk: (id: number) => request<Risk>("GET", `/patients/${id}/risk`),
  patientWeight: (id: number) =>
    request<PatientWeightSummary>("GET", `/patients/${id}/weight`),
  patientNotes: (id: number) =>
    request<DoctorNote[]>("GET", `/patients/${id}/notes`),
  addPatientNote: (
    id: number,
    body: string,
    resolved: boolean | null = null,
  ) =>
    request<DoctorNote>("POST", `/patients/${id}/notes`, { body, resolved }),
  deletePatientNote: (patientId: number, noteId: number) =>
    request<{ ok: true }>(
      "DELETE",
      `/patients/${patientId}/notes/${noteId}`,
    ),
  // care events (dual-layer intervention loop)
  careEvents: (id: number) =>
    request<CareEventsResponse>("GET", `/care-events/${id}`),
  markPatientReviewed: (id: number) =>
    request<{ id: number; occurredAt: string }>(
      "POST",
      `/care-events/${id}/reviewed`,
    ),
  markPatientFollowUpCompleted: (id: number) =>
    request<{ id: number; occurredAt: string; triggerEventId: number | null }>(
      "POST",
      `/care-events/${id}/follow-up-completed`,
    ),
  needsReviewIds: () =>
    request<{ ids: number[] }>("GET", `/care-events/_ids/needs-review`),

  setTreatmentStatus: (
    id: number,
    input: {
      status: TreatmentStatus;
      stopReason?: StopReason;
      stopNote?: string | null;
    },
  ) =>
    request<PatientDetail>(
      "PATCH",
      `/patients/${id}/treatment-status`,
      input,
    ),
  // ---- doctor MFA (TOTP) ---------------------------------------------------
  // HIPAA pilot, T007. Backend mounts these under /me/mfa BEFORE the
  // patient-only /me router so doctor sessions can enroll and verify.
  // mfaStatus polls cheaply; the rest are user-initiated form submits.
  mfaStatus: () =>
    request<{ enrolled: boolean; sessionVerified: boolean; hasSession: boolean }>(
      "GET",
      "/me/mfa/status",
    ),
  mfaEnrollStart: () =>
    request<{ secret: string; otpauthUrl: string; qrcodeDataUrl: string }>(
      "POST",
      "/me/mfa/enroll/start",
    ),
  mfaEnrollVerify: (code: string) =>
    request<{ ok: true; recoveryCodes: string[] }>(
      "POST",
      "/me/mfa/enroll/verify",
      { code },
    ),
  // Pass either { code } (TOTP) or { recoveryCode } (single-use backup).
  // Sending both returns 400; the backend schema is .strict().
  mfaVerify: (input: { code?: string; recoveryCode?: string }) =>
    request<{ ok: true }>("POST", "/me/mfa/verify", input),
  mfaDisable: (code: string) =>
    request<{ ok: true }>("POST", "/me/mfa/disable", { code }),

  // ---- Clinic interventions (Phase 4) -------------------------------------
  // Doctor-scoped reads only -- the patient app handles writes via the
  // /api/patient/interventions/* endpoints. The worklist endpoint feeds
  // the new Patient Requested / Worse / Elevated / Repeated buckets on
  // the worklist page; the per-patient endpoint feeds the "Recent
  // Interventions" card on the patient detail page.
  clinicInterventionsWorklist: () =>
    request<ClinicInterventionsWorklist>(
      "GET",
      "/clinic/interventions",
    ),
  clinicPatientInterventions: (patientId: number) =>
    request<ClinicPatientInterventionsResponse>(
      "GET",
      // Server mounts the clinic intervention router at
      // /clinic/interventions, so the per-patient history sits at
      // /clinic/interventions/patients/:id (NOT /clinic/patients/:id/interventions,
      // which is reserved for the legacy patient-summary route).
      `/clinic/interventions/patients/${patientId}`,
    ),
};

export { HttpError };
