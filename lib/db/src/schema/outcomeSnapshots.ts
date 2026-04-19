import {
  pgTable,
  serial,
  integer,
  boolean,
  date,
  timestamp,
  numeric,
  text,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Daily proxy outcome snapshot per patient. One row per (patient, date).
// Computed server-side (or upserted by a daily job) so analytics joins
// stay simple. Each field is nullable because some signals (e.g.
// 30/60/90-day retention) only become known later -- we backfill via
// upsert as those windows mature.
export const outcomeSnapshotsTable = pgTable(
  "outcome_snapshots",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),

    // -- Proxy outcomes (computed from check-in / log data) --
    dailyCheckinCompleted: boolean("daily_checkin_completed"),
    nextDayCheckinCompleted: boolean("next_day_checkin_completed"),
    weeklyConsistency: numeric("weekly_consistency"), // 0-100
    medicationLogCompletion: numeric("medication_log_completion"), // 0-100
    // Direction over the 3-day window. "improved" / "same" / "worsened".
    symptomTrend3d: text("symptom_trend_3d", {
      enum: ["improved", "same", "worsened", "unknown"],
    }),
    // Did the patient open the app in the last 72h?
    appEngaged72h: boolean("app_engaged_72h"),
    // Did a clinician outreach get triggered for this patient on/around
    // this date (escalation tier flipped to "clinician")?
    clinicianOutreachTriggered: boolean("clinician_outreach_triggered"),

    // -- Retention windows (backfilled lazily) --
    treatmentActive30d: boolean("treatment_active_30d"),
    treatmentActive60d: boolean("treatment_active_60d"),
    treatmentActive90d: boolean("treatment_active_90d"),

    // -- Convenience flags used by intervention->outcome attribution --
    // Adherence improved over the 3-day window vs the prior 3-day
    // window (used as the proxy for "did the recommendation work?").
    adherenceImproved3d: boolean("adherence_improved_3d"),
    symptomImproved3d: boolean("symptom_improved_3d"),
    symptomWorsened3d: boolean("symptom_worsened_3d"),
    // True when the patient re-engaged after a low-adherence window
    // (e.g. came back after >= 2 missed check-ins). Used to measure
    // re-engagement effectiveness of REENGAGE-mode coach interactions.
    reengagedAfterLowAdherence: boolean("reengaged_after_low_adherence"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqPatientDate: unique("outcome_snapshots_patient_date_unique").on(
      t.patientUserId,
      t.snapshotDate,
    ),
    byDate: index("outcome_snapshots_date_idx").on(t.snapshotDate),
  }),
);

export const insertOutcomeSnapshotSchema = createInsertSchema(
  outcomeSnapshotsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOutcomeSnapshot = z.infer<typeof insertOutcomeSnapshotSchema>;
export type OutcomeSnapshot = typeof outcomeSnapshotsTable.$inferSelect;
