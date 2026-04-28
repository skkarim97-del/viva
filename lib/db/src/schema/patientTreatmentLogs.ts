import {
  pgTable,
  serial,
  integer,
  text,
  date,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Patient-confirmed treatment history. Append-only audit log of what
// the patient says they are on (or have been on), captured as the
// patient changes selections in the Viva Care app. Distinct from
// patients.glp1Drug / patients.dose, which are clinician-set and stay
// the source of truth for the dashboard. We keep both: the clinician
// view continues to read the patients row; analytics and titration
// reasoning can read this history.
export const TREATMENT_LOG_SOURCES = ["patient", "doctor"] as const;
export type TreatmentLogSource = (typeof TREATMENT_LOG_SOURCES)[number];

// Free-text on purpose: the patient app collects medication name from
// a curated picker plus an "other" path, and dose/frequency are also
// short strings (e.g. "2.5", "mg", "weekly"). Anything richer would
// require a structured catalog change every time a new GLP-1 ships.
export const patientTreatmentLogsTable = pgTable(
  "patient_treatment_logs",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    medicationName: text("medication_name").notNull(),
    dose: real("dose"),
    doseUnit: text("dose_unit"),
    frequency: text("frequency"),
    startedOn: date("started_on"),
    source: text("source", { enum: TREATMENT_LOG_SOURCES })
      .notNull()
      .default("patient"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatientCreated: index("patient_treatment_logs_patient_created_idx").on(
      t.patientUserId,
      t.createdAt,
    ),
  }),
);

export const insertPatientTreatmentLogSchema = createInsertSchema(
  patientTreatmentLogsTable,
).omit({ id: true, createdAt: true });
export type InsertPatientTreatmentLog = z.infer<
  typeof insertPatientTreatmentLogSchema
>;
export type PatientTreatmentLog =
  typeof patientTreatmentLogsTable.$inferSelect;
