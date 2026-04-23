import type { PatientRow } from "@/lib/api";

// ----------------------------------------------------------------------
// Row-level intelligence for the dashboard worklist.
//
// Mirrors the logic on the patient detail page (issue type, priority,
// summary, next action) but operates on the leaner PatientRow payload
// returned by GET /patients. Engagement vs clinical separation is the
// same: silence alone is engagement, not clinical deterioration.
//
// Inputs we get for free on the row:
//   - signals[]            (rendered already; first one often "No
//                           check-in for Xd" or a rule label)
//   - lastCheckin          (ISO date or null)
//   - action               (needs_followup / monitor / stable / pending)
//   - riskBand             (low / medium / high)
//   - treatmentStatus?     (active / stopped / unknown)
//   - symptomFlagCount?    (number of active symptom flags)
//   - symptomEscalating?   (any flag suggests follow-up)
//   - symptomSummary?      (short label like "Severe nausea")
//   - inactive12d?         (silence >= 12 days)
//
// Inputs passed in from the page:
//   - needsReview          (open escalation_requested w/o doctor_reviewed)
// ----------------------------------------------------------------------

export type IssueType = "engagement" | "clinical" | "combined" | "stable";
export type RowPriority =
  | "review_now"
  | "follow_up_today"
  | "monitor"
  | "stable";

export interface RowIntelligence {
  issueType: IssueType;
  priority: RowPriority;
  summary: string;
  nextAction: string;
  silentDays: number | null;
}

export const ISSUE_LABEL: Record<IssueType, string> = {
  engagement: "Engagement",
  clinical: "Clinical",
  combined: "Combined",
  stable: "Stable",
};

export const ISSUE_STYLE: Record<IssueType, { bg: string; fg: string }> = {
  engagement: { bg: "rgba(255,149,0,0.10)", fg: "#9A5B00" },
  clinical: { bg: "rgba(255,59,48,0.10)", fg: "#B5251D" },
  combined: { bg: "rgba(20,34,64,0.08)", fg: "#142240" },
  stable: { bg: "rgba(30,142,62,0.10)", fg: "#1E8E3E" },
};

export const PRIORITY_LABEL: Record<RowPriority, string> = {
  review_now: "Review now",
  follow_up_today: "Follow up today",
  monitor: "Monitor",
  stable: "Stable",
};

export const RISK_BAND_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Moderate",
  high: "Elevated",
};

export const RISK_BAND_DOT: Record<"low" | "medium" | "high", string> = {
  low: "#1E8E3E",
  medium: "#B8650A",
  high: "#B5251D",
};

// Sort key: lower number sorts first. Combined > Clinical > Engagement
// > Stable matches the worklist priority preference in the spec.
export const ISSUE_SORT: Record<IssueType, number> = {
  combined: 0,
  clinical: 1,
  engagement: 2,
  stable: 3,
};

export const PRIORITY_SORT: Record<RowPriority, number> = {
  review_now: 0,
  follow_up_today: 1,
  monitor: 2,
  stable: 3,
};

function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / (1000 * 60 * 60 * 24)));
}

export function rowIntelligence(
  p: PatientRow,
  needsReview: boolean,
  now: Date = new Date(),
): RowIntelligence {
  // Pending rows have nothing to score yet; the dashboard already
  // routes them into a separate "Pending activation" bucket.
  if (p.pending) {
    return {
      issueType: "stable",
      priority: "stable",
      summary: "Awaiting account activation.",
      nextAction: "Resend invite if needed.",
      silentDays: null,
    };
  }

  const silent = daysSince(p.lastCheckin, now);

  // ---- Signal classification -------------------------------------
  const hasEngagementSignal =
    needsReview ||
    !p.lastCheckin ||
    (silent !== null && silent >= 3) ||
    !!p.inactive12d;

  const hasClinicalSignal =
    (p.symptomFlagCount ?? 0) > 0 ||
    !!p.symptomEscalating ||
    p.treatmentStatus === "stopped" ||
    p.riskBand === "high";

  let issueType: IssueType = "stable";
  if (hasEngagementSignal && hasClinicalSignal) issueType = "combined";
  else if (hasClinicalSignal) issueType = "clinical";
  else if (hasEngagementSignal) issueType = "engagement";

  // ---- Priority --------------------------------------------------
  // Mirrors the detail page: silence alone never reaches Review now.
  let priority: RowPriority = "stable";
  if (needsReview) {
    priority = "review_now";
  } else if (issueType === "combined" && p.symptomEscalating) {
    priority = "review_now";
  } else if (p.symptomEscalating) {
    priority = "follow_up_today";
  } else if (p.action === "needs_followup") {
    priority = "follow_up_today";
  } else if (silent !== null && silent >= 7) {
    priority = "follow_up_today";
  } else if (
    (silent !== null && silent >= 3) ||
    (p.symptomFlagCount ?? 0) > 0 ||
    p.treatmentStatus === "stopped" ||
    p.action === "monitor" ||
    p.riskBand === "medium" ||
    !p.lastCheckin ||
    p.inactive12d
  ) {
    priority = "monitor";
  }

  // ---- Summary + next action -------------------------------------
  // Short, single-line. The detail page has more room for nuance;
  // here we stay tight so the worklist scans quickly.
  let summary = "Stable, no immediate follow-up needed.";
  let nextAction = "Monitor";
  const symptom = p.symptomSummary ? p.symptomSummary.toLowerCase() : null;

  if (issueType === "combined") {
    if (symptom && silent !== null && silent >= 3) {
      summary = `Reported ${symptom}, then stopped checking in ${silent}d ago.`;
    } else if (symptom && needsReview) {
      summary = `Flagged ${symptom} and requested clinician review.`;
    } else if (symptom) {
      summary = `${capitalize(symptom)} alongside declining engagement.`;
    } else {
      summary = "Treatment concern paired with engagement drop.";
    }
    nextAction = "Call today";
  } else if (issueType === "clinical") {
    if (p.symptomEscalating && symptom) {
      summary = `${capitalize(symptom)} may need treatment support.`;
      nextAction = "Review symptoms";
    } else if (symptom) {
      summary = `${capitalize(symptom)} active in recent check-ins.`;
      nextAction = "Review symptoms";
    } else if (p.treatmentStatus === "stopped") {
      summary = "Treatment stopped. Confirm clinical context.";
      nextAction = "Confirm next step";
    } else {
      summary = "Clinical signals warrant a closer look.";
      nextAction = "Review symptoms";
    }
  } else if (issueType === "engagement") {
    if (needsReview) {
      summary = "Patient requested clinician review.";
      nextAction = "Acknowledge & call";
    } else if (silent !== null && silent >= 10) {
      summary = `May be disengaging after ${silent} days without check-in.`;
      nextAction = "Call today";
    } else if (silent !== null && silent >= 7) {
      summary = `No check-in for ${silent} days. Engagement slipping.`;
      nextAction = "Call today";
    } else if (silent !== null && silent >= 3) {
      summary = `Engagement slowing. Last check-in ${silent}d ago.`;
      nextAction = "Send nudge";
    } else if (!p.lastCheckin) {
      summary = "No check-ins logged yet. Confirm onboarding.";
      nextAction = "Send nudge";
    } else if (p.inactive12d) {
      summary = "Inactive for 12+ days. Possible disengagement.";
      nextAction = "Call today";
    } else {
      summary = "Follow-up pending with this patient.";
      nextAction = "Log follow-up";
    }
  }

  return { issueType, priority, summary, nextAction, silentDays: silent };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
