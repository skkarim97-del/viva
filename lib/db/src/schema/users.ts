import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { telehealthPlatformsTable } from "./telehealthPlatforms";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["doctor", "patient"] }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").unique(),
  // Display name of the doctor's clinic / practice. Captured during the
  // doctor onboarding wizard. Null on patient rows. This stays as a
  // per-doctor display label (invite emails, dashboard header). The
  // authoritative tenant grouping for analytics is platform_id below.
  clinicName: text("clinic_name"),
  // Telehealth platform (Viva customer) this user belongs to. Populated
  // for doctor rows at signup; null on patient rows -- patients inherit
  // platform through patients.doctor_id, and patients.platform_id
  // denormalizes that link for fast analytics joins.
  platformId: integer("platform_id").references(
    () => telehealthPlatformsTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
