import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// ----------------------------------------------------------------------
// careEvents -- the lightweight dual-layer intervention event stream.
//
// Why a new table instead of extending interventionEventsTable?
// interventionEventsTable is heavy (treatment-state snapshot + claims
// policy + signal confidence are all NOT NULL) and oriented at the
// AI-coach analytics pipeline. The dual-layer loop needs to record
// events from THREE actors -- viva (system), patient, doctor -- and
// types like `doctor_reviewed` have no treatment snapshot to take.
// Keeping the two tables separate avoids forcing fake snapshots and
// keeps the funnel queries simple.
// ----------------------------------------------------------------------

export const CARE_EVENT_SOURCES = ["viva", "doctor", "patient"] as const;
export type CareEventSource = (typeof CARE_EVENT_SOURCES)[number];

export const CARE_EVENT_TYPES = [
  "coach_message",
  "recommendation_shown",
  "escalation_requested",
  "doctor_reviewed",
  "doctor_note",
  "treatment_status_updated",
  // Explicit doctor-side signal that a clinician completed real
  // follow-up on a prior escalation. Distinct from doctor_reviewed
  // (which only acknowledges that the escalation was seen). Carries
  // triggerEventId pointing back at the escalation_requested row when
  // one exists, so the analytics funnel can compute time-to-follow-up.
  "follow_up_completed",
] as const;
export type CareEventType = (typeof CARE_EVENT_TYPES)[number];

export const careEventsTable = pgTable(
  "care_events",
  {
    id: serial("id").primaryKey(),
    // The patient the event is ABOUT. Always set, even for doctor /
    // viva-emitted events.
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // The user who took the action. Doctor for doctor_*, patient for
    // escalation_requested, NULL for system-emitted viva events.
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: CARE_EVENT_SOURCES }).notNull(),
    type: text("type", { enum: CARE_EVENT_TYPES }).notNull(),
    // Optional self-reference to the upstream trigger care_event (e.g.
    // a follow_up_completed pointing back at the escalation_requested
    // it answered). Self-FK kept loose: AnyPgColumn cast to avoid the
    // circular type dance and ON DELETE SET NULL so deleting a trigger
    // never cascades.
    triggerEventId: integer("trigger_event_id"),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    // Free-form per-event payload. Examples: {status, stopReason} for
    // treatment_status_updated; {messageLength, mode} for coach_message;
    // {note} for escalation_requested when the patient adds context.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatient: index("care_events_patient_occurred_idx").on(
      t.patientUserId,
      t.occurredAt,
    ),
    byType: index("care_events_type_occurred_idx").on(t.type, t.occurredAt),
  }),
);

export const insertCareEventSchema = createInsertSchema(careEventsTable).omit({
  id: true,
  createdAt: true,
  occurredAt: true,
});
export type InsertCareEvent = z.infer<typeof insertCareEventSchema>;
export type CareEvent = typeof careEventsTable.$inferSelect;
