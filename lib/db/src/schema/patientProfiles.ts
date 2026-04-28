import {
  pgTable,
  integer,
  text,
  real,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Server-persisted onboarding profile. Mirrors the small subset of
// the in-app UserProfile that the patient actually fills in during
// onboarding and that we need available to the clinician /
// analytics layer or to recover after an app reinstall. The richer
// per-day state (today's energy, today's hydration, etc.) lives in
// patient_checkins -- this table is for slow-changing identity-style
// fields only.
//
// Single row per patient (PK is patient_user_id) so the patient app
// can blind-upsert without first issuing a SELECT. Field set is
// intentionally small and aligned 1-to-1 with what the onboarding UI
// already collects -- we deliberately do NOT mirror the entire
// UserProfile (no body fat, no chat tone, no fasting protocol) to
// avoid overcollecting.
export const patientProfilesTable = pgTable("patient_profiles", {
  patientUserId: integer("patient_user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Age in years at onboarding. Date of birth is intentionally not
  // captured; the app only asks for age.
  age: integer("age"),
  sex: text("sex", { enum: ["male", "female", "other"] }),
  // Height stored in inches for the imperial app today. A future kg/cm
  // path would store cm here and rely on `units` to interpret; for
  // MVP we keep one column to stay lean.
  heightInches: real("height_inches"),
  // Patient-reported current weight (separate from patient_weights
  // log; this is the onboarding snapshot only).
  weightLbs: real("weight_lbs"),
  goalWeightLbs: real("goal_weight_lbs"),
  units: text("units", { enum: ["imperial", "metric"] }),
  // Free-form list of HealthGoal strings the app already uses
  // (e.g. ["fat_loss", "stay_consistent"]). Stored as jsonb so adding
  // a new goal type doesn't require a migration.
  goals: jsonb("goals").$type<string[]>().default([]),
  glp1Medication: text("glp1_medication"),
  glp1Reason: text("glp1_reason"),
  glp1Duration: text("glp1_duration"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPatientProfileSchema = createInsertSchema(
  patientProfilesTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertPatientProfile = z.infer<typeof insertPatientProfileSchema>;
export type PatientProfile = typeof patientProfilesTable.$inferSelect;
