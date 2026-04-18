import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  patientsTable,
  apiTokensTable,
} from "@workspace/db";
import { z } from "zod";

// Issue a long-lived bearer token for the patient mobile app. Cookies
// are not reliable on RN, so the app stores this in AsyncStorage and
// sends it on every request via Authorization: Bearer <token>.
async function issueApiToken(
  userId: number,
  role: "doctor" | "patient",
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(apiTokensTable).values({ token, userId, role });
  return token;
}

const router: Router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signupSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

// POST /auth/signup -- create a new doctor account. Patient accounts
// are not created this way; they are provisioned by a doctor via the
// invite flow and claim their account from the mobile app.
router.post("/signup", async (req: Request, res: Response) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "email_in_use" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      role: "doctor",
      name: parsed.data.name.trim(),
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "create_failed" });
    return;
  }
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.log.error({ err: regenErr }, "session regenerate failed");
      res.status(500).json({ error: "session_regenerate_failed" });
      return;
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.save((err) => {
      if (err) {
        req.log.error({ err }, "session save failed");
        res.status(500).json({ error: "session_save_failed" });
        return;
      }
      res.status(201).json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clinicName: user.clinicName,
        needsOnboarding: true,
      });
    });
  });
});

// POST /auth/activate -- patient claims a pending account using the
// invite token the doctor sent them. Sets the real password, stamps
// activatedAt (so the dashboard moves them out of "Pending"), and
// returns a bearer token for the mobile app.
const activateSchema = z.object({
  token: z.string().min(8).max(200),
  password: z.string().min(8).max(200),
});
router.post("/activate", async (req: Request, res: Response) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [patient] = await db
    .select({
      userId: patientsTable.userId,
      activatedAt: patientsTable.activatedAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.activationToken, parsed.data.token))
    .limit(1);
  if (!patient) {
    res.status(404).json({ error: "invalid_token" });
    return;
  }
  if (patient.activatedAt) {
    // Token was already burned. Fail closed -- the patient should
    // sign in with their email + password instead.
    res.status(409).json({ error: "already_activated" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await db
    .update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, patient.userId));
  await db
    .update(patientsTable)
    .set({ activatedAt: new Date(), activationToken: null })
    .where(
      and(
        eq(patientsTable.userId, patient.userId),
        isNull(patientsTable.activatedAt),
      ),
    );
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, patient.userId))
    .limit(1);
  if (!user) {
    res.status(500).json({ error: "activation_failed" });
    return;
  }
  const token = await issueApiToken(user.id, user.role);
  res.status(200).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { email, password } = parsed.data;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  // Regenerate the session ID at the moment of privilege change so an
  // attacker who fixated a pre-login cookie cannot reuse it post-auth.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.log.error({ err: regenErr }, "session regenerate failed");
      res.status(500).json({ error: "session_regenerate_failed" });
      return;
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    // Wait for the session row to land in Postgres before responding,
    // otherwise the next request can race ahead of connect-pg-simple's
    // async write and look unauthenticated.
    req.session.save(async (err) => {
      if (err) {
        req.log.error({ err }, "session save failed");
        res.status(500).json({ error: "session_save_failed" });
        return;
      }
      const needsOnboarding =
        user.role === "doctor"
          ? !user.clinicName || (await countDoctorPatients(user.id)) === 0
          : false;
      // Always issue a bearer token. The dashboard ignores it (uses
      // its session cookie); the mobile patient app stores it in
      // AsyncStorage so it can authenticate subsequent requests.
      const token = await issueApiToken(user.id, user.role);
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clinicName: user.clinicName,
        needsOnboarding,
        token,
      });
    });
  });
});

router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clinicName: user.clinicName,
    needsOnboarding:
      user.role === "doctor"
        ? !user.clinicName || (await countDoctorPatients(user.id)) === 0
        : false,
  });
});

async function countDoctorPatients(doctorId: number): Promise<number> {
  const rows = await db
    .select({ id: patientsTable.userId })
    .from(patientsTable)
    .where(eq(patientsTable.doctorId, doctorId));
  return rows.length;
}

export default router;
