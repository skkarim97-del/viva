import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const PgStore = connectPgSimple(session);

const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET must be set. It is required to sign session cookies.",
  );
}

export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    tableName: "session",
    // createTableIfMissing reads a .sql file from disk next to the
    // connect-pg-simple source. esbuild bundling breaks that lookup,
    // so we provision the `session` table manually in migrations.
    createTableIfMissing: false,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
});

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "doctor" | "patient";
    // Doctor MFA per-session verification state (T007).
    // mfaVerified is true ONLY after the doctor has POSTed a valid
    // TOTP code in THIS session. It is intentionally NOT set by
    // login alone -- verifying once at login per session is the
    // whole point of step-up MFA. Cleared by /auth/logout via
    // session.destroy().
    mfaVerified?: boolean;
    mfaVerifiedAt?: number; // unix ms
  }
}
