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
  // Stamped the first time the patient signs in to the mobile app. While
  // null the dashboard shows the patient as "Pending activation" and
  // skips risk scoring entirely (no signals to score yet).
  activatedAt: timestamp("activated_at"),
});

export const insertPatientSchema = createInsertSchema(patientsTable);
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
