import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Append-only persistence of every patient<->coach message. Distinct
// from care_events.coach_message which only stores metadata (length,
// mode) for analytics. This table stores the actual body for pilot
// QA and safety review. It is intentionally NOT exposed to the
// clinician dashboard yet; reads happen only via internal /
// operator-key endpoints.
export const COACH_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type CoachMessageRole = (typeof COACH_MESSAGE_ROLES)[number];

export const coachMessagesTable = pgTable(
  "coach_messages",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: COACH_MESSAGE_ROLES }).notNull(),
    body: text("body").notNull(),
    // Optional caller-supplied label for the conversation mode the
    // message was generated in (e.g. "reassure", "simplify"). Used by
    // analytics; safe to be null for older clients.
    mode: text("mode"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatientCreated: index("coach_messages_patient_created_idx").on(
      t.patientUserId,
      t.createdAt,
    ),
  }),
);

export const insertCoachMessageSchema = createInsertSchema(
  coachMessagesTable,
).omit({ id: true, createdAt: true });
export type InsertCoachMessage = z.infer<typeof insertCoachMessageSchema>;
export type CoachMessage = typeof coachMessagesTable.$inferSelect;
