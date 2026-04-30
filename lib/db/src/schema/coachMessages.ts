import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { usersTable } from "./users";
import { telehealthPlatformsTable } from "./telehealthPlatforms";

// Append-only persistence of every patient<->coach message turn.
//
// PRIVACY MODEL (PILOT, REDUCED PHI RETENTION):
// By default we DO NOT store the raw user text or the full AI
// response. We store *structured metadata only* -- category, risk,
// escalation flags, model used, length -- so analytics and safety
// audits still work. The body column is kept (now NULLABLE) for two
// reasons:
//   1. Backwards compatibility with rows written before the privacy
//      model landed (those still have body populated).
//   2. Local-dev debugging when COACH_STORE_RAW_MESSAGES=true. In
//      that mode the body is PHI-redacted before insert.
// In all pilot/production environments, body MUST be null on every
// new row. See artifacts/api-server/src/lib/coachClassify.ts and
// artifacts/api-server/src/routes/coach/index.ts.
//
// Read access remains internal/operator-key only; the table is
// intentionally NOT exposed to the clinician dashboard.

export const COACH_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type CoachMessageRole = (typeof COACH_MESSAGE_ROLES)[number];

// Message content category (allowlisted). Free-text never lands here
// -- the classifier only emits one of these constants.
export const COACH_MESSAGE_CATEGORIES = [
  "symptom_support",
  "medication_question",
  "side_effect",
  "nutrition",
  "hydration",
  "exercise",
  "urgent_concern",
  "other",
] as const;
export type CoachMessageCategory = (typeof COACH_MESSAGE_CATEGORIES)[number];

// Coarse risk band for the message content. "critical" is reserved
// for messages that should escalate to a clinician immediately
// (active SI, acute symptoms, treatment-stop intent, etc).
export const COACH_RISK_CATEGORIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type CoachRiskCategory = (typeof COACH_RISK_CATEGORIES)[number];

export const coachMessagesTable = pgTable(
  "coach_messages",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: COACH_MESSAGE_ROLES }).notNull(),
    // Raw message body. NULL by default in the privacy model -- only
    // populated when COACH_STORE_RAW_MESSAGES=true (dev/debug only)
    // and even then after PHI redaction. Existing pre-pilot rows
    // retain their original text; a cleanup script can null them.
    body: text("body"),
    // Optional caller-supplied label for the conversation mode the
    // message was generated in (e.g. "reassure", "simplify"). Used by
    // analytics; safe to be null for older clients.
    mode: text("mode"),
    // ----- Structured metadata (allowlisted, never raw text) -------
    messageCategory: text("message_category", {
      enum: COACH_MESSAGE_CATEGORIES,
    }),
    riskCategory: text("risk_category", { enum: COACH_RISK_CATEGORIES }),
    escalationRecommended: boolean("escalation_recommended")
      .notNull()
      .default(false),
    escalationTriggered: boolean("escalation_triggered")
      .notNull()
      .default(false),
    // Optional pointer to a templated/canned response so we can later
    // measure which templates fire without keeping the full text.
    responseTemplateId: text("response_template_id"),
    // "openai:gpt-4o-mini" etc. Captured per row so we can audit
    // which model produced an assistant turn without storing the
    // turn body.
    modelProvider: text("model_provider"),
    safetyFlag: boolean("safety_flag").notNull().default(false),
    // Tenant scope -- denormalized from the patient at insert time so
    // analytics by platform / doctor doesn't need a 3-table join on
    // every query. Both nullable + ON DELETE SET NULL so we never
    // block a patient delete on coach history.
    platformId: integer("platform_id").references(
      () => telehealthPlatformsTable.id,
      { onDelete: "set null" },
    ),
    doctorUserId: integer("doctor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // Length of the original (un-stored) message in characters. A
    // pure size signal, no content -- lets analytics distinguish
    // "patient typed one word" from "patient wrote a paragraph".
    messageLength: integer("message_length"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byPatientCreated: index("coach_messages_patient_created_idx").on(
      t.patientUserId,
      t.createdAt,
    ),
    byPlatformCreated: index("coach_messages_platform_created_idx").on(
      t.platformId,
      t.createdAt,
    ),
  }),
);

export const insertCoachMessageSchema = createInsertSchema(
  coachMessagesTable,
).omit({ id: true, createdAt: true });
export type InsertCoachMessage = z.infer<typeof insertCoachMessageSchema>;
export type CoachMessage = typeof coachMessagesTable.$inferSelect;
