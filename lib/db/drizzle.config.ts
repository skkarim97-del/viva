import { defineConfig } from "drizzle-kit";
import path from "path";

// Mirror the same resolution order as lib/db/src/index.ts so drizzle-kit
// push always targets the same database the application connects to.
// In production: set AWS_DATABASE_URL (RDS). In local dev: set DATABASE_URL.
const url = process.env.AWS_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "Set AWS_DATABASE_URL (production RDS) or DATABASE_URL (local dev) before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
