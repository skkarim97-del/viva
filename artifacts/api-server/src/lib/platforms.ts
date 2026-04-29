import { eq } from "drizzle-orm";
import { db, telehealthPlatformsTable } from "@workspace/db";

// Slug of the default platform every freshly-created doctor lands on
// during the demo phase. Once Viva onboards a second customer this
// becomes a runtime decision (e.g. picked at signup or by an admin),
// but for now there's exactly one platform and the assignment is
// implicit.
export const DEMO_PLATFORM_SLUG = "demo";

// Module-level cache. The demo platform row is created once at install
// time (via the backfill SQL) and its id never changes for the life of
// the database, so a permanent in-memory cache is safe and avoids a
// SELECT on every doctor signup / patient create.
let demoPlatformIdCache: number | null = null;

/**
 * Resolve the integer id of the default ("demo") telehealth platform.
 * Returns null only if the platform row was deleted out from under us
 * (which the FK ON DELETE SET NULL guards against on user/patient rows
 * but doesn't undo); callers should treat that as "leave platformId
 * null on the new row" rather than failing the request.
 */
export async function getDemoPlatformId(): Promise<number | null> {
  if (demoPlatformIdCache !== null) return demoPlatformIdCache;
  const [row] = await db
    .select({ id: telehealthPlatformsTable.id })
    .from(telehealthPlatformsTable)
    .where(eq(telehealthPlatformsTable.slug, DEMO_PLATFORM_SLUG))
    .limit(1);
  if (!row) return null;
  demoPlatformIdCache = row.id;
  return row.id;
}
