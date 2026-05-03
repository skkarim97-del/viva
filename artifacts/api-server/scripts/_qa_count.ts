import { pool } from "@workspace/db";
const r = await pool.query("select count(*)::int as n from analytics_events");
console.log("analytics_events rows on AWS:", r.rows[0].n);
const r2 = await pool.query("select event_name, count(*)::int as n from analytics_events group by event_name order by n desc limit 10");
console.log("by event_name:");
r2.rows.forEach((row: any) => console.log(" ", row.event_name, "x", row.n));
await pool.end();
