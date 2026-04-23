import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { logEvent as logAnalytics } from "@/lib/analytics";
import {
  api,
  type CareEvent,
  type Checkin,
  type PatientDetail,
  type PatientWeightSummary,
  type Risk,
  type StopReason,
  type StopTimingBucket,
  type SymptomFlag,
  type TreatmentStatus,
} from "@/lib/api";
import { relativeTime, daysSince } from "@/lib/relativeTime";

const SYMPTOM_LABEL: Record<SymptomFlag["symptom"], string> = {
  nausea: "Nausea",
  constipation: "Constipation",
  low_appetite: "Low appetite",
};
const SEVERITY_LABEL: Record<SymptomFlag["severity"], string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};
const PERSISTENCE_LABEL: Record<SymptomFlag["persistence"], string> = {
  transient: "Transient",
  persistent: "Persistent",
  worsening: "Worsening",
};
// Severity drives the chip color so the most actionable flag pops
// visually without us also having to add an icon legend.
const SEVERITY_STYLE: Record<
  SymptomFlag["severity"],
  { bg: string; fg: string }
> = {
  mild: { bg: "rgba(56,182,255,0.10)", fg: "#0B6FAA" },
  moderate: { bg: "rgba(255,149,0,0.12)", fg: "#B8650A" },
  severe: { bg: "rgba(255,59,48,0.12)", fg: "#B5251D" },
};

const ENERGY_LABEL: Record<Checkin["energy"], string> = {
  depleted: "Depleted",
  tired: "Tired",
  good: "Good",
  great: "Great",
};
const NAUSEA_LABEL: Record<Checkin["nausea"], string> = {
  none: "None",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

function fmtDate(d: string): string {
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[18px] font-semibold text-foreground mb-4">
      {children}
    </h2>
  );
}

// ----------------------------------------------------------------------
// Patient summary intelligence layer.
//
// Synthesizes the existing rule-based signals (risk, care events,
// check-in recency, symptom flags, treatment status) into a single
// clinician-facing reading: action priority, plain-English summary,
// recommended next action, and 2-4 reason pills explaining why this
// patient is being surfaced.
//
// Design intent: this is interpretation, not new model. Everything
// here is derived from values already on the page; we just promote
// them to the top so the doctor doesn't have to reconstruct the
// story themselves.
// ----------------------------------------------------------------------

type ActionPriority = "review_now" | "follow_up_today" | "monitor" | "stable";

// Issue type separates *engagement* (the patient is going dark) from
// *clinical* (the patient is reporting real symptom or treatment
// concerns) so the doctor can read the situation correctly. Silence
// alone is engagement, not clinical deterioration.
type IssueType = "engagement" | "clinical" | "combined" | "stable";

const ISSUE_LABEL: Record<IssueType, string> = {
  engagement: "Engagement",
  clinical: "Clinical",
  combined: "Combined",
  stable: "Stable",
};

const ISSUE_STYLE: Record<IssueType, { bg: string; fg: string }> = {
  engagement: { bg: "rgba(255,149,0,0.10)", fg: "#9A5B00" },
  clinical: { bg: "rgba(255,59,48,0.10)", fg: "#B5251D" },
  combined: { bg: "rgba(20,34,64,0.08)", fg: "#142240" },
  stable: { bg: "rgba(30,142,62,0.10)", fg: "#1E8E3E" },
};

const PRIORITY_LABEL: Record<ActionPriority, string> = {
  review_now: "Review Now",
  follow_up_today: "Follow Up Today",
  monitor: "Monitor",
  stable: "Stable",
};

const PRIORITY_STYLE: Record<
  ActionPriority,
  { bg: string; fg: string; dot: string }
> = {
  review_now: {
    bg: "rgba(255,59,48,0.12)",
    fg: "#B5251D",
    dot: "#FF3B30",
  },
  follow_up_today: {
    bg: "rgba(255,149,0,0.14)",
    fg: "#9A5B00",
    dot: "#FF9500",
  },
  monitor: {
    bg: "rgba(56,182,255,0.14)",
    fg: "#0B6FAA",
    dot: "#38B6FF",
  },
  stable: {
    bg: "rgba(30,142,62,0.12)",
    fg: "#1E8E3E",
    dot: "#34C759",
  },
};

interface IntelligenceInputs {
  treatmentStatus: TreatmentStatus;
  silentDays: number | null;
  hasAnyCheckin: boolean;
  riskBand?: "low" | "medium" | "high";
  riskAction?: "needs_followup" | "monitor" | "stable" | "pending";
  symptomFlags: SymptomFlag[];
  escalationOpen: boolean;
  followUpPending: boolean;
  lastEscalationAt: string | null;
  recentLowMood: boolean;
  recentNegativeTrend: boolean;
}

interface Intelligence {
  issueType: IssueType;
  priority: ActionPriority;
  summary: string;
  nextAction: string;
  reasons: string[];
}

function computeIntelligence(i: IntelligenceInputs): Intelligence {
  // ---- Signal classification --------------------------------------
  // Engagement signals: the patient is going quiet, not necessarily
  // declining clinically. Escalation alone is engagement (the patient
  // is asking for contact); only when paired with a real symptom flag
  // does it become "combined".
  const hasEngagementSignal =
    i.escalationOpen ||
    i.followUpPending ||
    (i.silentDays !== null && i.silentDays >= 3) ||
    !i.hasAnyCheckin;

  // Clinical signals: real symptom / treatment-tolerance reports.
  // recentLowMood is included as a soft clinical signal because mood
  // <=2 is patient-reported deterioration, not absence of signal.
  const topFlag = [...i.symptomFlags].sort((a, b) => {
    const sevRank = { severe: 3, moderate: 2, mild: 1 } as const;
    const persRank = { worsening: 3, persistent: 2, transient: 1 } as const;
    const aScore = sevRank[a.severity] * 10 + persRank[a.persistence];
    const bScore = sevRank[b.severity] * 10 + persRank[b.persistence];
    return bScore - aScore;
  })[0];
  const hasClinicalSignal =
    !!topFlag ||
    i.recentLowMood ||
    i.treatmentStatus === "stopped" ||
    i.riskBand === "high";

  let issueType: IssueType = "stable";
  if (hasEngagementSignal && hasClinicalSignal) issueType = "combined";
  else if (hasClinicalSignal) issueType = "clinical";
  else if (hasEngagementSignal) issueType = "engagement";

  // ---- Reason pills ------------------------------------------------
  // Ordered by clinical priority. We surface the most actionable
  // engagement + clinical drivers first so a "combined" patient gets
  // a balanced read at a glance.
  const reasons: string[] = [];
  if (i.escalationOpen) reasons.push("Patient requested review");
  if (topFlag) {
    const symptomLabel = SYMPTOM_LABEL[topFlag.symptom];
    const persistenceWord =
      topFlag.persistence === "worsening"
        ? "worsening"
        : topFlag.persistence === "persistent"
          ? "persistent"
          : SEVERITY_LABEL[topFlag.severity].toLowerCase();
    reasons.push(`${symptomLabel} ${persistenceWord}`);
  }
  if (i.followUpPending) reasons.push("Follow-up pending");
  if (i.silentDays !== null && i.silentDays >= 3) {
    reasons.push(`No check-in ${i.silentDays} days`);
  } else if (!i.hasAnyCheckin) {
    reasons.push("No check-ins logged");
  }
  if (i.recentLowMood) reasons.push("Last check-in negative");
  if (i.treatmentStatus === "stopped") reasons.push("Treatment stopped");
  if (i.riskBand === "high") reasons.push("Treatment risk elevated");
  const trimmedReasons = reasons.slice(0, 4);

  // ---- Priority ----------------------------------------------------
  // Ladder. Silence alone never reaches "Review now"; only clinical
  // worsening or an explicit escalation can. Combined cases (silence
  // + worsening) get one notch stronger than either signal alone.
  let priority: ActionPriority = "stable";
  if (i.escalationOpen) {
    priority = "review_now";
  } else if (topFlag && topFlag.severity === "severe") {
    priority = issueType === "combined" ? "review_now" : "follow_up_today";
  } else if (
    issueType === "combined" &&
    topFlag &&
    topFlag.persistence === "worsening"
  ) {
    priority = "review_now";
  } else if (i.followUpPending) {
    priority = "follow_up_today";
  } else if (topFlag && topFlag.persistence === "worsening") {
    priority = "follow_up_today";
  } else if (i.silentDays !== null && i.silentDays >= 7) {
    priority = "follow_up_today";
  } else if (i.riskAction === "needs_followup") {
    priority = "follow_up_today";
  } else if (
    (i.silentDays !== null && i.silentDays >= 3) ||
    topFlag ||
    i.treatmentStatus === "stopped" ||
    i.riskAction === "monitor" ||
    i.riskBand === "medium" ||
    !i.hasAnyCheckin
  ) {
    priority = "monitor";
  }

  // ---- Summary + next action --------------------------------------
  // Copy is shaped by issueType so engagement reads as engagement
  // (disengagement, re-engage) and clinical reads as clinical
  // (treatment support, symptom review). Combined explicitly names
  // both halves so the doctor knows it isn't just one or the other.
  const symptomName = topFlag ? SYMPTOM_LABEL[topFlag.symptom].toLowerCase() : null;
  const symptomDir = topFlag
    ? topFlag.persistence === "worsening"
      ? "worsening"
      : topFlag.persistence === "persistent"
        ? "persistent"
        : SEVERITY_LABEL[topFlag.severity].toLowerCase()
    : null;

  let summary = "Patient appears stable with no immediate follow-up needed.";
  let nextAction = "Monitor only, no action needed today.";

  if (issueType === "combined") {
    if (topFlag && i.silentDays !== null && i.silentDays >= 3) {
      summary = `Patient reported ${symptomDir} ${symptomName} and then stopped checking in.`;
      nextAction = `Contact patient and review ${symptomName} severity together.`;
    } else if (topFlag && i.escalationOpen) {
      summary = `Patient flagged ${symptomDir} ${symptomName} and requested clinician review.`;
      nextAction = `Contact patient and address requested review of ${symptomName}.`;
    } else if (topFlag) {
      summary = `Recent ${symptomName} concerns are now paired with declining engagement.`;
      nextAction = `Contact patient and review ${symptomName} and treatment tolerance.`;
    } else {
      summary = "Patient may be struggling with both treatment tolerance and follow-through.";
      nextAction = "Contact patient and assess treatment tolerance and re-engagement.";
    }
  } else if (issueType === "clinical") {
    if (topFlag && topFlag.persistence === "worsening") {
      summary = `Patient is reporting worsening ${symptomName} and may need treatment support.`;
      nextAction = `Review ${symptomName} severity and treatment tolerance.`;
    } else if (topFlag && topFlag.severity === "severe") {
      summary = `Patient is reporting severe ${symptomName}; clinician review is recommended.`;
      nextAction = `Contact patient and assess ${symptomName} severity today.`;
    } else if (topFlag) {
      summary = `Symptoms appear ${symptomDir}; clinician review may be appropriate.`;
      nextAction = `Review ${symptomName} in recent check-ins and decide on follow-up.`;
    } else if (i.treatmentStatus === "stopped") {
      summary = "Treatment is currently stopped. Confirm clinical context is still accurate.";
      nextAction = "Confirm stop reason and decide on next clinical step.";
    } else if (i.recentLowMood) {
      summary = "Recent check-ins suggest treatment tolerance may be declining.";
      nextAction = "Review recent check-ins and confirm need for clinical follow-up.";
    } else {
      summary = "Clinical signals warrant a closer look at this patient's recent reports.";
      nextAction = "Review symptom flags and confirm need for clinical follow-up.";
    }
  } else if (issueType === "engagement") {
    if (i.escalationOpen) {
      summary = "Patient requested follow-up. Acknowledge and re-engage.";
      nextAction = "Mark reviewed, then call patient to address the request.";
    } else if (i.followUpPending) {
      summary = "Patient requested follow-up and has not yet re-engaged.";
      nextAction = "Log the follow-up touchpoint with this patient today.";
    } else if (i.silentDays !== null && i.silentDays >= 7) {
      summary = `Patient has not checked in for ${i.silentDays} days and may be disengaging.`;
      nextAction = "Contact patient and assess re-engagement barriers.";
    } else if (i.silentDays !== null && i.silentDays >= 3) {
      summary = "Engagement has slowed and follow-up may be needed.";
      nextAction = "Send a check-in nudge today; call if no response within 24h.";
    } else if (!i.hasAnyCheckin) {
      summary = "No check-ins logged yet. Encourage onboarding completion.";
      nextAction = "Confirm patient has activated the Viva Care app.";
    }
  }

  return { issueType, priority, summary, nextAction, reasons: trimmedReasons };
}

// Treatment-concern severity label. We deliberately move away from
// raw "Treatment risk 30%" — the percentage is abstract and competes
// with the action-priority pill. A three-step word scale (Low /
// Moderate / Elevated) is easier to read at a glance and stays
// visually secondary to the care summary.
const RISK_BAND_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Moderate",
  high: "Elevated",
};
const RISK_BAND_DOT: Record<"low" | "medium" | "high", string> = {
  low: "#1E8E3E",
  medium: "#B8650A",
  high: "#B5251D",
};

function PatientSummaryCard({
  intel,
  patient,
  weight,
  risk,
}: {
  intel: Intelligence;
  patient: PatientDetail;
  weight: PatientWeightSummary | undefined;
  risk: Risk | null;
}) {
  const style = PRIORITY_STYLE[intel.priority];
  const issueStyle = ISSUE_STYLE[intel.issueType];
  return (
    <div className="bg-card rounded-[20px] p-5 sm:p-6">
      {/* --- Identity row -------------------------------------------
          Patient name + drug/dose on the left, action-priority pill
          on the right. The priority pill replaces the old "Risk 30%"
          badge as the dominant header signal because it tells the
          doctor what to *do*, not just a number. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 sm:flex-1 w-full">
          <h1 className="font-display text-[24px] sm:text-[28px] font-bold text-foreground leading-tight break-words">
            {patient.name}
          </h1>
          <div className="text-muted-foreground text-sm mt-1.5 font-medium truncate sm:whitespace-normal sm:break-words">
            {patient.phone ?? patient.email}
          </div>
          <div className="text-foreground text-sm mt-3 font-medium">
            {patient.glp1Drug ?? "No drug recorded"}
            {patient.dose && (
              <span className="text-muted-foreground font-normal">
                {" · "}{patient.dose}
              </span>
            )}
            {patient.startedOn && (
              <span className="text-muted-foreground font-normal">
                {" · started "}{fmtDate(patient.startedOn)}
              </span>
            )}
          </div>
          {weight?.latest && (
            <div
              className="text-muted-foreground text-xs mt-1.5 font-medium flex items-center gap-2"
              aria-label="Latest weight"
            >
              <span className="text-foreground font-semibold">
                {Math.round(weight.latest.weightLbs)} lbs
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {weight.daysSinceLast === 0
                  ? "logged today"
                  : weight.daysSinceLast === 1
                  ? "1 day ago"
                  : `${weight.daysSinceLast} days ago`}
              </span>
              {(weight.trend === "up" || weight.trend === "down") &&
                weight.prior && (
                  <span className="text-muted-foreground">
                    {weight.trend === "up" ? "↑" : "↓"}{" "}
                    {Math.abs(
                      Math.round(
                        weight.latest.weightLbs - weight.prior.weightLbs,
                      ),
                    )}{" "}
                    lbs
                  </span>
                )}
            </div>
          )}
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap self-start"
          style={{ backgroundColor: style.bg, color: style.fg }}
          aria-label={`Action priority: ${PRIORITY_LABEL[intel.priority]}`}
        >
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: style.dot }}
          />
          {PRIORITY_LABEL[intel.priority]}
        </div>
      </div>

      {/* --- Care summary block -------------------------------------
          Eyebrow + issue-type chip, then the headline sentence and
          the recommended next action. Sits inside the same card as
          the identity row, separated only by a hairline so the top
          reads as one cohesive intelligence block. */}
      <div className="mt-5 pt-5 border-t border-border">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Care summary
          </div>
          <div
            className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap"
            style={{ backgroundColor: issueStyle.bg, color: issueStyle.fg }}
            aria-label={`Issue type: ${ISSUE_LABEL[intel.issueType]}`}
          >
            {ISSUE_LABEL[intel.issueType]}
          </div>
        </div>
        <p className="font-display text-[17px] sm:text-[18px] font-semibold text-foreground leading-snug mt-3">
          {intel.summary}
        </p>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 text-sm">
          <span
            className="text-[10px] uppercase tracking-wider font-semibold shrink-0 sm:mt-0.5"
            style={{ color: "#6B7280" }}
          >
            Next action
          </span>
          <span
            className="font-semibold break-words min-w-0"
            style={{ color: "#142240" }}
          >
            {intel.nextAction}
          </span>
        </div>
      </div>

      {/* --- Footer: reason pills + treatment concern ---------------
          Reason pills explain *why* this patient is in this priority.
          The treatment-concern label sits alongside as a quiet
          secondary signal — it adds clinical context without
          competing with the priority pill at the top. */}
      {(intel.reasons.length > 0 || risk) && (
        <div className="mt-5 pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          {intel.reasons.length > 0 ? (
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Why this patient is flagged
              </div>
              <div className="flex flex-wrap gap-1.5">
                {intel.reasons.map((r) => (
                  <span
                    key={r}
                    className="px-2.5 py-1 rounded-lg text-xs text-foreground bg-background font-semibold"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div />
          )}
          {risk && (
            <div
              className="text-xs font-medium flex items-center gap-2 sm:shrink-0"
              style={{ color: "#6B7280" }}
              aria-label={`Treatment concern: ${RISK_BAND_LABEL[risk.band]}`}
            >
              <span className="uppercase tracking-wider text-[10px] font-semibold">
                Treatment concern
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: RISK_BAND_DOT[risk.band] }}
                />
                <span className="text-foreground font-semibold">
                  {RISK_BAND_LABEL[risk.band]}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PatientDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  // Pilot analytics: one `patient_viewed` per (patient, mount). Re-
  // fires when the doctor navigates between patient detail pages
  // because the id dep changes.
  useEffect(() => {
    logAnalytics("patient_viewed");
  }, [id]);
  const patient = useQuery({
    queryKey: ["patient", id],
    queryFn: () => api.patient(id),
  });
  const checkins = useQuery({
    queryKey: ["patient", id, "checkins"],
    queryFn: () => api.patientCheckins(id),
  });
  const risk = useQuery({
    queryKey: ["patient", id, "risk"],
    queryFn: () => api.patientRisk(id),
  });
  const notes = useQuery({
    queryKey: ["patient", id, "notes"],
    queryFn: () => api.patientNotes(id),
  });
  const weight = useQuery({
    queryKey: ["patient", id, "weight"],
    queryFn: () => api.patientWeight(id),
  });
  // Care events power the dual-layer intervention surface: the amber
  // escalation banner up top and the doctor-side audit trail below
  // the notes section.
  const care = useQuery({
    queryKey: ["patient", id, "care-events"],
    queryFn: () => api.careEvents(id),
  });
  const markReviewed = useMutation({
    mutationFn: () => api.markPatientReviewed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", id, "care-events"] });
      qc.invalidateQueries({ queryKey: ["needs-review-ids"] });
    },
  });
  // Explicit "I followed up" doctor signal -- distinct from review.
  // Drives the closed-loop measurement (escalation -> follow-up
  // -> outcome) in the analytics Care Loop page.
  const markFollowUp = useMutation({
    mutationFn: () => api.markPatientFollowUpCompleted(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", id, "care-events"] });
    },
  });

  const [draft, setDraft] = useState("");
  // Local state for the treatment-status editor. We don't keep these in
  // a separate query; mutating PATCH returns the fresh PatientDetail
  // and we just push it into the patient cache.
  const [statusEditOpen, setStatusEditOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<TreatmentStatus>("active");
  const [stopReasonDraft, setStopReasonDraft] =
    useState<StopReason>("side_effects");
  const [stopNoteDraft, setStopNoteDraft] = useState("");
  const setStatusMut = useMutation({
    mutationFn: () =>
      api.setTreatmentStatus(id, {
        status: statusDraft,
        stopReason:
          statusDraft === "stopped" ? stopReasonDraft : undefined,
        stopNote:
          statusDraft === "stopped" && stopNoteDraft.trim()
            ? stopNoteDraft.trim()
            : null,
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(["patient", id], fresh);
      qc.invalidateQueries({ queryKey: ["patients"] });
      setStatusEditOpen(false);
    },
  });
  const addNote = useMutation({
    mutationFn: (body: string) => api.addPatientNote(id, body),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["patient", id, "notes"] });
    },
  });
  const delNote = useMutation({
    mutationFn: (noteId: number) => api.deletePatientNote(id, noteId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", id, "notes"] }),
  });

  if (patient.isPending) {
    return (
      <div className="text-muted-foreground py-12 text-center">Loading...</div>
    );
  }
  if (patient.isError || !patient.data) {
    return (
      <div
        className="rounded-xl px-4 py-3 font-medium"
        style={{ color: "#B5251D", backgroundColor: "rgba(255,59,48,0.10)" }}
      >
        Could not load patient.
      </div>
    );
  }

  const p = patient.data;

  // Compute the intelligence layer once per render. Inputs are pulled
  // entirely from values already rendered elsewhere on this page so
  // the summary can never disagree with the supporting cards below.
  const silentDays =
    checkins.data && checkins.data.length > 0
      ? daysSince(checkins.data[0]!.date)
      : null;
  const recentLowMood =
    !!checkins.data &&
    checkins.data.length > 0 &&
    checkins.data.slice(0, 3).some((c) => c.mood <= 2);
  const intel = computeIntelligence({
    treatmentStatus: p.treatmentStatus,
    silentDays,
    hasAnyCheckin: !!checkins.data && checkins.data.length > 0,
    riskBand: risk.data?.band,
    riskAction: risk.data?.action,
    symptomFlags: risk.data?.symptomFlags ?? [],
    escalationOpen: !!care.data?.escalationOpen,
    followUpPending: !!care.data?.followUpPending,
    lastEscalationAt: care.data?.lastEscalationAt ?? null,
    recentLowMood,
    recentNegativeTrend: false,
  });

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground inline-block font-medium transition-colors"
      >
        ← All patients
      </Link>

      {/* Unified clinical command card. Identity (name / med / dose),
          care summary (issue type, action priority, summary sentence,
          next action, reason pills), and a quiet treatment-concern
          severity label all live in ONE card so the top of the page
          reads as a single intelligence block instead of stacked
          modules. The lower cards remain the evidence layer. */}
      <PatientSummaryCard
        intel={intel}
        patient={p}
        weight={weight.data}
        risk={risk.data ?? null}
      />


      {/* Escalation banner. Renders amber + CTA when the patient has
          requested care-team review and no doctor_reviewed event has
          fired since. After reviewing, collapses to a quiet line so
          the audit trail is still visible without screaming for
          attention. */}
      {care.data?.escalationOpen && care.data.lastEscalationAt && (
        <div
          className="rounded-[20px] px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{
            backgroundColor: "rgba(255,149,0,0.10)",
            color: "#8B4F00",
          }}
        >
          <span aria-hidden className="text-lg">🛟</span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-sm">
              Patient requested more support
            </div>
            <div className="text-xs mt-0.5 opacity-80 font-medium">
              {relativeTime(care.data.lastEscalationAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => markReviewed.mutate()}
            disabled={markReviewed.isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: "#142240", color: "#fff" }}
          >
            {markReviewed.isPending ? "Marking..." : "Mark as reviewed"}
          </button>
        </div>
      )}
      {care.data && !care.data.escalationOpen && care.data.lastReviewAt && (
        <div className="text-xs text-muted-foreground font-medium">
          {(() => {
            const reviewer = care.data.events.find(
              (e) =>
                e.type === "doctor_reviewed" &&
                e.occurredAt === care.data!.lastReviewAt,
            );
            const who = reviewer?.actorName
              ? `Dr. ${reviewer.actorName.split(" ").slice(-1)[0]}`
              : "Care team";
            return `Reviewed by ${who} · ${relativeTime(care.data.lastReviewAt)}`;
          })()}
        </div>
      )}

      {/* Follow-up completed — explicit doctor signal that the patient
          actually got a follow-up after escalating. Distinct from
          "Mark as reviewed" (which only acknowledges the escalation
          was seen). Shown when there's an open escalation that hasn't
          been followed up yet, regardless of review state, so doctors
          can record the follow-up the moment it happens. After click,
          the button collapses into a quiet audit-trail line so the
          loop is closed visibly. */}
      {/* Follow-up tracking — three rendered states so the doctor
          always has a visible affordance:
            (1) followUpPending=true  → prominent green call-to-action
                ("Did you follow up?") with the primary button.
            (2) recently followed up  → quiet audit line + a small
                "Log another follow-up" button so they can record a
                second touchpoint.
            (3) no escalation history → small inline "Log follow-up"
                button so doctors can record an ad-hoc check-in even
                when the patient hasn't escalated. The backend stores
                trigger_event_id=NULL in this case; analytics filter
                those out of the funnel but include them in raw count.
          The button always reaches the same POST endpoint. */}
      {care.data?.followUpPending ? (
        <div
          className="rounded-[20px] px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{
            backgroundColor: "rgba(52,199,89,0.10)",
            color: "#1F6B36",
          }}
        >
          <span aria-hidden className="text-lg">📞</span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-sm">
              Did you follow up with this patient?
            </div>
            <div className="text-xs mt-0.5 opacity-80 font-medium">
              Records a doctor follow-up on the most recent escalation
              ({relativeTime(care.data.lastEscalationAt!)}).
            </div>
          </div>
          <button
            type="button"
            onClick={() => markFollowUp.mutate()}
            disabled={markFollowUp.isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: "#1F6B36", color: "#fff" }}
          >
            {markFollowUp.isPending ? "Saving..." : "Follow-up completed"}
          </button>
        </div>
      ) : care.data && care.data.lastFollowUpAt ? (
        // State (2): a follow-up exists and there's no newer escalation.
        // Quiet audit-trail card so the closed loop is visible without
        // shouting, but doctors can still record an additional touchpoint.
        <div className="rounded-[16px] border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
          <span aria-hidden className="text-base">✓</span>
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm font-semibold text-foreground">
              {(() => {
                const fu = care.data.events.find(
                  (e) =>
                    e.type === "follow_up_completed" &&
                    e.occurredAt === care.data!.lastFollowUpAt,
                );
                const who = fu?.actorName
                  ? `Dr. ${fu.actorName.split(" ").slice(-1)[0]}`
                  : "Care team";
                return `Follow-up completed by ${who} · ${relativeTime(
                  care.data.lastFollowUpAt!,
                )}`;
              })()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 font-medium">
              You can log another touchpoint anytime.
            </div>
          </div>
          <button
            type="button"
            onClick={() => markFollowUp.mutate()}
            disabled={markFollowUp.isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 border border-border bg-background hover:bg-secondary transition-colors"
          >
            {markFollowUp.isPending ? "Saving..." : "Log another follow-up"}
          </button>
        </div>
      ) : care.data ? (
        // State (3): no follow-up history at all. Was previously a faint
        // text line + tiny pill that nobody noticed. Now a full action
        // row card matching the language and weight of the escalation
        // banner -- still subtler than the green CTA but impossible
        // to miss.
        <div className="rounded-[20px] px-5 py-4 flex items-center gap-4 flex-wrap bg-card border border-border">
          <span aria-hidden className="text-lg">📋</span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-sm text-foreground">
              No follow-up logged yet
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 font-medium">
              Log a doctor follow-up the moment you call, message, or
              check in on this patient. Feeds the closed-loop care metrics.
            </div>
          </div>
          <button
            type="button"
            onClick={() => markFollowUp.mutate()}
            disabled={markFollowUp.isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {markFollowUp.isPending ? "Saving..." : "Log follow-up"}
          </button>
        </div>
      ) : null}

      {/* Treatment status. Doctor-owned source of truth for whether
          this patient is currently on GLP-1 therapy. Drives whether
          they show up in the active panel and feeds the retention
          KPIs in /internal/analytics. We deliberately keep it to
          three states (active / stopped / unknown) so the control
          stays unambiguous; risk-band/at-risk is derived elsewhere. */}
      <TreatmentStatusCard
        status={p.treatmentStatus}
        source={p.treatmentStatusSource}
        stopReason={p.stopReason}
        stopNote={p.stopNote}
        stopTimingBucket={p.stopTimingBucket}
        daysOnTreatment={p.daysOnTreatment}
        updatedAt={p.treatmentStatusUpdatedAt}
        editing={statusEditOpen}
        onEdit={() => {
          setStatusDraft(p.treatmentStatus);
          setStopReasonDraft((p.stopReason as StopReason) ?? "side_effects");
          setStopNoteDraft(p.stopNote ?? "");
          setStatusEditOpen(true);
        }}
        onCancel={() => setStatusEditOpen(false)}
        onSave={() => setStatusMut.mutate()}
        saving={setStatusMut.isPending}
        errorMessage={
          setStatusMut.isError
            ? (setStatusMut.error as Error).message
            : null
        }
        statusDraft={statusDraft}
        setStatusDraft={setStatusDraft}
        stopReasonDraft={stopReasonDraft}
        setStopReasonDraft={setStopReasonDraft}
        stopNoteDraft={stopNoteDraft}
        setStopNoteDraft={setStopNoteDraft}
      />

      {/* Last check-in recency line. Used to be a large coloured
          callout, but the summary card above already names this
          signal in plain English when it matters. We keep the fact
          (the doctor still wants the exact number of days) but
          render it as a quiet supporting line so we're not repeating
          the same headline twice. */}
      {checkins.data && checkins.data.length > 0 && (() => {
        const gap = daysSince(checkins.data[0]!.date);
        if (gap < 2) return null;
        return (
          <div
            className="text-xs text-muted-foreground font-medium flex items-center gap-2 px-1"
            aria-label="Last check-in recency"
          >
            <span aria-hidden>⏱</span>
            <span>
              Last check-in {gap} day{gap === 1 ? "" : "s"} ago
            </span>
          </div>
        );
      })()}

      {/* Symptom flags. Distinct from churn-risk rules: this is the
          clinical-symptom layer. Surfaced ABOVE the risk explanation
          because a worsening symptom is more actionable than a
          7-day energy trend. */}
      {risk.data && risk.data.symptomFlags.length > 0 && (
        <section className="bg-card rounded-[20px] p-6">
          <SectionTitle>Symptom flags</SectionTitle>
          <ul className="space-y-3">
            {risk.data.symptomFlags.map((f) => {
              const sev = SEVERITY_STYLE[f.severity];
              return (
                <li
                  key={f.symptom}
                  className="bg-background rounded-xl px-4 py-3.5"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-display text-[15px] font-semibold text-foreground">
                        {SYMPTOM_LABEL[f.symptom]}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                        {PERSISTENCE_LABEL[f.persistence]} ·{" "}
                        {f.daysObserved} of last {f.windowDays} day
                        {f.windowDays === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <span
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                        style={{ backgroundColor: sev.bg, color: sev.fg }}
                      >
                        {SEVERITY_LABEL[f.severity]}
                      </span>
                      {f.suggestFollowup && (
                        <span
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                          style={{
                            backgroundColor: "rgba(255,59,48,0.12)",
                            color: "#B5251D",
                          }}
                        >
                          Follow up
                        </span>
                      )}
                    </div>
                  </div>
                  {f.contributors.length > 0 && (
                    <div className="mt-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                        Likely contributors
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {f.contributors.map((c) => (
                          <span
                            key={c}
                            className="px-2 py-0.5 rounded-md text-xs text-foreground bg-card font-medium"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Closed-loop signals -- these are what convert
                      "we showed advice" into "is the advice working?". */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium">
                    <span className="text-muted-foreground">
                      {f.guidanceShown
                        ? "Guidance acknowledged"
                        : "Guidance not yet acknowledged"}
                    </span>
                    {f.trendResponse && (
                      <span
                        className="px-2 py-0.5 rounded-md font-semibold"
                        style={(() => {
                          if (f.trendResponse === "better") {
                            return { backgroundColor: "rgba(30,142,62,0.12)", color: "#1E8E3E" };
                          }
                          if (f.trendResponse === "worse") {
                            return { backgroundColor: "rgba(255,59,48,0.12)", color: "#B5251D" };
                          }
                          return { backgroundColor: "rgba(20,34,64,0.08)", color: "#142240" };
                        })()}
                      >
                        Patient reports{" "}
                        {f.trendResponse === "better"
                          ? "better"
                          : f.trendResponse === "worse"
                            ? "worse"
                            : "same"}
                      </span>
                    )}
                    {f.clinicianRequested && (
                      <span
                        className="px-2 py-0.5 rounded-md font-semibold"
                        style={{
                          backgroundColor: "rgba(255,149,0,0.14)",
                          color: "#9A5B00",
                        }}
                      >
                        Patient requested clinician
                      </span>
                    )}
                  </div>
                  {f.suggestFollowup && f.escalationReasons.length > 0 && (
                    <div className="mt-2 text-[11px] text-muted-foreground font-medium">
                      <span className="uppercase tracking-wider">
                        Why escalated:
                      </span>{" "}
                      <span className="text-foreground">
                        {f.escalationReasons.join(" · ")}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Risk explanation */}
        <section className="bg-card rounded-[20px] p-6">
          <SectionTitle>Key drivers</SectionTitle>
          {risk.data && risk.data.rules.length === 0 && (
            <p className="text-foreground text-sm font-medium">
              No risk signals fired in the recent window.
            </p>
          )}
          {risk.data && risk.data.rules.length > 0 && (
            <ul className="space-y-2.5">
              {risk.data.rules.map((r) => (
                <li
                  key={r.code}
                  className="flex items-start gap-3 text-sm bg-background rounded-xl px-4 py-3"
                >
                  <span className="font-semibold text-xs text-accent mt-0.5 shrink-0 w-7">
                    +{r.weight}
                  </span>
                  <span className="text-foreground font-medium">
                    {r.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {risk.data && (
            <div className="text-xs text-muted-foreground mt-4 font-medium">
              Computed {fmtDate(risk.data.asOf)}
            </div>
          )}
        </section>

        {/* Recent check-ins */}
        <section className="bg-card rounded-[20px] p-6">
          <SectionTitle>Recent check-ins</SectionTitle>
          {checkins.isPending && (
            <div className="text-muted-foreground text-sm">Loading...</div>
          )}
          {checkins.data && checkins.data.length === 0 && (
            <div className="text-muted-foreground text-sm">
              No check-ins logged yet.
            </div>
          )}
          {checkins.data && checkins.data.length > 0 && (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {checkins.data.slice(0, 14).map((c) => (
                <div
                  key={c.id}
                  className="bg-background rounded-xl px-4 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">
                        {fmtDate(c.date)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                        Mood {c.mood}/5
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs justify-end">
                      <span className="px-2.5 py-1 bg-card rounded-lg text-foreground font-semibold whitespace-nowrap">
                        {ENERGY_LABEL[c.energy]}
                      </span>
                      <span className="px-2.5 py-1 bg-card rounded-lg text-foreground font-semibold whitespace-nowrap">
                        Nausea: {NAUSEA_LABEL[c.nausea]}
                      </span>
                    </div>
                  </div>
                  {c.notes && c.notes.trim().length > 0 && (
                    <div className="mt-2 text-sm text-foreground italic leading-snug">
                      &ldquo;{c.notes}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Notes */}
      <section className="bg-card rounded-[20px] p-6">
        <SectionTitle>Care Team Notes</SectionTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v.length === 0) return;
            addNote.mutate(v);
          }}
          className="mb-5"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a note for the care team..."
            className="w-full px-4 py-3 rounded-xl bg-background text-foreground font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-y"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={addNote.isPending || draft.trim().length === 0}
              className="px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-60"
            >
              {addNote.isPending ? "Saving..." : "Save note"}
            </button>
          </div>
        </form>
        {notes.data && notes.data.length === 0 && (
          <div className="text-muted-foreground text-sm font-medium">
            No notes yet.
          </div>
        )}
        {notes.data && notes.data.length > 0 && (
          <ul className="space-y-3">
            {notes.data.map((n) => (
              <li
                key={n.id}
                className="bg-background rounded-xl px-4 py-3.5 group relative"
              >
                <div className="text-sm text-foreground whitespace-pre-wrap font-medium">
                  {n.body}
                </div>
                <div className="text-xs text-muted-foreground mt-2.5 flex items-center justify-between font-medium">
                  <span title={new Date(n.createdAt).toLocaleString()}>
                    <span className="text-foreground font-semibold">
                      {n.doctorName || "Care team"}
                    </span>
                    <span className="mx-1.5 opacity-50">·</span>
                    {relativeTime(n.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Delete this note?")) delNote.mutate(n.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity font-semibold"
                    style={{ color: "#B5251D" }}
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Care-events audit trail. Compact list of doctor-side actions
          + patient escalations so the doctor can see the loop without
          leaving the page. We hide the high-volume viva-side
          coach_message / recommendation_shown rows here -- those live
          in analytics, not in the per-patient view. */}
      {care.data && care.data.events.length > 0 && (() => {
        const visible = care.data.events.filter(
          (e) =>
            e.type === "doctor_reviewed" ||
            e.type === "doctor_note" ||
            e.type === "treatment_status_updated" ||
            e.type === "escalation_requested",
        );
        if (visible.length === 0) return null;
        return (
          <section className="bg-card rounded-[20px] p-6">
            <SectionTitle>Care loop activity</SectionTitle>
            <ul className="space-y-2">
              {visible.slice(0, 12).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 text-sm font-medium"
                >
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        e.source === "patient"
                          ? "#FF9500"
                          : e.source === "doctor"
                          ? "#142240"
                          : "#5AC8FA",
                    }}
                  />
                  <span className="text-foreground">
                    {careEventLabel(e)}
                  </span>
                  <span className="text-muted-foreground text-xs ml-auto">
                    {relativeTime(e.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}
    </div>
  );
}

// Compact human label for the care-events audit trail. Kept as a plain
// switch so adding a new event type is a one-line edit.
function careEventLabel(e: CareEvent): string {
  switch (e.type) {
    case "escalation_requested":
      return "Patient requested more support";
    case "doctor_reviewed":
      return e.actorName
        ? `${e.actorName} marked as reviewed`
        : "Marked as reviewed";
    case "doctor_note":
      return e.actorName
        ? `${e.actorName} added a note`
        : "Care note added";
    case "treatment_status_updated": {
      const status = (e.metadata?.status as string) ?? "updated";
      return `Treatment status set to ${status}`;
    }
    default:
      return e.type;
  }
}

// ---- TreatmentStatusCard ---------------------------------------------------
// Pulled out of PatientDetailPage so the JSX above stays scannable.
// Read-mode shows a colored chip + "edited by ..." line. Edit-mode is
// a tiny inline form -- no modal, no separate page -- because doctors
// will hit this constantly during weekly reviews and a modal would
// add a click for nothing.

const STATUS_LABEL: Record<TreatmentStatus, string> = {
  active: "On treatment",
  stopped: "Stopped",
  unknown: "Unknown",
};
const STATUS_STYLE: Record<TreatmentStatus, { bg: string; fg: string }> = {
  active: { bg: "rgba(52,199,89,0.12)", fg: "#1F7A3A" },
  stopped: { bg: "rgba(255,59,48,0.12)", fg: "#B5251D" },
  unknown: { bg: "rgba(142,142,147,0.16)", fg: "#4A4A55" },
};
const STOP_REASON_LABEL: Record<StopReason, string> = {
  side_effects: "Side effects",
  cost_or_insurance: "Cost or insurance",
  lack_of_efficacy: "Lack of efficacy",
  patient_choice_or_motivation: "Patient choice or motivation",
  other: "Other",
};
const SOURCE_LABEL: Record<"doctor" | "patient" | "system", string> = {
  doctor: "you",
  patient: "patient",
  system: "system",
};

const STOP_TIMING_LABEL: Record<StopTimingBucket, string> = {
  d0_30: "0 to 30 days",
  d31_60: "31 to 60 days",
  d61_90: "61 to 90 days",
  d90_plus: "More than 90 days",
  unknown: "",
};

function TreatmentStatusCard(props: {
  status: TreatmentStatus;
  source: "doctor" | "patient" | "system" | null;
  stopReason: StopReason | null;
  stopNote: string | null;
  stopTimingBucket: StopTimingBucket;
  daysOnTreatment: number | null;
  updatedAt: string | null;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  errorMessage: string | null;
  statusDraft: TreatmentStatus;
  setStatusDraft: (s: TreatmentStatus) => void;
  stopReasonDraft: StopReason;
  setStopReasonDraft: (r: StopReason) => void;
  stopNoteDraft: string;
  setStopNoteDraft: (n: string) => void;
}) {
  const style = STATUS_STYLE[props.status];
  return (
    <section className="bg-card rounded-[20px] p-4 sm:p-6">
      {/* Stack title/pills above the Update button on mobile so the
          button doesn't get pushed onto a cramped second row sharing
          space with a long status pill. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
          <h2 className="font-display text-[18px] font-semibold text-foreground">
            Treatment status
          </h2>
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ backgroundColor: style.bg, color: style.fg }}
          >
            {STATUS_LABEL[props.status]}
          </span>
          {props.status === "stopped" && props.stopReason && (
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
              style={{
                backgroundColor: "rgba(142,142,147,0.16)",
                color: "#4A4A55",
              }}
            >
              {STOP_REASON_LABEL[props.stopReason]}
            </span>
          )}
        </div>
        {!props.editing && (
          <button
            type="button"
            onClick={props.onEdit}
            className="self-start sm:self-auto text-sm font-semibold text-foreground bg-background hover:bg-muted rounded-lg px-3 py-1.5 transition-colors"
          >
            Update
          </button>
        )}
      </div>

      {!props.editing && (
        <>
          {/* Stop timing line. Only meaningful when status='stopped' AND
              we have both a startedOn date and an updatedAt date.
              Server returns daysOnTreatment=null in any other case. */}
          {props.status === "stopped" && props.daysOnTreatment !== null && (
            <div className="text-sm text-foreground mt-3 font-medium">
              Stopped {props.daysOnTreatment} day
              {props.daysOnTreatment === 1 ? "" : "s"} after starting
              treatment
              {props.stopTimingBucket !== "unknown" && (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {STOP_TIMING_LABEL[props.stopTimingBucket]}
                </span>
              )}
            </div>
          )}
          {props.status === "stopped" && props.stopNote && (
            <p className="text-sm text-foreground mt-3 leading-relaxed">
              {props.stopNote}
            </p>
          )}
          {props.updatedAt && props.source && (
            <div className="text-xs text-muted-foreground mt-3 font-medium">
              Set by {SOURCE_LABEL[props.source]} ·{" "}
              {relativeTime(props.updatedAt)}
            </div>
          )}
        </>
      )}

      {props.editing && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_LABEL) as TreatmentStatus[]).map((s) => {
              const selected = props.statusDraft === s;
              const sStyle = STATUS_STYLE[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => props.setStatusDraft(s)}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: selected ? sStyle.bg : "transparent",
                    color: selected ? sStyle.fg : "#4A4A55",
                    border: `1px solid ${
                      selected ? sStyle.fg : "rgba(142,142,147,0.3)"
                    }`,
                  }}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
          {props.statusDraft === "stopped" && (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Reason
                </label>
                <select
                  value={props.stopReasonDraft}
                  onChange={(e) =>
                    props.setStopReasonDraft(e.target.value as StopReason)
                  }
                  className="bg-background rounded-lg px-3 py-2 text-sm font-medium text-foreground w-full max-w-xs"
                >
                  {(Object.keys(STOP_REASON_LABEL) as StopReason[]).map(
                    (r) => (
                      <option key={r} value={r}>
                        {STOP_REASON_LABEL[r]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Note (optional)
                </label>
                <textarea
                  value={props.stopNoteDraft}
                  onChange={(e) => props.setStopNoteDraft(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Context for the care team"
                  className="bg-background rounded-lg px-3 py-2 text-sm font-medium text-foreground w-full"
                />
              </div>
            </>
          )}
          {props.errorMessage && (
            <div
              className="text-xs font-semibold rounded-lg px-3 py-2"
              style={{
                backgroundColor: "rgba(255,59,48,0.10)",
                color: "#B5251D",
              }}
            >
              {props.errorMessage}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={props.onSave}
              disabled={props.saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#142240" }}
            >
              {props.saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={props.onCancel}
              disabled={props.saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-foreground bg-background hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
