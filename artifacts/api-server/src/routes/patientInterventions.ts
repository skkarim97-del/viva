// =====================================================================
// /api/patient/interventions  (spec Part 6 patient endpoints)
// =====================================================================
// Six endpoints, all requirePatient + per-row id-belongs-to-me check:
//   POST   /generate         create a new intervention
//   GET    /active           list shown/accepted/pending_feedback/escalated
//   POST   /:id/accept       shown -> pending_feedback
//   POST   /:id/dismiss      shown -> dismissed
//   POST   /:id/feedback     pending_feedback -> feedback_collected/resolved
//   POST   /:id/escalate     {shown,accepted,pending_feedback} -> escalated
//
// Every route mirrors the lifecycle to care_events for the existing
// dashboard worklist + funnel queries (recommendation_shown,
// intervention_feedback, escalation_requested) so we don't dual-source
// the same signal.

import { Router, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  patientInterventionsTable,
  careEventsTable,
  analyticsEventsTable,
  PATIENT_INTERVENTION_TRIGGER_TYPES,
  PATIENT_INTERVENTION_FEEDBACK_RESULTS,
  type PatientIntervention,
} from "@workspace/db";
import {
  requirePatient,
  type AuthedRequest,
} from "../middlewares/auth";
import { mediumApiLimiter } from "../middlewares/rateLimit";
import { phiAudit } from "../middlewares/phiAudit";
import { logger } from "../lib/logger";
import {
  generatePersonalizedIntervention,
  type InterventionAnalyticsEvent,
} from "../lib/interventionEngine";

const router: Router = Router();

// Lifecycle gate. mediumApiLimiter on the router because every patient
// endpoint here is mutation-heavy or runs the engine; the strict
// limiter would only matter for unauthenticated bursts and that's
// not the threat surface for a logged-in patient.
router.use(mediumApiLimiter);
router.use(requirePatient);

// PHI audit trail. The actor is always the patient themselves; for
// every endpoint with :id we resolve the patient via the row, but
// the simplest invariant is "the actor IS the patient" which is what
// requirePatient guarantees. So the audit just keys off auth.userId.
router.use(
  phiAudit({
    getPatientId: (req) => (req as AuthedRequest).auth?.userId ?? null,
  }),
);

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

// Fire-and-forget analytics insert. Never block the response on it,
// never let an analytics outage surface to the patient. Mirrors the
// pattern used in routes/analytics.ts.
function fireAnalytics(
  userId: number,
  events: InterventionAnalyticsEvent[],
  metadata: Record<string, unknown>,
): void {
  if (events.length === 0) return;
  const rows = events.map((eventName) => ({
    userType: "patient",
    userId,
    eventName,
    sessionId: null,
    platform: null,
    timezone: null,
  }));
  void rows;
  // We only persist the event NAME; metadata stays in logs (where pino
  // redact already strips PHI fields). This matches analytics_events
  // schema which has no metadata column.
  void metadata;
  db.insert(analyticsEventsTable)
    .values(rows)
    .catch((err) => {
      logger.warn({ err }, "intervention_analytics_insert_failed");
    });
}

// Look up an intervention BY id, but only if it belongs to the
// caller. Returns null on not-found OR not-owned -- callers should
// not differentiate (404 either way, no info leak).
async function loadOwnedIntervention(
  patientUserId: number,
  interventionId: number,
): Promise<PatientIntervention | null> {
  const [row] = await db
    .select()
    .from(patientInterventionsTable)
    .where(
      and(
        eq(patientInterventionsTable.id, interventionId),
        eq(patientInterventionsTable.patientUserId, patientUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// -----------------------------------------------------------------
// POST /generate -- create a new intervention
// -----------------------------------------------------------------

const generateSchema = z.object({
  source: z.enum(["checkin", "manual", "scheduled"]).default("manual"),
  symptomType: z.string().min(1).max(64).nullish(),
  severity: z.number().int().min(1).max(5).nullish(),
  // The patient app may pass a trigger override when the patient
  // explicitly selects "ask my care team" -- we route that to the
  // patient_requested_review trigger.
  triggerType: z.enum(PATIENT_INTERVENTION_TRIGGER_TYPES).nullish(),
});

router.post("/generate", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { source, symptomType, severity, triggerType } = parsed.data;
  // Zod v4 narrows .nullish() to a synthetic shape that tsc surfaces
  // as `{} | null` rather than `string | null | undefined`. The runtime
  // values are correct strings/numbers; cast at the boundary to keep
  // the engine signature tight without sprinkling `as` deeper.
  const symptomTypeArg =
    (symptomType as string | null | undefined) ?? null;
  const severityArg =
    (severity as number | null | undefined) ?? null;

  try {
    const generated = await generatePersonalizedIntervention({
      patientUserId: userId,
      forcedTriggerType: (triggerType as typeof triggerType) ?? undefined,
      forcedSymptomType: symptomTypeArg,
      forcedSeverity: severityArg,
    });

    // Unified-card invariant: at most ONE active Personalized
    // check-in row per patient at a time. Two paths:
    //   A. An active row exists AND is still in "shown" status (the
    //      patient hasn't acted on it yet) -- UPDATE it in place with
    //      the freshly synthesized multi-symptom content. This is
    //      what makes slider edits live-update the visible card
    //      within the 1.2s frontend debounce instead of producing a
    //      stack of cards.
    //   B. Otherwise (no active row, OR the active row is past
    //      "shown" -- accepted/pending_feedback/escalated -- and we
    //      shouldn't disrupt that flow):
    //        * If the active row is past "shown", return it as-is.
    //        * If no active row exists, INSERT a new one. Any prior
    //          same-trigger active rows that the engine flagged for
    //          supersede are dismissed first so /active still returns
    //          exactly one card.
    // We query active rows BEFORE branching on `generated` so that
    // the locked-active path (accepted/pending_feedback/escalated)
    // also wins when the engine produced no new triggers (e.g. the
    // patient already acted on the card and nothing new is detected
    // -- we must NOT clobber that locked row by returning null).
    const activeRows = await db
      .select()
      .from(patientInterventionsTable)
      .where(
        and(
          eq(patientInterventionsTable.patientUserId, userId),
          inArray(patientInterventionsTable.status, ACTIVE_STATUSES),
        ),
      )
      .orderBy(desc(patientInterventionsTable.createdAt));

    const liveEditable = activeRows.find((r) => r.status === "shown") ?? null;
    const lockedActive = activeRows.find((r) => r.status !== "shown") ?? null;

    if (!generated) {
      // No triggers detected. If the patient already engaged with a
      // locked card (accepted / awaiting feedback / escalated), keep
      // surfacing it so feedback flow isn't disrupted. Otherwise
      // there's truly nothing to show.
      if (lockedActive) {
        res.json({ intervention: lockedActive });
        return;
      }
      res.json({ intervention: null, reason: "no_trigger_or_active" });
      return;
    }

    let row: PatientIntervention | undefined;
    let liveUpdated = false;

    if (liveEditable) {
      // Path A: update in place. Refresh the synthesized fields,
      // bump the trigger metadata to the new primary, and persist.
      // Status stays "shown" so the patient's existing card just
      // re-renders with new copy.
      const [updated] = await db
        .update(patientInterventionsTable)
        .set({
          triggerType: generated.insertRow.triggerType,
          symptomType: generated.insertRow.symptomType,
          severity: generated.insertRow.severity,
          riskLevel: generated.insertRow.riskLevel,
          contextSummary: generated.insertRow.contextSummary,
          deidentifiedAiPayload: generated.insertRow.deidentifiedAiPayload,
          whatWeNoticed: generated.insertRow.whatWeNoticed,
          recommendation: generated.insertRow.recommendation,
          followUpQuestion: generated.insertRow.followUpQuestion,
          recommendationCategory: generated.insertRow.recommendationCategory,
          escalationReason: generated.insertRow.escalationReason,
          generatedBy: generated.insertRow.generatedBy,
          updatedAt: new Date(),
        })
        .where(eq(patientInterventionsTable.id, liveEditable.id))
        .returning();
      row = updated;
      liveUpdated = true;
    } else if (lockedActive) {
      // The patient has already engaged with the active card
      // (accepted / awaiting feedback / escalated). Don't replace it
      // and don't pile on a new one -- just return the existing row
      // so the mobile client can keep rendering it.
      res.json({ intervention: lockedActive });
      return;
    } else {
      // Path B: no active row. Dismiss any same-trigger superseded
      // rows that the engine flagged (rare in the unified-card model
      // but kept for parity with prior behavior) and insert fresh.
      const supersededIds = (
        generated.insertRow.contextSummary?.priorInterventions
          ?.activeInterventions ?? []
      )
        .filter((a) => a.type === generated.insertRow.triggerType)
        .map((a) => a.id);
      if (supersededIds.length > 0) {
        await db
          .update(patientInterventionsTable)
          .set({ status: "dismissed", updatedAt: new Date() })
          .where(
            and(
              eq(patientInterventionsTable.patientUserId, userId),
              inArray(patientInterventionsTable.id, supersededIds),
            ),
          );
      }
      const [inserted] = await db
        .insert(patientInterventionsTable)
        .values(generated.insertRow)
        .returning();
      row = inserted;
    }

    if (!row) {
      res.status(500).json({ error: "insert_failed" });
      return;
    }

    // Mirror to care_events (recommendation_shown) ONLY for newly
    // inserted rows. Live updates to an already-shown card don't
    // re-fire the "shown" event -- the patient hasn't been shown a
    // new card, just refreshed copy on the same one. Without this
    // guard the dashboard funnel would over-count impressions every
    // time a slider moved.
    if (!liveUpdated) {
      db.insert(careEventsTable)
        .values({
          patientUserId: userId,
          actorUserId: null,
          source: "viva",
          type: "recommendation_shown",
          metadata: {
            intervention_id: row.id,
            trigger_type: row.triggerType,
            recommendation_category: row.recommendationCategory,
            generated_by: row.generatedBy,
            source,
            risk_level: row.riskLevel,
          },
        })
        .catch((err) => {
          logger.warn(
            { err, interventionId: row.id },
            "intervention_care_event_insert_failed",
          );
        });
    }

    // Analytics: always fire AI-payload / fallback / phi-guardrail
    // events (they describe what the engine did), but suppress the
    // "intervention_generated" + "intervention_shown" funnel events
    // for live updates so the analytics taxonomy still means "a new
    // card was created" when those events fire.
    const eventsToFire = liveUpdated
      ? generated.analyticsEvents.filter(
          (e) =>
            e !== "intervention_generated" && e !== "intervention_shown",
        )
      : generated.analyticsEvents;
    fireAnalytics(userId, eventsToFire, {
      intervention_id: row.id,
      trigger_type: row.triggerType,
      generated_by: row.generatedBy,
      source,
      live_updated: liveUpdated,
    });

    res.status(liveUpdated ? 200 : 201).json({ intervention: row });
  } catch (err) {
    logger.error({ err, userId }, "intervention_generate_failed");
    res.status(500).json({ error: "generate_failed" });
  }
});

// -----------------------------------------------------------------
// GET /active -- list active interventions for the caller
// -----------------------------------------------------------------

const ACTIVE_STATUSES = [
  "shown",
  "accepted",
  "pending_feedback",
  "escalated",
] as const;

router.get("/active", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  try {
    const rows = await db
      .select()
      .from(patientInterventionsTable)
      .where(
        and(
          eq(patientInterventionsTable.patientUserId, userId),
          inArray(patientInterventionsTable.status, ACTIVE_STATUSES),
        ),
      )
      .orderBy(desc(patientInterventionsTable.createdAt))
      .limit(10);
    res.json({ interventions: rows });
  } catch (err) {
    logger.error({ err, userId }, "intervention_active_failed");
    res.status(500).json({ error: "list_failed" });
  }
});

// -----------------------------------------------------------------
// POST /:id/accept -- shown -> pending_feedback
// -----------------------------------------------------------------

router.post("/:id/accept", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const existing = await loadOwnedIntervention(userId, id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (
    existing.status !== "shown" &&
    existing.status !== "accepted"
  ) {
    res.status(409).json({ error: "invalid_status_transition" });
    return;
  }
  const now = new Date();
  const [updated] = await db
    .update(patientInterventionsTable)
    .set({
      status: "pending_feedback",
      acceptedAt: existing.acceptedAt ?? now,
      feedbackRequestedAt: now,
      updatedAt: now,
    })
    .where(eq(patientInterventionsTable.id, id))
    .returning();

  fireAnalytics(userId, ["intervention_accepted"], {
    intervention_id: id,
    trigger_type: existing.triggerType,
  });
  res.json({ intervention: updated });
});

// -----------------------------------------------------------------
// POST /:id/dismiss
// -----------------------------------------------------------------

const dismissSchema = z.object({
  reason: z.enum(["not_relevant", "not_now", "other"]).default("other"),
});

router.post("/:id/dismiss", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = dismissSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const existing = await loadOwnedIntervention(userId, id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (existing.status !== "shown") {
    res.status(409).json({ error: "invalid_status_transition" });
    return;
  }
  const [updated] = await db
    .update(patientInterventionsTable)
    .set({
      status: "dismissed",
      escalationReason: parsed.data.reason,
      updatedAt: new Date(),
    })
    .where(eq(patientInterventionsTable.id, id))
    .returning();
  fireAnalytics(userId, ["intervention_dismissed"], {
    intervention_id: id,
    reason: parsed.data.reason,
  });
  res.json({ intervention: updated });
});

// -----------------------------------------------------------------
// POST /:id/feedback
// -----------------------------------------------------------------

const feedbackSchema = z.object({
  feedbackResult: z.enum(PATIENT_INTERVENTION_FEEDBACK_RESULTS),
  // Patient free-text. NEVER sent to OpenAI; stored INTERNAL ONLY.
  // Capped at 1000 chars to bound DB row size.
  patientNote: z.string().max(1000).nullish(),
});

router.post("/:id/feedback", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = feedbackSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const existing = await loadOwnedIntervention(userId, id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (
    existing.status !== "accepted" &&
    existing.status !== "pending_feedback"
  ) {
    res.status(409).json({ error: "invalid_status_transition" });
    return;
  }
  const now = new Date();
  const { feedbackResult, patientNote } = parsed.data;

  // Status logic per spec Part 6:
  //   better -> resolved
  //   same   -> feedback_collected (caller may generate a follow-up)
  //   worse  -> escalated (auto-escalate the row)
  //   didnt_try -> feedback_collected, no outcome attribution
  let nextStatus: PatientIntervention["status"];
  let escalatedAt: Date | null = null;
  let resolvedAt: Date | null = null;
  let escalationReason: string | null = existing.escalationReason;
  if (feedbackResult === "better") {
    nextStatus = "resolved";
    resolvedAt = now;
  } else if (feedbackResult === "worse") {
    nextStatus = "escalated";
    escalatedAt = now;
    escalationReason = "patient_feedback_worse";
  } else {
    nextStatus = "feedback_collected";
  }

  const [updated] = await db
    .update(patientInterventionsTable)
    .set({
      status: nextStatus,
      feedbackResult,
      patientNote: patientNote ?? null,
      feedbackCollectedAt: now,
      escalatedAt,
      resolvedAt,
      escalationReason,
      updatedAt: now,
    })
    .where(eq(patientInterventionsTable.id, id))
    .returning();

  // Mirror to care_events. Always log intervention_feedback;
  // additionally log escalation_requested when worse (so the
  // existing dashboard worklist's needs-review bucket surfaces it).
  const careRows: Array<typeof careEventsTable.$inferInsert> = [
    {
      patientUserId: userId,
      actorUserId: userId,
      source: "patient",
      type: "intervention_feedback",
      metadata: {
        intervention_id: id,
        response: feedbackResult,
        intervention: existing.symptomType ?? existing.triggerType,
      },
    },
  ];
  if (feedbackResult === "worse") {
    careRows.push({
      patientUserId: userId,
      actorUserId: userId,
      source: "patient",
      type: "escalation_requested",
      metadata: {
        intervention_id: id,
        reason: "patient_feedback_worse",
        channel: "intervention",
      },
    });
  }
  db.insert(careEventsTable)
    .values(careRows)
    .catch((err) => {
      logger.warn(
        { err, interventionId: id },
        "intervention_feedback_care_event_insert_failed",
      );
    });

  // Analytics events vary by feedback. Spec Part 9 names are kept
  // verbatim (the feedback variants share a lookup table here so a
  // future name change is one edit, not four).
  const analyticsEvents: InterventionAnalyticsEvent[] = [];
  const feedbackToEvent: Record<
    "better" | "same" | "worse" | "didnt_try",
    InterventionAnalyticsEvent
  > = {
    better: "intervention_feedback_better",
    same: "intervention_feedback_same",
    worse: "intervention_feedback_worse",
    didnt_try: "intervention_feedback_didnt_try",
  };
  analyticsEvents.push(
    feedbackToEvent[feedbackResult as keyof typeof feedbackToEvent],
  );
  if (feedbackResult === "better") {
    analyticsEvents.push("intervention_resolved");
  } else if (feedbackResult === "worse") {
    analyticsEvents.push("intervention_escalated");
  }
  fireAnalytics(userId, analyticsEvents, {
    intervention_id: id,
    feedback_result: feedbackResult,
  });

  res.json({ intervention: updated });
});

// -----------------------------------------------------------------
// POST /:id/escalate -- patient explicitly asks the care team
// -----------------------------------------------------------------

router.post("/:id/escalate", async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const existing = await loadOwnedIntervention(userId, id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (
    existing.status === "resolved" ||
    existing.status === "expired" ||
    existing.status === "escalated"
  ) {
    res.status(409).json({ error: "invalid_status_transition" });
    return;
  }
  const now = new Date();
  const [updated] = await db
    .update(patientInterventionsTable)
    .set({
      status: "escalated",
      escalatedAt: now,
      escalationReason: existing.escalationReason ?? "patient_requested",
      updatedAt: now,
    })
    .where(eq(patientInterventionsTable.id, id))
    .returning();

  // Mirror to care_events. Hooks straight into the existing
  // needs-review worklist on the dashboard.
  db.insert(careEventsTable)
    .values({
      patientUserId: userId,
      actorUserId: userId,
      source: "patient",
      type: "escalation_requested",
      metadata: {
        intervention_id: id,
        reason: "patient_requested",
        channel: "intervention",
      },
    })
    .catch((err) => {
      logger.warn(
        { err, interventionId: id },
        "intervention_escalate_care_event_insert_failed",
      );
    });

  fireAnalytics(userId, ["intervention_escalated"], {
    intervention_id: id,
  });
  res.json({ intervention: updated });
});

// Reference unused import to avoid linter noise; sql may be used later
// for grouped rollups.
void sql;

export default router;
