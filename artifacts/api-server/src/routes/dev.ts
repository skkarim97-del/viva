import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  patientsTable,
  apiTokensTable,
} from "@workspace/db";
import { getDemoPlatformId } from "../lib/platforms";
import { generateRawApiToken, hashApiToken } from "../lib/apiTokens";

// Replit-preview-only convenience login. Lets the operator tap a
// single button on the patient sign-in screen and land in the Today
// tab as a seeded fake patient -- no invite link, no manual signup.
//
// HARD GATE: this entire router is mounted ONLY when
//   NODE_ENV !== "production" OR ENABLE_DEV_LOGIN === "true"
// In production the gate fails, the mount is skipped, and any caller
// that hits /api/dev/* gets the standard 404 from the outer router.
// We additionally check the gate inside every handler as a defense
// in depth in case the mount ever drifts.
//
// What the endpoint does NOT do:
//   - never returns real patient data; uses a single seeded fake row
//   - never reuses a real doctor; provisions a paired fake doctor on
//     first call and reuses it forever afterwards
//   - never accepts arbitrary email/password input; the demo identity
//     is hardcoded so the URL surface is "dev login -> known fake user"
const DEV_DEMO_PATIENT_EMAIL = "demo.patient@viva.dev";
const DEV_DEMO_DOCTOR_EMAIL = "demo.doctor@viva.dev";
const DEV_DEMO_DOCTOR_NAME = "Viva Demo Clinician";
const DEV_DEMO_PATIENT_NAME = "Viva Demo Patient";
const DEV_DEMO_CLINIC_NAME = "Viva Demo Clinic";

export function isDevLoginEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.ENABLE_DEV_LOGIN === "true") return true;
  return false;
}

const router: Router = Router();

// Belt-and-suspenders: even if the router is wired up by mistake, every
// request still gets the gate check. A disabled gate returns 404 (not
// 403) so the route's existence is invisible to scanners.
router.use((_req: Request, res: Response, next: NextFunction) => {
  if (!isDevLoginEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
});

async function issueApiToken(
  userId: number,
  role: "doctor" | "patient",
): Promise<string> {
  const raw = generateRawApiToken();
  await db
    .insert(apiTokensTable)
    .values({ token: hashApiToken(raw), userId, role });
  return raw;
}

// Find-or-create the seeded demo doctor. Patients require a non-null
// doctor_id (FK), so the very first dev login also provisions a paired
// fake clinician. Subsequent calls reuse the same row.
//
// Race-safe: two concurrent first calls both run SELECT, both miss,
// both attempt INSERT. The unique constraint on users.email guarantees
// only one INSERT succeeds; .onConflictDoNothing() turns the loser
// into a no-op (zero returned rows) instead of a 500. The follow-up
// SELECT then resolves to the winner's row for both callers.
async function ensureDemoDoctor(): Promise<{ id: number; platformId: number | null }> {
  const existing = await selectDemoDoctor();
  if (existing) {
    assertDoctorRole(existing.role);
    return { id: existing.id, platformId: existing.platformId };
  }

  const platformId = await getDemoPlatformId();
  // Random unguessable hash. Login-by-password is not intended for
  // the demo doctor -- the only way in is via this dev endpoint, and
  // that endpoint creates patients, not doctor sessions.
  const passwordHash = await bcrypt.hash(
    `dev-demo-${generateRawApiToken()}`,
    10,
  );
  await db
    .insert(usersTable)
    .values({
      email: DEV_DEMO_DOCTOR_EMAIL,
      passwordHash,
      role: "doctor",
      name: DEV_DEMO_DOCTOR_NAME,
      clinicName: DEV_DEMO_CLINIC_NAME,
      platformId,
    })
    .onConflictDoNothing({ target: usersTable.email });

  // Re-read after the INSERT regardless of who won the race. This is
  // a single round-trip and guarantees we return a real row id.
  const winner = await selectDemoDoctor();
  if (!winner) throw new Error("dev_demo_doctor_create_failed");
  assertDoctorRole(winner.role);
  return { id: winner.id, platformId: winner.platformId };
}

async function selectDemoDoctor(): Promise<{
  id: number;
  platformId: number | null;
  role: string;
} | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      platformId: usersTable.platformId,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.email, DEV_DEMO_DOCTOR_EMAIL))
    .limit(1);
  return row ?? null;
}

function assertDoctorRole(role: string): void {
  // Defense in depth: the seeded doctor row's role must remain
  // "doctor". If a manual DB edit ever flips it (or the email gets
  // recycled for a real user) we fail closed rather than continue
  // and risk handing out a token under the wrong role.
  if (role !== "doctor") {
    throw new Error(`dev_demo_doctor_role_invariant_violated:${role}`);
  }
}

function assertPatientRole(role: string): void {
  // Same belt-and-suspenders for the patient. The /api/dev login
  // endpoint MUST always issue a patient token; if the seeded user
  // row drifted to role=doctor, fail closed and surface a 500
  // instead of escalating the caller to clinician.
  if (role !== "patient") {
    throw new Error(`dev_demo_patient_role_invariant_violated:${role}`);
  }
}

async function ensureDemoPatient(
  doctorId: number,
  doctorPlatformId: number | null,
): Promise<{ id: number; email: string; name: string }> {
  const existing = await selectDemoPatient();
  if (existing) {
    assertPatientRole(existing.role);
    // Be tolerant of partial seeds: if the user row exists but the
    // patients row was wiped (e.g. by a manual cleanup), recreate it.
    // .onConflictDoNothing() makes this idempotent under concurrency
    // and harmless on the common path where the row already exists.
    await db
      .insert(patientsTable)
      .values({
        userId: existing.id,
        doctorId,
        platformId: doctorPlatformId,
        activatedAt: new Date(),
        treatmentStatus: "active",
        treatmentStatusSource: "system",
        treatmentStatusUpdatedAt: new Date(),
        treatmentStatusUpdatedBy: doctorId,
      })
      .onConflictDoNothing({ target: patientsTable.userId });
    return { id: existing.id, email: existing.email, name: existing.name };
  }

  // First-ever dev login: create the demo patient user + patient row.
  // Use .onConflictDoNothing on both inserts so two parallel "first"
  // calls cannot both 500 out on the unique-email / PK collisions;
  // whichever loses the race re-reads the winner's row below.
  const passwordHash = await bcrypt.hash(
    `dev-demo-${generateRawApiToken()}`,
    10,
  );
  await db.transaction(async (tx) => {
    await tx
      .insert(usersTable)
      .values({
        email: DEV_DEMO_PATIENT_EMAIL,
        passwordHash,
        role: "patient",
        name: DEV_DEMO_PATIENT_NAME,
      })
      .onConflictDoNothing({ target: usersTable.email });
    const [u] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, DEV_DEMO_PATIENT_EMAIL))
      .limit(1);
    if (!u) throw new Error("dev_demo_patient_user_create_failed");
    await tx
      .insert(patientsTable)
      .values({
        userId: u.id,
        doctorId,
        platformId: doctorPlatformId,
        activatedAt: new Date(),
        treatmentStatus: "active",
        treatmentStatusSource: "system",
        treatmentStatusUpdatedAt: new Date(),
        treatmentStatusUpdatedBy: doctorId,
      })
      .onConflictDoNothing({ target: patientsTable.userId });
  });

  const winner = await selectDemoPatient();
  if (!winner) throw new Error("dev_demo_patient_create_failed");
  assertPatientRole(winner.role);
  return { id: winner.id, email: winner.email, name: winner.name };
}

async function selectDemoPatient(): Promise<{
  id: number;
  email: string;
  name: string;
  role: string;
} | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.email, DEV_DEMO_PATIENT_EMAIL))
    .limit(1);
  return row ?? null;
}

router.post(
  "/login-demo-patient",
  async (req: Request, res: Response) => {
    try {
      const doctor = await ensureDemoDoctor();
      const patient = await ensureDemoPatient(doctor.id, doctor.platformId);
      const token = await issueApiToken(patient.id, "patient");

      // Loud, structured log so anyone tailing the API can see this
      // endpoint was hit. Includes the patient id but no PII beyond
      // the seeded fake email.
      req.log.warn(
        {
          event: "dev_demo_patient_login",
          patientUserId: patient.id,
          email: patient.email,
        },
        "DEV DEMO PATIENT LOGIN USED",
      );

      // Mirror the /auth/login response shape that sessionApi.login
      // expects: top-level id/email/name/role plus the bearer token.
      // We also include a `user` block so the new dev path is just as
      // happy with the documented activate-style shape.
      res.status(200).json({
        token,
        id: patient.id,
        email: patient.email,
        name: patient.name,
        role: "patient" as const,
        clinicName: null,
        needsOnboarding: false,
        user: {
          id: patient.id,
          email: patient.email,
          name: patient.name,
          role: "patient" as const,
        },
      });
    } catch (err) {
      req.log.error(
        { err, event: "dev_demo_patient_login_failed" },
        "dev demo patient login failed",
      );
      res.status(500).json({ error: "dev_login_failed" });
    }
  },
);

export default router;
