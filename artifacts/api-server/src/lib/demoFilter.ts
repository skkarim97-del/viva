import { sql, like, or } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Pre-pilot decision: a user is a "demo account" if their email
// matches ANY of the demo patterns below. Analytics MUST exclude them
// so operator dashboards reflect real pilot signal only.
//
// Patterns (kept in lockstep across helpers below):
//   - 'demo%@itsviva.com' -- the canonical pre-pilot demo standard:
//       seeded demo doctors (scripts/seed.ts: demo@itsviva.com;
//       seedSyntheticPilot.ts: demo+dr-N-RUNTAG@itsviva.com,
//       demo+riley@itsviva.com), demo patients on those rosters
//       (demo+pt-N-cohort-RUNTAG@itsviva.com,
//       demo.{bucket}.{name}@itsviva.com), dev-login demo identities
//       (routes/dev.ts: demo+doctor / demo+patient), and patients
//       invited BY a demo doctor (placeholder email is rewritten in
//       routes/patients.ts to match this pattern).
//   - '%@vivaai.demo' -- the legacy api-server seed QA dataset
//       (PATIENTS array in scripts/seed.ts uses @vivaai.demo emails;
//       doctor@vivaai.demo). Excluded as a defense-in-depth so a
//       future re-run of `pnpm --filter @workspace/api-server run
//       seed` cannot re-pollute the operator dashboards even before
//       the post-seed cleanup runs.
//
// Two usage shapes -- pick the one that matches the call site:
//
// 1. Drizzle query builder (preferred where convenient):
//      .where(notInArray(patientCheckinsTable.patientUserId, demoUserIdsSelect()))
//
// 2. Raw SQL via db.execute(sql`...`) -- inject the fragment in the
//    WHERE. The column is qualified (e.g. "p.user_id" or
//    "patient_user_id") and the literal patterns are inlined because
//    parameter binding inside a sub-select adds no safety here.
//      sql`... where ${excludeDemoCol("patient_user_id")} ...`
//
// 3. When the query already has a `users u` join, prefer the cheaper
//    inline check `and u.email not like ${DEMO_EMAIL_LIKE} and
//    u.email not like ${DEMO_VIVAAI_LIKE}` over re-subquerying users.
export const DEMO_EMAIL_LIKE = "demo%@itsviva.com";
export const DEMO_VIVAAI_LIKE = "%@vivaai.demo";

export function demoUserIdsSelect() {
  return db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      or(
        like(usersTable.email, DEMO_EMAIL_LIKE),
        like(usersTable.email, DEMO_VIVAAI_LIKE),
      ),
    );
}

export function excludeDemoCol(qualifiedCol: string) {
  return sql.raw(
    `${qualifiedCol} not in (select id from users where email like 'demo%@itsviva.com' or email like '%@vivaai.demo')`,
  );
}
