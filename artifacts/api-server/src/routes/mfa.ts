import { Router, type Request, type Response, type IRouter } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { strictAuthLimiter } from "../middlewares/rateLimit";
import {
  generateTotpSecret,
  buildOtpauthUrl,
  generateQrcodeDataUrl,
  verifyTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../lib/mfa";

// /me/mfa router (HIPAA pilot, T007). Doctor TOTP enrollment + per-session
// step-up verification. Patients are technically allowed to enroll too --
// the endpoints are role-agnostic -- but the gate that matters
// (requireDoctorMfa in middlewares/auth.ts) is doctor-only.
//
// Endpoint contract:
//   GET    /me/mfa/status         -> { enrolled, sessionVerified, hasSession }
//   POST   /me/mfa/enroll/start   -> { secret, otpauthUrl, qrcodeDataUrl }
//                                    (overwrites any pending unverified secret;
//                                     no-ops if mfa is already enrolled)
//   POST   /me/mfa/enroll/verify  { code } -> { recoveryCodes }
//                                    (issues recovery codes on success;
//                                     also sets session.mfaVerified=true)
//   POST   /me/mfa/verify         { code? | recoveryCode? } -> { ok: true }
//                                    (per-session step-up; rate-limited)
//   POST   /me/mfa/disable        { code } -> { ok: true }
//                                    (verify code first, then clear all mfa fields)
const router: IRouter = Router();

// All MFA endpoints require an authenticated session/bearer (same gate as
// /auth/me). They do NOT require requireDoctorMfa because requireDoctorMfa
// IS the thing this router lets you satisfy.
router.use(requireAuth);

router.get("/status", async (req: Request, res: Response) => {
  const auth = (req as AuthedRequest).auth;
  const [row] = await db
    .select({ enrolledAt: usersTable.mfaEnrolledAt })
    .from(usersTable)
    .where(eq(usersTable.id, auth.userId))
    .limit(1);
  const enrolled = !!(row && row.enrolledAt);
  // hasSession lets the dashboard distinguish bearer-token doctors
  // (which can never satisfy MFA in this design) from session doctors
  // who just need to verify.
  const hasSession = typeof req.session.userId === "number";
  res.json({
    enrolled,
    sessionVerified: req.session.mfaVerified === true,
    hasSession,
  });
});

router.post(
  "/enroll/start",
  strictAuthLimiter,
  async (req: Request, res: Response) => {
  const auth = (req as AuthedRequest).auth;
  // Empty-body strict schema -- defense-in-depth so that any extra
  // keys are rejected at the edge, matching every other MFA endpoint.
  const parsed = z.object({}).strict().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }
  const [row] = await db
    .select({
      email: usersTable.email,
      enrolledAt: usersTable.mfaEnrolledAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, auth.userId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  // Refuse to re-enroll without an explicit /disable. Otherwise a
  // mid-session attacker who hijacks an already-verified browser
  // could rotate the secret out from under the legitimate doctor.
  if (row.enrolledAt) {
    res.status(409).json({ error: "already_enrolled" });
    return;
  }
  const secret = generateTotpSecret();
  const otpauthUrl = buildOtpauthUrl(secret, row.email);
  const qrcodeDataUrl = await generateQrcodeDataUrl(otpauthUrl);
  await db
    .update(usersTable)
    .set({ mfaSecret: secret })
    .where(eq(usersTable.id, auth.userId));
  res.json({ secret, otpauthUrl, qrcodeDataUrl });
  },
);

// Exactly-one-of: either { code } (TOTP) or { recoveryCode }, never
// both. Sending both is rejected with 400 -- the contract documented
// in artifacts/viva-dashboard/src/lib/api.ts mfaVerify() is XOR.
const verifySchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    recoveryCode: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((d) => Boolean(d.code) !== Boolean(d.recoveryCode), {
    message: "exactly one of code or recoveryCode required",
  });

router.post(
  "/enroll/verify",
  strictAuthLimiter,
  async (req: Request, res: Response) => {
    const auth = (req as AuthedRequest).auth;
    const parsed = z
      .object({ code: z.string().min(1).max(16) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const [row] = await db
      .select({
        secret: usersTable.mfaSecret,
        enrolledAt: usersTable.mfaEnrolledAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, auth.userId))
      .limit(1);
    if (!row || !row.secret) {
      res.status(400).json({ error: "no_pending_enrollment" });
      return;
    }
    if (row.enrolledAt) {
      res.status(409).json({ error: "already_enrolled" });
      return;
    }
    if (!verifyTotpCode(row.secret, parsed.data.code.trim())) {
      res.status(400).json({ error: "invalid_code" });
      return;
    }
    // Issue recovery codes ONLY on successful verify so a user who
    // bails halfway through enrollment doesn't see a useless set.
    // Codes are returned plaintext exactly once and stored as
    // sha256 hashes -- same posture as bearer api tokens (T002).
    const codes = generateRecoveryCodes();
    const codeHashes = codes.map(hashRecoveryCode);
    await db
      .update(usersTable)
      .set({
        mfaEnrolledAt: new Date(),
        mfaRecoveryCodesHashed: codeHashes,
      })
      .where(eq(usersTable.id, auth.userId));
    // The user just proved they have the device, so this session is
    // verified. Save explicitly so downstream PHI requests on the
    // same connection see the flag.
    req.session.mfaVerified = true;
    req.session.mfaVerifiedAt = Date.now();
    req.session.save(() => {
      res.json({ ok: true, recoveryCodes: codes });
    });
  },
);

router.post(
  "/verify",
  strictAuthLimiter,
  async (req: Request, res: Response) => {
    const auth = (req as AuthedRequest).auth;
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const { code, recoveryCode } = parsed.data;
    const [row] = await db
      .select({
        secret: usersTable.mfaSecret,
        enrolledAt: usersTable.mfaEnrolledAt,
        recoveryHashes: usersTable.mfaRecoveryCodesHashed,
      })
      .from(usersTable)
      .where(eq(usersTable.id, auth.userId))
      .limit(1);
    if (!row || !row.secret || !row.enrolledAt) {
      res.status(400).json({ error: "not_enrolled" });
      return;
    }
    let ok = false;
    if (code) {
      ok = verifyTotpCode(row.secret, code.trim());
    } else if (recoveryCode) {
      // Atomic single-use consumption. We do the membership check and
      // the removal in ONE Postgres statement so two concurrent
      // /verify calls with the same code can't both succeed: only
      // the statement that matches `ANY(...)` actually mutates the
      // row, and the other gets zero rowCount.
      //
      // hashRecoveryCode trims+lowercases the input and sha256-hexes
      // it, matching how enrollment stored the digests, so the
      // ANY-comparison is on hash-on-hash equality. The hash itself
      // is uniformly distributed, so a comparison-timing side channel
      // here would only leak information about the digest, not the
      // original recovery code.
      const incomingHash = hashRecoveryCode(recoveryCode);
      const result = await db.execute(sql`
        update users
           set mfa_recovery_codes_hashed = array_remove(
             mfa_recovery_codes_hashed, ${incomingHash}
           )
         where id = ${auth.userId}
           and ${incomingHash} = any(mfa_recovery_codes_hashed)
        returning id
      `);
      ok = (result.rowCount ?? 0) > 0;
    }
    if (!ok) {
      res.status(400).json({ error: "invalid_code" });
      return;
    }
    req.session.mfaVerified = true;
    req.session.mfaVerifiedAt = Date.now();
    req.session.save(() => {
      res.json({ ok: true });
    });
  },
);

router.post(
  "/disable",
  strictAuthLimiter,
  async (req: Request, res: Response) => {
    const auth = (req as AuthedRequest).auth;
    const parsed = z
      .object({ code: z.string().min(1).max(16) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const [row] = await db
      .select({
        secret: usersTable.mfaSecret,
        enrolledAt: usersTable.mfaEnrolledAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, auth.userId))
      .limit(1);
    if (!row || !row.secret || !row.enrolledAt) {
      res.status(400).json({ error: "not_enrolled" });
      return;
    }
    if (!verifyTotpCode(row.secret, parsed.data.code.trim())) {
      res.status(400).json({ error: "invalid_code" });
      return;
    }
    await db
      .update(usersTable)
      .set({
        mfaSecret: null,
        mfaEnrolledAt: null,
        mfaRecoveryCodesHashed: null,
      })
      .where(eq(usersTable.id, auth.userId));
    req.session.mfaVerified = false;
    req.session.mfaVerifiedAt = undefined;
    req.session.save(() => {
      res.json({ ok: true });
    });
  },
);

export default router;
