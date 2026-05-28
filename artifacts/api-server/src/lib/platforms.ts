import { eq } from "drizzle-orm";
import { db, telehealthPlatformsTable } from "@workspace/db";

export const DEMO_PLATFORM_SLUG = "demo";

let demoPlatformIdCache: number | null = null;

// Bust the module-level cache. Used by the seed/backfill scripts and
// tests after they insert or wipe platform rows so subsequent calls
// re-query instead of returning a stale id.
export function clearDemoPlatformIdCache(): void {
  demoPlatformIdCache = null;
}

// Soft lookup: returns null when the demo platform row is absent.
// Callers that can tolerate a null platformId (e.g. analytics helpers
// that treat null as "unscoped") should use this. All write paths that
// must guarantee a platform assignment should use ensureDemoPlatformId.
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

// Strict lookup: never returns null.
//
// Development / staging / demo:
//   If the demo platform row is missing, auto-upsert it so a freshly
//   provisioned DB works without a manual seed step.
//
// Production:
//   If the demo platform row is missing, throw a clear error. A
//   missing row in production is a deployment bug and must be loud.
export async function ensureDemoPlatformId(): Promise<number> {
  const id = await getDemoPlatformId();
  if (id !== null) return id;

  if (process.env.NODE_ENV !== "production") {
    const [row] = await db
      .insert(telehealthPlatformsTable)
      .values({ name: "Demo Platform", slug: DEMO_PLATFORM_SLUG, status: "active" })
      .onConflictDoUpdate({
        target: telehealthPlatformsTable.slug,
        set: { name: "Demo Platform", status: "active", updatedAt: new Date() },
      })
      .returning({ id: telehealthPlatformsTable.id });
    if (row) {
      demoPlatformIdCache = row.id;
      return row.id;
    }
  }

  throw new Error(
    `FATAL: telehealth_platforms row with slug='${DEMO_PLATFORM_SLUG}' is missing. ` +
    `Run: pnpm --filter @workspace/api-server run seed`,
  );
}

// Resolve any platform by slug. Returns null when the slug is not found.
// Used by the internal analytics endpoints that accept ?platformSlug=.
export async function getPlatformBySlug(
  slug: string,
): Promise<{ id: number; name: string; slug: string; status: string } | null> {
  const [row] = await db
    .select({
      id: telehealthPlatformsTable.id,
      name: telehealthPlatformsTable.name,
      slug: telehealthPlatformsTable.slug,
      status: telehealthPlatformsTable.status,
    })
    .from(telehealthPlatformsTable)
    .where(eq(telehealthPlatformsTable.slug, slug.toLowerCase()))
    .limit(1);
  return row ?? null;
}
