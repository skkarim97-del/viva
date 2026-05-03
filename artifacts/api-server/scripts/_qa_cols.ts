import { pool } from "@workspace/db";
const r = await pool.query(
  "select column_name from information_schema.columns where table_name='analytics_events' order by ordinal_position",
);
console.log(r.rows.map((x: { column_name: string }) => x.column_name).join(", "));
await pool.end();
