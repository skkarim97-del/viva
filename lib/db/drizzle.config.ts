import { defineConfig } from "drizzle-kit";
import path from "path";
import { readFileSync } from "node:fs";

// Mirror the same resolution order as lib/db/src/index.ts so drizzle-kit
// push always targets the same database the application connects to.
// In production: set AWS_DATABASE_URL (RDS). In local dev: set DATABASE_URL.
const baseUrl = process.env.AWS_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error(
    "Set AWS_DATABASE_URL (production RDS) or DATABASE_URL (local dev) before running drizzle-kit.",
  );
}

// drizzle-kit's URL form ({ url }) accepts no ssl property — SSL can only be
// passed via the host/port form. We therefore parse the RDS URL into its
// components and apply the same SSL strategy as lib/db/src/index.ts:
//   - AWS_DB_SSL_CA_PATH set → verify-full with the CA bundle
//   - AWS_DB_SSL_CA_PATH unset → encrypted but rejectUnauthorized: false
//     (pilot fallback; resolves SELF_SIGNED_CERT_IN_CHAIN without a bundle)
// Local dev (DATABASE_URL only) uses the plain URL form; no SSL needed.
function rdsCredentials(rawUrl: string) {
  const u = new URL(rawUrl);
  const caPath = process.env.AWS_DB_SSL_CA_PATH?.trim();
  const ssl = caPath
    ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true as const }
    : { rejectUnauthorized: false };
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 5432,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    ssl,
  };
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbCredentials: (process.env.AWS_DATABASE_URL ? rdsCredentials(baseUrl) : { url: baseUrl }) as any,
});
