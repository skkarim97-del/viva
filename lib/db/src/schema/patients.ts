import { pgTable, integer, text, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

export const patientsTable = pgTable("patients", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  doctorId: integer("doctor_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  glp1Drug: text("glp1_drug"),
  // Free-form dose label, e.g. "1mg weekly". Kept as a single text column
  // to stay lean -- structured titration history is intentionally out of
  // scope for the MVP.
  dose: text("dose"),
  startedOn: date("started_on"),
  // Single-use opaque token the doctor sends to a patient so the mobile
  // app can claim this account on first launch. Null after activation.
  activationToken: text("activation_token").unique(),
  // When the current activation token was issued (or last re-issued via
  // /patients/:id/resend). Null on legacy rows that predate this column;
  // the TTL check at activate time grandfathers those in (`null` -> no
  // expiry enforced) so we don't strand any in-flight pilot invites.
  // New tokens always get a stamp; the activation flow rejects tokens
  // older than INVITE_TOKEN_TTL_DAYS with 410 Gone.
  activationTokenIssuedAt: timestamp("activation_token_issued_at"),
  // Stamped the first time the patient signs in to the mobile app. While
  // null the dashboard shows the patient as "Pending activation" and
  // skips risk scoring entirely (no signals to score yet).
  activatedAt: timestamp("activated_at"),

  // ----- Treatment status (lean MVP retention layer) -----------------
  // active = currently on treatment (clinician-confirmed or system-
  //          assumed for activated patients before any explicit mark)
  // stopped = explicitly marked as no longer on treatment
  // unknown = not enough info to confidently label
  // We deliberately keep this to three values + an optional at-risk
  // derived in code, not a DB column, to avoid taxonomy creep.
  treatmentStatus: text("treatment_status", {
    enum: ["active", "stopped", "unknown"],
  })
    .notNull()
    .default("unknown"),
  // Who set the current status. doctor = clinician dashboard control,
  // patient = future patient-app self-report (not yet wired),
  // system = backfill / activation-time assumption.
  treatmentStatusSource: text("treatment_status_source", {
    enum: ["doctor", "patient", "system"],
  }),
  // Only meaningful when treatmentStatus = 'stopped'. Cleared on any
  // transition back to active/unknown.
  stopReason: text("stop_reason", {
    enum: [
      "side_effects",
      "cost_or_insurance",
      "lack_of_efficacy",
      "patient_choice_or_motivation",
      "other",
    ],
  }),
  // Optional free-text doctor note, capped at 500 chars at the API.
  stopNote: text("stop_note"),
  treatmentStatusUpdatedAt: timestamp("treatment_status_updated_at"),
  treatmentStatusUpdatedBy: integer("treatment_status_updated_by"),
});

export const TREATMENT_STATUSES = ["active", "stopped", "unknown"] as const;
export type TreatmentStatus = (typeof TREATMENT_STATUSES)[number];

export const TREATMENT_STATUS_SOURCES = ["doctor", "patient", "system"] as const;
export type TreatmentStatusSource = (typeof TREATMENT_STATUS_SOURCES)[number];

// Stop-reason taxonomy. Deliberately small + flat: pilots need to know
// "is churn mostly side-effect driven?" -- adding more buckets only
// fragments the signal. Free-text stopNote covers nuance.
export const STOP_REASONS = [
  "side_effects",
  "cost_or_insurance",
  "lack_of_efficacy",
  "patient_choice_or_motivation",
  "other",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// Stop-timing buckets, derived from (treatmentStatusUpdatedAt - startedOn).
// Not persisted: we recompute on read so backfills / corrections to
// startedOn flow through automatically. Keep thresholds in one place
// so server analytics and the UI agree.
// Buckets: 0-30, 31-60, 61-90, >90 days, plus unknown when start or stop
// is missing.
export const STOP_TIMING_BUCKET_30_DAYS = 30;
export const STOP_TIMING_BUCKET_60_DAYS = 60;
export const STOP_TIMING_BUCKET_90_DAYS = 90;
export type StopTiming = "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown";
export const STOP_TIMING_BUCKETS: readonly Exclude<StopTiming, "unknown">[] = [
  "d0_30",
  "d31_60",
  "d61_90",
  "d90_plus",
] as const;
export function deriveStopTiming(
  startedOn: string | Date | null | undefined,
  stoppedAt: string | Date | null | undefined,
): { bucket: StopTiming; daysOnTreatment: number | null } {
  if (!startedOn || !stoppedAt) {
    return { bucket: "unknown", daysOnTreatment: null };
  }
  const start =
    startedOn instanceof Date ? startedOn : new Date(startedOn);
  const stop = stoppedAt instanceof Date ? stoppedAt : new Date(stoppedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) {
    return { bucket: "unknown", daysOnTreatment: null };
  }
  const days = Math.max(
    0,
    Math.floor((stop.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );
  let bucket: StopTiming;
  if (days <= STOP_TIMING_BUCKET_30_DAYS) bucket = "d0_30";
  else if (days <= STOP_TIMING_BUCKET_60_DAYS) bucket = "d31_60";
  else if (days <= STOP_TIMING_BUCKET_90_DAYS) bucket = "d61_90";
  else bucket = "d90_plus";
  return { bucket, daysOnTreatment: days };
}

export const insertPatientSchema = createInsertSchema(patientsTable);
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
