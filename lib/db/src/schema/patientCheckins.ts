import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  unique,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// All NEW columns below (appetite, digestion, hydration, bowelMovement,
// doseTakenToday, guidanceShown) are intentionally nullable. Existing
// rows pre-date the symptom-management feature, and the mobile clients
// out in the wild will not send them on every check-in. Server logic
// must treat absent values as "unknown", never as "low / no / false".
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
    // -- Symptom-management inputs (all optional) ---------------------
    // appetite/digestion mirror the existing pulse-pilot UI enums so
    // the patient app already has data to send. The server-side symptom
    // rules engine consumes these for "low_appetite" and
    // "constipation" detection respectively.
    appetite: text("appetite", {
      enum: ["strong", "normal", "low", "very_low"],
    }),
    digestion: text("digestion", {
      enum: ["fine", "bloated", "constipated", "diarrhea"],
    }),
    // Mirrors HydrationLevel in pulse-pilot. Used as a contributor for
    // both nausea and constipation guidance.
    hydration: text("hydration", {
      enum: ["hydrated", "good", "low", "dehydrated"],
    }),
    // Daily yes/no -- supports the constipation rule directly. null =
    // patient didn't answer, NOT a "no".
    bowelMovement: boolean("bowel_movement"),
    // Did the patient take their GLP-1 dose today? Lets the rules engine
    // correlate symptoms with same-day dosing without reaching into the
    // medication log table.
    doseTakenToday: boolean("dose_taken_today"),
    // Per-symptom acknowledgment of the in-app guidance card. Shape:
    //   { nausea?: true, constipation?: true, low_appetite?: true }
    // Used so the doctor dashboard can render "patient has already
    // received basic self-management guidance" alongside a flag.
    guidanceShown: jsonb("guidance_shown")
      .$type<{ nausea?: boolean; constipation?: boolean; low_appetite?: boolean }>()
      .default({}),
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
