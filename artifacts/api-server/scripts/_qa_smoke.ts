import { db, pool, usersTable, patientsTable, analyticsEventsTable, careEventsTable } from "@workspace/db";
import { eq, and, gt, sql, desc, inArray } from "drizzle-orm";

async function main() {
  const arg = process.argv[2];
  if (arg === "find-demo-patient") {
    const rows = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .innerJoin(patientsTable, eq(patientsTable.userId, usersTable.id))
      .innerJoin(
        sql`users d`,
        sql`d.id = ${patientsTable.doctorId} AND d.email = 'demo@itsviva.com'`,
      )
      .orderBy(usersTable.id)
      .limit(1);
    console.log(rows[0]?.email ?? "");
  } else if (arg === "recent-analytics") {
    // Use raw SQL to dodge a drizzle quirk where this particular
    // combination of inArray + gt against analyticsEventsTable
    // generates a malformed projection. Functionally equivalent.
    const r = await pool.query(
      `select event_name, payload, created_at
         from analytics_events
        where event_name = ANY($1::text[])
          and created_at > now() - interval '10 minutes'
        order by created_at desc
        limit 10`,
      [
        [
          "plan_item_suggested",
          "plan_item_overridden",
          "plan_item_completed",
          "plan_item_uncompleted",
          "integration_status_changed",
        ],
      ],
    );
    console.log("rows:", r.rows.length);
    r.rows.forEach((row: { event_name: string; payload: unknown }) =>
      console.log(" ", row.event_name, JSON.stringify(row.payload)),
    );
  } else if (arg === "latest-escalation") {
    const rows = await db
      .select()
      .from(careEventsTable)
      .where(eq(careEventsTable.type, "escalation_requested"))
      .orderBy(desc(careEventsTable.occurredAt))
      .limit(1);
    rows.forEach((r) =>
      console.log(r.type, r.source, JSON.stringify(r.metadata)),
    );
  }
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
