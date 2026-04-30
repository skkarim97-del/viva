import { Router, type Response } from "express";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  outcomeSnapshotsTable,
  patientCheckinsTable,
} from "@workspace/db";
import { requirePatient, type AuthedRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { phiAudit } from "../middlewares/phiAudit";

const router: Router = Router();
// HIPAA audit log. Both routes use requirePatient per-route, so
// req.auth is populated by the time the response 'finish' handler
// fires; the middleware safely no-ops on 401 when no actor was set.
router.use(
  phiAudit({
    getPatientId: (req) => (req as AuthedRequest).auth?.userId ?? null,
  }),
);

// Direct upsert path. The mobile client calls this once per day with
// the proxy outcomes it can compute locally (daily check-in done?
// adherence trend, symptom trend, etc.). Server-side compute is also
// supported via /outcomes/recompute below, which derives the same
// fields from check-in rows so analytics works for older clients
// that don't yet POST snapshots.
const snapshotSchema = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyCheckinCompleted: z.boolean().nullish(),
  nextDayCheckinCompleted: z.boolean().nullish(),
  weeklyConsistency: z.number().min(0).max(100).nullish(),
  medicationLogCompletion: z.number().min(0).max(100).nullish(),
  symptomTrend3d: z.enum(["improved", "same", "worsened", "unknown"]).nullish(),
  appEngaged72h: z.boolean().nullish(),
  clinicianOutreachTriggered: z.boolean().nullish(),
  treatmentActive30d: z.boolean().nullish(),
  treatmentActive60d: z.boolean().nullish(),
  treatmentActive90d: z.boolean().nullish(),
  adherenceImproved3d: z.boolean().nullish(),
  symptomImproved3d: z.boolean().nullish(),
  symptomWorsened3d: z.boolean().nullish(),
  reengagedAfterLowAdherence: z.boolean().nullish(),
});

router.post("/snapshot", requirePatient, async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const parsed = snapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const v = parsed.data;
  const numToStr = (n: number | null | undefined) =>
    typeof n === "number" ? n.toString() : null;
  try {
    // Drizzle's onConflictDoUpdate keeps the analytics view stable
    // (one row per patient per day) and lets the client safely
    // re-POST the same date as the day progresses.
    await db
      .insert(outcomeSnapshotsTable)
      .values({
        patientUserId: userId,
        snapshotDate: v.snapshotDate,
        dailyCheckinCompleted: v.dailyCheckinCompleted ?? null,
        nextDayCheckinCompleted: v.nextDayCheckinCompleted ?? null,
        weeklyConsistency: numToStr(v.weeklyConsistency),
        medicationLogCompletion: numToStr(v.medicationLogCompletion),
        symptomTrend3d: v.symptomTrend3d ?? null,
        appEngaged72h: v.appEngaged72h ?? null,
        clinicianOutreachTriggered: v.clinicianOutreachTriggered ?? null,
        treatmentActive30d: v.treatmentActive30d ?? null,
        treatmentActive60d: v.treatmentActive60d ?? null,
        treatmentActive90d: v.treatmentActive90d ?? null,
        adherenceImproved3d: v.adherenceImproved3d ?? null,
        symptomImproved3d: v.symptomImproved3d ?? null,
        symptomWorsened3d: v.symptomWorsened3d ?? null,
        reengagedAfterLowAdherence: v.reengagedAfterLowAdherence ?? null,
      })
      .onConflictDoUpdate({
        target: [
          outcomeSnapshotsTable.patientUserId,
          outcomeSnapshotsTable.snapshotDate,
        ],
        set: {
          dailyCheckinCompleted: v.dailyCheckinCompleted ?? null,
          nextDayCheckinCompleted: v.nextDayCheckinCompleted ?? null,
          weeklyConsistency: numToStr(v.weeklyConsistency),
          medicationLogCompletion: numToStr(v.medicationLogCompletion),
          symptomTrend3d: v.symptomTrend3d ?? null,
          appEngaged72h: v.appEngaged72h ?? null,
          clinicianOutreachTriggered: v.clinicianOutreachTriggered ?? null,
          treatmentActive30d: v.treatmentActive30d ?? null,
          treatmentActive60d: v.treatmentActive60d ?? null,
          treatmentActive90d: v.treatmentActive90d ?? null,
          adherenceImproved3d: v.adherenceImproved3d ?? null,
          symptomImproved3d: v.symptomImproved3d ?? null,
          symptomWorsened3d: v.symptomWorsened3d ?? null,
          reengagedAfterLowAdherence: v.reengagedAfterLowAdherence ?? null,
          updatedAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "outcome_snapshot_failed");
    res.status(500).json({ error: "snapshot_failed" });
  }
});

// Server-side recompute. Called by the analytics summary endpoint
// before it aggregates, so older mobile clients (that haven't
// adopted /outcomes/snapshot yet) still produce useful outcome rows.
// Conservative: derives only the fields that can be computed from
// patient_checkins alone -- anything wearable-derived stays null.
export async function recomputeRecentOutcomesForAllPatients(
  daysBack: number,
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceYmd = since.toISOString().slice(0, 10);

  // Pull recent check-ins, grouped by patient.
  const cks = await db
    .select()
    .from(patientCheckinsTable)
    .where(gte(patientCheckinsTable.date, sinceYmd))
    .orderBy(desc(patientCheckinsTable.date));

  const byPatient = new Map<number, typeof cks>();
  for (const c of cks) {
    const arr = byPatient.get(c.patientUserId) ?? [];
    arr.push(c);
    byPatient.set(c.patientUserId, arr);
  }

  let upserts = 0;
  for (const [patientUserId, list] of byPatient) {
    // Build a per-day index for quick lookup.
    const byDate = new Map(list.map((c) => [c.date, c]));
    const daysToWrite: string[] = [];
    for (let i = 0; i < daysBack; i += 1) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      daysToWrite.push(d.toISOString().slice(0, 10));
    }
    for (const day of daysToWrite) {
      const todayCk = byDate.get(day) ?? null;
      const nextDay = new Date(day + "T00:00:00");
      nextDay.setDate(nextDay.getDate() + 1);
      const nextYmd = nextDay.toISOString().slice(0, 10);
      const nextCk = byDate.get(nextYmd) ?? null;

      // 7-day consistency centered ending on `day`.
      const windowStart = new Date(day + "T00:00:00");
      windowStart.setDate(windowStart.getDate() - 6);
      const windowStartYmd = windowStart.toISOString().slice(0, 10);
      let inWindow = 0;
      for (const c of list) {
        if (c.date >= windowStartYmd && c.date <= day) inWindow += 1;
      }
      const weeklyConsistency = (inWindow / 7) * 100;

      // 3-day symptom trend (today + prev 2 vs prior 3).
      const sevAt = (ck: (typeof list)[number] | null | undefined): number => {
        if (!ck) return 0;
        const nauseaWeight: Record<string, number> =
          { none: 0, mild: 1, moderate: 2, severe: 3 };
        return nauseaWeight[ck.nausea ?? "none"] ?? 0;
      };
      const window3 = (anchor: string) => {
        const a = new Date(anchor + "T00:00:00");
        let total = 0;
        for (let j = 0; j < 3; j += 1) {
          const d = new Date(a);
          d.setDate(d.getDate() - j);
          total += sevAt(byDate.get(d.toISOString().slice(0, 10)) ?? null);
        }
        return total;
      };
      const recent3 = window3(day);
      const prior3Anchor = new Date(day + "T00:00:00");
      prior3Anchor.setDate(prior3Anchor.getDate() - 3);
      const prior3 = window3(prior3Anchor.toISOString().slice(0, 10));
      let symptomTrend3d: "improved" | "same" | "worsened" | "unknown" =
        "unknown";
      if (recent3 < prior3) symptomTrend3d = "improved";
      else if (recent3 > prior3) symptomTrend3d = "worsened";
      else symptomTrend3d = "same";

      // Adherence-improved (3d): more check-in days in recent window
      // than prior 3-day window.
      let recentDays = 0;
      let priorDays = 0;
      for (let j = 0; j < 3; j += 1) {
        const dr = new Date(day + "T00:00:00");
        dr.setDate(dr.getDate() - j);
        if (byDate.has(dr.toISOString().slice(0, 10))) recentDays += 1;
        const dp = new Date(day + "T00:00:00");
        dp.setDate(dp.getDate() - (j + 3));
        if (byDate.has(dp.toISOString().slice(0, 10))) priorDays += 1;
      }
      const adherenceImproved = recentDays > priorDays;
      const reengaged = priorDays === 0 && recentDays >= 1;

      await db
        .insert(outcomeSnapshotsTable)
        .values({
          patientUserId,
          snapshotDate: day,
          dailyCheckinCompleted: !!todayCk,
          nextDayCheckinCompleted: !!nextCk,
          weeklyConsistency: weeklyConsistency.toFixed(2),
          medicationLogCompletion: null,
          symptomTrend3d,
          appEngaged72h: !!todayCk,
          clinicianOutreachTriggered: null,
          treatmentActive30d: null,
          treatmentActive60d: null,
          treatmentActive90d: null,
          adherenceImproved3d: adherenceImproved,
          symptomImproved3d: symptomTrend3d === "improved",
          symptomWorsened3d: symptomTrend3d === "worsened",
          reengagedAfterLowAdherence: reengaged,
        })
        .onConflictDoUpdate({
          target: [
            outcomeSnapshotsTable.patientUserId,
            outcomeSnapshotsTable.snapshotDate,
          ],
          set: {
            dailyCheckinCompleted: !!todayCk,
            nextDayCheckinCompleted: !!nextCk,
            weeklyConsistency: weeklyConsistency.toFixed(2),
            symptomTrend3d,
            appEngaged72h: !!todayCk,
            adherenceImproved3d: adherenceImproved,
            symptomImproved3d: symptomTrend3d === "improved",
            symptomWorsened3d: symptomTrend3d === "worsened",
            reengagedAfterLowAdherence: reengaged,
            updatedAt: new Date(),
          },
        });
      upserts += 1;
    }
  }
  return upserts;
}

router.get("/recent", requirePatient, async (req, res: Response) => {
  const userId = (req as AuthedRequest).auth.userId;
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceYmd = since.toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(outcomeSnapshotsTable)
    .where(
      and(
        eq(outcomeSnapshotsTable.patientUserId, userId),
        gte(outcomeSnapshotsTable.snapshotDate, sinceYmd),
      ),
    )
    .orderBy(desc(outcomeSnapshotsTable.snapshotDate));
  res.json(rows);
});

export default router;
