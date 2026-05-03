import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// patient_integrations -- per-patient wearable / data-source
// connection status. Future-proofed for Fitbit, Whoop, Oura, etc.,
// but seeded with apple_health only at pilot time.
//
// Why a dedicated table instead of a column on patient_profiles:
// the thesis is "wearable signals broadly", not "Apple Health only".
// A 1-to-many shape lets a patient connect multiple providers and
// lets us record per-provider permissions/last-sync without
// reshuffling profiles every time we add one.
//
// Why a status column instead of inferring from
// patient_health_daily_summaries presence:
// presence proves "data arrived" but cannot distinguish
//   * patient has never seen the connect screen   (unknown)
//   * patient declined the OS prompt              (declined)
//   * patient connected but no data yet           (connected, last_sync_at NULL)
//   * patient was connected and then revoked      (disconnected, disconnected_at set)
//   * device doesn't support it (Android, web)    (unavailable)
// All of which the dashboard / analytics need to answer truthfully.
//
// "Connected" is still cross-checked against actual health-summary
// rows by the symptom/recent-pattern guardrails -- this table
// records intent, the summaries table records ground truth.

export const INTEGRATION_PROVIDERS = ["apple_health"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = [
  "unknown",
  "connected",
  "disconnected",
  "declined",
  "unavailable",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const patientIntegrationsTable = pgTable(
  "patient_integrations",
  {
    id: serial("id").primaryKey(),
    patientUserId: integer("patient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Provider key. Stored as text (not pg enum) so adding a new
    // provider is a code change, not a DB migration. The TS enum
    // above is the allowlist; server validates.
    provider: text("provider", { enum: INTEGRATION_PROVIDERS }).notNull(),
    status: text("status", { enum: INTEGRATION_STATUSES })
      .notNull()
      .default("unknown"),
    // First time this provider transitioned to "connected". Sticky
    // across disconnect/reconnect so we have an "ever connected"
    // signal for analytics.
    connectedAt: timestamp("connected_at"),
    // Most recent transition out of "connected".
    disconnectedAt: timestamp("disconnected_at"),
    // Last time the client successfully POSTed a daily summary
    // attributed to this provider. Updated by the health-summary
    // endpoint when source matches.
    lastSyncAt: timestamp("last_sync_at"),
    // List of granted scopes / sample types we requested and got
    // (e.g. ["steps", "sleep", "hrv", "heart_rate"]). Useful for
    // "no sleep data because permission not granted" answers.
    permissions: jsonb("permissions").$type<string[]>(),
    // Free-form per-provider context (device model, OS version,
    // disconnect reason, etc.). PHI-free by convention.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqProvider: unique("patient_integrations_provider_uniq").on(
      t.patientUserId,
      t.provider,
    ),
    byPatient: index("patient_integrations_by_patient_idx").on(t.patientUserId),
  }),
);

export type InsertPatientIntegration =
  typeof patientIntegrationsTable.$inferInsert;
export type PatientIntegration =
  typeof patientIntegrationsTable.$inferSelect;
