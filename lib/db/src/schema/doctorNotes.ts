import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

export const doctorNotesTable = pgTable("doctor_notes", {
  id: serial("id").primaryKey(),
  patientUserId: integer("patient_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  doctorUserId: integer("doctor_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  // Doctor's self-reported outcome of the note. true = action resolved
  // the issue, false = needs more work, null = not answered yet. Kept
  // nullable so historical notes don't get a misleading default; this
  // becomes the seed of a worked-vs-didn't-work training signal.
  resolved: boolean("resolved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDoctorNoteSchema = createInsertSchema(doctorNotesTable).omit(
  { id: true, createdAt: true },
);
export type InsertDoctorNote = z.infer<typeof insertDoctorNoteSchema>;
export type DoctorNote = typeof doctorNotesTable.$inferSelect;
