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
import { isInviteTokenExpired } from "../lib/inviteTokens";

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
  // Step 1: Look up the token. We read activatedAt and issuedAt up
  // front so we can return a precise status code (404 vs 409 vs 410)
  // without burning the token. The atomic claim below still defends
  // against the case where two requests both pass these checks
  // concurrently -- one will win the UPDATE, the other will get 0
  // rows back and fall through to the post-claim recovery branch.
  const [patient] = await db
    .select({
      userId: patientsTable.userId,
      activatedAt: patientsTable.activatedAt,
      activationTokenIssuedAt: patientsTable.activationTokenIssuedAt,
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
    // sign in with their email + password instead. (Idempotency note:
    // we deliberately do NOT re-issue a bearer here, because at this
    // point we cannot tell whether this caller is the same client that
    // already activated, or a different device replaying a leaked URL.
    // The mobile client surfaces this as "already used, sign in instead".)
    res.status(409).json({ error: "already_activated" });
    return;
  }
  if (isInviteTokenExpired(patient.activationTokenIssuedAt)) {
    // 410 Gone is the right shape: the resource existed, but the
    // window for using it has closed. The mobile client maps this
    // to "ask your clinician for a fresh invite link".
    res.status(410).json({ error: "token_expired" });
    return;
  }

  // Step 2: Hash the password BEFORE the atomic claim. Bcrypt is the
  // expensive step (~100ms); doing it before the UPDATE means the
  // critical section is just two writes. If hashing throws, we have
  // not yet touched the DB and the token remains usable.
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  // Step 3: Atomic claim + password write in a single transaction.
  // The UPDATE filters on `activationToken = $token AND activatedAt IS
  // NULL`, so concurrent activations cannot both succeed: the second
  // one matches zero rows. .returning() lets us detect that case
  // without a second SELECT.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(patientsTable)
      .set({
        activatedAt: new Date(),
        activationToken: null,
        activationTokenIssuedAt: null,
      })
      .where(
        and(
          eq(patientsTable.activationToken, parsed.data.token),
          isNull(patientsTable.activatedAt),
        ),
      )
      .returning({ userId: patientsTable.userId });
    if (rows.length === 0) return null;
    const winningUserId = rows[0]!.userId;
    await tx
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, winningUserId));
    return winningUserId;
  });

  if (claimed === null) {
    // Lost the race. Re-read so we can give the right status: if
    // activatedAt is now set, a parallel request beat us (409); if
    // the row no longer matches the token, it was rotated out from
    // under us by a doctor /resend (404). Both responses are precise
    // enough for the mobile client to render the correct CTA.
    const [recheck] = await db
      .select({
        userId: patientsTable.userId,
        activatedAt: patientsTable.activatedAt,
      })
      .from(patientsTable)
      .where(eq(patientsTable.userId, patient.userId))
      .limit(1);
    if (recheck?.activatedAt) {
      res.status(409).json({ error: "already_activated" });
      return;
    }
    res.status(404).json({ error: "invalid_token" });
    return;
  }

  // Step 4: Read back the user (the transaction is closed; the
  // password hash is durably written) and issue the bearer the mobile
  // client will store in AsyncStorage. The bearer insert is awaited
  // so the token is queryable on the very next request -- there is
  // no read-your-write race for the first authenticated call.
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claimed))
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
      // Doctors graduate from onboarding once they've named their
      // practice. We deliberately do NOT also require a non-empty
      // patient roster: the wizard now exposes a "Skip for now" path
      // and clinicians can invite from the dashboard later, so an
      // empty roster is a valid steady state. Gating on patient count
      // would force any returning doctor whose roster was emptied
      // (deleted, archived, etc.) back through the wizard.
      const needsOnboarding =
        user.role === "doctor" ? !user.clinicName : false;
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
    // Mirrors the login handler: clinic-name presence is the sole
    // gate. We dropped the patient-count check so an empty roster no
    // longer bounces the doctor back into the wizard.
    needsOnboarding:
      user.role === "doctor" ? !user.clinicName : false,
  });
});

export default router;
