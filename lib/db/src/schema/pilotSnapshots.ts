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
import { usersTable } from "./users";

// Frozen Pilot Metrics readouts. Snapshots are append-only: once a row is
// inserted, the metrics blob and date range never change. The live
// /pilot dashboard keeps recomputing for the rolling window; snapshots
// pin a specific window so partners can compare e.g. Day 15 vs Day 30
// readings without the underlying numbers shifting.
//
// Scope columns are nullable because today's pilot is whole-cohort
// (operator-key dashboard, no per-doctor / per-clinic split). They exist
// so a future per-clinic or per-doctor snapshot can be added without a
// schema change.
//
// generatedByUserId is nullable because the snapshot is created via the
// operator key, which is not a user row. generatedByLabel always carries
// a human-readable string the UI can show ("operator", or in the future
// the doctor's name when a doctor-scoped snapshot path lands).
//
// metricDefinitionVersion records which version of the computation logic
// produced the metrics blob. It must be bumped whenever the meaning of
// any KPI changes (window size defaults, dedupe windows, definition of
// "acted on"/"reviewed", etc.) so an old snapshot can never be silently
// re-interpreted with new rules.
export const pilotSnapshotsTable = pgTable(
  "pilot_snapshots",
  {
    id: serial("id").primaryKey(),

    // Scope -- both nullable for "all clinics / all doctors".
    clinicName: text("clinic_name"),
    doctorUserId: integer("doctor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    // Window the metrics describe. Stored as `date` (YYYY-MM-DD) because
    // the cohort is described by a calendar window, not by exact
    // millisecond bounds. The server expands these to inclusive
    // [start 00:00, end 23:59:59.999] when computing.
    cohortStartDate: date("cohort_start_date").notNull(),
    cohortEndDate: date("cohort_end_date").notNull(),

    // When the snapshot was taken and by whom.
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    generatedByUserId: integer("generated_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    generatedByLabel: text("generated_by_label").notNull(),

    // Computation version + payload.
    metricDefinitionVersion: text("metric_definition_version").notNull(),
    patientCount: integer("patient_count").notNull(),
    metrics: jsonb("metrics").notNull(),

    // Free-text operator notes ("Day 15 readout for partner check-in").
    notes: text("notes"),
  },
  (table) => ({
    // Most reads are "list snapshots, newest first" -- index supports it.
    generatedAtIdx: index("pilot_snapshots_generated_at_idx").on(
      table.generatedAt,
    ),
  }),
);

export type PilotSnapshot = typeof pilotSnapshotsTable.$inferSelect;
export type NewPilotSnapshot = typeof pilotSnapshotsTable.$inferInsert;
