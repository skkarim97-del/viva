import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  patientsTable,
  apiTokensTable,
  patientCheckinsTable,
  patientInterventionsTable,
  careEventsTable,
} from "@workspace/db";
import { getDemoPlatformId } from "../lib/platforms";
import { generateRawApiToken, hashApiToken } from "../lib/apiTokens";
import { generatePersonalizedIntervention } from "../lib/interventionEngine";
import { logger } from "../lib/logger";

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

// -------------------------------------------------------------------
// Demo Today-tab seeding
// -------------------------------------------------------------------
// After the operator logs in via this endpoint we want them to see
// the new personalized intervention card immediately on the Today
// tab -- without first having to hand-enter symptom sliders. We do
// that here, server-side, so the mobile dev button stays a thin
// "tap and go" shortcut.
//
// The seed:
//   1. Upserts today's patient_checkins row for the demo patient
//      with the spec values (energy=tired, nausea=moderate,
//      appetite=low, digestion=constipated, bowel_movement=false).
//      `onConflictDoUpdate` so a second login the same day re-seeds
//      cleanly instead of inheriting yesterday's leftover edits.
//   2. Soft-clears any still-active interventions for the demo
//      patient (status -> dismissed). Without this the engine's
//      duplicate-trigger suppression would block the new card AND
//      stale rows would dominate the /active list.
//   3. Calls generatePersonalizedIntervention() with a forced
//      `nausea` trigger so the engine never no-ops on threshold
//      math; the de-id payload still drives the AI/template branch
//      normally so the rendered copy looks like real production
//      output.
//   4. If the engine returns null (no template matched) OR throws,
//      inserts a hardcoded fallback row that matches the example
//      copy in the task description so the operator always sees
//      the three labeled sections + three buttons.
//   5. Mirrors to care_events (recommendation_shown) so the
//      dashboard worklist also surfaces the seeded row -- demo data
//      flows through the same lanes as production data.
//
// This entire block is dev-only by mount: in production neither
// the route nor this helper runs, so no demo data ever lands in a
// production patient row. The function is also scoped strictly to
// the seeded demo user id -- it cannot touch a real patient.
const DEMO_FALLBACK_INTERVENTION = {
  triggerType: "nausea" as const,
  symptomType: "nausea",
  severity: 4,
  riskLevel: "elevated" as const,
  whatWeNoticed:
    "You reported severe nausea, low appetite and constipation today.",
  recommendation:
    "Start with small sips of water and a light protein-forward snack, then take a short walk if your stomach feels okay.",
  followUpQuestion:
    "After you try it, tell us if your nausea and digestion feel better, the same or worse.",
  recommendationCategory: "small_meal" as const,
  generatedBy: "rules_fallback" as const,
};

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function seedDemoTodaysCheckinAndIntervention(
  patientUserId: number,
  doctorId: number,
): Promise<void> {
  const today = todayLocalYmd();

  // 1. Upsert today's check-in row.
  await db
    .insert(patientCheckinsTable)
    .values({
      patientUserId,
      date: today,
      energy: "tired",
      nausea: "severe",
      mood: 3,
      appetite: "low",
      digestion: "constipated",
      bowelMovement: false,
    })
    .onConflictDoUpdate({
      target: [patientCheckinsTable.patientUserId, patientCheckinsTable.date],
      set: {
        energy: "tired",
        nausea: "severe",
        mood: 3,
        appetite: "low",
        digestion: "constipated",
        bowelMovement: false,
      },
    });

  // 2. Soft-clear stale active interventions for the demo patient.
  await db
    .update(patientInterventionsTable)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(
      and(
        eq(patientInterventionsTable.patientUserId, patientUserId),
        inArray(patientInterventionsTable.status, [
          "shown",
          "accepted",
          "pending_feedback",
          "escalated",
        ]),
      ),
    );

  // 3. Try the real engine first so the operator sees production-shaped
  //    copy whenever the templates / AI branch can produce one.
  let row:
    | {
        id: number;
        triggerType: string;
        recommendationCategory: string | null;
        generatedBy: string;
        riskLevel: string;
      }
    | undefined;
  try {
    const generated = await generatePersonalizedIntervention({
      patientUserId,
      forcedTriggerType: "nausea",
      forcedSymptomType: "nausea",
      forcedSeverity: 4,
    });
    if (generated) {
      const [inserted] = await db
        .insert(patientInterventionsTable)
        .values(generated.insertRow)
        .returning();
      row = inserted;
    }
  } catch (err) {
    logger.warn(
      {
        err,
        patientUserId,
        event: "dev_demo_intervention_engine_failed",
      },
      "demo intervention engine failed; using hardcoded fallback",
    );
  }

  // 4. Hardcoded fallback so the demo card is always visible.
  if (!row) {
    const [inserted] = await db
      .insert(patientInterventionsTable)
      .values({
        patientUserId,
        doctorId,
        ...DEMO_FALLBACK_INTERVENTION,
        contextSummary: { source: "dev_demo_seed_fallback" },
        deidentifiedAiPayload: null,
        escalationReason: null,
      })
      .returning();
    row = inserted;
  }

  if (!row) return;

  // 5. Mirror to care_events. Best-effort; a failure here must not
  //    swallow the seeded intervention row.
  try {
    await db.insert(careEventsTable).values({
      patientUserId,
      actorUserId: null,
      source: "viva",
      type: "recommendation_shown",
      metadata: {
        intervention_id: row.id,
        trigger_type: row.triggerType,
        recommendation_category: row.recommendationCategory,
        generated_by: row.generatedBy,
        source: "dev_demo_seed",
        risk_level: row.riskLevel,
      },
    });
  } catch (err) {
    logger.warn(
      { err, interventionId: row.id, event: "dev_demo_care_event_failed" },
      "demo care_event mirror failed",
    );
  }
}

// ---------------------------------------------------------------------
// POST /api/dev/reset-demo-patient
//
// Dev-only "reset to a known scenario" helper for the seeded demo
// patient. Lets the operator flip between three pre-baked clinical
// presentations on the same demo account so a stakeholder demo can
// walk through stable -> moderate -> severe without seeding fresh
// patients each time.
//
// Hard guarantees:
//   - Returns 404 in production (router-level gate above already
//     enforces this; we re-check here as defense in depth).
//   - Only ever touches the demo patient row -- looked up by the
//     hardcoded fake email DEV_DEMO_PATIENT_EMAIL. Never accepts an
//     arbitrary patient_id or email from the request body.
//   - Idempotent: replays of the same scenario converge to the same
//     post-state. Today's check-in is upserted, stale active
//     interventions are soft-cleared, escalation flags are written
//     directly into care_events.
//   - Body shape: { scenario: "stable" | "moderate" | "severe" }.
//     Anything else returns 400.
// ---------------------------------------------------------------------
type DemoScenario = "stable" | "moderate" | "severe";

const DEMO_SCENARIO_CHECKINS: Record<DemoScenario, {
  energy: "great" | "good" | "tired" | "depleted";
  nausea: "none" | "mild" | "moderate" | "severe";
  mood: number;
  appetite: "strong" | "normal" | "low" | "very_low";
  digestion: "fine" | "bloated" | "constipated" | "diarrhea";
  bowelMovement: boolean;
}> = {
  stable: {
    energy: "good",
    nausea: "none",
    mood: 4,
    appetite: "normal",
    digestion: "fine",
    bowelMovement: true,
  },
  moderate: {
    energy: "tired",
    nausea: "mild",
    mood: 3,
    appetite: "low",
    digestion: "bloated",
    bowelMovement: true,
  },
  severe: {
    energy: "depleted",
    nausea: "severe",
    mood: 2,
    appetite: "very_low",
    digestion: "diarrhea",
    bowelMovement: false,
  },
};

router.post(
  "/reset-demo-patient",
  async (req: Request, res: Response) => {
    if (!isDevLoginEnabled()) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const scenario = req.body?.scenario as unknown;
    if (
      scenario !== "stable" &&
      scenario !== "moderate" &&
      scenario !== "severe"
    ) {
      res.status(400).json({
        error: "invalid_scenario",
        allowed: ["stable", "moderate", "severe"],
      });
      return;
    }

    try {
      const doctor = await ensureDemoDoctor();
      const patient = await ensureDemoPatient(doctor.id, doctor.platformId);
      const today = todayLocalYmd();
      const checkin = DEMO_SCENARIO_CHECKINS[scenario as DemoScenario];

      // 1. Upsert today's check-in for the demo patient.
      await db
        .insert(patientCheckinsTable)
        .values({
          patientUserId: patient.id,
          date: today,
          ...checkin,
        })
        .onConflictDoUpdate({
          target: [patientCheckinsTable.patientUserId, patientCheckinsTable.date],
          set: { ...checkin },
        });

      // 2. Soft-clear stale active interventions so the next /active
      //    fetch is clean and a freshly seeded card (severe scenario)
      //    isn't competing with old rows.
      await db
        .update(patientInterventionsTable)
        .set({ status: "dismissed", updatedAt: new Date() })
        .where(
          and(
            eq(patientInterventionsTable.patientUserId, patient.id),
            inArray(patientInterventionsTable.status, [
              "shown",
              "accepted",
              "pending_feedback",
              "escalated",
            ]),
          ),
        );

      // 3. Mark any open escalations as reviewed so the dashboard
      //    inbox starts each scenario from a clean slate. Then, for
      //    the severe scenario only, fire a fresh escalation so the
      //    provider escalation banner becomes visible immediately.
      await db.insert(careEventsTable).values({
        patientUserId: patient.id,
        actorUserId: doctor.id,
        source: "doctor",
        type: "doctor_reviewed",
        metadata: {
          source: "dev_demo_reset",
          scenario,
        },
      });

      let escalationFired = false;
      if (scenario === "severe") {
        await db.insert(careEventsTable).values({
          patientUserId: patient.id,
          actorUserId: patient.id,
          source: "patient",
          type: "escalation_requested",
          metadata: {
            source: "dev_demo_reset",
            scenario,
          },
        });
        escalationFired = true;

        // Re-seed today's intervention so the severe scenario also
        // has a card visible in the patient app.
        try {
          await seedDemoTodaysCheckinAndIntervention(patient.id, doctor.id);
        } catch (seedErr) {
          req.log.warn(
            {
              err: seedErr,
              event: "dev_demo_reset_seed_failed",
              patientUserId: patient.id,
              scenario,
            },
            "dev demo reset seed failed; reset proceeded anyway",
          );
        }
      }

      req.log.warn(
        {
          event: "dev_demo_reset",
          patientUserId: patient.id,
          scenario,
          escalationFired,
        },
        "DEV DEMO RESET USED",
      );

      res.status(200).json({
        ok: true,
        scenario,
        patientUserId: patient.id,
        escalationFired,
      });
    } catch (err) {
      req.log.error(
        { err, event: "dev_demo_reset_failed" },
        "dev demo reset failed",
      );
      res.status(500).json({ error: "dev_reset_failed" });
    }
  },
);

router.post(
  "/login-demo-patient",
  async (req: Request, res: Response) => {
    try {
      const doctor = await ensureDemoDoctor();
      const patient = await ensureDemoPatient(doctor.id, doctor.platformId);
      const token = await issueApiToken(patient.id, "patient");

      // Seed today's check-in + a freshly generated personalized
      // intervention so the Today tab visibly shows the new card on
      // the next /active fetch. Wrapped in try/catch so a partial
      // failure never blocks the bearer-token return -- without the
      // token the operator cannot test anything else.
      try {
        await seedDemoTodaysCheckinAndIntervention(patient.id, doctor.id);
      } catch (seedErr) {
        req.log.warn(
          {
            err: seedErr,
            event: "dev_demo_seed_failed",
            patientUserId: patient.id,
          },
          "dev demo seed failed; returning token anyway",
        );
      }

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
