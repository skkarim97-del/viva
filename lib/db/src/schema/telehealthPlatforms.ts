import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

// Telehealth platforms = Viva's customers. A platform owns a set of
// providers (doctor users), and through them a set of patients. All
// pilot metrics, snapshots, and customer-facing analytics are scoped
// to a platform; the live dashboard can additionally narrow to a
// single provider within a platform.
//
// Today's pilot has exactly one platform ("Demo Platform"), but the
// data model is designed for multi-tenant from day one so a second
// platform can be onboarded without a schema migration.
//
// Status values:
//   active  -- live customer, included in default analytics rollups
//   paused  -- temporarily inactive (billing hold, contract pause);
//              not included in default rollups but data is preserved
//   archived -- historical, contract ended; excluded from defaults
//
// Slug is the stable URL-safe identifier we use in queries and (in
// the future) external readout URLs. It's unique and lowercase by
// convention; the API rejects mixed-case input.
export const telehealthPlatformsTable = pgTable(
  "telehealth_platforms",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: ["active", "paused", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("telehealth_platforms_status_idx").on(t.status),
  }),
);

export type TelehealthPlatform = typeof telehealthPlatformsTable.$inferSelect;
export type NewTelehealthPlatform =
  typeof telehealthPlatformsTable.$inferInsert;
