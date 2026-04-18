import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

export const patientCheckinsTable = pgTable(
  "patient_checkins",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    energy: text("energy", {
      enum: ["depleted", "tired", "good", "great"],
    }).notNull(),
    nausea: text("nausea", {
      enum: ["none", "mild", "moderate", "severe"],
    }).notNull(),
    mood: integer("mood").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqPatientDate: unique().on(t.patientUserId, t.date),
  }),
);

export const insertPatientCheckinSchema = createInsertSchema(
  patientCheckinsTable,
).omit({ id: true, createdAt: true });
export type InsertPatientCheckin = z.infer<typeof insertPatientCheckinSchema>;
export type PatientCheckin = typeof patientCheckinsTable.$inferSelect;
