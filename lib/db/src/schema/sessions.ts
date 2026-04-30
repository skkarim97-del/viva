import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// connect-pg-simple's session store, declared in our drizzle schema so
// drizzle-kit push knows the table exists in BOTH the database and the
// schema. Without this, `drizzle-kit push` sees "session" in the DB but
// not in the schema and asks whether each new schema table (e.g.
// phi_access_logs) might be a rename of "session" -- a destructive
// suggestion we MUST never accept on the production AWS RDS instance.
//
// We do not read or write this table from drizzle. The express-session
// middleware (artifacts/api-server/src/middlewares/session.ts) owns it
// via connect-pg-simple. The column shape mirrors connect-pg-simple's
// own `table.sql` so push-force never tries to ALTER it.
export const sessionTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_session_expire").on(t.expire),
  }),
);
