import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDoctorNoteSchema = createInsertSchema(doctorNotesTable).omit(
  { id: true, createdAt: true },
);
export type InsertDoctorNote = z.infer<typeof insertDoctorNoteSchema>;
export type DoctorNote = typeof doctorNotesTable.$inferSelect;
