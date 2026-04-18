import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// One row per scheduled dose. `status` is the source of truth for adherence
// scoring -- "missed" includes anything the patient never confirmed within
// a reasonable window. `skipped` is intentional (sick day, fasting, etc).
export const medicationEventsTable = pgTable(
  "medication_events",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    scheduledFor: date("scheduled_for").notNull(),
    takenAt: timestamp("taken_at"),
    status: text("status", {
      enum: ["taken", "missed", "skipped"],
    }).notNull(),
    doseMg: numeric("dose_mg"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatientDate: index("med_events_by_patient_date").on(
      t.patientUserId,
      t.scheduledFor,
    ),
  }),
);

export const insertMedicationEventSchema = createInsertSchema(
  medicationEventsTable,
).omit({ id: true, createdAt: true });
export type InsertMedicationEvent = z.infer<
  typeof insertMedicationEventSchema
>;
export type MedicationEvent = typeof medicationEventsTable.$inferSelect;
