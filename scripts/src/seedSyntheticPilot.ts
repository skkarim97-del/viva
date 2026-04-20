/**
 * seedSyntheticPilot.ts
 *
 * Lightweight seed script that fills the Viva DB with believable
 * pilot-shaped data so the analytics surfaces (Operating, Retention,
 * Behavior, Care loop, drill-downs) actually have something to render.
 *
 * Goal: "looks legit at a glance in Viva Analytics", not a simulator.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed:pilot   (wipe + seed)
 *   pnpm --filter @workspace/scripts run seed:reset   (wipe only)
 *
 * Synthetic users are tagged by an `@viva.synthetic` email suffix so
 * reset is precise and never touches real accounts. Patient FKs cascade,
 * so deleting the synthetic user rows wipes all derived rows in one go.
 */

import { sql } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  doctorNotesTable,
  interventionEventsTable,
  outcomeSnapshotsTable,
  careEventsTable,
} from "@workspace/db";

// --------- tiny utilities --------------------------------------------

const SUFFIX = "@viva.synthetic";
// Bcrypt hash of "synthetic-pilot" (cost 10). These accounts are not
// meant for interactive login; the column is NOT NULL so we need *some*
// valid hash here.
const PWHASH =
  "$2b$10$wGZ6Or.0vF.VtkzN6Xn8w.VbmkyuFXwiu/4yYOmKsrlw9Ax3M5H7m";

// Mulberry32 — small, deterministic so reseeding is reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260419);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
const between = (lo: number, hi: number) =>
  Math.floor(lo + rand() * (hi - lo + 1));
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

// --------- cohorts ---------------------------------------------------
//
// Cohort drives status / stop-reason / activity recency / symptoms.
// 40 / 25 / 15 / 15 / 5 split = 100 patients.

type Cohort =
  | "stable"
  | "side_effect"
  | "disengaging"
  | "cost_motivation"
  | "low_efficacy";

const COHORT_PLAN: Array<[Cohort, number]> = [
  ["stable", 40],
  ["side_effect", 25],
  ["disengaging", 15],
  ["cost_motivation", 15],
  ["low_efficacy", 5],
];

const FIRST_NAMES = [
  "Avery","Blake","Casey","Drew","Elliot","Finley","Gray","Harper",
  "Indigo","Jamie","Kai","Logan","Morgan","Nico","Oakley","Parker",
  "Quinn","Riley","Sage","Tatum","Umi","Val","Wren","Yael",
];
const LAST_NAMES = [
  "Adler","Bishop","Cole","Diaz","Ellis","Frost","Gonzalez","Hayes",
  "Iverson","Jensen","Khan","Lee","Mendez","Novak","Ortega","Patel",
  "Quinn","Reyes","Singh","Turner","Vega","Walsh","Xu","Young",
];
const DRUGS = ["semaglutide", "tirzepatide", "liraglutide"];
const DOSES = ["0.25mg", "0.5mg", "1.0mg", "1.7mg", "2.4mg"];
const SURFACES = ["Today", "WeeklyPlan", "Coach"] as const;
const INT_TYPES = [
  "hydration","protein_fueling","light_movement","recovery_rest",
  "symptom_monitoring","adherence_checkin","dose_day_caution",
] as const;

function fullName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

// --------- reset -----------------------------------------------------

async function wipeSynthetic(): Promise<number> {
  // Patient cascades take care of checkins / interventions / outcomes /
  // care_events / doctor_notes (note doctor_notes.doctorUserId is
  // restrict but the synthetic doctors only have synthetic patients,
  // so deleting the patients first leaves nothing pointing at them).
  const res = await db.execute(sql`
    with del_patients as (
      delete from users
      where email like ${"%" + SUFFIX} and role = 'patient'
      returning id
    ),
    del_doctors as (
      delete from users
      where email like ${"%" + SUFFIX} and role = 'doctor'
      returning id
    )
    select
      (select count(*) from del_patients)::int as patients,
      (select count(*) from del_doctors)::int as doctors
  `);
  const row = (res.rows?.[0] ?? {}) as { patients?: number; doctors?: number };
  return Number(row.patients ?? 0) + Number(row.doctors ?? 0);
}

// --------- seed ------------------------------------------------------

async function seedDoctors(): Promise<number[]> {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    email: `dr.${i + 1}.${Date.now().toString(36)}${SUFFIX}`,
    passwordHash: PWHASH,
    role: "doctor" as const,
    name: `Dr. ${pick(LAST_NAMES)}`,
    clinicName: pick(["Coastal GLP-1 Clinic", "Lakeside Metabolic", "Northwell Wellness"]),
  }));
  const inserted = await db
    .insert(usersTable)
    .values(rows)
    .returning({ id: usersTable.id });
  return inserted.map((r) => r.id);
}

interface PatientPlan {
  cohort: Cohort;
  status: "active" | "stopped" | "unknown";
  stopReason: string | null;
  startedDaysAgo: number;
  stoppedDaysAgo: number | null;   // when treatment ended (drives stop timing)
  lastActivityDaysAgo: number;     // drives DAU/WAU/MAU bucket
  hasWearable: boolean;
  willEscalate: boolean;
  doctorId: number;
}

function planFor(cohort: Cohort, doctorId: number): PatientPlan {
  // Treatment status + stop reason follow the cohort tendency.
  let status: PatientPlan["status"] = "active";
  let stopReason: string | null = null;
  let startedDaysAgo = between(20, 180);
  let stoppedDaysAgo: number | null = null;

  if (cohort === "side_effect") {
    if (chance(0.55)) {
      status = "stopped";
      stopReason = "side_effects";
      // Side effects skew early.
      const daysOn = between(7, 35);
      startedDaysAgo = between(daysOn + 5, daysOn + 60);
      stoppedDaysAgo = startedDaysAgo - daysOn;
    }
  } else if (cohort === "disengaging") {
    if (chance(0.5)) status = "unknown";
    else if (chance(0.4)) {
      status = "stopped";
      stopReason = pick(["other", "patient_choice_or_motivation"]);
      const daysOn = between(20, 90);
      startedDaysAgo = between(daysOn + 5, daysOn + 60);
      stoppedDaysAgo = startedDaysAgo - daysOn;
    }
  } else if (cohort === "cost_motivation") {
    if (chance(0.7)) {
      status = "stopped";
      stopReason = pick(["cost_or_insurance", "patient_choice_or_motivation"]);
      // Cost / motivation skew mid → late.
      const daysOn = between(45, 150);
      startedDaysAgo = between(daysOn + 5, daysOn + 30);
      stoppedDaysAgo = startedDaysAgo - daysOn;
    }
  } else if (cohort === "low_efficacy") {
    status = "stopped";
    stopReason = "lack_of_efficacy";
    const daysOn = between(95, 170);
    startedDaysAgo = between(daysOn + 5, daysOn + 20);
    stoppedDaysAgo = startedDaysAgo - daysOn;
  }
  // stable cohort → defaults (active, no stop)

  // Activity recency: stable patients are most active, disengaging
  // skews stale, stopped patients trail off after stop date.
  let lastActivityDaysAgo: number;
  if (status === "stopped") {
    lastActivityDaysAgo = (stoppedDaysAgo ?? 0) + between(0, 7);
  } else if (cohort === "disengaging") {
    lastActivityDaysAgo = pick([1, 5, 10, 18, 28, 45]);
  } else if (cohort === "stable") {
    lastActivityDaysAgo = pick([0, 0, 0, 1, 1, 2, 3, 5]);
  } else if (cohort === "side_effect") {
    lastActivityDaysAgo = pick([0, 1, 2, 4, 7, 12]);
  } else {
    lastActivityDaysAgo = pick([0, 1, 3, 6, 14, 25]);
  }

  return {
    cohort,
    status,
    stopReason,
    startedDaysAgo,
    stoppedDaysAgo,
    lastActivityDaysAgo,
    hasWearable: chance(0.35),
    willEscalate:
      cohort === "side_effect" ? chance(0.6) :
      cohort === "stable"      ? chance(0.05) :
      chance(0.2),
    doctorId,
  };
}

async function seedPatients(doctorIds: number[]): Promise<{
  patientIds: number[];
  plans: Map<number, PatientPlan>;
}> {
  const plans = new Map<number, PatientPlan>();
  const userRows: Array<typeof usersTable.$inferInsert> = [];
  const planList: PatientPlan[] = [];

  for (const [cohort, count] of COHORT_PLAN) {
    for (let i = 0; i < count; i++) {
      const doctorId = doctorIds[i % doctorIds.length]!;
      const plan = planFor(cohort, doctorId);
      planList.push(plan);
      const seq = userRows.length + 1;
      userRows.push({
        email: `pt${seq}.${cohort}.${Date.now().toString(36)}${SUFFIX}`,
        passwordHash: PWHASH,
        role: "patient",
        name: fullName(),
      });
    }
  }

  const inserted = await db
    .insert(usersTable)
    .values(userRows)
    .returning({ id: usersTable.id });
  const patientIds = inserted.map((r) => r.id);

  // patients table rows
  const ptRows = patientIds.map((id, i) => {
    const p = planList[i]!;
    const startedOn = dateOnly(daysAgo(p.startedDaysAgo));
    const activatedAt = daysAgo(p.startedDaysAgo);
    const stoppedAt = p.stoppedDaysAgo == null ? null : daysAgo(p.stoppedDaysAgo);
    plans.set(id, p);
    return {
      userId: id,
      doctorId: p.doctorId,
      glp1Drug: pick(DRUGS),
      dose: pick(DOSES),
      startedOn,
      activatedAt,
      treatmentStatus: p.status,
      treatmentStatusSource: (p.status === "stopped" ? "doctor" : "system") as
        | "doctor"
        | "system"
        | "patient",
      stopReason: p.stopReason,
      treatmentStatusUpdatedAt: stoppedAt,
      treatmentStatusUpdatedBy:
        p.status === "stopped" ? p.doctorId : null,
    };
  });
  await db.insert(patientsTable).values(ptRows);
  return { patientIds, plans };
}

// --------- activity (checkins / interventions / outcomes / care) -----

async function seedActivity(
  doctorIds: number[],
  patientIds: number[],
  plans: Map<number, PatientPlan>,
): Promise<{ escalations: number; reviewed: number }> {
  const checkins: Array<typeof patientCheckinsTable.$inferInsert> = [];
  const interventions: Array<typeof interventionEventsTable.$inferInsert> = [];
  const outcomes: Array<typeof outcomeSnapshotsTable.$inferInsert> = [];
  const notes: Array<typeof doctorNotesTable.$inferInsert> = [];
  const careEvents: Array<typeof careEventsTable.$inferInsert> = [];

  let escalations = 0;
  let reviewed = 0;

  for (const pid of patientIds) {
    const plan = plans.get(pid)!;
    const tier = plan.hasWearable ? "wearable" : "self_report";

    // How many days back to populate. Stops after stop date for
    // stopped patients so churn looks real.
    const horizon = Math.min(plan.startedDaysAgo, 60);
    const stopAt = plan.stoppedDaysAgo ?? -1;
    const checkinFreq =
      plan.cohort === "stable" ? 0.75 :
      plan.cohort === "side_effect" ? 0.55 :
      plan.cohort === "disengaging" ? 0.25 :
      0.4;

    for (let d = horizon; d >= 0; d--) {
      if (d < stopAt && plan.status === "stopped" && stopAt > 0) continue;
      if (d < plan.lastActivityDaysAgo - 1) continue; // patient went silent
      if (!chance(checkinFreq)) continue;
      const date = dateOnly(daysAgo(d));
      const energy =
        plan.cohort === "side_effect" ? pick(["depleted", "tired", "tired", "good"]) :
        plan.cohort === "stable"      ? pick(["good", "good", "great", "tired"]) :
                                        pick(["tired", "good", "depleted"]);
      const nausea =
        plan.cohort === "side_effect" ? pick(["mild", "moderate", "moderate", "severe"]) :
                                        pick(["none", "none", "mild"]);
      checkins.push({
        patientUserId: pid,
        date,
        energy,
        nausea,
        mood: between(2, 5),
        appetite: pick(["normal", "normal", "low", "strong"]),
        digestion: pick(["fine", "fine", "bloated", "constipated"]),
        hydration: pick(["hydrated", "good", "low"]),
        bowelMovement: chance(0.7),
        doseTakenToday: chance(0.85),
      });

      // Interventions ~ every 2-3 active days, carries dataTier so the
      // Apple Health % metric lights up via the existing pathway.
      if (chance(0.45)) {
        interventions.push({
          patientUserId: pid,
          occurredOn: date,
          surface: pick(SURFACES),
          interventionType: pick(INT_TYPES),
          title: "Daily guidance",
          rationale: null,
          treatmentStateSnapshot: {
            primaryFocus: "well_being",
            escalationNeed: plan.willEscalate ? "monitor" : "none",
            treatmentStage: "maintenance",
            treatmentDailyState: "steady",
            communicationMode: "supportive",
            dataTier: tier,
            recentTitration: false,
            symptomBurden: plan.cohort === "side_effect" ? "moderate" : "low",
            adherenceSignal: "stable",
            insufficientForPlan: false,
          },
          claimsPolicySummary: {
            canCiteSleep: tier === "wearable",
            canCiteHRV: tier === "wearable",
            canCiteRecovery: tier === "wearable",
            canCiteSteps: tier !== "self_report",
            physiologicalClaimsAllowed: tier === "wearable",
            narrativeConfidence: "moderate",
          },
          signalConfidenceSummary: null,
        });
      }

      // Outcome snapshots: proxies that drive next-day check-in,
      // symptom-improved, app-engaged-72h on the dashboard.
      if (chance(0.4)) {
        outcomes.push({
          patientUserId: pid,
          snapshotDate: date,
          dailyCheckinCompleted: true,
          nextDayCheckinCompleted: chance(
            plan.cohort === "stable" ? 0.7 : 0.45,
          ),
          appEngaged72h: chance(plan.cohort === "disengaging" ? 0.3 : 0.6),
          symptomImproved3d: chance(plan.cohort === "side_effect" ? 0.25 : 0.45),
          symptomWorsened3d: chance(plan.cohort === "side_effect" ? 0.35 : 0.1),
          adherenceImproved3d: chance(0.4),
          symptomTrend3d: pick(["improving", "flat", "worsening"]),
          treatmentActive30d: plan.status === "active",
          treatmentActive60d: plan.status === "active",
          treatmentActive90d: plan.status === "active",
        });
      }
    }

    // Doctor notes — engagement varies by doctor index.
    const noteCount =
      plan.cohort === "side_effect" ? between(1, 3) :
      plan.cohort === "stable"      ? between(0, 1) :
                                      between(0, 2);
    for (let n = 0; n < noteCount; n++) {
      const ago = between(1, Math.min(40, plan.startedDaysAgo));
      notes.push({
        patientUserId: pid,
        doctorUserId: plan.doctorId,
        body: pick([
          "Tolerating dose well. Continue current plan.",
          "Watching nausea trend — recheck in a week.",
          "Discussed hydration and protein. Patient receptive.",
          "Status update reviewed; no escalation needed.",
        ]),
        resolved: chance(0.5),
        createdAt: daysAgo(ago),
      });
      // Mirror into care_events so the audit trail picks it up.
      careEvents.push({
        patientUserId: pid,
        actorUserId: plan.doctorId,
        source: "doctor",
        type: "doctor_note",
        occurredAt: daysAgo(ago),
        metadata: null,
      });
    }

    // Treatment-status-update care_event for stopped patients.
    if (plan.status === "stopped" && plan.stoppedDaysAgo != null) {
      careEvents.push({
        patientUserId: pid,
        actorUserId: plan.doctorId,
        source: "doctor",
        type: "treatment_status_updated",
        occurredAt: daysAgo(plan.stoppedDaysAgo),
        metadata: { status: "stopped", stopReason: plan.stopReason },
      });
    }

    // A few Viva-side care_events for everyone (coach + recommendations).
    for (let k = 0; k < between(2, 6); k++) {
      const ago = between(0, Math.min(30, plan.startedDaysAgo));
      careEvents.push({
        patientUserId: pid,
        actorUserId: null,
        source: "viva",
        type: chance(0.5) ? "coach_message" : "recommendation_shown",
        occurredAt: daysAgo(ago),
        metadata: null,
      });
    }

    // Escalations + (sometimes) doctor reviewed afterward.
    if (plan.willEscalate) {
      const escAgo = between(1, Math.min(25, plan.startedDaysAgo));
      careEvents.push({
        patientUserId: pid,
        actorUserId: pid,
        source: "patient",
        type: "escalation_requested",
        occurredAt: daysAgo(escAgo),
        metadata: null,
      });
      escalations++;
      // ~70% reviewed; of those, half quick (<1d), half slow (1-5d).
      if (chance(0.7)) {
        const lag = chance(0.5) ? 0 : between(1, 5);
        const reviewedAgo = Math.max(0, escAgo - lag);
        careEvents.push({
          patientUserId: pid,
          actorUserId: plan.doctorId,
          source: "doctor",
          type: "doctor_reviewed",
          occurredAt: daysAgo(reviewedAgo),
          metadata: null,
        });
        reviewed++;
      }
    }
  }

  // Bulk insert in chunks so we don't overflow parameter limits.
  await chunkInsert(checkins, (xs) => db.insert(patientCheckinsTable).values(xs));
  await chunkInsert(interventions, (xs) => db.insert(interventionEventsTable).values(xs));
  await chunkInsert(outcomes, (xs) => db.insert(outcomeSnapshotsTable).values(xs));
  await chunkInsert(notes, (xs) => db.insert(doctorNotesTable).values(xs));
  await chunkInsert(careEvents, (xs) => db.insert(careEventsTable).values(xs));

  // Light doctor-DAU touch: bump treatmentStatusUpdatedAt for a few
  // active patients so doctor activity (and "patients reviewed" today)
  // is visible in the operating panel without touching anything else.
  const activeIds = patientIds.filter((id) => plans.get(id)!.status === "active");
  for (let i = 0; i < Math.min(8, activeIds.length); i++) {
    const id = activeIds[i]!;
    const plan = plans.get(id)!;
    await db
      .update(patientsTable)
      .set({
        treatmentStatusUpdatedAt: daysAgo(between(0, 6)),
        treatmentStatusUpdatedBy: plan.doctorId,
        treatmentStatusSource: "doctor",
      })
      .where(sql`user_id = ${id}`);
  }

  return { escalations, reviewed };
}

async function chunkInsert<T>(
  items: T[],
  insertOne: (chunk: T[]) => unknown,
): Promise<void> {
  const SIZE = 500;
  for (let i = 0; i < items.length; i += SIZE) {
    if (items.length === 0) return;
    await insertOne(items.slice(i, i + SIZE));
  }
}

// --------- reconciliation summary ------------------------------------

async function summary(): Promise<void> {
  const r = await db.execute(sql`
    with synth as (
      select id from users where email like ${"%" + SUFFIX} and role = 'patient'
    )
    select
      (select count(*)::int from users where email like ${"%" + SUFFIX} and role='doctor') as doctors,
      (select count(*)::int from synth) as patients,
      (select count(*)::int from patients p join synth s on s.id=p.user_id where p.treatment_status='active')  as active,
      (select count(*)::int from patients p join synth s on s.id=p.user_id where p.treatment_status='stopped') as stopped,
      (select count(*)::int from patients p join synth s on s.id=p.user_id where p.treatment_status='unknown') as unknown,
      (select count(distinct ce.patient_user_id)::int from care_events ce join synth s on s.id=ce.patient_user_id where ce.type='escalation_requested') as escalated_patients,
      (select count(*)::int from care_events ce join synth s on s.id=ce.patient_user_id where ce.type='escalation_requested') as escalations,
      (select count(*)::int from care_events ce join synth s on s.id=ce.patient_user_id where ce.type='doctor_reviewed') as reviewed,
      (select count(distinct pc.patient_user_id)::int from patient_checkins pc join synth s on s.id=pc.patient_user_id where pc.date = current_date) as dau,
      (select count(distinct pc.patient_user_id)::int from patient_checkins pc join synth s on s.id=pc.patient_user_id where pc.date >= current_date - interval '7 days') as wau,
      (select count(distinct pc.patient_user_id)::int from patient_checkins pc join synth s on s.id=pc.patient_user_id where pc.date >= current_date - interval '30 days') as mau,
      (select count(distinct ie.patient_user_id)::int from intervention_events ie join synth s on s.id=ie.patient_user_id where ie.treatment_state_snapshot->>'dataTier'='wearable' and ie.occurred_on >= current_date - interval '30 days') as wearable
  `);
  const row = (r.rows?.[0] ?? {}) as Record<string, number | undefined>;
  const n = (k: string) => Number(row[k] ?? 0);
  const total = n("active") + n("stopped") + n("unknown");
  const reconciles = total === n("patients");
  console.log("\n=== Synthetic pilot summary ===");
  console.log(`doctors:               ${n("doctors")}`);
  console.log(`patients:              ${n("patients")}`);
  console.log(`  active:              ${n("active")}`);
  console.log(`  stopped:             ${n("stopped")}`);
  console.log(`  unknown:             ${n("unknown")}`);
  console.log(`  reconciles to total: ${reconciles ? "yes" : "NO"}`);
  console.log(`escalations:           ${n("escalations")} (patients: ${n("escalated_patients")})`);
  console.log(`doctor_reviewed:       ${n("reviewed")}`);
  console.log(`patient DAU/WAU/MAU:   ${n("dau")} / ${n("wau")} / ${n("mau")}`);
  console.log(`apple health (30d):    ${n("wearable")} patients`);
  console.log("===============================\n");
}

// --------- entrypoint ------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const resetOnly = args.has("--reset");

  console.log(`Wiping previous synthetic data (matches '%${SUFFIX}')…`);
  const deleted = await wipeSynthetic();
  console.log(`  deleted ${deleted} synthetic users (and their cascaded rows).`);

  if (!resetOnly) {
    console.log("Seeding synthetic pilot…");
    const doctorIds = await seedDoctors();
    console.log(`  inserted ${doctorIds.length} doctors.`);
    const { patientIds, plans } = await seedPatients(doctorIds);
    console.log(`  inserted ${patientIds.length} patients.`);
    const { escalations, reviewed } = await seedActivity(
      doctorIds,
      patientIds,
      plans,
    );
    console.log(
      `  generated activity: ${escalations} escalations, ${reviewed} doctor reviews.`,
    );
  }

  await summary();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
