import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Intervention surface from which the recommendation was rendered.
export const INTERVENTION_SURFACES = ["Today", "WeeklyPlan", "Coach"] as const;
export type InterventionSurface = (typeof INTERVENTION_SURFACES)[number];

// Normalized intervention type. Matches the central treatment-state
// primaryFocus + the symptom-tip catalog. Kept narrow on purpose so
// downstream analytics can group cleanly.
export const INTERVENTION_TYPES = [
  "hydration",
  "protein_fueling",
  "light_movement",
  "recovery_rest",
  "symptom_monitoring",
  "clinician_escalation",
  "dose_day_caution",
  "adherence_checkin",
] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];

// Compact treatment-state snapshot kept on each event. Mirrors the
// fields the analytics view groups by. Stored as JSONB so we don't
// have to migrate the table every time DailyTreatmentState gains a
// lens.
export interface InterventionTreatmentSnapshot {
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
}

// Compact claims-policy summary -- which boolean gates were true at
// the moment the intervention surfaced. Independent of the
// per-signal confidence summary below.
export interface InterventionClaimsPolicySummary {
  canCiteSleep: boolean;
  canCiteHRV: boolean;
  canCiteRecovery: boolean;
  canCiteSteps: boolean;
  physiologicalClaimsAllowed: boolean;
  narrativeConfidence: "low" | "moderate" | "high";
}

// Per-signal confidence summary at the moment the intervention
// surfaced. Used by analytics to slice outcomes by confidence band.
export type SignalConfidenceLevel = "none" | "low" | "medium" | "high";
export interface InterventionSignalConfidenceSummary {
  hrv: SignalConfidenceLevel;
  rhr: SignalConfidenceLevel;
  sleepDuration: SignalConfidenceLevel;
  sleepQuality: SignalConfidenceLevel;
  recovery: SignalConfidenceLevel;
  activity: SignalConfidenceLevel;
}

export const interventionEventsTable = pgTable(
  "intervention_events",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    occurredOn: date("occurred_on").notNull(),
    surface: text("surface", { enum: INTERVENTION_SURFACES }).notNull(),
    interventionType: text("intervention_type", {
      enum: INTERVENTION_TYPES,
    }).notNull(),
    title: text("title").notNull(),
    rationale: text("rationale"),
    treatmentStateSnapshot: jsonb("treatment_state_snapshot")
      .$type<InterventionTreatmentSnapshot>()
      .notNull(),
    claimsPolicySummary: jsonb("claims_policy_summary")
      .$type<InterventionClaimsPolicySummary>()
      .notNull(),
    signalConfidenceSummary: jsonb("signal_confidence_summary")
      .$type<InterventionSignalConfidenceSummary>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatientDate: index("intervention_events_patient_date_idx").on(
      t.patientUserId,
      t.occurredOn,
    ),
    byType: index("intervention_events_type_idx").on(t.interventionType),
  }),
);

export const insertInterventionEventSchema = createInsertSchema(
  interventionEventsTable,
).omit({ id: true, createdAt: true, occurredAt: true });
export type InsertInterventionEvent = z.infer<
  typeof insertInterventionEventSchema
>;
export type InterventionEvent = typeof interventionEventsTable.$inferSelect;
