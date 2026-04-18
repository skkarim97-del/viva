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
}

export interface PatientDetail {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  glp1Drug: string | null;
  dose: string | null;
  startedOn: string | null;
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

const BASE = "/api";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
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
  patients: () => request<PatientRow[]>("GET", "/patients"),
  doctorStats: () =>
    request<{ actionsToday: number }>("GET", "/patients/stats"),
  patient: (id: number) => request<PatientDetail>("GET", `/patients/${id}`),
  patientCheckins: (id: number) =>
    request<Checkin[]>("GET", `/patients/${id}/checkins`),
  patientRisk: (id: number) => request<Risk>("GET", `/patients/${id}/risk`),
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
};

export { HttpError };
