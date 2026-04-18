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
}

export type Action = "needs_followup" | "monitor" | "stable";

export interface PatientRow {
  id: number;
  name: string;
  email: string;
  glp1Drug: string | null;
  dose: string | null;
  startedOn: string | null;
  lastCheckin: string | null;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  // Workflow state computed server-side: needs_followup / monitor / stable.
  action: Action;
  // Up to two short, scannable signals for this patient, primary first.
  // Empty array when no rules fired. The UI joins these with " · " so
  // two patients with the same primary signal don't read as identical.
  signals: string[];
  // ISO timestamp of the most recent care-team note for this patient,
  // or null if nobody has logged an action yet. Used to render
  // "Last note: 2d ago" on the queue so doctors don't double-up calls.
  lastNoteAt: string | null;
}

export interface PatientDetail {
  id: number;
  name: string;
  email: string;
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

export interface Risk {
  score: number;
  band: "low" | "medium" | "high";
  rules: FiredRule[];
  asOf: string;
  action: Action;
  // One-line directive derived from the highest-priority rule, e.g.
  // "Follow up on missed check-ins". Null when no rules fired.
  suggestedAction: string | null;
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

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<Me>("POST", "/auth/login", { email, password }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/auth/me"),

  // doctor
  patients: () => request<PatientRow[]>("GET", "/patients"),
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
