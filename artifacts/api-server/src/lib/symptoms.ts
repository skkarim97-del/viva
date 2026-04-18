import type { PatientCheckin } from "@workspace/db";

/**
 * Rules-based symptom-management layer for Viva.
 *
 * Scope (intentionally narrow for MVP -- per spec):
 *   * nausea
 *   * constipation
 *   * low appetite
 *
 * For each tracked symptom, this module:
 *   1. Decides whether the symptom is "active" right now (mild, moderate,
 *      severe).
 *   2. Decides whether it is transient, persistent, or worsening.
 *   3. Identifies likely behavioral contributors from the same window.
 *   4. Decides whether the case warrants doctor escalation.
 *
 * Important guardrails the doctor product depends on:
 *   * Absent fields are "unknown", never assumed "no" or "low". A patient
 *     who didn't fill in `bowelMovement` does NOT get a constipation flag
 *     just from missing data.
 *   * The output is small and explainable. The dashboard renders the
 *     contributors verbatim, so labels here are user-facing prose.
 *   * `suggestFollowup` is the ONLY signal that promotes a patient to
 *     "needs_followup". Severity alone does not -- transient mild nausea
 *     on day 1 of GLP-1 is normal and does not need a doctor call.
 */

export type Symptom = "nausea" | "constipation" | "low_appetite";
export type Persistence = "transient" | "persistent" | "worsening";
export type SymptomSeverity = "mild" | "moderate" | "severe";

export interface SymptomFlag {
  symptom: Symptom;
  severity: SymptomSeverity;
  persistence: Persistence;
  // Number of days within the lookback window that this symptom was
  // present. Lets the dashboard render "constipation 3 of last 5 days".
  daysObserved: number;
  windowDays: number;
  // Human-readable contributor labels (e.g. "Low hydration"). Empty
  // array if none could be inferred from the data.
  contributors: string[];
  // Whether the patient has acknowledged the in-app guidance card for
  // this symptom on the most recent check-in. The dashboard uses this
  // to show "Patient has seen self-management guidance" beside the flag.
  guidanceShown: boolean;
  // True when the case meets escalation criteria. Caller (deriveAction)
  // bumps the workflow state to "needs_followup".
  suggestFollowup: boolean;
}

interface ComputeOpts {
  // Server timestamp used for "today". Injectable for tests.
  now?: Date;
}

function ymd(d: Date): string {
  // Server-local YYYY-MM-DD, matching how patient_checkins.date is
  // stored. Using toISOString here would shift around 00:00 UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(today: Date, n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return ymd(d);
}

// Index check-ins by date for fast lookup and ensure each window
// iteration only sees the most recent row for a given day. The unique
// index on (patient_user_id, date) makes duplicates impossible at the
// DB level, but defending against duplicates here keeps the function
// pure and testable.
function indexByDate(checkins: PatientCheckin[]): Map<string, PatientCheckin> {
  const m = new Map<string, PatientCheckin>();
  for (const c of checkins) {
    const existing = m.get(c.date);
    if (!existing || c.id > existing.id) m.set(c.date, c);
  }
  return m;
}

// Returns the rows for the last `windowDays` days, OLDEST first. Days
// the patient skipped are simply missing from the array -- callers
// should NOT treat a missing day as a "no symptom" day.
function windowRows(
  byDate: Map<string, PatientCheckin>,
  today: Date,
  windowDays: number,
): PatientCheckin[] {
  const out: PatientCheckin[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = daysAgo(today, i);
    const row = byDate.get(d);
    if (row) out.push(row);
  }
  return out;
}

const NAUSEA_SEVERITY: Record<string, number> = {
  none: 0,
  mild: 1,
  moderate: 2,
  severe: 3,
};

function severityFromNumber(n: number): SymptomSeverity {
  if (n >= 3) return "severe";
  if (n >= 2) return "moderate";
  return "mild";
}

// Identify likely behavioral contributors for nausea on the rows where
// nausea was actually present. Looking only at symptomatic days avoids
// labeling "low hydration on a nausea-free day" as a contributor.
function nauseaContributors(rows: PatientCheckin[]): string[] {
  const symptomatic = rows.filter(
    (r) => r.nausea && r.nausea !== "none",
  );
  const contributors: string[] = [];
  if (
    symptomatic.some(
      (r) => r.hydration === "low" || r.hydration === "dehydrated",
    )
  ) {
    contributors.push("Low hydration on symptomatic days");
  }
  if (symptomatic.some((r) => r.doseTakenToday === true)) {
    contributors.push("Reported on dose day");
  }
  if (symptomatic.some((r) => r.appetite === "very_low")) {
    contributors.push("Very low appetite (long fasting window likely)");
  }
  return contributors;
}

function constipationContributors(rows: PatientCheckin[]): string[] {
  const contributors: string[] = [];
  if (
    rows.some(
      (r) => r.hydration === "low" || r.hydration === "dehydrated",
    )
  ) {
    contributors.push("Low hydration");
  }
  // Energy is the closest proxy we have for movement today. "depleted"
  // or "tired" on the majority of days strongly implies low activity.
  const lowEnergyDays = rows.filter(
    (r) => r.energy === "depleted" || r.energy === "tired",
  ).length;
  if (rows.length >= 3 && lowEnergyDays / rows.length >= 0.5) {
    contributors.push("Low movement (energy depleted/tired most days)");
  }
  return contributors;
}

function lowAppetiteContributors(rows: PatientCheckin[]): string[] {
  const contributors: string[] = [];
  const symptomatic = rows.filter(
    (r) => r.appetite === "low" || r.appetite === "very_low",
  );
  if (symptomatic.some((r) => r.nausea && r.nausea !== "none")) {
    contributors.push("Co-occurring nausea");
  }
  if (
    symptomatic.some(
      (r) => r.hydration === "low" || r.hydration === "dehydrated",
    )
  ) {
    contributors.push("Low hydration");
  }
  return contributors;
}

// Compare today's nausea severity to the prior 3 days to decide
// whether we're trending up. "Worsening" is what convinces a clinician
// to actually call -- a flat-but-persistent symptom is much less urgent
// than one that just escalated.
function isWorsening(
  rows: PatientCheckin[],
  pick: (r: PatientCheckin) => number,
): boolean {
  if (rows.length < 2) return false;
  const today = rows[rows.length - 1]!;
  const prior = rows.slice(0, -1);
  if (prior.length === 0) return false;
  const todayVal = pick(today);
  const priorAvg = prior.reduce((s, r) => s + pick(r), 0) / prior.length;
  // +1 step (e.g. mild -> moderate) clears the bar for "worsening".
  return todayVal >= priorAvg + 1 && todayVal >= 2;
}

function nauseaFlag(
  rows: PatientCheckin[],
  ack: PatientCheckin | undefined,
): SymptomFlag | null {
  if (rows.length === 0) return null;
  const symptomatic = rows.filter(
    (r) => r.nausea && r.nausea !== "none",
  );
  if (symptomatic.length === 0) return null;
  const maxSev = Math.max(
    ...symptomatic.map((r) => NAUSEA_SEVERITY[r.nausea] ?? 0),
  );
  const severity = severityFromNumber(maxSev);
  const worsening = isWorsening(rows, (r) =>
    NAUSEA_SEVERITY[r.nausea] ?? 0,
  );
  let persistence: Persistence;
  if (worsening) persistence = "worsening";
  else if (symptomatic.length >= 2) persistence = "persistent";
  else persistence = "transient";

  // Escalation gate per spec: severe, persistent across multiple days,
  // worsening, or occurring on a dose day.
  const onDoseDay = symptomatic.some((r) => r.doseTakenToday === true);
  const suggestFollowup =
    severity === "severe" ||
    persistence === "worsening" ||
    (persistence === "persistent" && symptomatic.length >= 3) ||
    (onDoseDay && symptomatic.length >= 2);

  return {
    symptom: "nausea",
    severity,
    persistence,
    daysObserved: symptomatic.length,
    windowDays: rows.length,
    contributors: nauseaContributors(rows),
    guidanceShown: !!ack?.guidanceShown?.nausea,
    suggestFollowup,
  };
}

function constipationFlag(
  rows: PatientCheckin[],
  ack: PatientCheckin | undefined,
): SymptomFlag | null {
  if (rows.length === 0) return null;
  // Two ways the patient signals constipation:
  //   (a) digestion === "constipated" (subjective)
  //   (b) bowelMovement === false multiple days in a row (objective)
  // We only count (b) as a true streak when we have AT LEAST 3
  // consecutive false answers. This avoids flagging a single "no"
  // (which is medically normal day-to-day variation).
  const subjectiveDays = rows.filter((r) => r.digestion === "constipated");
  const noBmAnswers = rows.filter((r) => r.bowelMovement === false);
  let bmStreak = 0;
  let maxBmStreak = 0;
  for (const r of rows) {
    if (r.bowelMovement === false) {
      bmStreak += 1;
      if (bmStreak > maxBmStreak) maxBmStreak = bmStreak;
    } else if (r.bowelMovement === true) {
      bmStreak = 0;
    }
    // bowelMovement == null doesn't reset OR extend the streak.
  }

  const objectiveActive = maxBmStreak >= 3;
  const subjectiveActive = subjectiveDays.length >= 1;
  if (!objectiveActive && !subjectiveActive) return null;

  const daysObserved = Math.max(subjectiveDays.length, noBmAnswers.length);
  // Severity: any objective ≥3-day streak is moderate; ≥5-day streak is
  // severe. Subjective alone tops out at moderate without escalation.
  let severity: SymptomSeverity = "mild";
  if (maxBmStreak >= 5) severity = "severe";
  else if (objectiveActive) severity = "moderate";
  else if (subjectiveDays.length >= 3) severity = "moderate";

  const persistence: Persistence =
    daysObserved >= 3 || maxBmStreak >= 3 ? "persistent" : "transient";

  const suggestFollowup =
    severity === "severe" ||
    (persistence === "persistent" && daysObserved >= 4);

  return {
    symptom: "constipation",
    severity,
    persistence,
    daysObserved,
    windowDays: rows.length,
    contributors: constipationContributors(rows),
    guidanceShown: !!ack?.guidanceShown?.constipation,
    suggestFollowup,
  };
}

function lowAppetiteFlag(
  rows: PatientCheckin[],
  ack: PatientCheckin | undefined,
): SymptomFlag | null {
  if (rows.length === 0) return null;
  const symptomatic = rows.filter(
    (r) => r.appetite === "low" || r.appetite === "very_low",
  );
  if (symptomatic.length === 0) return null;
  const veryLowDays = symptomatic.filter(
    (r) => r.appetite === "very_low",
  ).length;
  const severity: SymptomSeverity =
    veryLowDays >= 3 ? "severe" : veryLowDays >= 1 ? "moderate" : "mild";

  // For appetite, "worsening" means more very_low days recently than
  // earlier in the window. Cheap proxy: today's value is "very_low" AND
  // the prior 2 days were not.
  const today = rows[rows.length - 1]!;
  const prior2 = rows.slice(-3, -1);
  const worsening =
    today.appetite === "very_low" &&
    prior2.every((r) => r.appetite !== "very_low");

  let persistence: Persistence;
  if (worsening) persistence = "worsening";
  else if (symptomatic.length >= 3) persistence = "persistent";
  else persistence = "transient";

  const suggestFollowup =
    severity === "severe" ||
    persistence === "worsening" ||
    (persistence === "persistent" && symptomatic.length >= 4);

  return {
    symptom: "low_appetite",
    severity,
    persistence,
    daysObserved: symptomatic.length,
    windowDays: rows.length,
    contributors: lowAppetiteContributors(rows),
    guidanceShown: !!ack?.guidanceShown?.low_appetite,
    suggestFollowup,
  };
}

/**
 * Compute the active symptom flags for one patient.
 *
 * Each symptom uses its own sensible lookback window:
 *   * nausea         -> last 3 days (acute, dose-correlated)
 *   * constipation   -> last 5 days (slower-moving, needs streak)
 *   * low appetite   -> last 5 days (multi-day pattern matters more
 *                                    than a single skipped meal)
 */
export function computeSymptomFlags(
  checkins: PatientCheckin[],
  opts: ComputeOpts = {},
): SymptomFlag[] {
  const today = opts.now ?? new Date();
  const byDate = indexByDate(checkins);
  // Most recent row across any symptom window -- used to read the
  // patient's latest guidance acknowledgment.
  const todayRow = byDate.get(ymd(today));
  const yesterdayRow = byDate.get(daysAgo(today, 1));
  const ack = todayRow ?? yesterdayRow;

  const out: SymptomFlag[] = [];
  const f1 = nauseaFlag(windowRows(byDate, today, 3), ack);
  const f2 = constipationFlag(windowRows(byDate, today, 5), ack);
  const f3 = lowAppetiteFlag(windowRows(byDate, today, 5), ack);
  if (f1) out.push(f1);
  if (f2) out.push(f2);
  if (f3) out.push(f3);
  // Order by escalation first, then severity, so the dashboard renders
  // the most actionable flag at the top.
  const sevRank: Record<SymptomSeverity, number> = {
    mild: 0,
    moderate: 1,
    severe: 2,
  };
  out.sort((a, b) => {
    if (a.suggestFollowup !== b.suggestFollowup) {
      return a.suggestFollowup ? -1 : 1;
    }
    return sevRank[b.severity] - sevRank[a.severity];
  });
  return out;
}

// True when the active flags justify promoting the patient to
// needs_followup. Used by deriveAction in lib/risk.
export function symptomsRequireFollowup(flags: SymptomFlag[]): boolean {
  return flags.some((f) => f.suggestFollowup);
}

// One short doctor-facing line summarizing the most urgent flag, used
// in the patient list view ("Severe nausea persistent 3d"). Returns
// null when there are no escalating flags.
export function summarizeFlagForList(flags: SymptomFlag[]): string | null {
  const top = flags.find((f) => f.suggestFollowup) ?? flags[0];
  if (!top) return null;
  const sym =
    top.symptom === "low_appetite"
      ? "Low appetite"
      : top.symptom === "constipation"
        ? "Constipation"
        : "Nausea";
  if (top.persistence === "worsening") return `${sym} worsening`;
  if (top.severity === "severe") return `Severe ${sym.toLowerCase()}`;
  if (top.persistence === "persistent") {
    return `${sym} persistent ${top.daysObserved}d`;
  }
  return sym;
}
