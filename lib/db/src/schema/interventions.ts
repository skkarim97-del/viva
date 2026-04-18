import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";

// Structured log of every action a clinician takes on a patient. This is
// the substrate for the future learning loop: by recording (a) what
// triggered the intervention, (b) what kind of intervention it was, and
// (c) what happened to the patient afterwards, we can later train a
// model on which interventions actually re-engage patients.
export const interventionsTable = pgTable(
  "interventions",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    doctorUserId: integer("doctor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    kind: text("kind", {
      enum: [
        "note",
        "call",
        "message",
        "escalation",
        "dose_review",
        "check_in",
        "other",
      ],
    }).notNull(),
    reason: text("reason").notNull(),
    // What signal triggered this action -- typically a flag code or the
    // risk score at the time of decision. Both are nullable so a doctor
    // can log a proactive action that wasn't system-prompted.
    triggerFlagCode: text("trigger_flag_code"),
    triggerRiskScore: integer("trigger_risk_score"),
    status: text("status", {
      enum: ["planned", "in_progress", "completed", "cancelled"],
    })
      .notNull()
      .default("planned"),
    // Outcome stays "pending" until a clinician revisits the patient and
    // marks whether the intervention worked. This is the label column for
    // any future supervised model.
    outcome: text("outcome", {
      enum: ["pending", "re_engaged", "improved", "no_change", "declined"],
    })
      .notNull()
      .default("pending"),
    plannedFor: timestamp("planned_for"),
    completedAt: timestamp("completed_at"),
    followUpAt: date("follow_up_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatientCreated: index("interventions_by_patient_created").on(
      t.patientUserId,
      t.createdAt,
    ),
  }),
);

export const insertInterventionSchema = createInsertSchema(
  interventionsTable,
).omit({ id: true, createdAt: true });
export type InsertIntervention = z.infer<typeof insertInterventionSchema>;
export type Intervention = typeof interventionsTable.$inferSelect;
