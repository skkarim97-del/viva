/**
 * Seed script: creates one doctor and four varied patients with 30 days
 * of check-ins each. Idempotent on emails -- re-running clears existing
 * seeded users (and cascade-deletes their check-ins/notes) before re-inserting.
 *
 * Run with: pnpm --filter @workspace/api-server run seed
 */
import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  doctorNotesTable,
  type InsertPatientCheckin,
} from "@workspace/db";

const SEED_PASSWORD = "viva-demo-2026";

interface PatientSpec {
  email: string;
  name: string;
  glp1Drug: string;
  dose: string;
  startedDaysAgo: number;
  // tone shapes the random generator: stable patients log great/good/none,
  // struggling patients log tired/depleted/moderate, silent patients have gaps
  tone: "stable" | "improving" | "struggling" | "silent";
}

const DOCTOR_EMAIL = "doctor@vivaai.demo";

const PATIENTS: PatientSpec[] = [
  {
    email: "alex.morgan@vivaai.demo",
    name: "Alex Morgan",
    glp1Drug: "Semaglutide",
    dose: "0.5mg weekly",
    startedDaysAgo: 90,
    tone: "stable",
  },
  {
    email: "jamie.chen@vivaai.demo",
    name: "Jamie Chen",
    glp1Drug: "Tirzepatide",
    dose: "5mg weekly",
    startedDaysAgo: 45,
    tone: "improving",
  },
  {
    email: "priya.patel@vivaai.demo",
    name: "Priya Patel",
    glp1Drug: "Semaglutide",
    dose: "1mg weekly",
    startedDaysAgo: 21,
    tone: "struggling",
  },
  {
    email: "sam.rivera@vivaai.demo",
    name: "Sam Rivera",
    glp1Drug: "Tirzepatide",
    dose: "7.5mg weekly",
    startedDaysAgo: 60,
    tone: "silent",
  },
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function checkinsFor(
  patientUserId: number,
  tone: PatientSpec["tone"],
): InsertPatientCheckin[] {
  const out: InsertPatientCheckin[] = [];
  const today = new Date();

  for (let daysAgo = 0; daysAgo < 30; daysAgo++) {
    // "silent" patients stop logging 5 days ago to trigger the silence rule
    if (tone === "silent" && daysAgo < 5) continue;
    // sprinkle a few normal gaps for realism
    if (tone !== "silent" && Math.random() < 0.1) continue;

    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    const date = d.toISOString().split("T")[0]!;

    let energy: InsertPatientCheckin["energy"];
    let nausea: InsertPatientCheckin["nausea"];
    let mood: number;

    switch (tone) {
      case "stable":
        energy = pick(["good", "good", "great", "tired"] as const);
        nausea = pick(["none", "none", "mild"] as const);
        mood = pick([3, 4, 4, 5]);
        break;
      case "improving":
        // earlier days rougher, recent days better
        if (daysAgo > 15) {
          energy = pick(["tired", "depleted", "good"] as const);
          nausea = pick(["mild", "moderate", "none"] as const);
          mood = pick([2, 3, 3]);
        } else {
          energy = pick(["good", "great", "good"] as const);
          nausea = pick(["none", "none", "mild"] as const);
          mood = pick([4, 4, 5]);
        }
        break;
      case "struggling":
        energy = pick(["tired", "depleted", "depleted", "tired"] as const);
        nausea = pick(["moderate", "severe", "moderate", "mild"] as const);
        mood = pick([1, 2, 2, 3]);
        break;
      case "silent":
        energy = pick(["good", "tired"] as const);
        nausea = pick(["none", "mild"] as const);
        mood = pick([3, 4]);
        break;
    }

    out.push({
      patientUserId,
      date,
      energy,
      nausea,
      mood,
      notes: null,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const allEmails = [DOCTOR_EMAIL, ...PATIENTS.map((p) => p.email)];

  // Wipe prior seed runs by email -- cascades remove related rows.
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.email, allEmails));
  if (existing.length > 0) {
    const ids = existing.map((r) => r.id);
    await db.delete(doctorNotesTable).where(inArray(doctorNotesTable.patientUserId, ids));
    await db.delete(patientCheckinsTable).where(inArray(patientCheckinsTable.patientUserId, ids));
    await db.delete(patientsTable).where(inArray(patientsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    console.log(`[seed] removed ${existing.length} prior seed users`);
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const [doctor] = await db
    .insert(usersTable)
    .values({
      email: DOCTOR_EMAIL,
      passwordHash,
      role: "doctor",
      name: "Dr. Riley Kim",
    })
    .returning();
  console.log(`[seed] created doctor ${doctor!.email} (id=${doctor!.id})`);

  for (const p of PATIENTS) {
    const startedOn = new Date();
    startedOn.setDate(startedOn.getDate() - p.startedDaysAgo);

    const [user] = await db
      .insert(usersTable)
      .values({
        email: p.email,
        passwordHash,
        role: "patient",
        name: p.name,
      })
      .returning();
    await db.insert(patientsTable).values({
      userId: user!.id,
      doctorId: doctor!.id,
      glp1Drug: p.glp1Drug,
      dose: p.dose,
      startedOn: startedOn.toISOString().split("T")[0]!,
    });

    const cks = checkinsFor(user!.id, p.tone);
    if (cks.length > 0) {
      await db.insert(patientCheckinsTable).values(cks);
    }
    console.log(
      `[seed] patient ${p.name} (${p.tone}) -> ${cks.length} check-ins`,
    );
  }

  console.log(`\n[seed] done. Demo password for every account: ${SEED_PASSWORD}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
