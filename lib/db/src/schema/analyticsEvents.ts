import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
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
  }),
);

export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;
