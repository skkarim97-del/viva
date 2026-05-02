/**
 * IV07 smoke-test bootstrap. Creates one doctor + one patient + one
 * recent nausea check-in so we have a deterministic target for the
 * intervention generate/active/feedback/escalate flow. Writes the
 * resulting credentials to /tmp/iv_smoke_creds.json so the curl
 * harness can read them.
 */
import bcrypt from "bcryptjs";
import {
  db,
  pool,
  usersTable,
  patientsTable,
  patientCheckinsTable,
} from "@workspace/db";
import fs from "node:fs";

const ts = Date.now();
const docEmail = `iv.doc.${ts}@example.com`;
const patEmail = `iv.pat.${ts}@example.com`;
const password = "TestPass123!";
const hash = await bcrypt.hash(password, 10);

const [doc] = await db
  .insert(usersTable)
  .values({ email: docEmail, passwordHash: hash, role: "doctor", name: "IV Doc" })
  .returning();
const doctorId = doc!.id;

const [pat] = await db
  .insert(usersTable)
  .values({ email: patEmail, passwordHash: hash, role: "patient", name: "IV Pat" })
  .returning();
const patientUserId = pat!.id;

const startedOn = new Date();
startedOn.setDate(startedOn.getDate() - 14);
await db.insert(patientsTable).values({
  userId: patientUserId,
  doctorId,
  glp1Drug: "Semaglutide",
  dose: "0.5mg weekly",
  startedOn: startedOn.toISOString().split("T")[0]!,
  activatedAt: new Date(),
  treatmentStatus: "active",
  treatmentStatusSource: "system",
});

// Today's check-in: moderate nausea + low appetite + low hydration
// gives the trigger engine a clear pickBestTrigger candidate
// ("nausea + low food intake today") so /generate returns a row.
const todayDateStr = new Date().toISOString().slice(0, 10);
await db.insert(patientCheckinsTable).values({
  patientUserId,
  date: todayDateStr,
  energy: "tired",
  nausea: "moderate",
  mood: 6,
  appetite: "low",
  hydration: "low",
  digestion: "fine",
  bowelMovement: true,
  doseTakenToday: true,
});

const out = { doctorId, patientUserId, docEmail, patEmail, password };
fs.writeFileSync("/tmp/iv_smoke_creds.json", JSON.stringify(out));
console.log(JSON.stringify(out));
await pool.end();
