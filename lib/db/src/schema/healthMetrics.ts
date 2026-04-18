import {
  pgTable,
  serial,
  integer,
  date,
  timestamp,
  numeric,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Daily wearable / weight snapshot. All metric columns are nullable since
// patients may have a scale but no wearable, or vice versa, and we still
// want to record what we have.
export const healthMetricsTable = pgTable(
  "health_metrics",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    sleepMinutes: integer("sleep_minutes"),
    restingHr: integer("resting_hr"),
    hrv: integer("hrv"),
    steps: integer("steps"),
    weightKg: numeric("weight_kg"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqPatientDate: unique().on(t.patientUserId, t.date),
  }),
);

export const insertHealthMetricSchema = createInsertSchema(
  healthMetricsTable,
).omit({ id: true, createdAt: true });
export type InsertHealthMetric = z.infer<typeof insertHealthMetricSchema>;
export type HealthMetric = typeof healthMetricsTable.$inferSelect;
