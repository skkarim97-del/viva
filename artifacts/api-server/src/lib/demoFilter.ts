import { sql, like } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Pre-pilot decision: any user whose email matches `demo%@itsviva.com`
// is a demo account -- the seeded demo doctor (scripts/seed.ts), demo
// patients on that doctor's roster, dev-login demo identities
// (routes/dev.ts), pilot-shaped synthetic data
// (scripts/seedSyntheticPilot.ts), and patients invited BY a demo
// doctor (placeholder email is rewritten in routes/patients.ts to
// match this pattern). Analytics MUST exclude them so dashboards
// reflect real pilot signal only.
//
// Two usage shapes -- pick the one that matches the call site:
//
// 1. Drizzle query builder (preferred where convenient):
//      .where(notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()))
//
// 2. Raw SQL via db.execute(sql`...`) -- inject the fragment in the
//    WHERE. The column is qualified (e.g. "p.user_id" or
//    "patient_user_id") and the literal pattern is inlined because
//    parameter binding inside a sub-select adds no safety here.
//      sql`... where ${excludeDemoCol("patient_user_id")} ...`
//
// 3. When the query already has a `users u` join, prefer the cheaper
//    inline check `and u.email not like ${DEMO_EMAIL_LIKE}` over
//    re-subquerying users.
export const DEMO_EMAIL_LIKE = "demo%@itsviva.com";

export function demoUserIdsSelect() {
  return db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.email, DEMO_EMAIL_LIKE));
}

export function excludeDemoCol(qualifiedCol: string) {
  return sql.raw(
    `${qualifiedCol} not in (select id from users where email like 'demo%@itsviva.com')`,
  );
}
