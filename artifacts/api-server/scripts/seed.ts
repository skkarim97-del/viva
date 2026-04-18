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
  // Tone shapes the random check-in generator. The mix is calibrated so
  // the seeded roster lands roughly on the clinic-realistic split:
  //   ~15% Needs follow-up, ~30% Monitor, ~55% Stable.
  tone:
    | "stable"
    | "improving"
    | "low-energy"
    | "newly-silent" // 3-4 day gap -> silence rule fires, score ~30
    | "struggling" // severe nausea + low energy -> needs_followup
    | "silent"; // 5+ day gap -> needs_followup via override
}

const DOCTOR_EMAIL = "doctor@vivaai.demo";

// Clinic of 40. The original four patients (Alex, Jamie, Priya, Sam) keep
// their tones and ordering at the top so any docs / screenshots that
// reference them by name continue to work.
const PATIENTS: PatientSpec[] = [
  // --- Original four (kept) -----------------------------------------------
  { email: "alex.morgan@vivaai.demo",   name: "Alex Morgan",    glp1Drug: "Semaglutide",  dose: "0.5mg weekly",  startedDaysAgo: 90,  tone: "stable" },
  { email: "jamie.chen@vivaai.demo",    name: "Jamie Chen",     glp1Drug: "Tirzepatide",  dose: "5mg weekly",    startedDaysAgo: 45,  tone: "improving" },
  { email: "priya.patel@vivaai.demo",   name: "Priya Patel",    glp1Drug: "Semaglutide",  dose: "1mg weekly",    startedDaysAgo: 21,  tone: "struggling" },
  { email: "sam.rivera@vivaai.demo",    name: "Sam Rivera",     glp1Drug: "Tirzepatide",  dose: "7.5mg weekly",  startedDaysAgo: 60,  tone: "silent" },

  // --- Needs follow-up bucket (silent + struggling) -----------------------
  { email: "marcus.holloway@vivaai.demo",  name: "Marcus Holloway",  glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 80,  tone: "silent" },
  { email: "elena.vasquez@vivaai.demo",    name: "Elena Vasquez",    glp1Drug: "Tirzepatide", dose: "10mg weekly",   startedDaysAgo: 30,  tone: "struggling" },
  { email: "naomi.williams@vivaai.demo",   name: "Naomi Williams",   glp1Drug: "Semaglutide", dose: "1.7mg weekly",  startedDaysAgo: 14,  tone: "struggling" },
  { email: "diego.alvarez@vivaai.demo",    name: "Diego Alvarez",    glp1Drug: "Tirzepatide", dose: "2.5mg weekly",  startedDaysAgo: 10,  tone: "silent" },
  { email: "yuki.tanaka@vivaai.demo",      name: "Yuki Tanaka",      glp1Drug: "Semaglutide", dose: "2.4mg weekly",  startedDaysAgo: 50,  tone: "struggling" },

  // --- Monitor bucket (newly-silent + low-energy) -------------------------
  { email: "ben.adler@vivaai.demo",        name: "Ben Adler",        glp1Drug: "Semaglutide", dose: "0.25mg weekly", startedDaysAgo: 7,   tone: "newly-silent" },
  { email: "haruko.nakamura@vivaai.demo",  name: "Haruko Nakamura",  glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 35,  tone: "low-energy" },
  { email: "rebecca.shah@vivaai.demo",     name: "Rebecca Shah",     glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 28,  tone: "low-energy" },
  { email: "owen.bennett@vivaai.demo",     name: "Owen Bennett",     glp1Drug: "Tirzepatide", dose: "7.5mg weekly",  startedDaysAgo: 65,  tone: "newly-silent" },
  { email: "tara.singh@vivaai.demo",       name: "Tara Singh",       glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 40,  tone: "low-energy" },
  { email: "luca.romano@vivaai.demo",      name: "Luca Romano",      glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 20,  tone: "newly-silent" },
  { email: "ada.okafor@vivaai.demo",       name: "Ada Okafor",       glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 12,  tone: "low-energy" },
  { email: "noor.haddad@vivaai.demo",      name: "Noor Haddad",      glp1Drug: "Tirzepatide", dose: "2.5mg weekly",  startedDaysAgo: 18,  tone: "newly-silent" },
  { email: "felix.zhao@vivaai.demo",       name: "Felix Zhao",       glp1Drug: "Semaglutide", dose: "1.7mg weekly",  startedDaysAgo: 55,  tone: "low-energy" },
  { email: "sienna.martin@vivaai.demo",    name: "Sienna Martin",    glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 22,  tone: "low-energy" },
  { email: "raj.iyer@vivaai.demo",         name: "Raj Iyer",         glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 75,  tone: "newly-silent" },

  // --- Stable / improving bucket ------------------------------------------
  { email: "mei.lin@vivaai.demo",          name: "Mei Lin",          glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 110, tone: "stable" },
  { email: "jordan.park@vivaai.demo",      name: "Jordan Park",      glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 95,  tone: "stable" },
  { email: "grace.obrien@vivaai.demo",     name: "Grace O'Brien",    glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 70,  tone: "improving" },
  { email: "kenji.suzuki@vivaai.demo",     name: "Kenji Suzuki",     glp1Drug: "Tirzepatide", dose: "10mg weekly",   startedDaysAgo: 130, tone: "stable" },
  { email: "isla.murphy@vivaai.demo",      name: "Isla Murphy",      glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 60,  tone: "improving" },
  { email: "noah.bergstrom@vivaai.demo",   name: "Noah Bergstrom",   glp1Drug: "Tirzepatide", dose: "7.5mg weekly",  startedDaysAgo: 85,  tone: "stable" },
  { email: "amara.johnson@vivaai.demo",    name: "Amara Johnson",    glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 50,  tone: "improving" },
  { email: "hugo.silva@vivaai.demo",       name: "Hugo Silva",       glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 100, tone: "stable" },
  { email: "lina.kovac@vivaai.demo",       name: "Lina Kovac",       glp1Drug: "Semaglutide", dose: "1.7mg weekly",  startedDaysAgo: 42,  tone: "improving" },
  { email: "emma.fitzgerald@vivaai.demo",  name: "Emma Fitzgerald",  glp1Drug: "Tirzepatide", dose: "2.5mg weekly",  startedDaysAgo: 15,  tone: "improving" },
  { email: "tomas.weber@vivaai.demo",      name: "Tomas Weber",      glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 120, tone: "stable" },
  { email: "ines.delacruz@vivaai.demo",    name: "Ines De La Cruz",  glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 78,  tone: "stable" },
  { email: "kai.nakashima@vivaai.demo",    name: "Kai Nakashima",    glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 33,  tone: "stable" },
  { email: "olivia.brennan@vivaai.demo",   name: "Olivia Brennan",   glp1Drug: "Tirzepatide", dose: "10mg weekly",   startedDaysAgo: 88,  tone: "improving" },
  { email: "santiago.cruz@vivaai.demo",    name: "Santiago Cruz",    glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 25,  tone: "improving" },
  { email: "freya.lindqvist@vivaai.demo",  name: "Freya Lindqvist",  glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 105, tone: "stable" },
  { email: "miles.donovan@vivaai.demo",    name: "Miles Donovan",    glp1Drug: "Semaglutide", dose: "2.4mg weekly",  startedDaysAgo: 140, tone: "stable" },
  { email: "zara.khan@vivaai.demo",        name: "Zara Khan",        glp1Drug: "Tirzepatide", dose: "7.5mg weekly",  startedDaysAgo: 36,  tone: "improving" },
  { email: "wesley.dunn@vivaai.demo",      name: "Wesley Dunn",      glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 67,  tone: "stable" },
  { email: "ana.beltran@vivaai.demo",      name: "Ana Beltran",      glp1Drug: "Tirzepatide", dose: "2.5mg weekly",  startedDaysAgo: 9,   tone: "improving" },
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

  // newly-silent: stop logging 3 days ago (fires silence rule, no override)
  // silent: stop logging 5+ days ago (triggers needs_followup escalation)
  const silenceGap = tone === "silent" ? 5 : tone === "newly-silent" ? 3 : 0;

  for (let daysAgo = 0; daysAgo < 30; daysAgo++) {
    if (silenceGap > 0 && daysAgo < silenceGap) continue;
    // sprinkle a few normal gaps for realism on the actively-logging tones
    if (silenceGap === 0 && Math.random() < 0.1) continue;

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
      case "low-energy":
        // Persistently dragging but no severe symptoms -- a Monitor case.
        energy = pick(["tired", "depleted", "tired", "good"] as const);
        nausea = pick(["mild", "none", "mild"] as const);
        mood = pick([2, 3, 3, 4]);
        break;
      case "struggling":
        energy = pick(["tired", "depleted", "depleted", "tired"] as const);
        nausea = pick(["moderate", "severe", "moderate", "mild"] as const);
        mood = pick([1, 2, 2, 3]);
        break;
      case "newly-silent":
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
