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
  // Doctor TOTP MFA (HIPAA pilot, T007). All three columns are
  // nullable so adding them never breaks existing rows.
  //   - mfaSecret     : RFC-6238 TOTP secret (base32). Stored as
  //                     plain text for the pilot; treat the row as
  //                     a credential and gate via DB access controls.
  //                     A "pending" enrollment lives here until the
  //                     first verify, at which point mfaEnrolledAt
  //                     is set and the secret becomes "active".
  //   - mfaEnrolledAt : timestamp of the verify that activated the
  //                     secret. null = enrollment not yet completed.
  //   - mfaRecoveryCodesHashed : sha256 hex digests of single-use
  //                     recovery codes. Patients/clinicians never see
  //                     the codes again after enrollment. NULL means
  //                     no codes issued yet (legacy row).
  mfaSecret: text("mfa_secret"),
  mfaEnrolledAt: timestamp("mfa_enrolled_at"),
  mfaRecoveryCodesHashed: text("mfa_recovery_codes_hashed").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
