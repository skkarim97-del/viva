import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const magicLinkTokensTable = pgTable("magic_link_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MagicLinkToken = typeof magicLinkTokensTable.$inferSelect;
