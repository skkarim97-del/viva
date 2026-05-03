import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// patient_plan_items -- per-patient weekly plan persistence.
//
// Replaces the AsyncStorage-only WEEKLY_PLAN_KEY + COMPLETION_KEY
// pair. Server is now source of truth so:
//   * data survives reinstall / device swap
//   * Clinic / Analytics can compute "plan completion rate"
//   * adherence can be a real KPI, not a local-only number
//
// Cadence:
//   weekStart is the Monday of the week (YYYY-MM-DD).
//   dayIndex is 0..6 (0 = Monday, 6 = Sunday).
//   date is the absolute date for that slot (denormalized for
//     simpler date-range queries; weekStart + dayIndex must agree).
//
// Category mirrors the mobile ActionCategory enum
// (artifacts/pulse-pilot/lib/engine/planEngine.ts and friends):
//   move / fuel / hydrate / recover / consistent
//
// Source distinguishes the AI/template auto-suggestion from a
// patient-selected override -- needed for the "patient adjusted
// their plan" engagement signal.
//
// Completion is a single completedAt timestamp (not a boolean) so
// we get the time-of-day for adherence-pattern analytics. NULL =
// not done. Re-completing after un-completing overwrites.
//
// We INTENTIONALLY upsert by (patient_user_id, week_start, day_index,
// category) rather than appending a new row per change so the
// dashboard's "current plan" query is a simple SELECT.

export const PLAN_ITEM_CATEGORIES = [
  "move",
  "fuel",
  "hydrate",
  "recover",
  "consistent",
] as const;
export type PlanItemCategory = (typeof PLAN_ITEM_CATEGORIES)[number];

export const PLAN_ITEM_SOURCES = ["auto", "patient_override"] as const;
export type PlanItemSource = (typeof PLAN_ITEM_SOURCES)[number];

export const patientPlanItemsTable = pgTable(
  "patient_plan_items",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Monday of the week (YYYY-MM-DD).
    weekStart: date("week_start").notNull(),
    // 0..6 (0 = Monday, 6 = Sunday). Validated in zod, not at DB
    // level (drizzle/pg has no cheap CHECK + we keep it permissive
    // for future 14-day plans).
    dayIndex: integer("day_index").notNull(),
    // Absolute date this slot belongs to. Denormalized for query
    // ergonomics ("show me everything completed this week").
    date: date("date").notNull(),
    category: text("category", { enum: PLAN_ITEM_CATEGORIES }).notNull(),
    // The original AI/template suggestion (display text).
    recommended: text("recommended"),
    // What the patient ended up with (may equal recommended).
    chosen: text("chosen"),
    source: text("source", { enum: PLAN_ITEM_SOURCES })
      .notNull()
      .default("auto"),
    // NULL = not completed. Set to now() when completed; cleared on
    // uncomplete.
    completedAt: timestamp("completed_at"),
    // Optional display copy. focusArea is the day-level theme
    // (lives in metadata too for forward-compat); title/subtitle
    // are reserved for richer card variants without a schema bump.
    title: text("title"),
    subtitle: text("subtitle"),
    // Extra structured data: optionId (for analytics joins),
    // focusArea, generator info, etc. PHI-free by convention.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqSlot: unique("patient_plan_items_slot_uniq").on(
      t.patientUserId,
      t.weekStart,
      t.dayIndex,
      t.category,
    ),
    byPatientWeek: index("patient_plan_items_patient_week_idx").on(
      t.patientUserId,
      t.weekStart,
    ),
    byPatientDate: index("patient_plan_items_patient_date_idx").on(
      t.patientUserId,
      t.date,
    ),
  }),
);

export type InsertPatientPlanItem = typeof patientPlanItemsTable.$inferInsert;
export type PatientPlanItem = typeof patientPlanItemsTable.$inferSelect;
