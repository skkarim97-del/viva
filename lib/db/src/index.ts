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

// AWS RDS uses a self-signed cert chain. Force sslmode=no-verify so
// pg-connection-string maps it to { rejectUnauthorized: false } and
// the Node TLS layer accepts the chain.
let connectionString = baseUrl;
if (process.env.AWS_DATABASE_URL) {
  const u = new URL(baseUrl);
  u.searchParams.set("sslmode", "no-verify");
  connectionString = u.toString();
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
