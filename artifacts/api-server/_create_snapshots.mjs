import pg from 'pg';
const { Pool } = pg;
const u = new URL(process.env.AWS_DATABASE_URL);
u.searchParams.set('sslmode', 'no-verify');
const pool = new Pool({ connectionString: u.toString() });
const sql = `
CREATE TABLE IF NOT EXISTS "pilot_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "clinic_name" text,
  "doctor_user_id" integer,
  "cohort_start_date" date NOT NULL,
  "cohort_end_date" date NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "generated_by_user_id" integer,
  "generated_by_label" text NOT NULL,
  "metric_definition_version" text NOT NULL,
  "patient_count" integer NOT NULL,
  "metrics" jsonb NOT NULL,
  "notes" text
);
DO $$ BEGIN
  ALTER TABLE "pilot_snapshots" ADD CONSTRAINT "pilot_snapshots_doctor_user_id_users_id_fk"
    FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pilot_snapshots" ADD CONSTRAINT "pilot_snapshots_generated_by_user_id_users_id_fk"
    FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "pilot_snapshots_generated_at_idx" ON "pilot_snapshots" ("generated_at");
`;
await pool.query(sql);
const r = await pool.query("select to_regclass('public.pilot_snapshots') as exists");
console.log('OK, exists:', r.rows[0].exists);
await pool.end();
