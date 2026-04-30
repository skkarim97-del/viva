import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const baseUrl = process.env.AWS_DATABASE_URL ?? process.env.DATABASE_URL;

if (!baseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// SSL strategy:
//   1. Local dev (DATABASE_URL only, no AWS_DATABASE_URL): no SSL, the
//      local Postgres in this Replit environment does not require it.
//   2. AWS RDS with `AWS_DB_SSL_CA_PATH` set: load the RDS CA bundle
//      from that file path and run `verify-full`. This is the path we
//      want on the EC2 production host. Drop any sslmode in the URL so
//      the Pool's `ssl` object is the single source of truth.
//   3. AWS RDS without `AWS_DB_SSL_CA_PATH`: fall back to
//      `sslmode=no-verify` for back-compat with the current Replit
//      Autoscale deployment that does not have the bundle on disk.
let connectionString = baseUrl;
let ssl: { ca: string; rejectUnauthorized: true } | undefined;

if (process.env.AWS_DATABASE_URL) {
  const u = new URL(baseUrl);
  const caPath = process.env.AWS_DB_SSL_CA_PATH?.trim();
  if (caPath) {
    let ca: string;
    try {
      ca = readFileSync(caPath, "utf8");
    } catch (err) {
      throw new Error(
        `AWS_DB_SSL_CA_PATH is set to "${caPath}" but the file could not be read: ${(err as Error).message}`,
      );
    }
    u.searchParams.delete("sslmode");
    ssl = { ca, rejectUnauthorized: true };
  } else {
    u.searchParams.set("sslmode", "no-verify");
  }
  connectionString = u.toString();
}

export const pool = new Pool(
  ssl ? { connectionString, ssl } : { connectionString },
);
export const db = drizzle(pool, { schema });

export * from "./schema";
