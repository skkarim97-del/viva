// =====================================================================
// buildPatientInterventionContext (spec Part 3)
// =====================================================================
// Pulls a compact internal snapshot of the patient's last 7 days +
// today and recent treatment + prior interventions. INTERNAL ONLY:
// this object can contain PHI and never crosses the OpenAI boundary.
// The lib/interventionEngine/deidentify.ts builder is the only thing
// allowed to read it and produce the OpenAI payload.
//
// We tolerate missing data gracefully -- a phone-only patient with
// no Apple Health connection should still produce a usable context;
// the trigger engine and templates have catchalls for the unknown
// case.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  patientCheckinsTable,
  patientHealthDailySummariesTable,
  patientWeightsTable,
  patientTreatmentLogsTable,
  patientsTable,
  patientInterventionsTable,
} from "@workspace/db";
import type {
  PatientInterventionFeedbackResult,
  PatientInterventionTriggerType,
} from "@workspace/db";

export interface PatientInterventionContext {
  patientUserId: number;
  doctorId: number | null;
  today: {
    date: string | null; // YYYY-MM-DD or null if no check-in today
    symptoms: string[];
    severity: number | null; // 1..5
    hydration:
      | "hydrated"
      | "good"
      | "low"
      | "dehydrated"
      | null;
    foodIntake: "strong" | "normal" | "low" | "very_low" | null;
    digestion: "fine" | "bloated" | "constipated" | "diarrhea" | null;
    bowelMovement: boolean | null;
    // Mirrors patient_checkins.energy enum verbatim: depleted (worst)
    // -> tired -> good -> great (best). The trigger engine treats
    // depleted+tired as "low energy".
    energy: "depleted" | "tired" | "good" | "great" | null;
    nausea: "none" | "mild" | "moderate" | "severe" | null;
    steps: number | null;
    sleepHours: number | null;
  };
  last7Days: {
    constipationDays: number;
    nauseaDays: number;
    lowEnergyDays: number;
    lowHydrationDays: number;
    lowFoodIntakeDays: number;
    missedCheckins: number;
    avgSteps: number | null;
    baselineSteps: number | null; // 14-day average for comparison
    stepsChangePct: number | null;
    weightChangeLbs: number | null;
    severityTrend: "improving" | "stable" | "worsening" | "unknown";
  };
  treatment: {
    medication: string | null;
    dose: string | null;
    daysSinceLastDose: number | null;
    recentDoseChange: boolean;
  };
  priorInterventions: {
    lastShownTriggerType: PatientInterventionTriggerType | null;
    lastFeedback: PatientInterventionFeedbackResult | null;
    repeatedUnresolved: boolean;
    activeStatuses: ReadonlyArray<string>;
    // Distinct trigger types currently active (status in
    // shown/accepted/pending_feedback/escalated). Used by the
    // orchestrator to suppress duplicate generation across ALL
    // active rows -- not just the most recent one.
    activeTriggerTypes: ReadonlyArray<PatientInterventionTriggerType>;
    // Per-active-row {type, severity, id} so the orchestrator can
    // allow severity-escalation supersede (moderate -> severe) and
    // the route handler can dismiss the superseded row.
    activeInterventions: ReadonlyArray<{
      id: number;
      type: PatientInterventionTriggerType;
      severity: number | null;
    }>;
  };
}

// -- helpers ----------------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function avg(nums: ReadonlyArray<number>): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// -- main -------------------------------------------------------------

export async function buildPatientInterventionContext(
  patientUserId: number,
): Promise<PatientInterventionContext> {
  const now = new Date();
  const todayStr = ymd(now);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = ymd(sevenDaysAgo);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = ymd(fourteenDaysAgo);

  // Fan out reads in parallel. Every query is independent -- no
  // cross-table joins needed in this snapshot.
  const [
    patientRow,
    checkins7,
    checkinsBaseline,
    healthSummaries14,
    weights14,
    treatmentLogs,
    priorInterventions,
  ] = await Promise.all([
    // Patient -> doctor scope (used to write doctor_id on the
    // generated intervention row).
    db
      .select({ doctorId: patientsTable.doctorId })
      .from(patientsTable)
      .where(eq(patientsTable.userId, patientUserId))
      .limit(1),
    // Last 7 days of check-ins (newest first).
    db
      .select()
      .from(patientCheckinsTable)
      .where(
        and(
          eq(patientCheckinsTable.patientUserId, patientUserId),
          gte(patientCheckinsTable.date, sevenDaysAgoStr),
        ),
      )
      .orderBy(desc(patientCheckinsTable.date))
      .limit(14),
    // Days 7..14 ago for baseline comparison (energy/severity trend).
    db
      .select()
      .from(patientCheckinsTable)
      .where(
        and(
          eq(patientCheckinsTable.patientUserId, patientUserId),
          gte(patientCheckinsTable.date, fourteenDaysAgoStr),
        ),
      )
      .orderBy(desc(patientCheckinsTable.date))
      .limit(30),
    // Last 14 days of Apple Health summaries -- powers
    // steps/sleep/HRV/baseline computations.
    db
      .select()
      .from(patientHealthDailySummariesTable)
      .where(
        and(
          eq(
            patientHealthDailySummariesTable.patientUserId,
            patientUserId,
          ),
          gte(
            patientHealthDailySummariesTable.summaryDate,
            fourteenDaysAgoStr,
          ),
        ),
      )
      .orderBy(desc(patientHealthDailySummariesTable.summaryDate))
      .limit(30),
    // Weights for trend-vs-7-days-ago comparison.
    db
      .select()
      .from(patientWeightsTable)
      .where(
        and(
          eq(patientWeightsTable.patientUserId, patientUserId),
          gte(
            patientWeightsTable.recordedAt,
            new Date(fourteenDaysAgo),
          ),
        ),
      )
      .orderBy(desc(patientWeightsTable.recordedAt))
      .limit(30),
    // Treatment logs (most recent first) for daysSinceLastDose +
    // recentDoseChange. We do NOT read patients.glp1Drug/dose into
    // the context that crosses to OpenAI -- only the timing bucket
    // is exposed there.
    db
      .select()
      .from(patientTreatmentLogsTable)
      .where(eq(patientTreatmentLogsTable.patientUserId, patientUserId))
      .orderBy(desc(patientTreatmentLogsTable.createdAt))
      .limit(5),
    // Recent interventions for the de-dupe + prior-feedback fields.
    db
      .select()
      .from(patientInterventionsTable)
      .where(eq(patientInterventionsTable.patientUserId, patientUserId))
      .orderBy(desc(patientInterventionsTable.createdAt))
      .limit(20),
  ]);

  // -- today snapshot ------------------------------------------------
  const todayRow =
    checkins7.find((c) => c.date === todayStr) ?? checkins7[0] ?? null;
  const todayHealth = healthSummaries14[0] ?? null;
  const todaySymptoms: string[] = [];
  if (todayRow) {
    if (todayRow.nausea && todayRow.nausea !== "none") {
      todaySymptoms.push("nausea");
    }
    if (todayRow.digestion === "constipated") todaySymptoms.push("constipation");
    if (todayRow.energy === "depleted" || todayRow.energy === "tired") {
      todaySymptoms.push("low_energy");
    }
    if (todayRow.appetite === "low" || todayRow.appetite === "very_low") {
      todaySymptoms.push("low_food_intake");
    }
    if (todayRow.hydration === "low" || todayRow.hydration === "dehydrated") {
      todaySymptoms.push("low_hydration");
    }
  }

  // Severity 1..5 mapped from the most prominent today symptom.
  // none/mild/moderate/severe -> 1/2/3/5; energy good/low/very_low ->
  // n/a/3/4. Caller uses the highest.
  let todaySeverity: number | null = null;
  if (todayRow) {
    const candidates: number[] = [];
    if (todayRow.nausea === "mild") candidates.push(2);
    if (todayRow.nausea === "moderate") candidates.push(3);
    if (todayRow.nausea === "severe") candidates.push(5);
    if (todayRow.energy === "tired") candidates.push(3);
    if (todayRow.energy === "depleted") candidates.push(4);
    if (todayRow.appetite === "low") candidates.push(3);
    if (todayRow.appetite === "very_low") candidates.push(4);
    if (todayRow.digestion === "constipated") candidates.push(2);
    if (todayRow.digestion === "diarrhea") candidates.push(3);
    if (candidates.length > 0) todaySeverity = Math.max(...candidates);
  }

  // -- 7-day rollups ------------------------------------------------
  const constipationDays = checkins7.filter(
    (c) => c.digestion === "constipated",
  ).length;
  const nauseaDays = checkins7.filter(
    (c) => c.nausea && c.nausea !== "none",
  ).length;
  const lowEnergyDays = checkins7.filter(
    (c) => c.energy === "depleted" || c.energy === "tired",
  ).length;
  const lowHydrationDays = checkins7.filter(
    (c) => c.hydration === "low" || c.hydration === "dehydrated",
  ).length;
  const lowFoodIntakeDays = checkins7.filter(
    (c) => c.appetite === "low" || c.appetite === "very_low",
  ).length;

  // Missed check-ins: 7 expected dates - distinct dates seen.
  const seenDates = new Set(checkins7.map((c) => c.date));
  let missedCheckins = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (!seenDates.has(ymd(d))) missedCheckins++;
  }

  // Steps: avg over last 7 days vs 14-day baseline.
  const stepsLast7 = healthSummaries14
    .filter((h) => h.summaryDate >= sevenDaysAgoStr && h.steps != null)
    .map((h) => h.steps as number);
  const stepsAll14 = healthSummaries14
    .filter((h) => h.steps != null)
    .map((h) => h.steps as number);
  const avgSteps = avg(stepsLast7);
  const baselineSteps = avg(stepsAll14);
  let stepsChangePct: number | null = null;
  if (avgSteps != null && baselineSteps != null && baselineSteps > 0) {
    stepsChangePct = Math.round(
      ((avgSteps - baselineSteps) / baselineSteps) * 100,
    );
  }

  // Weight: most recent vs ~7 days prior.
  let weightChangeLbs: number | null = null;
  if (weights14.length >= 2) {
    const newest = weights14[0]!;
    // Find the row closest to (newest.recordedAt - 7 days).
    const target = new Date(newest.recordedAt);
    target.setDate(target.getDate() - 7);
    let best: (typeof weights14)[number] | null = null;
    let bestDiff = Infinity;
    for (let i = 1; i < weights14.length; i++) {
      const w = weights14[i]!;
      const diff = Math.abs(w.recordedAt.getTime() - target.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        best = w;
      }
    }
    if (best) {
      weightChangeLbs =
        Math.round((newest.weightLbs - best.weightLbs) * 10) / 10;
    }
  }

  // Severity trend: today's severity vs avg severity in days 7..14.
  let severityTrend: PatientInterventionContext["last7Days"]["severityTrend"] =
    "unknown";
  const olderRows = checkinsBaseline.filter(
    (c) => c.date < sevenDaysAgoStr,
  );
  if (olderRows.length > 0 && todaySeverity != null) {
    const olderSeverities: number[] = [];
    for (const c of olderRows) {
      const cand: number[] = [];
      if (c.nausea === "moderate") cand.push(3);
      if (c.nausea === "severe") cand.push(5);
      if (c.energy === "depleted") cand.push(4);
      if (cand.length > 0) olderSeverities.push(Math.max(...cand));
    }
    const olderAvg = avg(olderSeverities);
    if (olderAvg != null) {
      if (todaySeverity > olderAvg + 0.5) severityTrend = "worsening";
      else if (todaySeverity < olderAvg - 0.5) severityTrend = "improving";
      else severityTrend = "stable";
    }
  }

  // -- treatment ----------------------------------------------------
  const latestTreatment = treatmentLogs[0] ?? null;
  let daysSinceLastDose: number | null = null;
  if (latestTreatment?.createdAt) {
    const ms = now.getTime() - latestTreatment.createdAt.getTime();
    daysSinceLastDose = Math.floor(ms / (1000 * 60 * 60 * 24));
  }
  const recentDoseChange =
    treatmentLogs.length >= 2 &&
    treatmentLogs[0]!.medicationName !== treatmentLogs[1]!.medicationName;

  // -- prior interventions -----------------------------------------
  const lastShown = priorInterventions[0] ?? null;
  // Most recent feedback from any closed-out intervention.
  const lastWithFeedback = priorInterventions.find(
    (i) => i.feedbackResult != null,
  );
  // Active = currently in shown/accepted/pending_feedback/escalated.
  // We capture both the status list (for analytics / debug) and the
  // distinct trigger-type set (for the orchestrator's de-dupe pass --
  // see comment on `activeTriggerTypes` above).
  const activeRows = priorInterventions.filter((i) =>
    ["shown", "accepted", "pending_feedback", "escalated"].includes(i.status),
  );
  const activeStatuses = activeRows.map((i) => i.status);
  const activeTriggerTypes = Array.from(
    new Set(activeRows.map((i) => i.triggerType)),
  );
  // Brief shape (id + type + severity) so the orchestrator can decide
  // whether a higher-severity detected trigger should supersede an
  // already-active row of the same type.
  const activeInterventions = activeRows.map((i) => ({
    id: i.id,
    type: i.triggerType,
    severity: i.severity ?? null,
  }));
  // Repeated unresolved: any intervention in the last 14 days with
  // feedback="worse" OR status="escalated" that hasn't been resolved.
  const repeatedUnresolved = priorInterventions.some(
    (i) =>
      (i.feedbackResult === "worse" || i.status === "escalated") &&
      i.status !== "resolved",
  );

  return {
    patientUserId,
    doctorId: patientRow[0]?.doctorId ?? null,
    today: {
      date: todayRow?.date ?? null,
      symptoms: todaySymptoms,
      severity: todaySeverity,
      hydration: todayRow?.hydration ?? null,
      foodIntake: todayRow?.appetite ?? null,
      digestion: todayRow?.digestion ?? null,
      bowelMovement: todayRow?.bowelMovement ?? null,
      energy: todayRow?.energy ?? null,
      nausea: todayRow?.nausea ?? null,
      steps: todayHealth?.steps ?? null,
      sleepHours:
        todayHealth?.sleepMinutes != null
          ? Math.round((todayHealth.sleepMinutes / 60) * 10) / 10
          : null,
    },
    last7Days: {
      constipationDays,
      nauseaDays,
      lowEnergyDays,
      lowHydrationDays,
      lowFoodIntakeDays,
      missedCheckins,
      avgSteps: avgSteps != null ? Math.round(avgSteps) : null,
      baselineSteps: baselineSteps != null ? Math.round(baselineSteps) : null,
      stepsChangePct,
      weightChangeLbs,
      severityTrend,
    },
    treatment: {
      medication: latestTreatment?.medicationName ?? null,
      dose:
        latestTreatment?.dose != null
          ? `${latestTreatment.dose}${latestTreatment.doseUnit ?? ""}`.trim() ||
            null
          : null,
      daysSinceLastDose,
      recentDoseChange,
    },
    priorInterventions: {
      lastShownTriggerType: lastShown?.triggerType ?? null,
      lastFeedback: lastWithFeedback?.feedbackResult ?? null,
      repeatedUnresolved,
      activeStatuses,
      activeTriggerTypes,
      activeInterventions,
    },
  };
}

// Convenience: avoid linting against the imported sql util we don't
// directly use here -- kept for future GROUP BY rollups.
void sql;
