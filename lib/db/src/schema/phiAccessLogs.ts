import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { patientsTable } from "./patients";
import { telehealthPlatformsTable } from "./telehealthPlatforms";

// ----------------------------------------------------------------------
// phi_access_logs -- HIPAA-style audit trail of who looked at whose
// PHI, when, and via which API.
//
// Design choices:
//   * Append-only. Rows are never updated or deleted by application
//     code. A future retention job will move > 6yr rows to cold
//     storage; for the pilot we keep everything online.
//   * Metadata only. We never store the request body, query string,
//     response body, or any field value from the underlying PHI row.
//     The audit log is meant to answer "did doctor X view patient
//     Y's data on date Z", not to mirror the data itself.
//   * IP and User-Agent are hashed (sha256 hex) before storage. The
//     raw values are quasi-identifiers (especially UA on enterprise
//     networks) and we have no operational need for them in cleartext;
//     hashing still allows "all events from the same client" grouping.
//   * actor_user_id is nullable so we can record operator-bearer
//     activity (which has no user row today). actor_role
//     disambiguates: 'operator' rows always have actor_user_id NULL.
// ----------------------------------------------------------------------

export const PHI_ACCESS_ROLES = [
  "doctor",
  "patient",
  "operator",
  "system",
] as const;
export type PhiAccessRole = (typeof PHI_ACCESS_ROLES)[number];

export const PHI_ACCESS_ACTIONS = ["read", "write", "delete"] as const;
export type PhiAccessAction = (typeof PHI_ACCESS_ACTIONS)[number];

export const phiAccessLogsTable = pgTable(
  "phi_access_logs",
  {
    id: serial("id").primaryKey(),
    // Who. actorUserId NULL for operator-bearer requests (no user row).
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    // What action and against whose data. targetPatientId is the
    // patient WHOSE PHI was touched; null for non-patient-scoped
    // reads (e.g. operator pulling platform-wide aggregates that
    // are already de-identified). targetPlatformId scopes operator
    // audits when the patient id is null.
    action: text("action").notNull(),
    targetPatientId: integer("target_patient_id").references(
      () => patientsTable.userId,
      { onDelete: "set null" },
    ),
    targetPlatformId: integer("target_platform_id").references(
      () => telehealthPlatformsTable.id,
      { onDelete: "set null" },
    ),
    // The URL path and HTTP verb. Path is captured AS REQUESTED,
    // already redacted by app.ts pino serializer for invite tokens.
    // We deliberately drop the query string to avoid accidentally
    // persisting search-term PHI.
    route: text("route").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    // Quasi-identifiers, hashed. SHA-256 hex (length 64). Empty
    // string when missing (e.g. UA-less probes).
    ipHash: text("ip_hash").notNull(),
    uaHash: text("ua_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // "What did doctor X access?" -- the most common audit query.
    index("phi_access_logs_actor_idx").on(t.actorUserId, t.createdAt),
    // "Who looked at patient Y's data?" -- the patient-side
    // disclosure query.
    index("phi_access_logs_target_idx").on(t.targetPatientId, t.createdAt),
    // Time-bounded window scans for retention/export jobs.
    index("phi_access_logs_created_idx").on(t.createdAt),
  ],
);

export type PhiAccessLogRow = typeof phiAccessLogsTable.$inferSelect;
export type PhiAccessLogInsert = typeof phiAccessLogsTable.$inferInsert;
