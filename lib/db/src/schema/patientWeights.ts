import {
  pgTable,
  serial,
  integer,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Weekly weight log. Intentionally a SEPARATE table from
// patient_checkins so weight tracking can stay on a different cadence
// (every ~7 days) without bloating the daily check-in row or coupling
// its absence to "patient skipped a day". Each entry is append-only:
// we never UPDATE rows, only INSERT new ones, so the table doubles as
// a clean weight history if we want to surface a trend later.
export const patientWeightsTable = pgTable(
  "patient_weights",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Stored as lbs (real). MVP only supports lbs entry; we keep this
    // a real so a future kg-aware UI can record fractional values
    // without a schema change.
    weightLbs: real("weight_lbs").notNull(),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatient: index("patient_weights_by_patient").on(
      t.patientUserId,
      t.recordedAt,
    ),
  }),
);

export type PatientWeight = typeof patientWeightsTable.$inferSelect;
