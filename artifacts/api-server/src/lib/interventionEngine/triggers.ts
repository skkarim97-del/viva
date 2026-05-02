// =====================================================================
// detectInterventionTriggers (spec Part 4)
// =====================================================================
// Pure function: takes an internal context snapshot and returns the
// ordered list of triggers that fire. Caller (orchestrator) picks
// the most-relevant ONE based on risk priority + de-dupe rules.
//
// Why a list (not just one trigger): later phases of the pilot may
// want to "stack" interventions (e.g. show two cards) or use the
// other detected triggers as additional context for the OpenAI
// payload. Returning all of them keeps that option open without
// re-walking the rules.

import type { PatientInterventionContext } from "./context";
import type {
  PatientInterventionTriggerType,
  PatientInterventionRiskLevel,
} from "@workspace/db";

export interface DetectedTrigger {
  type: PatientInterventionTriggerType;
  symptomType: string | null;
  severity: number | null;
  riskLevel: PatientInterventionRiskLevel;
  reason: string; // human-readable, used in escalation_reason
}

const RISK_PRIORITY: Record<PatientInterventionRiskLevel, number> = {
  elevated: 3,
  moderate: 2,
  low: 1,
};

// Co-signal labels emitted alongside the trigger; the templates
// module uses these to pick the most-specific fallback row.
export type Cosignal =
  | "low_steps"
  | "low_hydration"
  | "low_food_intake"
  | "post_dose"
  | "poor_sleep"
  | "low_appetite"
  | "elevated";

export function detectCosignals(
  ctx: PatientInterventionContext,
): Cosignal[] {
  const out: Cosignal[] = [];
  if (
    ctx.last7Days.stepsChangePct != null &&
    ctx.last7Days.stepsChangePct <= -25
  ) {
    out.push("low_steps");
  }
  if (
    ctx.today.hydration === "low" ||
    ctx.today.hydration === "dehydrated" ||
    ctx.last7Days.lowHydrationDays >= 2
  ) {
    out.push("low_hydration");
  }
  if (
    ctx.today.foodIntake === "low" ||
    ctx.today.foodIntake === "very_low" ||
    ctx.last7Days.lowFoodIntakeDays >= 2
  ) {
    out.push("low_food_intake");
    out.push("low_appetite");
  }
  if (
    ctx.treatment.daysSinceLastDose != null &&
    ctx.treatment.daysSinceLastDose <= 3
  ) {
    out.push("post_dose");
  }
  if (ctx.today.sleepHours != null && ctx.today.sleepHours < 6) {
    out.push("poor_sleep");
  }
  return out;
}

// Per-trigger-type severity. The orchestrator's supersede logic
// compares "new severity for THIS trigger type" against the active
// row's stored severity, so each trigger must carry a number that
// reflects its OWN symptom -- not the day's overall max severity.
// Without this, a severe-nausea update would inflate the constipation
// trigger's severity and incorrectly supersede an active constipation
// card. Returns null when the symptom isn't present (the trigger
// shouldn't fire in that case anyway).
function severityForTriggerType(
  ctx: PatientInterventionContext,
  type: PatientInterventionTriggerType,
): number | null {
  const t = ctx.today;
  switch (type) {
    case "nausea":
      if (t.nausea === "severe") return 5;
      if (t.nausea === "moderate") return 3;
      if (t.nausea === "mild") return 1;
      return null;
    case "low_energy":
      if (t.energy === "depleted") return 4;
      if (t.energy === "tired") return 2;
      return null;
    case "constipation":
    case "repeated_symptom":
      // Binary symptom; surface "1" when present so any same-type
      // active row blocks supersede (severity never exceeds itself).
      return t.digestion === "constipated" ? 1 : null;
    default:
      // For triggers without a clean per-symptom mapping (rapid
      // weight change, missed check-in, low hydration, worsening,
      // patient-requested), keep the day's max so existing behavior
      // is preserved.
      return t.severity;
  }
}

export function detectInterventionTriggers(
  ctx: PatientInterventionContext,
): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];
  const t = ctx.today;
  const w = ctx.last7Days;
  const sevNausea = severityForTriggerType(ctx, "nausea");
  const sevConstipation = severityForTriggerType(ctx, "constipation");
  const sevLowEnergy = severityForTriggerType(ctx, "low_energy");

  // 1. Repeated constipation
  if (w.constipationDays >= 2) {
    triggers.push({
      type: "repeated_symptom",
      symptomType: "constipation",
      severity: sevConstipation,
      riskLevel: "moderate",
      reason: `constipation reported ${w.constipationDays} of last 7 days`,
    });
  }

  // 2. Constipation + low activity
  if (
    t.digestion === "constipated" &&
    w.stepsChangePct != null &&
    w.stepsChangePct <= -25
  ) {
    triggers.push({
      type: "constipation",
      symptomType: "constipation",
      severity: sevConstipation,
      riskLevel: "moderate",
      reason: `constipation today + steps down ${Math.abs(w.stepsChangePct)}%`,
    });
  }

  // 3. Constipation + low hydration
  if (
    t.digestion === "constipated" &&
    (t.hydration === "low" || t.hydration === "dehydrated")
  ) {
    triggers.push({
      type: "constipation",
      symptomType: "constipation",
      severity: sevConstipation,
      riskLevel: "low",
      reason: "constipation + low hydration today",
    });
  }

  // 4. Nausea + low food intake
  if (
    t.nausea &&
    t.nausea !== "none" &&
    (t.foodIntake === "low" || t.foodIntake === "very_low")
  ) {
    triggers.push({
      type: "nausea",
      symptomType: "nausea",
      severity: sevNausea,
      riskLevel: "moderate",
      reason: "nausea + low food intake today",
    });
  }

  // 5. Nausea after dose timing
  if (
    t.nausea &&
    t.nausea !== "none" &&
    ctx.treatment.daysSinceLastDose != null &&
    ctx.treatment.daysSinceLastDose <= 3
  ) {
    triggers.push({
      type: "nausea",
      symptomType: "nausea",
      severity: sevNausea,
      riskLevel: "low",
      reason: "nausea within 3 days of last dose",
    });
  }

  // 6. Low energy + poor sleep
  if (
    (t.energy === "depleted" || t.energy === "tired") &&
    t.sleepHours != null &&
    t.sleepHours < 6
  ) {
    triggers.push({
      type: "low_energy",
      symptomType: "low_energy",
      severity: sevLowEnergy,
      riskLevel: "low",
      reason: "low energy + sleep below baseline",
    });
  }

  // 7. Low hydration (2+ days)
  if (w.lowHydrationDays >= 2) {
    triggers.push({
      type: "low_hydration",
      symptomType: "low_hydration",
      severity: null,
      riskLevel: "low",
      reason: `low hydration ${w.lowHydrationDays} of last 7 days`,
    });
  }

  // 8. Rapid weight change (>3 lbs drop in ~7 days)
  if (w.weightChangeLbs != null && w.weightChangeLbs <= -3) {
    triggers.push({
      type: "rapid_weight_change",
      symptomType: null,
      severity: null,
      riskLevel: "elevated",
      reason: `weight down ${Math.abs(w.weightChangeLbs)} lbs in ~7 days`,
    });
  }

  // 9. Worsening symptom
  if (w.severityTrend === "worsening") {
    triggers.push({
      type: "worsening_symptom",
      symptomType: t.symptoms[0] ?? null,
      severity: t.severity,
      riskLevel: "moderate",
      reason: "severity higher than recent average",
    });
  }

  // 10. Missed check-ins (2+ days)
  if (w.missedCheckins >= 2) {
    triggers.push({
      type: "missed_checkin",
      symptomType: null,
      severity: null,
      riskLevel: "low",
      reason: `${w.missedCheckins} missed check-ins in last 7 days`,
    });
  }

  // Note: trigger 11 (patient_requested_review) is NOT auto-detected
  // here. It only fires via the explicit /escalate endpoint or when
  // the route caller passes triggerType: "patient_requested_review".

  // Catch-alls so we always have SOMETHING to surface when a check-in
  // includes a symptom but none of the more-specific rules fired.
  if (
    triggers.length === 0 &&
    t.digestion === "constipated"
  ) {
    triggers.push({
      type: "constipation",
      symptomType: "constipation",
      severity: sevConstipation,
      riskLevel: "low",
      reason: "constipation reported today",
    });
  }
  if (
    triggers.length === 0 &&
    t.nausea &&
    t.nausea !== "none"
  ) {
    triggers.push({
      type: "nausea",
      symptomType: "nausea",
      severity: sevNausea,
      riskLevel: "low",
      reason: "nausea reported today",
    });
  }
  if (
    triggers.length === 0 &&
    (t.energy === "depleted" || t.energy === "tired")
  ) {
    triggers.push({
      type: "low_energy",
      symptomType: "low_energy",
      severity: sevLowEnergy,
      riskLevel: "low",
      reason: "low energy reported today",
    });
  }

  return triggers;
}

// Pick the single most-relevant trigger from the detected list,
// honoring spec rules:
//   * elevated > moderate > low
//   * skip triggers we already have an active intervention for
//     (de-dupe -- spec Part 4 "Avoid duplicate spam")
//   * EXCEPTION: when the patient's NEW severity for the same
//     trigger type strictly exceeds the active row's severity
//     (e.g. nausea moderate -> severe), allow regeneration so the
//     visible card reflects the escalation. The orchestrator /
//     route handler is responsible for dismissing the superseded
//     row before inserting the new one.
export function pickBestTrigger(
  detected: DetectedTrigger[],
  active: ReadonlyArray<{
    type: PatientInterventionTriggerType;
    severity: number | null;
  }>,
): DetectedTrigger | null {
  const filtered = detected.filter((t) => {
    const existing = active.find((a) => a.type === t.type);
    if (!existing) return true;
    const newSev = t.severity ?? 0;
    const oldSev = existing.severity ?? 0;
    return newSev > oldSev;
  });
  if (filtered.length === 0) return null;
  // Sort: highest priority first; on tie keep input order.
  const sorted = [...filtered].sort(
    (a, b) => RISK_PRIORITY[b.riskLevel] - RISK_PRIORITY[a.riskLevel],
  );
  return sorted[0] ?? null;
}
