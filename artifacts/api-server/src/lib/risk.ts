import type { PatientCheckin } from "@workspace/db";

/**
 * Lightweight rules-based churn-risk scoring. No persisted scores --
 * computed on demand from the patient's recent check-ins. Each rule
 * contributes a fixed weight; the total is bucketed into low/medium/high.
 *
 * The rules are intentionally small and explainable: the doctor sees
 * exactly which signals fired, not a black-box number.
 */

export type RiskBand = "low" | "medium" | "high";

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
    weight: 30,
  },
  lowEnergy7d: {
    code: "low_energy_7d",
    label: "Low energy trend (7d)",
    weight: 20,
  },
  severeNausea3d: {
    code: "severe_nausea_3d",
    label: "Recent nausea spike",
    weight: 15,
  },
  moodDecline: {
    code: "mood_decline",
    label: "Mood trending down",
    weight: 10,
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
  if (!last || daysBetween(today, new Date(last.date)) >= 3) {
    fired.push(RULES.silence3d);
  }

  // Helper: filter to last N days inclusive
  const within = (n: number) =>
    sorted.filter((c) => daysBetween(today, new Date(c.date)) < n);

  // Rule 2: avg energy weak across last 7 days
  const last7 = within(7);
  if (last7.length >= 3) {
    const weakCount = last7.filter(
      (c) => c.energy === "depleted" || c.energy === "tired",
    ).length;
    if (weakCount / last7.length >= 0.5) {
      fired.push(RULES.lowEnergy7d);
    }
  }

  // Rule 3: severe nausea in last 3 days
  const last3 = within(3);
  if (last3.some((c) => c.nausea === "severe")) {
    fired.push(RULES.severeNausea3d);
  }

  // Rule 4: mood declining (avg of last 3 vs prior 4)
  const last7Sorted = last7.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (last7Sorted.length >= 6) {
    const prior = last7Sorted.slice(0, last7Sorted.length - 3);
    const recent = last7Sorted.slice(last7Sorted.length - 3);
    const avg = (xs: PatientCheckin[]) =>
      xs.reduce((s, c) => s + c.mood, 0) / xs.length;
    if (avg(recent) < avg(prior) - 0.5) {
      fired.push(RULES.moodDecline);
    }
  }

  const score = fired.reduce((s, r) => s + r.weight, 0);
  const band: RiskBand = score >= 51 ? "high" : score >= 26 ? "medium" : "low";

  return {
    score,
    band,
    rules: fired,
    asOf: today.toISOString().split("T")[0]!,
  };
}
