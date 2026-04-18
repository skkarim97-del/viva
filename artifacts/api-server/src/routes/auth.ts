import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, patientsTable } from "@workspace/db";
import { z } from "zod";

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
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clinicName: user.clinicName,
        needsOnboarding,
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
