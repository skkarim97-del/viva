import { Router, type Response } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, desc, gte, inArray, max, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  patientsTable,
  patientCheckinsTable,
  patientWeightsTable,
  doctorNotesTable,
  careEventsTable,
  patientHealthDailySummariesTable,
  patientTreatmentLogsTable,
  TREATMENT_STATUSES,
  STOP_REASONS,
  deriveStopTiming,
} from "@workspace/db";
import {
  requireDoctor,
  requireDoctorMfa,
  type AuthedRequest,
} from "../middlewares/auth";
import {
  computeRisk,
  deriveAction,
  deriveSignals,
  deriveSuggestedAction,
} from "../lib/risk";
import {
  computeSymptomFlags,
  summarizeFlagForList,
} from "../lib/symptoms";
import { mediumApiLimiter } from "../middlewares/rateLimit";
import { phiAudit } from "../middlewares/phiAudit";

const router: Router = Router();

// Rate limit BEFORE the auth gate so an unauthenticated flood
// doesn't burn DB cycles on bcrypt-style work in requireDoctor.
router.use(mediumApiLimiter);
// requireDoctorMfa = requireDoctor + per-session TOTP verification (T007).
// All patient PHI in this router is doctor-only AND must be behind MFA
// for the HIPAA pilot. The export of `requireDoctor` is kept available
// for routes that need doctor identity but not PHI (none in this file
// today).
router.use(requireDoctorMfa);
void requireDoctor; // imported for future doctor-non-PHI routes; explicit no-op
// HIPAA audit log: mount AFTER requireDoctorMfa so req.auth is populated
// by the time the response 'finish' handler fires. The middleware's
// own try/catch + .catch() on the insert means an audit failure
// never breaks a doctor request. We pull the patient id from either
// `:id` (the standard 14 routes) or `:patientId` (only the
// notes/:noteId DELETE route uses the alternate name).
router.use(
  phiAudit({
    getPatientId: (req) => {
      const raw = req.params?.id ?? req.params?.patientId;
      if (typeof raw !== "string") return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
  }),
);

// GET /patients -- list every patient assigned to the calling doctor, with
// last-checkin date and computed risk band so the dashboard list view can
// render risk badges without N+1 round trips.
router.get("/", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  // Default behavior: stopped patients with no unresolved workflow are
  // considered "archived" and removed from the active dashboard. They
  // remain accessible via patient detail by id, and can be re-included
  // here with `?includeArchived=true` for search / history surfaces.
  const includeArchived = req.query.includeArchived === "true";
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
      glp1Drug: patientsTable.glp1Drug,
      dose: patientsTable.dose,
      startedOn: patientsTable.startedOn,
      activatedAt: patientsTable.activatedAt,
      activationToken: patientsTable.activationToken,
      activationTokenIssuedAt: patientsTable.activationTokenIssuedAt,
      treatmentStatus: patientsTable.treatmentStatus,
      stopReason: patientsTable.stopReason,
    })
    .from(patientsTable)
    .innerJoin(usersTable, eq(usersTable.id, patientsTable.userId))
    .where(eq(patientsTable.doctorId, doctorId));

  // Pull last 14 days of check-ins for all patients in one query, then
  // group in memory. Keeps it simple while avoiding the per-patient query.
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const cutoff = fourteenDaysAgo.toISOString().split("T")[0]!;

  const patientIds = rows.map((r) => r.id);
  const checkins =
    patientIds.length === 0
      ? []
      : await db
          .select()
          .from(patientCheckinsTable)
          .where(gte(patientCheckinsTable.date, cutoff));

  const byPatient = new Map<number, typeof checkins>();
  for (const c of checkins) {
    if (!patientIds.includes(c.patientUserId)) continue;
    const arr = byPatient.get(c.patientUserId) ?? [];
    arr.push(c);
    byPatient.set(c.patientUserId, arr);
  }

  // Pull the most recent note timestamp per patient in a single grouped
  // query so the list view can show "Last note: 2d ago" without an
  // extra round trip. Surfacing this on the queue is what stops two
  // doctors from re-calling the same patient.
  const lastNoteRows =
    patientIds.length === 0
      ? []
      : await db
          .select({
            patientUserId: doctorNotesTable.patientUserId,
            last: max(doctorNotesTable.createdAt),
          })
          .from(doctorNotesTable)
          .where(inArray(doctorNotesTable.patientUserId, patientIds))
          .groupBy(doctorNotesTable.patientUserId);
  const lastNoteByPatient = new Map<number, string>();
  for (const r of lastNoteRows) {
    if (r.last) lastNoteByPatient.set(r.patientUserId, r.last as string);
  }

  // All-time most recent check-in per patient. Distinct from the
  // 14-day risk window above because the 12+ day inactivity flag has
  // to consider patients whose last check-in fell outside that window
  // (or who never checked in at all). Source of truth shared with the
  // /internal disengagement aggregate so the worklist pill and the
  // analytics card cannot drift.
  const lastCheckinAllRows =
    patientIds.length === 0
      ? []
      : await db
          .select({
            patientUserId: patientCheckinsTable.patientUserId,
            last: max(patientCheckinsTable.date),
          })
          .from(patientCheckinsTable)
          .where(inArray(patientCheckinsTable.patientUserId, patientIds))
          .groupBy(patientCheckinsTable.patientUserId);
  const lastCheckinAllByPatient = new Map<number, string>();
  for (const r of lastCheckinAllRows) {
    if (r.last) lastCheckinAllByPatient.set(r.patientUserId, r.last as string);
  }

  // Per-patient unresolved-workflow lookup. A workflow is "unresolved"
  // when there's an escalation_requested with no later doctor_reviewed
  // OR no later follow_up_completed. Used to keep stopped patients
  // visible in the active dashboard until their open workflow item is
  // closed -- after which they archive automatically. One bulk query
  // keeps this O(1) for the queue, regardless of panel size.
  const openWorkflowByPatient = new Map<number, boolean>();
  if (patientIds.length > 0) {
    const wfRows = await db
      .select({
        patientUserId: careEventsTable.patientUserId,
        lastEsc: max(
          sql<string | null>`case when ${careEventsTable.type} = 'escalation_requested' then ${careEventsTable.occurredAt} end`,
        ),
        lastRev: max(
          sql<string | null>`case when ${careEventsTable.type} = 'doctor_reviewed' then ${careEventsTable.occurredAt} end`,
        ),
        lastFu: max(
          sql<string | null>`case when ${careEventsTable.type} = 'follow_up_completed' then ${careEventsTable.occurredAt} end`,
        ),
      })
      .from(careEventsTable)
      .where(inArray(careEventsTable.patientUserId, patientIds))
      .groupBy(careEventsTable.patientUserId);
    for (const r of wfRows) {
      const lastEsc = r.lastEsc ? new Date(r.lastEsc).getTime() : 0;
      if (!lastEsc) continue;
      const lastRev = r.lastRev ? new Date(r.lastRev).getTime() : 0;
      const lastFu = r.lastFu ? new Date(r.lastFu).getTime() : 0;
      const open = lastRev < lastEsc || lastFu < lastEsc;
      if (open) openWorkflowByPatient.set(r.patientUserId, true);
    }
  }
  const isArchived = (
    treatmentStatus: string,
    patientUserId: number,
  ): boolean =>
    treatmentStatus === "stopped" && !openWorkflowByPatient.get(patientUserId);

  // Single source of truth for the 12-day inactivity rule applied to
  // every branch below.
  const ACTIVITY_THRESHOLD_DAYS = 12;
  const activityCutoff = new Date();
  activityCutoff.setDate(activityCutoff.getDate() - ACTIVITY_THRESHOLD_DAYS);
  const activityCutoffDateStr = activityCutoff.toISOString().split("T")[0]!;
  const isInactive12d = (
    treatmentStatus: string,
    activatedAt: unknown,
    lastCheckinDate: string | null | undefined,
  ): boolean => {
    if (treatmentStatus !== "active" && treatmentStatus !== "unknown") {
      return false;
    }
    if (!activatedAt) return false;
    const activatedTs = new Date(activatedAt as string).getTime();
    if (activatedTs > activityCutoff.getTime()) return false;
    // Never checked in or last check-in date <= the cutoff date.
    return !lastCheckinDate || lastCheckinDate <= activityCutoffDateStr;
  };

  const result = rows.map((p) => {
    // Pending patients have not yet claimed their account in the
    // mobile app, so risk and signals are not yet meaningful. We
    // surface them in their own dashboard bucket instead of scoring
    // empty data and falsely calling them "Stable".
    const lastCheckinAllTime = lastCheckinAllByPatient.get(p.id) ?? null;
    const inactive12d = isInactive12d(
      p.treatmentStatus,
      p.activatedAt,
      lastCheckinAllTime,
    );

    const pending = !p.activatedAt;
    if (pending) {
      // Surface a stale-invite signal so the doctor can see at a
      // glance which invites are sitting unclaimed past 48h. The
      // hours value is exposed so the UI can render the precise age
      // (e.g. "Sent 3d ago") without re-deriving from the issuance
      // timestamp on the client.
      const issuedRaw = p.activationTokenIssuedAt
        ? new Date(p.activationTokenIssuedAt as unknown as string).getTime()
        : NaN;
      // Clamp at >= 0 and treat invalid/missing timestamps as null so a
      // bad row never serializes as NaN or trips the stale chip with a
      // negative age.
      const inviteAgeHours = Number.isFinite(issuedRaw)
        ? Math.max(0, Math.floor((Date.now() - issuedRaw) / (1000 * 60 * 60)))
        : null;
      const staleInvite =
        inviteAgeHours !== null && inviteAgeHours >= 48;
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        glp1Drug: p.glp1Drug,
        dose: p.dose,
        startedOn: p.startedOn,
        lastCheckin: null,
        riskScore: 0,
        riskBand: "low" as const,
        action: "pending" as const,
        status: "invited" as const,
        signals: [] as string[],
        lastNoteAt: lastNoteByPatient.get(p.id) ?? null,
        pending: true,
        activationToken: p.activationToken,
        treatmentStatus: p.treatmentStatus,
        stopReason: p.stopReason,
        inactive12d,
        inviteAgeHours,
        staleInvite,
        archived: isArchived(p.treatmentStatus, p.id),
      };
    }
    const cks = byPatient.get(p.id) ?? [];
    const risk = computeRisk(cks);
    // Compute symptom flags on the same window so the queue can render
    // a single inline summary string (e.g. "Severe nausea") without
    // requiring the dashboard to round-trip per-patient.
    const symptomFlags = computeSymptomFlags(cks);
    const symptomSummary = summarizeFlagForList(symptomFlags);
    const lastCheckin =
      cks.length > 0
        ? cks.reduce((acc, c) => (c.date > acc ? c.date : acc), cks[0]!.date)
        : null;
    // Activated but no check-ins yet -> still belongs in the pending
    // bucket from the doctor's POV (nothing to score), but flagged
    // separately so the card can read "Connected, awaiting first
    // check-in" instead of "Awaiting account activation".
    if (cks.length === 0) {
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        glp1Drug: p.glp1Drug,
        dose: p.dose,
        startedOn: p.startedOn,
        lastCheckin: null,
        riskScore: 0,
        riskBand: "low" as const,
        action: "pending" as const,
        status: "activated" as const,
        signals: [] as string[],
        lastNoteAt: lastNoteByPatient.get(p.id) ?? null,
        pending: true,
        activationToken: null as string | null,
        treatmentStatus: p.treatmentStatus,
        stopReason: p.stopReason,
        inactive12d,
        archived: isArchived(p.treatmentStatus, p.id),
      };
    }
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      glp1Drug: p.glp1Drug,
      dose: p.dose,
      startedOn: p.startedOn,
      lastCheckin,
      riskScore: risk.score,
      riskBand: risk.band,
      action: deriveAction(
        risk.score,
        risk.rules,
        lastCheckin,
        new Date(),
        symptomFlags,
      ),
      status: "monitoring" as const,
      signals: deriveSignals(risk.rules, lastCheckin),
      lastNoteAt: lastNoteByPatient.get(p.id) ?? null,
      pending: false,
      activationToken: null as string | null,
      // Compact symptom indicators for the queue card. The full flag
      // detail lives on /patients/:id/risk to keep this response light.
      symptomFlagCount: symptomFlags.length,
      symptomEscalating: symptomFlags.some((f) => f.suggestFollowup),
      symptomSummary,
      treatmentStatus: p.treatmentStatus,
      stopReason: p.stopReason,
      // Soft outreach signal -- treatment_status not affected. Uses
      // the all-time max(date) lookup, not the truncated 14-day window
      // above, so patients whose last check-in fell outside that
      // window are still counted correctly.
      inactive12d,
      archived: isArchived(p.treatmentStatus, p.id),
    };
  });

  // Default queue is the actionable panel only. Archived patients
  // (treatment stopped + no unresolved workflow) are dropped here
  // unless the caller explicitly opts in via includeArchived. The
  // detail endpoint (/patients/:id) is unaffected so any archived
  // patient remains directly addressable via search / history.
  const filtered = includeArchived ? result : result.filter((r) => !r.archived);

  res.json(filtered);
});

// GET /patients/stats -- one-shot panel-health snapshot for the
// dashboard summary bar. Returns metrics the queue itself can't
// compute client-side. (Needs-follow-up count, 3+ day silence count,
// total patients, and requested-review count are derived from
// /patients + /care-events/needs-review-ids on the client to avoid
// duplicate queries.) Defined BEFORE /:id so Express doesn't route
// "stats" through the param handler.
//
// Returns one operational KPI for the SummaryBar:
//
//   followUpRate24h: percentage (0-100, integer) of escalation_requested
//   events on this doctor's panel, in the last 30 days, that were
//   "responded to" within 24 hours of the escalation.
//
// Definitions:
//   * Eligible escalation = any escalation_requested event for a
//     patient on this doctor's panel with occurredAt >= now - 30d.
//     We INCLUDE escalations that are still <24h old (i.e. the
//     doctor's response window is still open) so that the metric
//     reacts the moment a clinician logs a follow-up from the
//     dashboard. An open escalation simply counts as a miss until
//     a qualifying response is recorded; once the response lands,
//     the next refetch shows it as a hit.
//   * Responded = there exists, for the SAME patient, a doctor-side
//     activity (follow_up_completed, doctor_reviewed, OR a doctor_note
//     by this doctor) with timestamp in [escalation.occurredAt,
//     escalation.occurredAt + 24h]. All three event types represent
//     clinician acknowledgment of the escalation in the audit trail,
//     so any one of them within the window satisfies the SLA.
//
// followUpRate24h is null when the denominator is zero (no panel
// patients or no escalations in the last 30 days). The client renders
// a placeholder in that case so we never display a misleading
// "0%" / "100%" against an empty sample.
router.get("/stats", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Patient ids in this doctor's panel; needed to scope
  // patient-initiated escalations to the right doctor and to scope
  // the response-event lookups to those same patients.
  const panelRows = await db
    .select({ userId: patientsTable.userId })
    .from(patientsTable)
    .where(eq(patientsTable.doctorId, doctorId));
  const panelPatientIds = panelRows.map((r) => r.userId);

  if (panelPatientIds.length === 0) {
    res.json({ followUpRate24h: null });
    return;
  }

  // Pull the eligible escalations and all candidate response events
  // in parallel, then resolve the within-24h match in memory. The
  // alternative -- a correlated subquery per escalation -- would scale
  // poorly past a few hundred rows for no real benefit at this volume.
  const [escalations, followUps, reviews, notes] = await Promise.all([
    db
      .select({
        id: careEventsTable.id,
        patientUserId: careEventsTable.patientUserId,
        occurredAt: careEventsTable.occurredAt,
      })
      .from(careEventsTable)
      .where(
        and(
          eq(careEventsTable.type, "escalation_requested"),
          inArray(careEventsTable.patientUserId, panelPatientIds),
          gte(careEventsTable.occurredAt, lookbackStart),
        ),
      ),
    db
      .select({
        patientUserId: careEventsTable.patientUserId,
        occurredAt: careEventsTable.occurredAt,
      })
      .from(careEventsTable)
      .where(
        and(
          eq(careEventsTable.type, "follow_up_completed"),
          eq(careEventsTable.actorUserId, doctorId),
          gte(careEventsTable.occurredAt, lookbackStart),
        ),
      ),
    db
      .select({
        patientUserId: careEventsTable.patientUserId,
        occurredAt: careEventsTable.occurredAt,
      })
      .from(careEventsTable)
      .where(
        and(
          eq(careEventsTable.type, "doctor_reviewed"),
          eq(careEventsTable.actorUserId, doctorId),
          gte(careEventsTable.occurredAt, lookbackStart),
        ),
      ),
    db
      .select({
        patientUserId: doctorNotesTable.patientUserId,
        occurredAt: doctorNotesTable.createdAt,
      })
      .from(doctorNotesTable)
      .where(
        and(
          eq(doctorNotesTable.doctorUserId, doctorId),
          gte(doctorNotesTable.createdAt, lookbackStart),
        ),
      ),
  ]);

  if (escalations.length === 0) {
    res.json({ followUpRate24h: null });
    return;
  }

  // Bucket every candidate response by patient so the per-escalation
  // lookup is O(responses for this patient) instead of O(all responses).
  const responsesByPatient = new Map<number, Date[]>();
  const pushResponse = (patientUserId: number, occurredAt: Date | null) => {
    if (!occurredAt) return;
    const bucket = responsesByPatient.get(patientUserId) ?? [];
    bucket.push(occurredAt);
    responsesByPatient.set(patientUserId, bucket);
  };
  for (const r of followUps) pushResponse(r.patientUserId, r.occurredAt);
  for (const r of reviews) pushResponse(r.patientUserId, r.occurredAt);
  for (const r of notes) pushResponse(r.patientUserId, r.occurredAt);

  let responded = 0;
  for (const esc of escalations) {
    if (!esc.occurredAt) continue;
    const escTs = esc.occurredAt.getTime();
    const deadline = escTs + 24 * 60 * 60 * 1000;
    const candidates = responsesByPatient.get(esc.patientUserId) ?? [];
    if (
      candidates.some((d) => {
        const ts = d.getTime();
        return ts >= escTs && ts <= deadline;
      })
    ) {
      responded += 1;
    }
  }

  const rate = Math.round((responded / escalations.length) * 100);
  res.json({ followUpRate24h: rate });
});

// PUT /patients/clinic -- set the calling doctor's clinic name. Captured
// once during the onboarding wizard, but editable later.
const clinicSchema = z.object({ clinicName: z.string().min(1).max(160) });
router.put("/clinic", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const parsed = clinicSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  await db
    .update(usersTable)
    .set({ clinicName: parsed.data.clinicName.trim() })
    .where(eq(usersTable.id, doctorId));
  res.json({ ok: true, clinicName: parsed.data.clinicName.trim() });
});

// POST /patients/invite -- provision a pending patient under the calling
// doctor and generate an opaque single-use activation token. The doctor
// gives the patient the resulting link; the mobile app exchanges the
// token for a real session on first launch (out of scope for this MVP).
const inviteSchema = z.object({
  name: z.string().min(1).max(120),
  // Phone is the primary patient contact field. We don't run any SMS
  // infrastructure yet, so this is purely stored on the user record and
  // surfaced back to the doctor; the activation channel is the copyable
  // invite link the doctor shares manually.
  phone: z.string().min(4).max(40),
  glp1Drug: z.string().max(80).optional().nullable(),
  dose: z.string().max(80).optional().nullable(),
});
// Normalize a free-form phone string to digits only so collisions are
// detected regardless of formatting (spaces, dashes, parens, +country).
function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, "");
}
function buildInviteLink(req: AuthedRequest, token: string): string {
  // Prefer the public host the dashboard is served on so the link the
  // doctor copies actually opens in their patient's browser.
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]!.trim();
  const host = req.get("host") || "viva-ai.replit.app";
  return `${proto}://${host}/invite/${token}`;
}
router.post("/invite", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const phone = normalizePhone(parsed.data.phone);
  if (phone.length < 4) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "phone_in_use" });
    return;
  }
  // Look up the inviting doctor's platform AND email in one round-trip.
  // Platform: denormalized onto patients.platform_id so analytics queries
  // filter by platform without a doubled join. If the doctor row somehow
  // has no platform (legacy data created before the platform layer
  // existed AND not covered by backfill), the patient simply lands
  // platformless -- the FK is nullable for exactly this case and
  // analytics treats null as "unscoped".
  // Email: the placeholder address we synthesize for the invitee
  // inherits the inviter's "demo-ness". A demo doctor (email matches
  // `demo%@itsviva.com`) inviting a real-looking phone number must
  // still produce a row that the analytics demo filter excludes,
  // otherwise stakeholder-demo invites would silently leak into
  // pilot KPIs.
  const [doctorRow] = await db
    .select({
      platformId: usersTable.platformId,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.id, doctorId))
    .limit(1);
  const platformId = doctorRow?.platformId ?? null;
  const inviterIsDemo = /^demo.*@itsviva\.com$/i.test(doctorRow?.email ?? "");
  // Synthesize a unique placeholder email so the legacy notNull/unique
  // email column is satisfied. The patient never sees this; they sign in
  // with a password they choose during activation, against the bearer
  // token issued from the invite link.
  // Pattern flips by inviter: demo doctor -> demo+inv-...@itsviva.com
  // (matches the analytics demo filter); real doctor -> the legacy
  // `@invite.viva.local` placeholder so real-pilot invites stay
  // visibly distinct from any demo activity.
  const placeholderEmail = inviterIsDemo
    ? `demo+inv-${phone}-${randomBytes(4).toString("hex")}@itsviva.com`
    : `invite-${phone}-${randomBytes(4).toString("hex")}@invite.viva.local`;
  // Random unguessable hash so a stolen invite token can't double as a
  // password. The patient sets a real password during activation.
  const placeholderHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
  const token = randomBytes(24).toString("base64url");
  const [user] = await db
    .insert(usersTable)
    .values({
      email: placeholderEmail,
      passwordHash: placeholderHash,
      role: "patient",
      name: parsed.data.name.trim(),
      phone,
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "create_failed" });
    return;
  }
  await db.insert(patientsTable).values({
    userId: user.id,
    doctorId,
    platformId,
    glp1Drug: parsed.data.glp1Drug?.trim() || null,
    dose: parsed.data.dose?.trim() || null,
    activationToken: token,
    activationTokenIssuedAt: new Date(),
  });
  res.status(201).json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    inviteLink: buildInviteLink(req as AuthedRequest, token),
  });
});

// POST /patients/:id/resend -- rotate the activation token for a still-
// pending patient and return the fresh link. No-op (409) if already
// activated, since a real session has already been established.
router.post("/:id/resend", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  // Ownership check first so a doctor probing other clinicians'
  // patient IDs cannot tell "exists but not yours" from "doesn't
  // exist" -- both return 404. Activation state is read for the
  // pre-flight 409, but the actual rotation below is conditional and
  // its rowcount is the source of truth (see comment there).
  const [row] = await db
    .select({
      doctorId: patientsTable.doctorId,
      activatedAt: patientsTable.activatedAt,
    })
    .from(patientsTable)
    .where(eq(patientsTable.userId, patientId))
    .limit(1);
  if (!row || row.doctorId !== doctorId) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (row.activatedAt) {
    res.status(409).json({ error: "already_activated" });
    return;
  }
  const token = randomBytes(24).toString("base64url");
  // Atomic rotation. If the patient activates between the SELECT above
  // and this UPDATE, the activatedAt-IS-NULL filter matches zero rows
  // and we fall through to the rowcount check -- so we can never hand
  // back a "fresh" invite link for a token that was never persisted.
  // Stamping issuedAt starts a new TTL window; the unique constraint
  // on activation_token invalidates the previous token in place.
  const rotated = await db
    .update(patientsTable)
    .set({ activationToken: token, activationTokenIssuedAt: new Date() })
    .where(
      and(
        eq(patientsTable.userId, patientId),
        eq(patientsTable.doctorId, doctorId),
        isNull(patientsTable.activatedAt),
      ),
    )
    .returning({ userId: patientsTable.userId });
  if (rotated.length === 0) {
    // Lost the race against an activation that landed between our
    // pre-flight read and the UPDATE. Surface the same 409 the
    // pre-flight would have, so the dashboard re-fetches state.
    res.status(409).json({ error: "already_activated" });
    return;
  }
  res.json({ inviteLink: buildInviteLink(req as AuthedRequest, token) });
});

// Helper: ensure a patient belongs to the calling doctor; throws 403 if not.
async function loadOwnedPatient(
  doctorId: number,
  patientId: number,
): Promise<{
  id: number;
  name: string;
  email: string;
  phone: string | null;
  glp1Drug: string | null;
  dose: string | null;
  startedOn: string | null;
  treatmentStatus: "active" | "stopped" | "unknown";
  treatmentStatusSource: "doctor" | "patient" | "system" | null;
  stopReason:
    | "side_effects"
    | "cost_or_insurance"
    | "lack_of_efficacy"
    | "patient_choice_or_motivation"
    | "other"
    | null;
  stopNote: string | null;
  treatmentStatusUpdatedAt: Date | null;
  // Derived from (treatmentStatusUpdatedAt - startedOn). Both fields are
  // sent so the dashboard can render "stopped 14 days after starting"
  // without re-doing the math.
  stopTimingBucket: "early" | "mid" | "late" | "unknown";
  daysOnTreatment: number | null;
} | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
      glp1Drug: patientsTable.glp1Drug,
      dose: patientsTable.dose,
      startedOn: patientsTable.startedOn,
      doctorId: patientsTable.doctorId,
      treatmentStatus: patientsTable.treatmentStatus,
      treatmentStatusSource: patientsTable.treatmentStatusSource,
      stopReason: patientsTable.stopReason,
      stopNote: patientsTable.stopNote,
      treatmentStatusUpdatedAt: patientsTable.treatmentStatusUpdatedAt,
    })
    .from(patientsTable)
    .innerJoin(usersTable, eq(usersTable.id, patientsTable.userId))
    .where(eq(patientsTable.userId, patientId))
    .limit(1);
  if (!row || row.doctorId !== doctorId) return null;
  const timing =
    row.treatmentStatus === "stopped"
      ? deriveStopTiming(row.startedOn, row.treatmentStatusUpdatedAt)
      : { bucket: "unknown" as const, daysOnTreatment: null };
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    glp1Drug: row.glp1Drug,
    dose: row.dose,
    startedOn: row.startedOn,
    treatmentStatus: row.treatmentStatus,
    treatmentStatusSource: row.treatmentStatusSource,
    stopReason: row.stopReason,
    stopNote: row.stopNote,
    treatmentStatusUpdatedAt: row.treatmentStatusUpdatedAt,
    stopTimingBucket: timing.bucket,
    daysOnTreatment: timing.daysOnTreatment,
  };
}

// PATCH /patients/:id/treatment-status -- doctor-only control to mark
// a patient's treatment status. Owns the entire transition: when
// status leaves 'stopped' we MUST clear the reason/note so they
// don't linger as ghost data on the next stop event.
const treatmentStatusBody = z
  .object({
    status: z.enum(TREATMENT_STATUSES),
    stopReason: z.enum(STOP_REASONS).optional(),
    stopNote: z.string().max(500).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "stopped" && !v.stopReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stopReason required when status is stopped",
        path: ["stopReason"],
      });
    }
  });

router.patch("/:id/treatment-status", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const owned = await loadOwnedPatient(doctorId, patientId);
  if (!owned) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = treatmentStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const isStop = parsed.data.status === "stopped";
  // Re-assert ownership *atomically* in the WHERE clause so a race
  // (e.g. patient reassigned between loadOwnedPatient and this UPDATE)
  // can never let a non-owning doctor mutate the row. The loadOwnedPatient
  // pre-check stays in for the clean 404 message; this is the actual
  // authorization gate.
  const updated = await db
    .update(patientsTable)
    .set({
      treatmentStatus: parsed.data.status,
      treatmentStatusSource: "doctor",
      // Zod superRefine guarantees stopReason is present when isStop=true,
      // so the assertion is safe; non-null assertion avoids the now-invalid
      // "unknown" fallback after the taxonomy refresh.
      stopReason: isStop ? parsed.data.stopReason! : null,
      stopNote: isStop ? parsed.data.stopNote ?? null : null,
      treatmentStatusUpdatedAt: new Date(),
      treatmentStatusUpdatedBy: doctorId,
    })
    .where(
      and(
        eq(patientsTable.userId, patientId),
        eq(patientsTable.doctorId, doctorId),
      ),
    )
    .returning({ userId: patientsTable.userId });
  if (updated.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Mirror the status change into the care-events stream so the
  // dual-layer funnel (Viva Analytics) can count "doctor took action
  // after escalation" without us building a parallel audit table.
  // Best-effort: if this insert fails the status update still stands.
  db
    .insert(careEventsTable)
    .values({
      patientUserId: patientId,
      actorUserId: doctorId,
      source: "doctor",
      type: "treatment_status_updated",
      metadata: {
        status: parsed.data.status,
        stopReason: isStop ? parsed.data.stopReason : null,
      },
    })
    .catch(() => {});
  const fresh = await loadOwnedPatient(doctorId, patientId);
  res.json(fresh);
});

router.get("/:id", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(patient);
});

router.get("/:id/checkins", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, patientId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(60);
  res.json(cks);
});

router.get("/:id/risk", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, patientId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(30);
  const risk = computeRisk(cks);
  const symptomFlags = computeSymptomFlags(cks);
  const lastCheckin = cks[0]?.date ?? null;
  // Send the workflow state and the suggested action alongside the raw
  // risk so the detail page can render a directive without having to
  // re-derive the rules client-side. symptomFlags is the new
  // clinically-meaningful payload that powers the "Symptom flags"
  // section on the patient detail page.
  res.json({
    ...risk,
    action: deriveAction(
      risk.score,
      risk.rules,
      lastCheckin,
      new Date(),
      symptomFlags,
    ),
    suggestedAction: deriveSuggestedAction(risk.rules, lastCheckin),
    symptomFlags,
  });
});

// Latest weight entry for the patient + how many days ago, plus a
// trend-vs-prior-entry indicator (up/down/flat). Subtle, MVP-only --
// kept as its own endpoint so the queue list query stays cheap and
// the dashboard's PatientDetailPage opts in to the small extra read.
router.get("/:id/weight", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const rows = await db
    .select()
    .from(patientWeightsTable)
    .where(eq(patientWeightsTable.patientUserId, patientId))
    .orderBy(desc(patientWeightsTable.recordedAt))
    .limit(2);
  if (rows.length === 0) {
    res.json({ latest: null, daysSinceLast: null, trend: "none" });
    return;
  }
  const latest = rows[0]!;
  const prior = rows[1] ?? null;
  const daysSinceLast = Math.floor(
    (Date.now() - new Date(latest.recordedAt).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  // Treat sub-1-lb wobble as flat so daily-edge fluctuations don't
  // spam an "up" / "down" label on the doctor's view.
  let trend: "up" | "down" | "flat" | "none" = "none";
  if (prior) {
    const delta = latest.weightLbs - prior.weightLbs;
    if (delta >= 1) trend = "up";
    else if (delta <= -1) trend = "down";
    else trend = "flat";
  }
  res.json({
    latest: {
      weightLbs: latest.weightLbs,
      recordedAt: latest.recordedAt,
    },
    prior: prior
      ? { weightLbs: prior.weightLbs, recordedAt: prior.recordedAt }
      : null,
    daysSinceLast,
    trend,
  });
});

router.get("/:id/notes", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Join the author so the UI can render "Dr. Kim • 2m ago" without a
  // separate users lookup per note.
  const notes = await db
    .select({
      id: doctorNotesTable.id,
      patientUserId: doctorNotesTable.patientUserId,
      doctorUserId: doctorNotesTable.doctorUserId,
      doctorName: usersTable.name,
      body: doctorNotesTable.body,
      resolved: doctorNotesTable.resolved,
      createdAt: doctorNotesTable.createdAt,
    })
    .from(doctorNotesTable)
    .innerJoin(usersTable, eq(usersTable.id, doctorNotesTable.doctorUserId))
    .where(eq(doctorNotesTable.patientUserId, patientId))
    .orderBy(desc(doctorNotesTable.createdAt));
  res.json(notes);
});

const noteSchema = z.object({
  body: z.string().min(1).max(5000),
  // Optional outcome flag captured right after saving the note --
  // becomes the seed of a worked-vs-didn't-work training signal.
  resolved: z.boolean().nullable().optional(),
});

router.post("/:id/notes", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [created] = await db
    .insert(doctorNotesTable)
    .values({
      patientUserId: patientId,
      doctorUserId: doctorId,
      body: parsed.data.body.trim(),
      resolved: parsed.data.resolved ?? null,
    })
    .returning();
  // Mirror as a care event so the dual-layer funnel sees doctor notes
  // as an intervention. Best-effort, same rationale as treatment-status.
  db
    .insert(careEventsTable)
    .values({
      patientUserId: patientId,
      actorUserId: doctorId,
      source: "doctor",
      type: "doctor_note",
      metadata: { noteId: created!.id, resolved: parsed.data.resolved ?? null },
    })
    .catch(() => {});
  // Look up the author's display name so the response matches the GET
  // shape -- the UI can drop the row into its list without a refetch.
  const [author] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, doctorId))
    .limit(1);
  res.status(201).json({ ...created!, doctorName: author?.name ?? "" });
});

router.delete("/:patientId/notes/:noteId", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.patientId);
  const noteId = Number(req.params.noteId);
  if (!Number.isFinite(patientId) || !Number.isFinite(noteId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Only the author can delete; another doctor on the same patient cannot
  // remove a peer's note.
  const result = await db
    .delete(doctorNotesTable)
    .where(
      and(
        eq(doctorNotesTable.id, noteId),
        eq(doctorNotesTable.patientUserId, patientId),
        eq(doctorNotesTable.doctorUserId, doctorId),
      ),
    )
    .returning();
  if (result.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Doctor read of a patient's recent Apple Health daily summaries. Owns
// the same loadOwnedPatient guard as the rest of /patients/:id/* so a
// doctor cannot peek at another doctor's roster.
// ---------------------------------------------------------------------
router.get("/:id/health/daily-summary", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const rows = await db
    .select()
    .from(patientHealthDailySummariesTable)
    .where(eq(patientHealthDailySummariesTable.patientUserId, patientId))
    .orderBy(desc(patientHealthDailySummariesTable.summaryDate))
    .limit(30);
  res.json(rows);
});

router.get("/:id/treatment-log", async (req, res: Response) => {
  const doctorId = (req as AuthedRequest).auth.userId;
  const patientId = Number(req.params.id);
  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patient = await loadOwnedPatient(doctorId, patientId);
  if (!patient) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const rows = await db
    .select()
    .from(patientTreatmentLogsTable)
    .where(eq(patientTreatmentLogsTable.patientUserId, patientId))
    .orderBy(desc(patientTreatmentLogsTable.createdAt))
    .limit(30);
  res.json(rows);
});

export default router;
