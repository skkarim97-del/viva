/**
 * Backfill script: assign the demo platform to doctor and patient rows
 * that have platformId = null (typically: rows created by the seed
 * script before platform support was added, or rows created in
 * environments where the demo platform row was absent at signup time).
 *
 * Backfill logic:
 *   1. Find the demo platform by slug="demo".
 *   2. Set users.platform_id = demo platform id for every doctor with
 *      platform_id IS NULL.
 *   3. Set patients.platform_id = their doctor's platform_id for every
 *      patient with platform_id IS NULL whose doctor has a platform_id.
 *
 * Safety:
 *   - Only NULL rows are touched. Non-null platform assignments are
 *     never overwritten.
 *   - In production, ALLOW_BACKFILL=true must be set explicitly.
 *   - Pass --dry-run to print counts without writing anything.
 *
 * Usage:
 *   # Dry run (safe, no writes):
 *   pnpm --filter @workspace/api-server run backfill -- --dry-run
 *
 *   # Real run (demo / staging):
 *   pnpm --filter @workspace/api-server run backfill
 *
 *   # Real run (production, explicit opt-in required):
 *   ALLOW_BACKFILL=true pnpm --filter @workspace/api-server run backfill
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  patientsTable,
  telehealthPlatformsTable,
} from "@workspace/db";

const isDryRun = process.argv.includes("--dry-run");
const isProduction = process.env.NODE_ENV === "production";
const allowBackfill = process.env.ALLOW_BACKFILL === "true";

async function main(): Promise<void> {
  if (isProduction && !allowBackfill) {
    console.error(
      "[backfill] BLOCKED: running in production requires ALLOW_BACKFILL=true.\n" +
      "  Set the env var only after reviewing the dry-run output.\n" +
      "  Example: ALLOW_BACKFILL=true pnpm --filter @workspace/api-server run backfill",
    );
    process.exit(1);
  }

  console.log(
    isDryRun
      ? "[backfill] DRY RUN — no writes will be made."
      : `[backfill] LIVE RUN${isProduction ? " (production, ALLOW_BACKFILL=true)" : ""}.`,
  );

  // Step 1: resolve the demo platform row.
  const [demoPlatform] = await db
    .select({
      id: telehealthPlatformsTable.id,
      name: telehealthPlatformsTable.name,
      slug: telehealthPlatformsTable.slug,
    })
    .from(telehealthPlatformsTable)
    .where(eq(telehealthPlatformsTable.slug, "demo"))
    .limit(1);

  if (!demoPlatform) {
    console.error(
      "[backfill] Demo platform row not found (slug='demo').\n" +
      "  Run the seed script first: pnpm --filter @workspace/api-server run seed",
    );
    process.exit(1);
  }
  console.log(
    `[backfill] Demo platform: "${demoPlatform.name}" (id=${demoPlatform.id})`,
  );

  // Step 2: count and backfill null-platform doctors.
  const [{ nullDoctors }] = await db
    .select({ nullDoctors: sql<number>`cast(count(*) as int)` })
    .from(usersTable)
    .where(and(eq(usersTable.role, "doctor"), isNull(usersTable.platformId)));

  console.log(`\n[backfill] Doctors with platformId=null: ${nullDoctors}`);

  if (nullDoctors > 0) {
    if (!isDryRun) {
      await db
        .update(usersTable)
        .set({ platformId: demoPlatform.id })
        .where(and(eq(usersTable.role, "doctor"), isNull(usersTable.platformId)));
    }
    console.log(
      isDryRun
        ? `[backfill]   Would update ${nullDoctors} doctor row(s) → platform_id=${demoPlatform.id}`
        : `[backfill]   Updated ${nullDoctors} doctor row(s) → platform_id=${demoPlatform.id}`,
    );
  }

  // Step 3: count and backfill null-platform patients whose doctor now
  // has a platform. We do this via a sub-select so we only touch patients
  // whose doctor has a resolved platform, avoiding a double-null scenario.
  const [{ nullPatients }] = await db
    .select({ nullPatients: sql<number>`cast(count(*) as int)` })
    .from(patientsTable)
    .where(isNull(patientsTable.platformId));

  console.log(`[backfill] Patients with platformId=null: ${nullPatients}`);

  if (nullPatients > 0) {
    if (!isDryRun) {
      // Copy platform_id from the patient's doctor row. Only updates rows
      // where the doctor also has a platform_id (guards against a doctor
      // row that is still null after step 2 for some reason).
      await db.execute(sql`
        update patients p
        set platform_id = u.platform_id
        from users u
        where p.doctor_id = u.id
          and p.platform_id is null
          and u.platform_id is not null
      `);
    }
    const [{ stillNull }] = await db
      .select({ stillNull: sql<number>`cast(count(*) as int)` })
      .from(patientsTable)
      .where(isNull(patientsTable.platformId));
    const updated = nullPatients - stillNull;
    console.log(
      isDryRun
        ? `[backfill]   Would update ~${nullPatients} patient row(s) from doctor platform_id`
        : `[backfill]   Updated ${updated} patient row(s). Still null: ${stillNull} (their doctor has no platform).`,
    );
  }

  // Step 4: final count summary.
  const [{ finalNullDoctors }] = await db
    .select({ finalNullDoctors: sql<number>`cast(count(*) as int)` })
    .from(usersTable)
    .where(and(eq(usersTable.role, "doctor"), isNull(usersTable.platformId)));
  const [{ finalNullPatients }] = await db
    .select({ finalNullPatients: sql<number>`cast(count(*) as int)` })
    .from(patientsTable)
    .where(isNull(patientsTable.platformId));

  console.log(`\n[backfill] Final null counts:`);
  console.log(`  Doctors  with platformId=null: ${finalNullDoctors}`);
  console.log(`  Patients with platformId=null: ${finalNullPatients}`);

  if (isDryRun) {
    console.log(
      "\n[backfill] Dry run complete. Re-run without --dry-run to apply changes.",
    );
  } else {
    console.log("\n[backfill] Done.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
