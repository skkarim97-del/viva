import { Router, type Response } from "express";
import { desc, eq, and, sql, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  patientCheckinsTable,
  patientWeightsTable,
  patientHealthDailySummariesTable,
  patientTreatmentLogsTable,
  patientProfilesTable,
  patientPlanItemsTable,
  patientIntegrationsTable,
  patientInterventionsTable,
  careEventsTable,
  analyticsEventsTable,
  PLAN_ITEM_CATEGORIES,
  PLAN_ITEM_SOURCES,
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
} from "@workspace/db";
import { requirePatient, type AuthedRequest } from "../middlewares/auth";
import { computeRisk } from "../lib/risk";
import { computeSymptomFlags } from "../lib/symptoms";
import { mediumApiLimiter } from "../middlewares/rateLimit";
import { phiAudit } from "../middlewares/phiAudit";

const router: Router = Router();
// Rate limit BEFORE the auth gate so an unauthenticated flood
// doesn't burn DB cycles on the bearer token lookup.
router.use(mediumApiLimiter);
router.use(requirePatient);
// HIPAA audit log for patient-self PHI. Mounted AFTER requirePatient
// so req.auth is set; getPatientId is the patient's own user id
// (every route in this router is naturally scoped to req.auth.userId
// -- /me has no other patient id surface).
router.use(
  phiAudit({
    getPatientId: (req) => (req as AuthedRequest).auth?.userId ?? null,
  }),
);

router.get("/checkins", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, userId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(60);
  res.json(cks);
});

// GET /me/checkins/today -- returns the patient's own check-in row for
// the current local YMD date if one exists, or 204 No Content if not.
// Used by the Today screen to hydrate the symptom sliders on cold start
// (e.g. after auto-login on the dev preview, where AsyncStorage is
// empty but the server already has today's seeded check-in row).
router.get("/checkins/today", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const today = `${y}-${m}-${day}`;
  const [row] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, today),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(204).end();
    return;
  }
  res.json(row);
});

// All symptom-management fields (appetite, digestion, hydration,
// bowelMovement, doseTakenToday) are OPTIONAL. Older mobile builds
// continue to submit just energy/nausea/mood and must keep working.
// guidanceShown is a small per-symptom ack object the patient app
// sends when the patient taps "Got it" on a symptom-tip card.
const checkinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.enum(["depleted", "tired", "good", "great"]),
  nausea: z.enum(["none", "mild", "moderate", "severe"]),
  mood: z.number().int().min(1).max(5),
  notes: z.string().max(2000).nullish(),
  appetite: z.enum(["strong", "normal", "low", "very_low"]).nullish(),
  digestion: z
    .enum(["fine", "bloated", "constipated", "diarrhea"])
    .nullish(),
  hydration: z
    .enum(["hydrated", "good", "low", "dehydrated"])
    .nullish(),
  bowelMovement: z.boolean().nullish(),
  doseTakenToday: z.boolean().nullish(),
  guidanceShown: z
    .object({
      nausea: z.boolean().optional(),
      constipation: z.boolean().optional(),
      low_appetite: z.boolean().optional(),
    })
    .nullish(),
  // Pilot analytics tag for the symptom-edit timeline. Locked to a
  // closed allowlist (NOT free text) so the analytics_events.payload
  // column can never receive PHI through this field even if a buggy
  // build or hostile client tries to smuggle text through it. Older
  // clients that omit source -> server defaults to "manual_save".
  // Unknown values are coerced server-side to "unknown" rather than
  // being persisted verbatim.
  //   today_checkin_autosave -- the Today screen's 1.2s debounced
  //     auto-save fired by the symptom-signature watcher
  //   manual_save            -- explicit Done button
  //   onboarding             -- first-run check-in capture
  //   demo_seed              -- dev/demo bootstrap inserts
  source: z
    .enum([
      "today_checkin_autosave",
      "manual_save",
      "onboarding",
      "demo_seed",
    ])
    .nullish(),
});

// Closed set of analytics payload keys the symptom-edit event is
// allowed to write. Anything outside this list is dropped before the
// insert -- defense in depth so a future contributor can't widen the
// payload shape and accidentally let PHI through.
const ALLOWED_CHECKIN_EVENT_KEYS = new Set([
  "source",
  "previous",
  "current",
  "changedFields",
  "isFirstSaveOfDay",
  "triggeredInterventionRefresh",
]);

router.post("/checkins", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const v = parsed.data;
  // Build the optional-field set once so the INSERT and UPDATE branches
  // stay in sync. Coerce undefined -> null so a patient who clears a
  // field on edit actually wipes the previous value rather than
  // preserving it (which would be a silent data lie on the dashboard).
  const symptomFields = {
    appetite: v.appetite ?? null,
    digestion: v.digestion ?? null,
    hydration: v.hydration ?? null,
    bowelMovement: v.bowelMovement ?? null,
    doseTakenToday: v.doseTakenToday ?? null,
    // For guidanceShown, undefined means "client didn't say" so we
    // preserve the existing value on update. Sending an explicit empty
    // object is treated as "reset acks for today".
    ...(v.guidanceShown !== undefined
      ? { guidanceShown: v.guidanceShown ?? {} }
      : {}),
  };
  // Snapshot the prior row (if any) BEFORE the upsert so the
  // analytics emitter below can diff previous vs current. This is
  // the only way to capture a worse-to-better symptom transition
  // for the pilot timeline -- patient_checkins itself is a single
  // upserted row per day, so once the new values are written the
  // prior state is gone.
  const [previousRow] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, v.date),
      ),
    )
    .limit(1);

  // Upsert by (patient_user_id, date) so the patient can edit today's
  // entry without creating duplicates.
  const [row] = await db
    .insert(patientCheckinsTable)
    .values({
      patientUserId: userId,
      date: v.date,
      energy: v.energy,
      nausea: v.nausea,
      mood: v.mood,
      notes: v.notes ?? null,
      ...symptomFields,
    })
    .onConflictDoUpdate({
      target: [
        patientCheckinsTable.patientUserId,
        patientCheckinsTable.date,
      ],
      set: {
        energy: v.energy,
        nausea: v.nausea,
        mood: v.mood,
        notes: v.notes ?? null,
        ...symptomFields,
      },
    })
    .returning();

  // -- Pilot analytics: append-only symptom-input timeline ----------
  //
  // patient_checkins is upserted per day, so it tracks "current
  // state". For the pilot we ALSO need the full history of
  // meaningful symptom edits within the day (worse->better, nausea
  // -> digestion, etc.) so dashboards can answer questions like
  // "how often do symptoms improve after a micro-intervention" and
  // "time from worsening to support shown".
  //
  // We diff only the symptom inputs the rules engine and the
  // recommendation card actually consume: energy, nausea, appetite,
  // digestion, hydration, bowelMovement, doseTakenToday. mood is
  // intentionally excluded -- the Today autosave hardcodes mood=3,
  // which would otherwise show up as a phantom "changedFields"
  // every save. notes is excluded for PHI hygiene -- analytics rows
  // must never carry free-text patient input.
  //
  // Anti-spam: we only append an event when at least one tracked
  // field actually changed, OR when this is the first check-in of
  // the day (previousRow == null). Identical re-saves are dropped.
  //
  // Best-effort insert wrapped in try/catch + req.log.warn -- per
  // the table's contract analytics MUST NEVER break a product flow.
  type SymptomShape = {
    energy: string | null;
    nausea: string | null;
    appetite: string | null;
    digestion: string | null;
    hydration: string | null;
    bowelMovement: boolean | null;
    doseTakenToday: boolean | null;
  };
  const pickSymptoms = (r: typeof row | undefined): SymptomShape | null =>
    r
      ? {
          energy: r.energy ?? null,
          nausea: r.nausea ?? null,
          appetite: r.appetite ?? null,
          digestion: r.digestion ?? null,
          hydration: r.hydration ?? null,
          bowelMovement: r.bowelMovement ?? null,
          doseTakenToday: r.doseTakenToday ?? null,
        }
      : null;
  const previous = pickSymptoms(previousRow);
  const current = pickSymptoms(row);
  if (current) {
    const changedFields: string[] = previous
      ? (Object.keys(current) as (keyof SymptomShape)[]).filter(
          (k) => previous[k] !== current[k],
        )
      : (Object.keys(current) as (keyof SymptomShape)[]);
    const isFirstSave = !previous;
    if (isFirstSave || changedFields.length > 0) {
      // The Zod enum already rejects unknown sources at the boundary;
      // this fallback covers the legitimate "older client omits the
      // field" case, never an arbitrary string.
      const source = v.source ?? "manual_save";
      // Only autosave-driven edits trigger a /generate refresh on the
      // client. Manual/onboarding/demo paths don't, so we record the
      // signal honestly rather than always claiming true.
      const triggeredInterventionRefresh =
        source === "today_checkin_autosave";
      // Build the payload, then sanitize through the closed allowlist
      // so we can never accidentally persist a key that wasn't
      // explicitly approved (defense in depth -- the input has
      // already been validated by checkinSchema).
      const rawPayload: Record<string, unknown> = {
        source,
        previous,
        current,
        changedFields,
        isFirstSaveOfDay: isFirstSave,
        triggeredInterventionRefresh,
      };
      const safePayload: Record<string, unknown> = {};
      for (const k of Object.keys(rawPayload)) {
        if (ALLOWED_CHECKIN_EVENT_KEYS.has(k)) safePayload[k] = rawPayload[k];
      }
      try {
        await db.insert(analyticsEventsTable).values({
          userType: "patient",
          userId,
          eventName: "patient_checkin_updated",
          eventDate: v.date,
          // sessionId/platform/timezone are populated by the regular
          // /analytics/events client pipeline; this server-side emit
          // doesn't have them and that's OK -- userId + eventDate +
          // createdAt are sufficient for the timeline view.
          payload: safePayload,
        });
      } catch (err) {
        req.log.warn(
          { err, userId, date: v.date },
          "patient_checkin_updated_event_insert_failed",
        );
      }
    }
  }

  res.status(201).json(row);
});

// PATCH /me/checkins/guidance -- mark the patient as having seen the
// in-app self-management guidance for one symptom on today's check-in
// row. Kept as its own endpoint so the tip card can fire-and-forget
// without rebuilding the full check-in payload.
const guidanceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptom: z.enum(["nausea", "constipation", "low_appetite"]),
});
router.patch("/checkins/guidance", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = guidanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { date, symptom } = parsed.data;
  const [existing] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, date),
      ),
    )
    .limit(1);
  if (!existing) {
    // We deliberately do NOT auto-create a check-in row here. The ack
    // is meaningful only against an actual day of data; otherwise we'd
    // tell the doctor "patient saw guidance" with no symptoms attached.
    res.status(404).json({ error: "no_checkin_today" });
    return;
  }
  const merged = { ...(existing.guidanceShown ?? {}), [symptom]: true };
  await db
    .update(patientCheckinsTable)
    .set({ guidanceShown: merged })
    .where(eq(patientCheckinsTable.id, existing.id));
  res.json({ ok: true, guidanceShown: merged });
});

// PATCH /me/checkins/trend -- patient answers the day-after follow-up
// "is this getting better, the same, or worse?" for one symptom.
// Returns 404 (silently ignorable) when there's no check-in row for
// the date, same as the guidance ack endpoint.
const trendSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptom: z.enum(["nausea", "constipation", "low_appetite"]),
  response: z.enum(["better", "same", "worse"]),
});
router.patch("/checkins/trend", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = trendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { date, symptom, response } = parsed.data;
  const [existing] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, date),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "no_checkin_today" });
    return;
  }
  const merged = { ...(existing.trendResponse ?? {}), [symptom]: response };
  await db
    .update(patientCheckinsTable)
    .set({ trendResponse: merged })
    .where(eq(patientCheckinsTable.id, existing.id));
  res.json({ ok: true, trendResponse: merged });
});

// PATCH /me/checkins/escalate -- patient explicitly asked the
// clinician to be aware of this symptom. Sticky: the doctor sees
// "Patient requested clinician" until the symptom resolves.
const escalateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptom: z.enum(["nausea", "constipation", "low_appetite"]),
});
router.patch("/checkins/escalate", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { date, symptom } = parsed.data;
  const [existing] = await db
    .select()
    .from(patientCheckinsTable)
    .where(
      and(
        eq(patientCheckinsTable.patientUserId, userId),
        eq(patientCheckinsTable.date, date),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "no_checkin_today" });
    return;
  }
  // Sticky-flag idempotency: the patient_checkins.clinicianRequested
  // jsonb already records "patient asked for clinician on this date
  // for this symptom" as a sticky boolean. We use that as the
  // dedupe key for the care_event so repeated taps (and the offline
  // replay queue) cannot multiply the doctor's worklist row.
  const wasAlreadyRequested =
    (existing.clinicianRequested as Record<string, boolean> | null)?.[symptom] ===
    true;
  const merged = { ...(existing.clinicianRequested ?? {}), [symptom]: true };
  await db
    .update(patientCheckinsTable)
    .set({ clinicianRequested: merged })
    .where(eq(patientCheckinsTable.id, existing.id));

  // -- care_event emission with structured (non-free-text) context -
  //
  // The other escalation path (POST /me/interventions/:id/escalate)
  // already inserts a care_event row. The sticky-flag path
  // historically did not, so the funnel undercounted patient-led
  // escalations. We close that gap here.
  //
  // Storage destination: care_events lives in the SAME AWS HIPAA-
  // protected RDS as patient_checkins, so clinical context (severity
  // enums, dose-taken, AH metric snapshot) is appropriate here --
  // it's the exact data the on-call clinician needs to triage.
  // What this row deliberately does NOT carry: free-text patient
  // notes, weights, contact info, DOB, or any field that wasn't
  // already captured under the same patient record. Nothing here is
  // ever written to analytics_events or sent to OpenAI.
  if (!wasAlreadyRequested) {
    try {
      // Latest live intervention for this patient (any status, last
      // 7 days). symptomType / triggerType / status are closed
      // taxonomies; recommendation copy is intentionally NOT
      // included.
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [latestIntervention] = await db
        .select({
          id: patientInterventionsTable.id,
          symptomType: patientInterventionsTable.symptomType,
          triggerType: patientInterventionsTable.triggerType,
          status: patientInterventionsTable.status,
          createdAt: patientInterventionsTable.createdAt,
        })
        .from(patientInterventionsTable)
        .where(
          and(
            eq(patientInterventionsTable.patientUserId, userId),
            gte(patientInterventionsTable.createdAt, sevenDaysAgo),
          ),
        )
        .orderBy(desc(patientInterventionsTable.createdAt))
        .limit(1);

      // Latest patient feedback on any intervention. Bounded enum
      // ("better"|"same"|"worse") -- no free text.
      const [latestFeedbackEvt] = await db
        .select({
          metadata: careEventsTable.metadata,
          occurredAt: careEventsTable.occurredAt,
        })
        .from(careEventsTable)
        .where(
          and(
            eq(careEventsTable.patientUserId, userId),
            eq(careEventsTable.type, "intervention_feedback"),
          ),
        )
        .orderBy(desc(careEventsTable.occurredAt))
        .limit(1);
      const fbMeta =
        (latestFeedbackEvt?.metadata as Record<string, unknown> | null) ?? null;
      const latestFeedback = fbMeta
        ? {
            response: typeof fbMeta.response === "string" ? fbMeta.response : null,
            intervention:
              typeof fbMeta.intervention === "string" ? fbMeta.intervention : null,
            at: latestFeedbackEvt!.occurredAt,
          }
        : null;

      // Most recent patient_health_daily_summary (last 14 days only;
      // older signals aren't useful clinical context). Numbers only.
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]!;
      const [latestHealth] = await db
        .select()
        .from(patientHealthDailySummariesTable)
        .where(
          and(
            eq(patientHealthDailySummariesTable.patientUserId, userId),
            gte(patientHealthDailySummariesTable.summaryDate, fourteenDaysAgo),
          ),
        )
        .orderBy(desc(patientHealthDailySummariesTable.summaryDate))
        .limit(1);

      // Apple Health connection state (intent recorded by patient,
      // separate from "did data arrive").
      const [ahIntegration] = await db
        .select({
          status: patientIntegrationsTable.status,
          connectedAt: patientIntegrationsTable.connectedAt,
          lastSyncAt: patientIntegrationsTable.lastSyncAt,
        })
        .from(patientIntegrationsTable)
        .where(
          and(
            eq(patientIntegrationsTable.patientUserId, userId),
            eq(patientIntegrationsTable.provider, "apple_health"),
          ),
        )
        .limit(1);

      const careEventMetadata = {
        symptom, // "nausea" | "constipation" | "low_appetite"
        date,
        channel: "checkin_sticky_flag",
        reason: "patient_requested_clinician_review",
        // Severity from today's check-in. All bounded enums.
        severity: {
          energy: existing.energy ?? null,
          nausea: existing.nausea ?? null,
          appetite: existing.appetite ?? null,
          digestion: existing.digestion ?? null,
          hydration: existing.hydration ?? null,
          bowelMovement: existing.bowelMovement ?? null,
        },
        // Same-day dose context -- did the patient take their GLP-1
        // today? Booleans only.
        dose: {
          takenToday: existing.doseTakenToday ?? null,
        },
        // Latest live intervention (PHI-free identifiers only).
        latestIntervention: latestIntervention
          ? {
              id: latestIntervention.id,
              symptomType: latestIntervention.symptomType,
              triggerType: latestIntervention.triggerType,
              status: latestIntervention.status,
              createdAt: latestIntervention.createdAt,
            }
          : null,
        latestFeedback,
        // Apple Health context. Distinguish "no data because
        // disconnected" from "no data because day was zero".
        appleHealth: {
          status: ahIntegration?.status ?? "unknown",
          lastSyncAt: ahIntegration?.lastSyncAt ?? null,
          latestSummary: latestHealth
            ? {
                date: latestHealth.summaryDate,
                steps: latestHealth.steps,
                sleepMinutes: latestHealth.sleepMinutes,
                hrv: latestHealth.hrv,
                restingHeartRate: latestHealth.restingHeartRate,
              }
            : null,
        },
        // Other symptoms the patient has flagged as clinician-
        // requested in the same check-in row. Useful so the doctor
        // sees "patient flagged BOTH nausea AND constipation today".
        coFlaggedSymptoms: Object.entries(
          (merged as Record<string, boolean>) ?? {},
        )
          .filter(([k, v]) => v === true && k !== symptom)
          .map(([k]) => k),
      };

      await db.insert(careEventsTable).values({
        patientUserId: userId,
        actorUserId: userId,
        source: "patient",
        type: "escalation_requested",
        triggerEventId: latestIntervention?.id ?? null,
        metadata: careEventMetadata,
      });
    } catch (err) {
      // Care-event emission MUST NOT block the patient's UI flow.
      // The sticky flag itself is already persisted above; a missing
      // analytics row is a degraded-but-acceptable outcome.
      req.log.warn(
        { err, userId, date, symptom },
        "escalate_care_event_insert_failed",
      );
    }
  }

  res.json({
    ok: true,
    clinicianRequested: merged,
    careEventEmitted: !wasAlreadyRequested,
  });
});

// =====================================================================
// Plan items (weekly plan + completion). Server is source of truth;
// the mobile client uses AsyncStorage as a cache and replays
// mutations best-effort.
// =====================================================================

const planItemUpsertSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayIndex: z.number().int().min(0).max(6),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(PLAN_ITEM_CATEGORIES),
  recommended: z.string().max(400).nullish(),
  chosen: z.string().max(400).nullish(),
  source: z.enum(PLAN_ITEM_SOURCES).nullish(),
  completed: z.boolean().nullish(),
  title: z.string().max(200).nullish(),
  subtitle: z.string().max(400).nullish(),
  // metadata is closed-key on the server side (allowlist below) so
  // a future contributor can't widen it into a PHI-leaking grab bag.
  metadata: z.record(z.unknown()).nullish(),
});

// Closed allowlist for plan-item metadata keys. Anything outside
// this set is dropped before insert.
const ALLOWED_PLAN_ITEM_METADATA_KEYS = new Set([
  "optionId",
  "focusArea",
  "templateId",
  "generator",
  "rationale",
]);

// Closed allowlist for analytics_events.payload on plan_item_*
// events. Categories / weekStart / dayIndex / source / optionId are
// all enums or stable identifiers -- never free patient text.
const ALLOWED_PLAN_EVENT_KEYS = new Set([
  "category",
  "weekStart",
  "dayIndex",
  "date",
  "source",
  "optionId",
  "previousChosenSameAsRecommended",
  "newChosenSameAsRecommended",
  "completed",
  "previousCompleted",
  "daysCount",
  "completedCount",
  "overrideCount",
]);

function sanitizePlanMetadata(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (ALLOWED_PLAN_ITEM_METADATA_KEYS.has(k)) out[k] = raw[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizePlanEventPayload(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (ALLOWED_PLAN_EVENT_KEYS.has(k)) out[k] = raw[k];
  }
  return out;
}

async function emitPlanAnalytics(
  userId: number,
  eventName: string,
  date: string,
  payload: Record<string, unknown>,
  log: AuthedRequest["log"],
): Promise<void> {
  try {
    await db.insert(analyticsEventsTable).values({
      userType: "patient",
      userId,
      eventName,
      eventDate: date,
      payload: sanitizePlanEventPayload(payload),
    });
  } catch (err) {
    log.warn({ err, userId, eventName }, "plan_item_analytics_insert_failed");
  }
}

router.get("/plan-items", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : null;
  if (weekStart && !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: "invalid_week_start" });
    return;
  }
  // weekStart query → only that week. Otherwise return the last
  // 4 weeks (28 days) so the mobile cache hydrates the carousel
  // without a follow-up call.
  const fromDate = weekStart
    ? weekStart
    : new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]!;
  const rows = await db
    .select()
    .from(patientPlanItemsTable)
    .where(
      and(
        eq(patientPlanItemsTable.patientUserId, userId),
        weekStart
          ? eq(patientPlanItemsTable.weekStart, weekStart)
          : gte(patientPlanItemsTable.date, fromDate),
      ),
    )
    .orderBy(
      patientPlanItemsTable.weekStart,
      patientPlanItemsTable.dayIndex,
      patientPlanItemsTable.category,
    );
  // Optional analytics: when a weekStart is supplied this is the
  // mobile Week tab hydrating, so emit a week_plan_viewed event.
  if (weekStart) {
    const completedCount = rows.filter((r) => r.completedAt != null).length;
    const overrideCount = rows.filter((r) => r.source === "patient_override").length;
    await emitPlanAnalytics(
      userId,
      "week_plan_viewed",
      weekStart,
      {
        weekStart,
        daysCount: new Set(rows.map((r) => r.dayIndex)).size,
        completedCount,
        overrideCount,
      },
      (req as AuthedRequest).log,
    );
  }
  res.json(rows);
});

router.post("/plan-items", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = planItemUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  // Explicit type assertion: drizzle-zod / zod version drift in this
  // workspace currently degrades the inferred type of parsed.data to
  // `unknown` whenever the schema includes a z.record(z.unknown())
  // field. The runtime guarantee from Zod is unchanged -- this cast
  // only restores the type information for the rest of the handler.
  const v = parsed.data as {
    weekStart: string;
    dayIndex: number;
    date: string;
    category: (typeof PLAN_ITEM_CATEGORIES)[number];
    recommended?: string | null;
    chosen?: string | null;
    source?: (typeof PLAN_ITEM_SOURCES)[number] | null;
    completed?: boolean | null;
    title?: string | null;
    subtitle?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  const recommended = v.recommended ?? null;
  const chosen = v.chosen ?? recommended;
  const declaredSource = v.source ?? "auto";
  // If chosen differs from recommended, the row is by definition a
  // patient override -- regardless of what the client claimed.
  const source: typeof declaredSource =
    recommended != null && chosen != null && chosen !== recommended
      ? "patient_override"
      : declaredSource;
  const completedAt = v.completed === true ? new Date() : null;
  const metadata = sanitizePlanMetadata(v.metadata);

  // Snapshot prior row so we can diff for analytics.
  const [previousRow] = await db
    .select()
    .from(patientPlanItemsTable)
    .where(
      and(
        eq(patientPlanItemsTable.patientUserId, userId),
        eq(patientPlanItemsTable.weekStart, v.weekStart),
        eq(patientPlanItemsTable.dayIndex, v.dayIndex),
        eq(patientPlanItemsTable.category, v.category),
      ),
    )
    .limit(1);

  const [row] = await db
    .insert(patientPlanItemsTable)
    .values({
      patientUserId: userId,
      weekStart: v.weekStart,
      dayIndex: v.dayIndex,
      date: v.date,
      category: v.category,
      recommended,
      chosen,
      source,
      completedAt,
      title: v.title ?? null,
      subtitle: v.subtitle ?? null,
      metadata,
    })
    .onConflictDoUpdate({
      target: [
        patientPlanItemsTable.patientUserId,
        patientPlanItemsTable.weekStart,
        patientPlanItemsTable.dayIndex,
        patientPlanItemsTable.category,
      ],
      set: {
        // Coalesce recommended/title/subtitle so a partial mutation
        // (e.g. toggle complete) doesn't blank the existing copy.
        recommended: sql`coalesce(excluded.recommended, ${patientPlanItemsTable.recommended})`,
        chosen: sql`coalesce(excluded.chosen, ${patientPlanItemsTable.chosen})`,
        source: source,
        completedAt:
          v.completed === undefined
            ? sql`${patientPlanItemsTable.completedAt}` // unchanged
            : completedAt,
        title: sql`coalesce(excluded.title, ${patientPlanItemsTable.title})`,
        subtitle: sql`coalesce(excluded.subtitle, ${patientPlanItemsTable.subtitle})`,
        metadata: metadata
          ? metadata
          : sql`${patientPlanItemsTable.metadata}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Analytics emissions (best-effort).
  const optionId =
    typeof metadata?.optionId === "string" ? metadata.optionId : null;
  const eventLog = (req as AuthedRequest).log;
  if (!previousRow) {
    await emitPlanAnalytics(
      userId,
      source === "auto" ? "plan_item_suggested" : "plan_item_overridden",
      v.date,
      {
        category: v.category,
        weekStart: v.weekStart,
        dayIndex: v.dayIndex,
        source,
        optionId,
      },
      eventLog,
    );
  } else {
    const prevChosen = previousRow.chosen ?? previousRow.recommended;
    if (chosen !== prevChosen) {
      await emitPlanAnalytics(
        userId,
        "plan_item_overridden",
        v.date,
        {
          category: v.category,
          weekStart: v.weekStart,
          dayIndex: v.dayIndex,
          source,
          optionId,
          previousChosenSameAsRecommended:
            (previousRow.chosen ?? null) === (previousRow.recommended ?? null),
          newChosenSameAsRecommended: chosen === recommended,
        },
        eventLog,
      );
    }
  }
  if (
    v.completed !== undefined &&
    (previousRow?.completedAt != null) !== (row!.completedAt != null)
  ) {
    await emitPlanAnalytics(
      userId,
      row!.completedAt != null ? "plan_item_completed" : "plan_item_uncompleted",
      v.date,
      {
        category: v.category,
        weekStart: v.weekStart,
        dayIndex: v.dayIndex,
        source: row!.source,
        optionId,
        completed: row!.completedAt != null,
      },
      eventLog,
    );
  }

  res.status(201).json(row);
});

router.patch("/plan-items/:id", async (req, res: Response) => {
  const userId = (req as unknown as AuthedRequest).auth.userId;
  const id = Number.parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const patchSchema = z.object({
    chosen: z.string().max(400).nullish(),
    completed: z.boolean().nullish(),
  });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [existing] = await db
    .select()
    .from(patientPlanItemsTable)
    .where(
      and(
        eq(patientPlanItemsTable.id, id),
        // Ownership check -- doctors must NEVER reach this row.
        eq(patientPlanItemsTable.patientUserId, userId),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const update: Partial<typeof patientPlanItemsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  let didOverride = false;
  if (parsed.data.chosen !== undefined) {
    update.chosen = parsed.data.chosen ?? null;
    if ((parsed.data.chosen ?? null) !== (existing.recommended ?? null)) {
      update.source = "patient_override";
      didOverride = true;
    }
  }
  let completionTransition: "completed" | "uncompleted" | null = null;
  if (parsed.data.completed !== undefined) {
    const wasCompleted = existing.completedAt != null;
    if (parsed.data.completed && !wasCompleted) {
      update.completedAt = new Date();
      completionTransition = "completed";
    } else if (!parsed.data.completed && wasCompleted) {
      update.completedAt = null;
      completionTransition = "uncompleted";
    }
  }
  const [row] = await db
    .update(patientPlanItemsTable)
    .set(update)
    .where(eq(patientPlanItemsTable.id, id))
    .returning();

  const optionId =
    typeof (existing.metadata as Record<string, unknown> | null)?.optionId === "string"
      ? ((existing.metadata as Record<string, unknown>).optionId as string)
      : null;
  const eventLog = (req as unknown as AuthedRequest).log;
  if (didOverride) {
    await emitPlanAnalytics(
      userId,
      "plan_item_overridden",
      existing.date,
      {
        category: existing.category,
        weekStart: existing.weekStart,
        dayIndex: existing.dayIndex,
        source: "patient_override",
        optionId,
      },
      eventLog,
    );
  }
  if (completionTransition) {
    await emitPlanAnalytics(
      userId,
      completionTransition === "completed"
        ? "plan_item_completed"
        : "plan_item_uncompleted",
      existing.date,
      {
        category: existing.category,
        weekStart: existing.weekStart,
        dayIndex: existing.dayIndex,
        source: row!.source,
        optionId,
        completed: completionTransition === "completed",
      },
      eventLog,
    );
  }

  res.json(row);
});

// =====================================================================
// Patient integrations (Apple Health initially, extensible). Records
// the patient's CONNECTION INTENT, distinct from "did data arrive"
// which is answered by patient_health_daily_summaries presence.
// =====================================================================

const integrationUpsertSchema = z.object({
  status: z.enum(INTEGRATION_STATUSES),
  permissions: z.array(z.string().max(60)).max(40).nullish(),
  // Closed-key allowlist applied below; metadata is for non-PHI
  // device/OS context.
  metadata: z.record(z.unknown()).nullish(),
});

const ALLOWED_INTEGRATION_METADATA_KEYS = new Set([
  "platform",
  "osVersion",
  "deviceModel",
  "appVersion",
  "disconnectReason",
  "errorCode",
]);

function sanitizeIntegrationMetadata(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (ALLOWED_INTEGRATION_METADATA_KEYS.has(k)) out[k] = raw[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

router.get("/integrations", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientIntegrationsTable)
    .where(eq(patientIntegrationsTable.patientUserId, userId));
  res.json(rows);
});

router.put("/integrations/:provider", async (req, res: Response) => {
  const userId = (req as unknown as AuthedRequest).auth.userId;
  const provider = req.params.provider;
  if (
    !provider ||
    !(INTEGRATION_PROVIDERS as readonly string[]).includes(provider)
  ) {
    res.status(400).json({ error: "invalid_provider" });
    return;
  }
  const parsed = integrationUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  // Same Zod-inference cast workaround as /plan-items.
  const v = parsed.data as {
    status: (typeof INTEGRATION_STATUSES)[number];
    permissions?: string[] | null;
    metadata?: Record<string, unknown> | null;
  };
  const now = new Date();

  const [existing] = await db
    .select()
    .from(patientIntegrationsTable)
    .where(
      and(
        eq(patientIntegrationsTable.patientUserId, userId),
        eq(patientIntegrationsTable.provider, provider as "apple_health"),
      ),
    )
    .limit(1);

  // First-time-connected timestamp is sticky across reconnects so
  // analytics can answer "ever connected?" without scanning history.
  const connectedAt =
    v.status === "connected"
      ? existing?.connectedAt ?? now
      : existing?.connectedAt ?? null;
  // Disconnect timestamp updates whenever the new status is a
  // non-connected terminal state (disconnected/declined). We do not
  // overwrite for 'unknown' (which is the initial install state).
  const disconnectedAt =
    v.status === "disconnected" || v.status === "declined"
      ? now
      : existing?.disconnectedAt ?? null;

  const metadata = sanitizeIntegrationMetadata(v.metadata);
  const permissions = v.permissions ?? null;

  const [row] = await db
    .insert(patientIntegrationsTable)
    .values({
      patientUserId: userId,
      provider: provider as "apple_health",
      status: v.status,
      connectedAt,
      disconnectedAt,
      lastSyncAt: existing?.lastSyncAt ?? null,
      permissions,
      metadata,
    })
    .onConflictDoUpdate({
      target: [
        patientIntegrationsTable.patientUserId,
        patientIntegrationsTable.provider,
      ],
      set: {
        status: v.status,
        connectedAt,
        disconnectedAt,
        permissions: permissions ?? sql`${patientIntegrationsTable.permissions}`,
        metadata: metadata ?? sql`${patientIntegrationsTable.metadata}`,
        updatedAt: now,
      },
    })
    .returning();

  // Analytics: emit a transition event when status actually changed.
  if (!existing || existing.status !== v.status) {
    try {
      await db.insert(analyticsEventsTable).values({
        userType: "patient",
        userId,
        eventName: "integration_status_changed",
        eventDate: now.toISOString().split("T")[0]!,
        payload: {
          provider,
          status: v.status,
          previousStatus: existing?.status ?? null,
        },
      });
    } catch (err) {
      (req as unknown as AuthedRequest).log.warn(
        { err, userId, provider },
        "integration_status_event_insert_failed",
      );
    }
  }

  res.status(201).json(row);
});

// -- Weekly weight log -------------------------------------------------
// Lives in its own table (patient_weights) and on its own cadence
// (every ~7 days), deliberately NOT inside the daily check-in payload.
// The mobile app calls /me/weights/latest on session start to decide
// whether to surface the weekly prompt; weeklyPromptDue flips true
// when the patient has no entry, or the latest entry is 7+ days old.

router.get("/weights/latest", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientWeightsTable)
    .where(eq(patientWeightsTable.patientUserId, userId))
    .orderBy(desc(patientWeightsTable.recordedAt))
    .limit(1);
  const latest = rows[0] ?? null;
  let daysSinceLast: number | null = null;
  if (latest) {
    const diffMs = Date.now() - new Date(latest.recordedAt).getTime();
    daysSinceLast = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  // Prompt the patient when they've never logged, or the last entry
  // is at least 7 days old. The "or" is important: a patient who has
  // never logged a weight should still see the prompt today.
  const weeklyPromptDue =
    daysSinceLast === null || daysSinceLast >= 7;
  res.json({
    latest: latest
      ? {
          weightLbs: latest.weightLbs,
          recordedAt: latest.recordedAt,
        }
      : null,
    daysSinceLast,
    weeklyPromptDue,
  });
});

const weightInputSchema = z.object({
  // Reasonable clinical bounds for adults in lbs. We do NOT validate
  // by patient (no kg path in MVP), so cap loosely to catch typos.
  weightLbs: z.number().positive().min(40).max(900),
});

router.post("/weights", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = weightInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const [row] = await db
    .insert(patientWeightsTable)
    .values({
      patientUserId: userId,
      weightLbs: parsed.data.weightLbs,
    })
    .returning();
  res.status(201).json({
    id: row!.id,
    weightLbs: row!.weightLbs,
    recordedAt: row!.recordedAt,
  });
});

router.get("/risk", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(eq(patientCheckinsTable.patientUserId, userId))
    .orderBy(desc(patientCheckinsTable.date))
    .limit(30);
  // Patient-facing /me/risk now includes symptomFlags so the mobile
  // app could render server-validated flags too -- today the app
  // computes tips client-side, but exposing the server view keeps the
  // contract symmetric with /patients/:id/risk.
  res.json({
    ...computeRisk(cks),
    symptomFlags: computeSymptomFlags(cks),
  });
});

// ---------------------------------------------------------------------
// Health daily summary. Mobile-side daily aggregation of HealthKit
// signals. Upsert by (patient, summaryDate). Every metric is nullable.
// We deliberately accept partial payloads so the mobile sync queue
// can post whatever it has without first reading the existing row.
// ---------------------------------------------------------------------
const healthSummarySchema = z.object({
  summaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().nonnegative().nullish(),
  sleepMinutes: z.number().int().nonnegative().nullish(),
  restingHeartRate: z.number().int().positive().max(300).nullish(),
  hrv: z.number().nonnegative().max(500).nullish(),
  activeCalories: z.number().int().nonnegative().nullish(),
  activeDay: z.boolean().nullish(),
  weightLbs: z.number().positive().min(40).max(900).nullish(),
  source: z.string().max(40).nullish(),
});

router.post("/health/daily-summary", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = healthSummarySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(patientHealthDailySummariesTable)
    .values({
      patientUserId: userId,
      summaryDate: d.summaryDate,
      steps: d.steps ?? null,
      sleepMinutes: d.sleepMinutes ?? null,
      restingHeartRate: d.restingHeartRate ?? null,
      hrv: d.hrv ?? null,
      activeCalories: d.activeCalories ?? null,
      activeDay: d.activeDay ?? null,
      weightLbs: d.weightLbs ?? null,
      source: d.source ?? null,
    })
    // Upsert by (patient, date). Nullable fields are coalesced so a
    // partial payload (e.g. weight-only sync) never zero-clobbers an
    // earlier full-day write.
    .onConflictDoUpdate({
      target: [
        patientHealthDailySummariesTable.patientUserId,
        patientHealthDailySummariesTable.summaryDate,
      ],
      set: {
        steps: sql`coalesce(excluded.steps, ${patientHealthDailySummariesTable.steps})`,
        sleepMinutes: sql`coalesce(excluded.sleep_minutes, ${patientHealthDailySummariesTable.sleepMinutes})`,
        restingHeartRate: sql`coalesce(excluded.resting_heart_rate, ${patientHealthDailySummariesTable.restingHeartRate})`,
        hrv: sql`coalesce(excluded.hrv, ${patientHealthDailySummariesTable.hrv})`,
        activeCalories: sql`coalesce(excluded.active_calories, ${patientHealthDailySummariesTable.activeCalories})`,
        activeDay: sql`coalesce(excluded.active_day, ${patientHealthDailySummariesTable.activeDay})`,
        weightLbs: sql`coalesce(excluded.weight_lbs, ${patientHealthDailySummariesTable.weightLbs})`,
        source: sql`coalesce(excluded.source, ${patientHealthDailySummariesTable.source})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Bump patient_integrations.lastSyncAt so the dashboard "data
  // freshness" indicator and analytics "AH connected & active in
  // last 7d" KPI reflect that the device is actually streaming. We
  // only do this for apple_health source; other sources (manual,
  // import) shouldn't claim integration freshness. Best-effort:
  // never block the data write on the freshness bump.
  if (d.source === "apple_health") {
    try {
      await db
        .update(patientIntegrationsTable)
        .set({ lastSyncAt: new Date() })
        .where(
          and(
            eq(patientIntegrationsTable.patientUserId, userId),
            eq(patientIntegrationsTable.provider, "apple_health"),
          ),
        );
    } catch (err) {
      req.log.warn(
        { err, userId },
        "apple_health_integration_lastSyncAt_update_failed",
      );
    }
  }

  res.status(201).json(row);
});

router.get("/health/daily-summary/recent", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientHealthDailySummariesTable)
    .where(eq(patientHealthDailySummariesTable.patientUserId, userId))
    .orderBy(desc(patientHealthDailySummariesTable.summaryDate))
    .limit(30);
  res.json(rows);
});

// ---------------------------------------------------------------------
// Treatment log. Append-only patient-confirmed med history. Distinct
// from patients.glp1Drug / patients.dose which the doctor sets and
// which remain the source of truth for the dashboard.
// ---------------------------------------------------------------------
const treatmentLogSchema = z.object({
  medicationName: z.string().min(1).max(200),
  dose: z.number().positive().max(1000).nullish(),
  doseUnit: z.string().max(20).nullish(),
  frequency: z.string().max(40).nullish(),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

router.post("/treatment-log", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = treatmentLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(patientTreatmentLogsTable)
    .values({
      patientUserId: userId,
      medicationName: d.medicationName,
      dose: d.dose ?? null,
      doseUnit: d.doseUnit ?? null,
      frequency: d.frequency ?? null,
      startedOn: d.startedOn ?? null,
      source: "patient",
    })
    .returning();
  res.status(201).json(row);
});

router.get("/treatment-log/recent", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const rows = await db
    .select()
    .from(patientTreatmentLogsTable)
    .where(eq(patientTreatmentLogsTable.patientUserId, userId))
    .orderBy(desc(patientTreatmentLogsTable.createdAt))
    .limit(30);
  res.json(rows);
});

// ---------------------------------------------------------------------
// Patient onboarding profile. One row per patient, blind-upsertable.
// We persist ONLY the fields the onboarding UI already collects --
// no extra PHI surface area beyond the existing in-app capture.
// ---------------------------------------------------------------------
const profileSchema = z.object({
  age: z.number().int().min(13).max(120).nullish(),
  sex: z.enum(["male", "female", "other"]).nullish(),
  heightInches: z.number().positive().max(120).nullish(),
  weightLbs: z.number().positive().min(40).max(900).nullish(),
  goalWeightLbs: z.number().positive().min(40).max(900).nullish(),
  units: z.enum(["imperial", "metric"]).nullish(),
  goals: z.array(z.string().max(60)).max(20).nullish(),
  glp1Medication: z.string().max(60).nullish(),
  glp1Reason: z.string().max(60).nullish(),
  glp1Duration: z.string().max(60).nullish(),
});

router.post("/profile", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(patientProfilesTable)
    .values({
      patientUserId: userId,
      age: d.age ?? null,
      sex: d.sex ?? null,
      heightInches: d.heightInches ?? null,
      weightLbs: d.weightLbs ?? null,
      goalWeightLbs: d.goalWeightLbs ?? null,
      units: d.units ?? null,
      goals: d.goals ?? [],
      glp1Medication: d.glp1Medication ?? null,
      glp1Reason: d.glp1Reason ?? null,
      glp1Duration: d.glp1Duration ?? null,
    })
    // Coalesce so a partial profile patch (e.g. units toggle only)
    // does not erase fields the onboarding flow has already captured.
    .onConflictDoUpdate({
      target: patientProfilesTable.patientUserId,
      set: {
        age: sql`coalesce(excluded.age, ${patientProfilesTable.age})`,
        sex: sql`coalesce(excluded.sex, ${patientProfilesTable.sex})`,
        heightInches: sql`coalesce(excluded.height_inches, ${patientProfilesTable.heightInches})`,
        weightLbs: sql`coalesce(excluded.weight_lbs, ${patientProfilesTable.weightLbs})`,
        goalWeightLbs: sql`coalesce(excluded.goal_weight_lbs, ${patientProfilesTable.goalWeightLbs})`,
        units: sql`coalesce(excluded.units, ${patientProfilesTable.units})`,
        // Goals overwrite the array (rather than coalesce) so a user
        // who deselects a goal sees it removed. Empty array is a
        // legitimate state.
        goals: sql`coalesce(excluded.goals, ${patientProfilesTable.goals})`,
        glp1Medication: sql`coalesce(excluded.glp1_medication, ${patientProfilesTable.glp1Medication})`,
        glp1Reason: sql`coalesce(excluded.glp1_reason, ${patientProfilesTable.glp1Reason})`,
        glp1Duration: sql`coalesce(excluded.glp1_duration, ${patientProfilesTable.glp1Duration})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json(row);
});

router.get("/profile", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const [row] = await db
    .select()
    .from(patientProfilesTable)
    .where(eq(patientProfilesTable.patientUserId, userId))
    .limit(1);
  if (!row) {
    res.json(null);
    return;
  }
  res.json(row);
});

export default router;
