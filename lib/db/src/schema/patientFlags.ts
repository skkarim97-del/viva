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

// Flags are durable state -- a flag opens the first time its rule fires
// and closes the moment that rule stops firing. This way the dashboard
// can show "open issues" without having to recompute history.
export const patientFlagsTable = pgTable(
  "patient_flags",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    severity: text("severity", { enum: ["red", "green", "info"] }).notNull(),
    label: text("label").notNull(),
    // Free-form structured context: which checkins fired the rule, the
    // computed delta vs baseline, etc. Lets us inspect a flag months
    // later without re-running history.
    detail: jsonb("detail"),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => ({
    byPatientOpen: index("flags_by_patient_open").on(
      t.patientUserId,
      t.resolvedAt,
    ),
  }),
);

export const insertPatientFlagSchema = createInsertSchema(
  patientFlagsTable,
).omit({ id: true, openedAt: true, resolvedAt: true });
export type InsertPatientFlag = z.infer<typeof insertPatientFlagSchema>;
export type PatientFlag = typeof patientFlagsTable.$inferSelect;
