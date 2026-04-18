import { pgTable, integer, text, date, numeric } from "drizzle-orm/pg-core";
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
  startedOn: date("started_on"),
  // Dose configuration. doseMg is stored as numeric so we can capture
  // titration values like 0.25 / 0.5 / 1.0 / 1.7 / 2.4.
  doseMg: numeric("dose_mg"),
  doseFrequencyDays: integer("dose_frequency_days"),
  // The most recent titration event. The risk engine uses this to detect
  // recent escalations, which correlate with side-effect spikes.
  lastDoseChangeAt: date("last_dose_change_at"),
  // Personal baselines for the wearable-driven rules. Without these the
  // engine cannot tell whether a 78bpm resting HR is normal or alarming.
  baselineRestingHr: integer("baseline_resting_hr"),
  baselineSteps: integer("baseline_steps"),
  weightKg: numeric("weight_kg"),
});

export const insertPatientSchema = createInsertSchema(patientsTable);
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
