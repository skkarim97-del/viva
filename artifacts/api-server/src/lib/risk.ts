import type { PatientCheckin } from "@workspace/db";
import type { SymptomFlag } from "./symptoms";
import { symptomsRequireFollowup } from "./symptoms";
import {
  RISK_WEIGHT_SILENCE,
  RISK_WEIGHT_LOW_ENERGY,
  RISK_WEIGHT_SEVERE_NAUSEA,
  RISK_WEIGHT_MOOD_DECLINE,
  RISK_BAND_HIGH_THRESHOLD,
  RISK_BAND_MEDIUM_THRESHOLD,
  RISK_ACTION_FOLLOWUP_SCORE,
  RISK_ACTION_MONITOR_SCORE,
  RISK_SILENCE_FLAG_DAYS,
  RISK_SILENCE_CRITICAL_DAYS,
  RISK_ENERGY_WINDOW_DAYS,
  RISK_ENERGY_MIN_CHECKINS,
  RISK_ENERGY_WEAK_RATIO,
  RISK_NAUSEA_WINDOW_DAYS,
  RISK_MOOD_MIN_WINDOW,
  RISK_MOOD_DECLINE_DELTA,
} from "../shared/constants";

/**
 * Lightweight rules-based churn-risk scoring. No persisted scores --
 * computed on demand from the patient's recent check-ins. Each rule
 * contributes a fixed weight; the total is bucketed into low/medium/high.
 *
 * The rules are intentionally small and explainable: the doctor sees
 * exactly which signals fired, not a black-box number.
 */

export type RiskBand = "low" | "medium" | "high";

/**
 * Workflow state -- what the doctor should DO with this patient. Distinct
 * from the risk band so the cutoffs can be tuned independently. Doctors
 * scan this column first; the risk percentage is supporting context.
 */
export type Action = "needs_followup" | "monitor" | "stable";

export interface FiredRule {
  code: string;
  label: string;
  weight: number;
}

export interface RiskResult {
  score: number;
  band: RiskBand;
  rules: FiredRule[];
  asOf: string; // ISO date
}

// Doctors scan, they don't read paragraphs. Labels are short, scannable
// phrases that act like badges -- the full explanation lives in the rule
// code if we ever need to expand it back out.
const RULES = {
  silence3d: {
    code: "silence_3d",
    label: "No check-in (3+ days)",
    weight: RISK_WEIGHT_SILENCE,
  },
  lowEnergy7d: {
    code: "low_energy_7d",
    label: "Low energy trend (7d)",
    weight: RISK_WEIGHT_LOW_ENERGY,
  },
  severeNausea3d: {
    code: "severe_nausea_3d",
    label: "Recent nausea spike",
    weight: RISK_WEIGHT_SEVERE_NAUSEA,
  },
  moodDecline: {
    code: "mood_decline",
    label: "Mood trending down",
    weight: RISK_WEIGHT_MOOD_DECLINE,
  },
} as const;

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function computeRisk(
  checkins: PatientCheckin[],
  now: Date = new Date(),
): RiskResult {
  const sorted = [...checkins].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const today = new Date(now.toISOString().split("T")[0]!);
  const fired: FiredRule[] = [];

  // Rule 1: silence > 3 days
  const last = sorted[sorted.length - 1];
  if (!last || daysBetween(today, new Date(last.date)) >= RISK_SILENCE_FLAG_DAYS) {
    fired.push(RULES.silence3d);
  }

  // Helper: filter to last N days inclusive
  const within = (n: number) =>
    sorted.filter((c) => daysBetween(today, new Date(c.date)) < n);

  // Rule 2: avg energy weak across last 7 days
  const last7 = within(RISK_ENERGY_WINDOW_DAYS);
  if (last7.length >= RISK_ENERGY_MIN_CHECKINS) {
    const weakCount = last7.filter(
      (c) => c.energy === "depleted" || c.energy === "tired",
    ).length;
    if (weakCount / last7.length >= RISK_ENERGY_WEAK_RATIO) {
      fired.push(RULES.lowEnergy7d);
    }
  }

  // Rule 3: severe nausea in last 3 days
  const last3 = within(RISK_NAUSEA_WINDOW_DAYS);
  if (last3.some((c) => c.nausea === "severe")) {
    fired.push(RULES.severeNausea3d);
  }

  // Rule 4: mood declining (avg of last 3 vs prior 4)
  const last7Sorted = last7.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (last7Sorted.length >= RISK_MOOD_MIN_WINDOW) {
    const prior = last7Sorted.slice(0, last7Sorted.length - 3);
    const recent = last7Sorted.slice(last7Sorted.length - 3);
    const avg = (xs: PatientCheckin[]) =>
      xs.reduce((s, c) => s + c.mood, 0) / xs.length;
    if (avg(recent) < avg(prior) - RISK_MOOD_DECLINE_DELTA) {
      fired.push(RULES.moodDecline);
    }
  }

  const score = fired.reduce((s, r) => s + r.weight, 0);
  const band: RiskBand = score >= RISK_BAND_HIGH_THRESHOLD ? "high" : score >= RISK_BAND_MEDIUM_THRESHOLD ? "medium" : "low";

  return {
    score,
    band,
    rules: fired,
    asOf: today.toISOString().split("T")[0]!,
  };
}

/**
 * Map the score + signals to a workflow state. Hard escalation triggers
 * (silence >= 5d or a recent severe-nausea spike) override the score
 * threshold so a doctor never misses a critical case because the number
 * happened to land at 49.
 */
export function deriveAction(
  score: number,
  rules: FiredRule[],
  lastCheckin: string | null,
  now: Date = new Date(),
  // Optional so existing call sites that haven't yet computed symptom
  // flags continue to compile. When provided, ANY flag with
  // suggestFollowup=true escalates the workflow state regardless of
  // the churn score -- the symptom layer is its own escalation channel.
  symptomFlags: SymptomFlag[] = [],
): Action {
  const days = lastCheckin
    ? daysBetween(now, new Date(lastCheckin))
    : Number.POSITIVE_INFINITY;
  const hasSevereNausea = rules.some((r) => r.code === "severe_nausea_3d");
  if (
    score >= RISK_ACTION_FOLLOWUP_SCORE ||
    days >= RISK_SILENCE_CRITICAL_DAYS ||
    hasSevereNausea ||
    symptomsRequireFollowup(symptomFlags)
  ) {
    return "needs_followup";
  }
  if (score >= RISK_ACTION_MONITOR_SCORE) return "monitor";
  return "stable";
}

/**
 * Translate the highest-priority fired rule into a one-line directive
 * the doctor can act on. Mirrors deriveTopSignal but speaks in verbs
 * instead of describing the signal.
 */
/**
 * Up to two short, scannable signal labels for the patient list view.
 * The first slot follows the same logic as the detail page (silence
 * customised to show the actual gap), the second slot adds the next
 * fired rule so two patients with identical primary signals don't read
 * as visually identical.
 */
export function deriveSignals(
  rules: FiredRule[],
  lastCheckin: string | null,
  now: Date = new Date(),
): string[] {
  if (rules.length === 0) return [];
  const out: string[] = [];
  const first = rules[0]!;
  if (first.code === "silence_3d") {
    if (lastCheckin) {
      const days = daysBetween(now, new Date(lastCheckin));
      out.push(`No check-in for ${days}d`);
    } else {
      out.push("Never checked in");
    }
  } else {
    out.push(first.label);
  }
  const second = rules.find((r) => r.code !== first.code);
  if (second) out.push(second.label);
  return out;
}

export function deriveSuggestedAction(
  rules: FiredRule[],
  lastCheckin: string | null,
  now: Date = new Date(),
): string | null {
  if (rules.length === 0) return null;
  const codes = new Set(rules.map((r) => r.code));
  // Order matters: silence and severe nausea are the urgent ones.
  if (codes.has("silence_3d")) {
    const days = lastCheckin
      ? daysBetween(now, new Date(lastCheckin))
      : null;
    if (days !== null && days >= RISK_SILENCE_CRITICAL_DAYS) {
      return `Call patient: no check-in in ${days} days`;
    }
    return "Follow up on missed check-ins";
  }
  if (codes.has("severe_nausea_3d")) {
    return "Check in about side effects";
  }
  if (codes.has("low_energy_7d")) {
    return "Discuss energy and dosing";
  }
  if (codes.has("mood_decline")) {
    return "Wellness check-in";
  }
  return null;
}
