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
  careEventsTable,
  type InsertPatientCheckin,
} from "@workspace/db";

const SEED_PASSWORD = "viva-demo-2026";

// Secondary, fully isolated demo account for the public "demo@itsviva.com"
// experience. Owns its own roster of exactly 12 patients (3 per priority
// bucket) so the worklist visualisation always lands in the same shape.
// Kept separate from the doctor@vivaai.demo / 40-patient seed so demo
// playthroughs never collide with the broader QA dataset.
const DEMO_DOCTOR_EMAIL = "demo@itsviva.com";
const DEMO_DOCTOR_PASSWORD = "Demo4917!";
const DEMO_DOCTOR_NAME = "Dr. Demo Avery";

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

// ----------------------------------------------------------------------
// Demo doctor (demo@itsviva.com) roster.
//
// Curated 12-patient list, 3 per priority bucket the Clinic worklist
// surfaces: Review Now, Follow Up Today, Track Closely (monitor),
// Doing Well (stable). The bucket label drives both the tone of the
// generated check-ins and -- for the "review_now" rows -- the open
// escalation_requested care event we insert at the end of the seed.
// Tones map to the existing PatientSpec.tone vocabulary so the random
// check-in generator is reused unchanged.
// ----------------------------------------------------------------------

type DemoBucket = "review_now" | "follow_up_today" | "monitor" | "stable";

interface DemoPatientSpec extends PatientSpec {
  bucket: DemoBucket;
}

const DEMO_PATIENTS: DemoPatientSpec[] = [
  // --- Review Now: open escalation, otherwise actively engaged --------
  { bucket: "review_now",      email: "demo.review.riley@itsviva.com",     name: "Riley Donovan",     glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 30,  tone: "stable" },
  { bucket: "review_now",      email: "demo.review.cassidy@itsviva.com",   name: "Cassidy Jiang",     glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 60,  tone: "stable" },
  { bucket: "review_now",      email: "demo.review.marco@itsviva.com",     name: "Marco Pellegrini",  glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 45,  tone: "improving" },

  // --- Follow Up Today: needs_followup via silence + struggling -------
  { bucket: "follow_up_today", email: "demo.followup.hailey@itsviva.com",  name: "Hailey Sutton",     glp1Drug: "Semaglutide", dose: "1.7mg weekly",  startedDaysAgo: 21,  tone: "struggling" },
  { bucket: "follow_up_today", email: "demo.followup.theo@itsviva.com",    name: "Theo Brennan",      glp1Drug: "Tirzepatide", dose: "7.5mg weekly",  startedDaysAgo: 14,  tone: "silent" },
  { bucket: "follow_up_today", email: "demo.followup.jasmin@itsviva.com",  name: "Jasmin Khoury",     glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 55,  tone: "struggling" },

  // --- Track Closely: monitor via newly-silent + low-energy -----------
  { bucket: "monitor",         email: "demo.monitor.devon@itsviva.com",    name: "Devon Marquez",     glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 28,  tone: "low-energy" },
  { bucket: "monitor",         email: "demo.monitor.lana@itsviva.com",     name: "Lana Ostrowski",    glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 42,  tone: "newly-silent" },
  { bucket: "monitor",         email: "demo.monitor.quentin@itsviva.com",  name: "Quentin Reyes",     glp1Drug: "Tirzepatide", dose: "2.5mg weekly",  startedDaysAgo: 18,  tone: "low-energy" },

  // --- Doing Well: stable + improving --------------------------------
  { bucket: "stable",          email: "demo.stable.mira@itsviva.com",      name: "Mira Bernstein",    glp1Drug: "Semaglutide", dose: "0.5mg weekly",  startedDaysAgo: 90,  tone: "stable" },
  { bucket: "stable",          email: "demo.stable.asher@itsviva.com",     name: "Asher Whitlock",    glp1Drug: "Tirzepatide", dose: "5mg weekly",    startedDaysAgo: 70,  tone: "improving" },
  { bucket: "stable",          email: "demo.stable.polina@itsviva.com",    name: "Polina Vetrov",     glp1Drug: "Semaglutide", dose: "1mg weekly",    startedDaysAgo: 110, tone: "stable" },
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
        // Drop "good" from the energy mix so the low_energy_7d rule fires
        // deterministically (>=4 of last 7 days tired/depleted), keeping
        // Monitor-bucket seeds from accidentally drifting into Stable.
        energy = pick(["tired", "depleted", "tired", "depleted"] as const);
        nausea = pick(["mild", "none", "mild"] as const);
        mood = pick([2, 3, 3, 4]);
        break;
      case "struggling":
        energy = pick(["tired", "depleted", "depleted", "tired"] as const);
        nausea = pick(["moderate", "severe", "moderate", "mild"] as const);
        mood = pick([1, 2, 2, 3]);
        break;
      case "newly-silent":
        // Pre-silence days are explicitly upbeat so the only rule that
        // fires on this tone is silence_3d (+30 = Monitor). Mixing in
        // "tired" days could co-fire low_energy_7d (+20 -> total 50)
        // which deriveAction promotes to needs_followup, defeating the
        // tone's role as the Monitor-bucket exemplar.
        energy = "good";
        nausea = "none";
        mood = 4;
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

// Deterministic check-in generator for the demo doctor's roster. The
// random checkinsFor helper is great for the 40-patient QA dataset
// (it sprinkles realistic variance) but the public demo needs every
// patient to land in the SAME bucket every time the seed runs. This
// helper produces a fixed shape per bucket -- no Math.random() calls --
// so the worklist render is reproducible.
function demoCheckinsFor(
  patientUserId: number,
  bucket: DemoBucket,
): InsertPatientCheckin[] {
  const out: InsertPatientCheckin[] = [];
  const today = new Date();

  // Always-quiet baseline used by review_now and stable. Active
  // patient, no clinical signals firing -- the only thing that lifts a
  // review_now patient out of "stable" is the open escalation_requested
  // care event we insert in main(), nothing in their check-in stream.
  const baselineDay = (
    daysAgo: number,
  ): InsertPatientCheckin => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return {
      patientUserId,
      date: d.toISOString().split("T")[0]!,
      energy: "good",
      nausea: "none",
      mood: 4,
      notes: null,
    };
  };

  switch (bucket) {
    case "review_now":
    case "stable":
      // 14 days of clean check-ins. No silence, no symptoms, no energy
      // dip -> deriveAction returns "stable" deterministically.
      for (let daysAgo = 0; daysAgo < 14; daysAgo++) {
        out.push(baselineDay(daysAgo));
      }
      return out;

    case "follow_up_today":
      // Force action=needs_followup via the severe_nausea_3d hard
      // override (deriveAction promotes any severe nausea in the last
      // 3 days regardless of score). Earlier days look ordinary so the
      // queue copy has something to pivot off ("Severe nausea active in
      // recent check-ins").
      for (let daysAgo = 0; daysAgo < 14; daysAgo++) {
        const d = new Date(today);
        d.setDate(d.getDate() - daysAgo);
        const date = d.toISOString().split("T")[0]!;
        if (daysAgo <= 1) {
          // Last 2 days: severe nausea + depleted energy -- the queue
          // card needs a clinical signal to summarise.
          out.push({
            patientUserId,
            date,
            energy: "depleted",
            nausea: "severe",
            mood: 2,
            notes: null,
          });
        } else if (daysAgo <= 3) {
          out.push({
            patientUserId,
            date,
            energy: "tired",
            nausea: "moderate",
            mood: 2,
            notes: null,
          });
        } else {
          out.push({
            patientUserId,
            date,
            energy: "good",
            nausea: "mild",
            mood: 3,
            notes: null,
          });
        }
      }
      return out;

    case "monitor":
      // 3-day silence -> silence_3d (+30) -> action=monitor. No other
      // rules fire (energy stays "good") so we don't accidentally co-
      // fire low_energy_7d and tip into needs_followup.
      for (let daysAgo = 3; daysAgo < 17; daysAgo++) {
        out.push(baselineDay(daysAgo));
      }
      return out;
  }
}

// Insert one patient row + their generated check-ins. Returns the new
// user id so callers can hang follow-up rows (care events, notes) off
// of it without doing another lookup.
async function seedPatient(
  spec: PatientSpec,
  doctorId: number,
  passwordHash: string,
  // Optional override for the check-in stream. When provided, this
  // replaces the random tone-based generator -- used by the demo
  // doctor seeding so its 12 patients land in fixed buckets.
  checkins?: InsertPatientCheckin[],
): Promise<number> {
  const startedOn = new Date();
  startedOn.setDate(startedOn.getDate() - spec.startedDaysAgo);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: spec.email,
      passwordHash,
      role: "patient",
      name: spec.name,
    })
    .returning();
  // Stamp activatedAt + treatment_status so the seeded roster lands on
  // the worklist as active patients rather than "pending activation"
  // rows. activatedAt sits 1 day after startedOn so the patient looks
  // like they signed in to the mobile app on day-2 of treatment.
  const activatedAt = new Date(startedOn);
  activatedAt.setDate(activatedAt.getDate() + 1);
  await db.insert(patientsTable).values({
    userId: user!.id,
    doctorId,
    glp1Drug: spec.glp1Drug,
    dose: spec.dose,
    startedOn: startedOn.toISOString().split("T")[0]!,
    activatedAt,
    treatmentStatus: "active",
    treatmentStatusSource: "system",
  });

  const cks = checkins ?? checkinsFor(user!.id, spec.tone);
  if (cks.length > 0) {
    await db.insert(patientCheckinsTable).values(cks);
  }
  return user!.id;
}

async function main(): Promise<void> {
  const allEmails = [
    DOCTOR_EMAIL,
    ...PATIENTS.map((p) => p.email),
    DEMO_DOCTOR_EMAIL,
    ...DEMO_PATIENTS.map((p) => p.email),
  ];

  // Wipe prior seed runs by email -- cascades remove related rows
  // (check-ins, notes, care events, patients) so re-running the seed
  // always lands the same shape regardless of how many times it ran.
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.email, allEmails));
  if (existing.length > 0) {
    const ids = existing.map((r) => r.id);
    // care_events first: it has FKs onto users(actor_user_id /
    // patient_user_id) and we want a clean wipe before we delete the
    // owning users below.
    await db.delete(careEventsTable).where(inArray(careEventsTable.patientUserId, ids));
    await db.delete(doctorNotesTable).where(inArray(doctorNotesTable.patientUserId, ids));
    await db.delete(patientCheckinsTable).where(inArray(patientCheckinsTable.patientUserId, ids));
    await db.delete(patientsTable).where(inArray(patientsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    console.log(`[seed] removed ${existing.length} prior seed users`);
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ---- Primary clinic (40 patients) --------------------------------
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
    await seedPatient(p, doctor!.id, passwordHash);
    console.log(`[seed] patient ${p.name} (${p.tone})`);
  }

  // ---- Demo clinic (12 patients, fixed bucket distribution) --------
  const demoPasswordHash = await bcrypt.hash(DEMO_DOCTOR_PASSWORD, 10);
  const [demoDoctor] = await db
    .insert(usersTable)
    .values({
      email: DEMO_DOCTOR_EMAIL,
      passwordHash: demoPasswordHash,
      role: "doctor",
      name: DEMO_DOCTOR_NAME,
      // Stamp clinicName up front so /api/auth/me returns
      // needsOnboarding=false for this account; without it the dashboard
      // bounces the demo login to /onboarding even though we already
      // seeded a full 12-patient roster below.
      clinicName: "Viva Demo Clinic",
    })
    .returning();
  console.log(
    `[seed] created demo doctor ${demoDoctor!.email} (id=${demoDoctor!.id})`,
  );

  // Patients share the standard SEED_PASSWORD so the existing mobile
  // demo flow keeps working; only the demo doctor account uses the
  // public Demo4917! password the dashboard surfaces.
  for (const p of DEMO_PATIENTS) {
    // Pass [] so seedPatient skips its random generator; we insert the
    // deterministic stream below once we have the real user id.
    const patientUserId = await seedPatient(p, demoDoctor!.id, passwordHash, []);
    const stream = demoCheckinsFor(patientUserId, p.bucket);
    if (stream.length > 0) {
      await db.insert(patientCheckinsTable).values(stream);
    }

    // Open escalation_requested for the Review Now bucket. The funnel
    // treats an escalation as "open" iff there is no later
    // doctor_reviewed / follow_up_completed for the same patient,
    // which is exactly what we want here -- a clinician demoing the
    // worklist should see these three rows pinned at the top in the
    // "Patient requested review" section.
    if (p.bucket === "review_now") {
      const occurredAt = new Date();
      // Spread the escalations over the last few hours so the worklist
      // ordering looks lived-in rather than stamped at the same second.
      occurredAt.setHours(occurredAt.getHours() - (1 + DEMO_PATIENTS.indexOf(p) % 4));
      await db.insert(careEventsTable).values({
        patientUserId,
        actorUserId: patientUserId,
        source: "patient",
        type: "escalation_requested",
        occurredAt,
        metadata: { note: "Requested clinician review from the mobile app." },
      });
    }
    console.log(
      `[seed] demo patient ${p.name} -> ${p.bucket} (tone=${p.tone})`,
    );
  }

  console.log(
    `\n[seed] done. Primary password: ${SEED_PASSWORD}  /  ` +
      `Demo doctor: ${DEMO_DOCTOR_EMAIL} / ${DEMO_DOCTOR_PASSWORD}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
