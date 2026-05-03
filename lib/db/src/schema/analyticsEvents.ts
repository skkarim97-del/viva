import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// ----------------------------------------------------------------------
// analytics_events -- tiny pilot-grade usage stream.
//
// Distinct from careEventsTable (which models the dual-layer clinical
// loop) and interventionEventsTable (which models AI-coach attribution
// analytics). This table answers ONE narrow question: when are
// patients and doctors actually using the product, and roughly for
// how long.
//
// We keep it deliberately small: no foreign keys, no enums on user_id,
// no soft schema for payloads. If a row fails to insert (analytics
// outage, FK race) it must NEVER break a product flow -- the helper
// always swallows errors.
// ----------------------------------------------------------------------

export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // 'patient' | 'doctor'. Plain text rather than an enum so a third
    // user_type later (e.g. 'admin') doesn't require a migration.
    userType: text("user_type").notNull(),
    // No FK on purpose: analytics rows must outlive a deleted user
    // and an analytics insert must never fail because of a referential
    // race (e.g. user row not yet visible to the analytics txn).
    userId: integer("user_id").notNull(),
    eventName: text("event_name").notNull(),
    sessionId: text("session_id"),
    // 'ios' | 'android' | 'web' | 'unknown'. Free-text for the same
    // forward-compat reason as userType.
    platform: text("platform"),
    // IANA timezone name as reported by the client at event time
    // (e.g. 'America/Los_Angeles'). Nullable because old rows did not
    // capture it and a privacy-restricted browser may withhold it.
    // Used by the hourly usage chart to bucket on the patient's
    // local hour rather than server time when available.
    timezone: text("timezone"),
    // Optional structured payload. Used by event-typed rows that need
    // to carry context beyond user/session/platform -- e.g.
    // `patient_checkin_updated`, which records previous + current
    // symptom state, the changed-fields list, the upstream source
    // (today_checkin_autosave, manual_save, onboarding, demo_seed),
    // and whether the change kicked off intervention regeneration.
    // PHI-discipline: callers must NOT put free-text notes, names, or
    // any clinician-identifying info in here. Symptom enums + booleans
    // are pilot-grade analytics and the only thing currently written.
    // Nullable so existing event rows remain valid and so generic
    // pings (page views, etc.) don't have to invent a payload.
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    // YYYY-MM-DD bucket for date-scoped events (e.g. the check-in
    // edit timeline). Pilot dashboards use this to align state-change
    // events with the daily check-in row without parsing payload JSON.
    // Nullable for non-date-scoped events.
    eventDate: text("event_date"),
  },
  (t) => ({
    byCreated: index("analytics_events_created_idx").on(t.createdAt),
    byUserCreated: index("analytics_events_user_created_idx").on(
      t.userType,
      t.userId,
      t.createdAt,
    ),
    byEventCreated: index("analytics_events_event_created_idx").on(
      t.eventName,
      t.createdAt,
    ),
    bySession: index("analytics_events_session_idx").on(t.sessionId),
    // Used by per-patient symptom-edit timeline queries (latest change
    // for a patient on a date) -- keeps the dashboard query off a
    // sequential scan as the table grows.
    byUserDateEvent: index("analytics_events_user_date_event_idx").on(
      t.userType,
      t.userId,
      t.eventDate,
      t.eventName,
    ),
  }),
);

export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;
