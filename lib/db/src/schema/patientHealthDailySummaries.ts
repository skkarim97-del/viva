import {
  pgTable,
  serial,
  integer,
  real,
  boolean,
  date,
  text,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// One row per patient per calendar day. Mirrors the daily Apple Health
// summary the mobile app already computes locally for the Trends tab.
// Every metric column is nullable because not every patient has every
// signal: a phone-only user has steps but no HRV; a wearable user has
// HRV but might be missing weight; etc. Server logic must treat absent
// values as "unknown", never as zero.
//
// We store derived daily summaries only -- never raw HealthKit
// samples. This keeps the table small enough to scan without an index
// for the dashboard's recent-N read, and side-steps the privacy /
// volume problem of mirroring an entire phone's health log.
export const patientHealthDailySummariesTable = pgTable(
  "patient_health_daily_summaries",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    summaryDate: date("summary_date").notNull(),
    steps: integer("steps"),
    sleepMinutes: integer("sleep_minutes"),
    restingHeartRate: integer("resting_heart_rate"),
    // HRV in milliseconds. Real because Apple reports fractional ms.
    hrv: real("hrv"),
    activeCalories: integer("active_calories"),
    // Did the patient hit the activity ring / move-goal threshold?
    // Kept as a separate boolean so the dashboard can render an
    // "active days last week" tile without re-deriving from calories.
    activeDay: boolean("active_day"),
    // Optional weight pulled from HealthKit. Distinct from
    // patient_weights, which is patient-typed entries from the app.
    // Both can coexist; consumers prefer the freshest source.
    weightLbs: real("weight_lbs"),
    // Free-form provenance label (e.g. "apple_health", "manual",
    // "garmin"). Kept text rather than enum so future sources don't
    // require a migration.
    source: text("source"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqPatientDate: unique("phds_patient_date_uniq").on(
      t.patientUserId,
      t.summaryDate,
    ),
    byPatientDate: index("phds_patient_date_idx").on(
      t.patientUserId,
      t.summaryDate,
    ),
  }),
);

export const insertPatientHealthDailySummarySchema = createInsertSchema(
  patientHealthDailySummariesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatientHealthDailySummary = z.infer<
  typeof insertPatientHealthDailySummarySchema
>;
export type PatientHealthDailySummary =
  typeof patientHealthDailySummariesTable.$inferSelect;
