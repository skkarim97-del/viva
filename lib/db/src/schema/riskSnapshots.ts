import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Append-only record of every risk computation. Storing each snapshot --
// rather than mutating a single row -- gives us the longitudinal history
// needed for trend charts now and ML training later.
export const riskSnapshotsTable = pgTable(
  "risk_snapshots",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
    score: integer("score").notNull(),
    bucket: text("bucket", { enum: ["green", "yellow", "red"] }).notNull(),
    // Drivers shape: { code, label, weight }[]. Stored as jsonb so the
    // engine can evolve its rule set without needing a column migration.
    drivers: jsonb("drivers").notNull(),
  },
  (t) => ({
    byPatientTime: index("risk_snapshots_by_patient_time").on(
      t.patientUserId,
      t.computedAt,
    ),
  }),
);

export const insertRiskSnapshotSchema = createInsertSchema(
  riskSnapshotsTable,
).omit({ id: true, computedAt: true });
export type InsertRiskSnapshot = z.infer<typeof insertRiskSnapshotSchema>;
export type RiskSnapshot = typeof riskSnapshotsTable.$inferSelect;

export interface RiskDriver {
  code: string;
  label: string;
  weight: number;
}
