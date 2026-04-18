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
    // Digestion / GI tract complaint, captured separately from nausea so we
    // can score gut-side effects independently of stomach-side effects.
    digestion: text("digestion", {
      enum: ["normal", "bloated", "constipated", "diarrhea"],
    }),
    appetite: text("appetite", {
      enum: ["very_low", "low", "normal", "strong"],
    }),
    mood: integer("mood").notNull(),
    // 1-5 self-reported drive to stay on plan; distinct from mood since
    // mood can be fine while motivation collapses (or vice versa).
    motivation: integer("motivation"),
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
