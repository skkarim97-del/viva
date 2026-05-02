import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// ---------------------------------------------------------------------
// patient_interventions -- AI-personalized micro-intervention loop.
//
// Distinct from intervention_events (which is immutable analytics
// captured by the mobile rules engine when a tip renders) and
// care_events (which is a flat lifecycle event log). This table is
// the SINGLE SOURCE OF TRUTH for an intervention as a stateful
// entity: a row carries its lifecycle status from generation through
// patient acceptance, feedback collection, and (optional) escalation.
//
// Why a new table instead of extending existing ones:
//   * intervention_events: NOT NULL on treatment_state_snapshot/
//     claims_policy_summary; rows are append-only analytics, cannot
//     transition state.
//   * care_events: a flat event LOG, not an entity. Forcing a state
//     machine into it loses single-source-of-truth and pollutes the
//     analytics funnel queries.
//   * patient_checkins.guidanceShown: per-day jsonb on a single row;
//     cannot represent multiple concurrent interventions or a multi-
//     day lifecycle.
//
// The lifecycle hooks back into care_events for analytics: every
// status transition that maps to an existing CARE_EVENT_TYPE
// (recommendation_shown on insert, intervention_feedback on feedback,
// escalation_requested on /escalate) ALSO writes a care_events row
// with metadata.intervention_id pointing at this table's id, so the
// dashboard's existing worklist + funnel queries surface the right
// patients for free, without dual-source-of-truth drift.
// ---------------------------------------------------------------------

// Trigger taxonomy. Mirrors the spec's 11 cases exactly. Kept narrow
// on purpose so the rule engine produces predictable buckets that
// analytics, the dashboard worklist, and the de-identified OpenAI
// payload can all key off without string surprises.
export const PATIENT_INTERVENTION_TRIGGER_TYPES = [
  "nausea",
  "constipation",
  "low_energy",
  "low_hydration",
  "low_food_intake",
  "missed_checkin",
  "rapid_weight_change",
  "worsening_symptom",
  "repeated_symptom",
  "patient_requested_review",
] as const;
export type PatientInterventionTriggerType =
  (typeof PATIENT_INTERVENTION_TRIGGER_TYPES)[number];

// Lifecycle. shown is the initial state; from there the patient can
// accept (-> pending_feedback), dismiss (-> dismissed), or escalate
// (-> escalated). After acceptance the patient submits feedback
// (-> feedback_collected). "better" feedback flips to resolved;
// "worse" feedback may flip to escalated. expired is the timeout
// state for a pending_feedback row that never received feedback.
export const PATIENT_INTERVENTION_STATUSES = [
  "shown",
  "accepted",
  "dismissed",
  "pending_feedback",
  "feedback_collected",
  "resolved",
  "escalated",
  "expired",
] as const;
export type PatientInterventionStatus =
  (typeof PATIENT_INTERVENTION_STATUSES)[number];

// Three-tier risk. moderate vs elevated is what drives the dashboard
// worklist bucketing -- elevated routes to "Worse After Intervention"
// or "Patient Requested Review" priority lanes.
export const PATIENT_INTERVENTION_RISK_LEVELS = [
  "low",
  "moderate",
  "elevated",
] as const;
export type PatientInterventionRiskLevel =
  (typeof PATIENT_INTERVENTION_RISK_LEVELS)[number];

// Patient feedback verbatim from the spec. didnt_try carries no
// outcome attribution -- it does NOT count as helped or worse.
export const PATIENT_INTERVENTION_FEEDBACK_RESULTS = [
  "better",
  "same",
  "worse",
  "didnt_try",
] as const;
export type PatientInterventionFeedbackResult =
  (typeof PATIENT_INTERVENTION_FEEDBACK_RESULTS)[number];

// Generation provenance. PILOT default is rules_fallback (no OpenAI
// dial); rules_ai_deidentified is set ONLY when the OpenAI call
// succeeded with a payload that passed the PHI scanner. rules_only
// is reserved for purely deterministic (no AI, no template) cases.
export const PATIENT_INTERVENTION_GENERATED_BY = [
  "rules_ai_deidentified",
  "rules_fallback",
  "rules_only",
] as const;
export type PatientInterventionGeneratedBy =
  (typeof PATIENT_INTERVENTION_GENERATED_BY)[number];

// Bounded recommendation category. The spec's allowed action list
// from Part 5 -- the OpenAI system prompt is constrained to pick
// one of these, and the fallback templates are pre-tagged with one.
export const PATIENT_INTERVENTION_RECOMMENDATION_CATEGORIES = [
  "hydration",
  "activity",
  "protein",
  "fiber",
  "small_meal",
  "rest",
  "tracking",
  "care_team_review",
] as const;
export type PatientInterventionRecommendationCategory =
  (typeof PATIENT_INTERVENTION_RECOMMENDATION_CATEGORIES)[number];

export const patientInterventionsTable = pgTable(
  "patient_interventions",
  {
    id: serial("id").primaryKey(),

    // The patient the intervention is FOR. Cascade-on-delete so a
    // user wipe also removes their interventions; matches every
    // other patient-scoped table.
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    // The doctor who owns this patient at generation time. Captured
    // here (rather than re-derived at read time) so the clinic
    // worklist query can index on (doctor_id, status) without a
    // join to patients. NULL when the patient has no assigned
    // doctor (rare on the pilot but possible).
    doctorId: integer("doctor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    triggerType: text("trigger_type", {
      enum: PATIENT_INTERVENTION_TRIGGER_TYPES,
    }).notNull(),

    // Free-text symptom name when applicable (e.g. "constipation"
    // for the constipation trigger, null for missed_checkin). Kept
    // free-text rather than enum because the symptom catalog is
    // larger than the trigger taxonomy.
    symptomType: text("symptom_type"),

    // Severity 1..5 from the spec. Nullable because not every
    // trigger has a severity (missed_checkin, patient_requested_review).
    severity: integer("severity"),

    status: text("status", { enum: PATIENT_INTERVENTION_STATUSES })
      .notNull()
      .default("shown"),

    riskLevel: text("risk_level", {
      enum: PATIENT_INTERVENTION_RISK_LEVELS,
    })
      .notNull()
      .default("low"),

    // INTERNAL ONLY. Full PHI-bearing context snapshot from
    // buildPatientInterventionContext(). NEVER sent to OpenAI; the
    // de-id payload below is what crosses the boundary. Kept on the
    // row for clinical context on the dashboard's "Recent
    // Interventions" card and for post-hoc audit ("what data drove
    // this recommendation?").
    contextSummary: jsonb("context_summary").notNull().default({}),

    // The EXACT payload that was sent to OpenAI, after PHI strip.
    // NULL when generated_by != 'rules_ai_deidentified'. This is
    // the primary auditor-facing column: a HIPAA reviewer should
    // be able to SELECT this from any row and confirm no PHI is
    // present. Storing the post-strip payload (vs reconstructing
    // it later) means the audit cannot drift from what actually
    // crossed the boundary.
    deidentifiedAiPayload: jsonb("deidentified_ai_payload"),

    whatWeNoticed: text("what_we_noticed").notNull(),
    recommendation: text("recommendation").notNull(),
    followUpQuestion: text("follow_up_question").notNull(),

    recommendationCategory: text("recommendation_category", {
      enum: PATIENT_INTERVENTION_RECOMMENDATION_CATEGORIES,
    }),

    feedbackResult: text("feedback_result", {
      enum: PATIENT_INTERVENTION_FEEDBACK_RESULTS,
    }),

    // Optional patient free-text on feedback or escalation. INTERNAL
    // ONLY -- never enters the OpenAI payload. Capped at 1000 chars
    // at the route boundary; storage is intentionally text() because
    // a patient writing their care team a note may exceed varchar(N)
    // and we'd rather truncate at the route than fail at insert.
    patientNote: text("patient_note"),

    // Free-text (but rule-engine-emitted) reason a row escalated.
    // Examples: "patient_feedback_worse", "rapid_weight_drop",
    // "patient_requested". Distinct from the rendered escalation
    // copy that the patient sees.
    escalationReason: text("escalation_reason"),

    generatedBy: text("generated_by", {
      enum: PATIENT_INTERVENTION_GENERATED_BY,
    })
      .notNull()
      .default("rules_fallback"),

    // Lifecycle timestamps. Each null until the corresponding
    // transition fires; we never backfill or guess. Useful for
    // pilot funnel analytics (time-from-trigger-to-feedback) and
    // for the dashboard's "Pending feedback for X hours" badge.
    acceptedAt: timestamp("accepted_at"),
    feedbackRequestedAt: timestamp("feedback_requested_at"),
    feedbackCollectedAt: timestamp("feedback_collected_at"),
    escalatedAt: timestamp("escalated_at"),
    resolvedAt: timestamp("resolved_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // "Active interventions for this patient" -- the most-hit query
    // (mobile /active endpoint). Status comes second so the index
    // is useful for both the patient view and the dashboard view.
    byPatientStatusCreated: index(
      "patient_interventions_patient_status_created_idx",
    ).on(t.patientUserId, t.status, t.createdAt),
    // "Active interventions for this doctor's patients" -- the
    // dashboard worklist query. Same shape as above but keyed off
    // doctor_id so we don't need a join.
    byDoctorStatusCreated: index(
      "patient_interventions_doctor_status_created_idx",
    ).on(t.doctorId, t.status, t.createdAt),
    // Used by the expire-stale-pending sweeper (status=
    // pending_feedback AND created_at < now() - threshold).
    byStatusCreated: index(
      "patient_interventions_status_created_idx",
    ).on(t.status, t.createdAt),
    // Analytics funnel grouping ("interventions by trigger type").
    byTriggerCreated: index(
      "patient_interventions_trigger_created_idx",
    ).on(t.triggerType, t.createdAt),
    // Worklist priority lane: elevated risk first.
    byRiskCreated: index(
      "patient_interventions_risk_created_idx",
    ).on(t.riskLevel, t.createdAt),
  }),
);

export const insertPatientInterventionSchema = createInsertSchema(
  patientInterventionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatientIntervention = z.infer<
  typeof insertPatientInterventionSchema
>;
export type PatientIntervention =
  typeof patientInterventionsTable.$inferSelect;
