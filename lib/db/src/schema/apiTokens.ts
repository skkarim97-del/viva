import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Long-lived bearer tokens for the patient mobile app. Cookies are not
// reliable across React Native's URLSession so the mobile client uses
// these tokens via Authorization: Bearer <token>. The dashboard keeps
// using its session cookie -- both schemes resolve to the same user.
export const apiTokensTable = pgTable("api_tokens", {
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["doctor", "patient"] }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
});

export type ApiToken = typeof apiTokensTable.$inferSelect;
