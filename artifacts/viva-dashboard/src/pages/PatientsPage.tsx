import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type Action,
  type ClinicWorklistIntervention,
  type PatientRow,
} from "@/lib/api";
import { PatientGroup } from "@/components/PatientGroup";
import { AddNoteModal } from "@/components/AddNoteModal";
import { InvitePatientModal } from "@/components/InvitePatientModal";
import { SummaryBar } from "@/components/SummaryBar";
import { relativeTime } from "@/lib/relativeTime";
import {
  rowIntelligence,
  ISSUE_LABEL,
  ISSUE_STYLE,
  ISSUE_SORT,
  PRIORITY_SORT,
  RISK_BAND_LABEL,
  RISK_BAND_DOT,
  type IssueType,
} from "@/lib/rowIntelligence";

// The queue is grouped by action so a 40-patient list reads as three
// short sections instead of one long scroll. Inside each group we sort
// by score desc, then break ties on the longest-silent patient so the
// worst signals always surface to the top of their group.
// Pending sits at the bottom: they're operationally important to track,
// but they have no clinical signals to act on yet. Active workflow
// states stay at the top of the queue.
const ACTION_ORDER: Action[] = ["needs_followup", "monitor", "stable", "pending"];

// Within a group we sort by IssueType (combined > clinical > engagement
// > stable), then by RowPriority (review_now > follow_up_today >
// monitor > stable), then risk score desc, then longest-silent first
// as a final tiebreak. The risk score keeps influence as a secondary
// signal, exactly per the dashboard intelligence brief.
function sortRows(
  rows: PatientRow[],
  needsReviewSet: Set<number>,
): PatientRow[] {
  return [...rows].sort((a, b) => {
    const ai = rowIntelligence(a, needsReviewSet.has(a.id));
    const bi = rowIntelligence(b, needsReviewSet.has(b.id));
    if (ISSUE_SORT[ai.issueType] !== ISSUE_SORT[bi.issueType]) {
      return ISSUE_SORT[ai.issueType] - ISSUE_SORT[bi.issueType];
    }
    if (PRIORITY_SORT[ai.priority] !== PRIORITY_SORT[bi.priority]) {
      return PRIORITY_SORT[ai.priority] - PRIORITY_SORT[bi.priority];
    }
    if (a.riskScore !== b.riskScore) return b.riskScore - a.riskScore;
    const aTs = a.lastCheckin ? Date.parse(a.lastCheckin) : 0;
    const bTs = b.lastCheckin ? Date.parse(b.lastCheckin) : 0;
    return aTs - bTs;
  });
}

function formatDate(d: string | null): string {
  if (!d) return "Never";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  const today = new Date();
  const days = Math.floor(
    (today.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface NoteTarget {
  id: number;
  name: string;
}

export function PatientsPage() {
  // The dashboard shows the active panel by default. Toggling this on
  // re-fetches with `?includeArchived=true` so stopped patients with no
  // unresolved workflow re-appear in their own collapsed section.
  const [showArchived, setShowArchived] = useState(false);
  const q = useQuery({
    queryKey: ["patients", { showArchived }],
    queryFn: () => api.patients({ includeArchived: showArchived }),
  });
  // Cheap sibling lookup -- ids of patients whose most-recent
  // escalation_requested has not been followed by a doctor_reviewed.
  // Used to badge worklist rows without bloating the main /patients
  // payload.
  const needsReview = useQuery({
    queryKey: ["needs-review-ids"],
    queryFn: api.needsReviewIds,
    // Poll on a 30s cadence so a doctor sitting on the worklist
    // sees a new "Patient requested review" pill appear within
    // half a minute of the patient tapping the CTA, without
    // requiring a manual refresh. Cheap query (returns just ids).
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const needsReviewSet = useMemo(
    () => new Set(needsReview.data?.ids ?? []),
    [needsReview.data],
  );

  // Phase 4 intervention worklist. Returns the flat list of active
  // interventions (shown / accepted / pending_feedback / escalated)
  // for this doctor's panel; we bucket them client-side into the four
  // priority lanes below. Polled at the same cadence as needsReview so
  // the dashboard reflects new feedback within ~30s.
  const interventionsWorklist = useQuery({
    queryKey: ["clinic-interventions-worklist"],
    queryFn: api.clinicInterventionsWorklist,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const interventionBuckets = useMemo(() => {
    const empty = {
      patientRequested: [] as ClinicWorklistIntervention[],
      worse: [] as ClinicWorklistIntervention[],
      elevated: [] as ClinicWorklistIntervention[],
      repeated: [] as ClinicWorklistIntervention[],
    };
    const list = interventionsWorklist.data?.interventions ?? [];
    if (list.length === 0) return empty;
    // Each intervention falls into the FIRST matching bucket (top
    // priority wins). This keeps a single row from double-counting
    // even when multiple signals are true (e.g. patient asked AND
    // riskLevel=elevated). One patient may still appear in multiple
    // buckets if they have multiple distinct active interventions.
    //
    // The predicates use the CANONICAL values emitted by the backend
    // (lib/db PATIENT_INTERVENTION_* enums). Most importantly:
    //   * worse -> we key off feedbackResult, NOT status, because the
    //     server auto-escalates a worse-feedback row, so its status is
    //     already "escalated" by the time it reaches the worklist.
    //   * patientRequested -> we ONLY check triggerType. The server
    //     also writes escalationReason="patient_feedback_worse" on the
    //     worse path; if we keyed off escalationReason here, every
    //     worse row would mis-route into patientRequested.
    const seen = new Set<number>();
    const place = (bucket: ClinicWorklistIntervention[], iv: ClinicWorklistIntervention) => {
      if (seen.has(iv.id)) return;
      seen.add(iv.id);
      bucket.push(iv);
    };
    for (const iv of list) {
      if (iv.triggerType === "patient_requested_review") {
        place(empty.patientRequested, iv);
      }
    }
    for (const iv of list) {
      if (iv.feedbackResult === "worse") {
        place(empty.worse, iv);
      }
    }
    for (const iv of list) {
      if (iv.riskLevel === "elevated") {
        place(empty.elevated, iv);
      }
    }
    for (const iv of list) {
      if (iv.triggerType === "repeated_symptom") {
        place(empty.repeated, iv);
      }
    }
    return empty;
  }, [interventionsWorklist.data]);
  const [, setLocation] = useLocation();
  // Worklist composition.
  //
  // "Patient requested review" is treated as an ORDERING priority, not
  // a risk-score input. We pull every row whose id is in needsReviewSet
  // out of its normal action bucket and surface them all in a dedicated
  // top section. The treatment-risk score on each card is rendered
  // unchanged -- the ordering override lives entirely here, in the
  // grouping step, and never mutates `p.riskScore` or `p.riskBand`.
  //
  // Patients without an open review request continue to flow through
  // the existing action buckets (needs_followup -> monitor -> stable
  // -> pending) sorted by riskScore desc with longest-silent tiebreak,
  // so clearing a review request returns a patient to their natural
  // position with no score side-effects.
  const grouped = useMemo(() => {
    const buckets: Record<Action, PatientRow[]> = {
      needs_followup: [],
      monitor: [],
      stable: [],
      pending: [],
    };
    const requestedReview: PatientRow[] = [];
    const archived: PatientRow[] = [];
    if (q.data) {
      for (const p of q.data) {
        // Archived patients (treatment stopped + no unresolved
        // workflow) get their own collapsed section so they don't
        // dilute Stable / Monitor counts.
        if (p.archived) {
          archived.push(p);
          continue;
        }
        if (needsReviewSet.has(p.id) && !p.pending) {
          requestedReview.push(p);
        } else {
          buckets[p.action].push(p);
        }
      }
      for (const k of ACTION_ORDER) buckets[k] = sortRows(buckets[k], needsReviewSet);
    }
    return {
      buckets,
      requestedReview: sortRows(requestedReview, needsReviewSet),
      archived: sortRows(archived, needsReviewSet),
    };
  }, [q.data, needsReviewSet]);

  // The active panel excludes archived rows so SummaryBar tiles and
  // totals describe the working queue, not the historical record.
  const activeRows = useMemo(
    () => (q.data ? q.data.filter((p) => !p.archived) : []),
    [q.data],
  );

  // Issue-type counts feed the SummaryBar tiles. Counted across the
  // full panel (excluding pending) so the numbers match the queue
  // the doctor is about to scroll.
  const issueCounts = useMemo(() => {
    const out: Record<IssueType, number> = {
      combined: 0,
      clinical: 0,
      engagement: 0,
      stable: 0,
    };
    for (const p of activeRows) {
      if (p.pending) continue;
      const intel = rowIntelligence(p, needsReviewSet.has(p.id));
      out[intel.issueType] += 1;
    }
    return out;
  }, [activeRows, needsReviewSet]);

  const followUpTodayCount = useMemo(() => {
    let n = 0;
    for (const p of activeRows) {
      if (p.pending) continue;
      const intel = rowIntelligence(p, needsReviewSet.has(p.id));
      if (intel.priority === "follow_up_today") n += 1;
    }
    return n;
  }, [activeRows, needsReviewSet]);

  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  // Group open-state lifted into the page so the SummaryBar can focus
  // a section (force-open + scroll) when a stat card is clicked.
  // Defaults: the priority "Patient requested review" section and
  // "Needs follow-up" both open; the rest collapsed.
  const [openGroups, setOpenGroups] = useState<Record<Action, boolean>>({
    needs_followup: true,
    monitor: false,
    stable: false,
    pending: false,
  });
  const [reviewGroupOpen, setReviewGroupOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const groupRefs = useRef<Record<Action, HTMLElement | null>>({
    needs_followup: null,
    monitor: null,
    stable: null,
    pending: null,
  });
  const requestedReviewRef = useRef<HTMLElement | null>(null);
  const focusGroup = (action: Action) => {
    setOpenGroups((g) => ({ ...g, [action]: true }));
    // Defer scroll until after expansion paints so the section's full
    // height is in the layout when we measure.
    requestAnimationFrame(() => {
      groupRefs.current[action]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };
  const focusRequestedReview = () => {
    setReviewGroupOpen(true);
    requestAnimationFrame(() => {
      requestedReviewRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="font-display text-[28px] font-bold text-foreground leading-tight">
            Your Patients
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5 font-medium">
            Live risk band based on the last 14 days of check-ins.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Show archived
          </label>
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="bg-primary text-primary-foreground font-semibold px-4 py-2.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all text-sm"
          >
            + Invite patient
          </button>
        </div>
      </div>

      {q.isPending && (
        <div className="text-muted-foreground py-12 text-center">
          Loading patients...
        </div>
      )}
      {q.isError && (
        <div
          className="rounded-xl px-4 py-3 font-medium"
          style={{ color: "#B5251D", backgroundColor: "rgba(255,59,48,0.10)" }}
        >
          Could not load patients.
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="bg-card rounded-[20px] p-12 text-center">
          <div className="font-display text-[20px] font-bold text-foreground mb-2">
            Add and invite patients to begin monitoring
          </div>
          <p className="text-sm text-muted-foreground font-medium max-w-md mx-auto leading-relaxed">
            Viva starts working once your patients are connected. Invite them
            using the button below and their daily check-ins will appear here.
          </p>
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="mt-6 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-2xl hover:opacity-90"
          >
            Invite patients
          </button>
        </div>
      )}

      {q.data && grouped.buckets.pending.length > 0 && (
        <div
          className="rounded-2xl px-4 py-3 mb-5 text-sm font-medium leading-relaxed"
          style={{ color: "#142240", backgroundColor: "rgba(56,182,255,0.12)" }}
        >
          Monitoring begins once patients complete their first check-in in the
          Viva app.
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <SummaryBar
          totalPatients={activeRows.length}
          reviewNowCount={grouped.requestedReview.length}
          followUpTodayCount={followUpTodayCount}
          engagementCount={issueCounts.engagement}
          clinicalCount={issueCounts.clinical}
          onFocusReviewNow={focusRequestedReview}
          onFocusFollowUpToday={() => focusGroup("needs_followup")}
        />
      )}

      {/* Phase 4 intervention worklist. Renders the four priority
          buckets (Patient requested -> Worse -> Elevated -> Repeated)
          ABOVE the existing action buckets so the doctor's eye lands
          on the highest-leverage actions first. Each bucket is its
          own collapsible section; an empty bucket is hidden so the
          page stays compact. The existing `requestedReview` care-event
          section below is preserved -- it surfaces patients who
          asked for help via the older symptom-tip flow, while these
          buckets surface the AI/personalised intervention loop. */}
      {q.data && q.data.length > 0 && (
        <InterventionWorklist
          buckets={interventionBuckets}
        />
      )}

      {/* Priority section: any patient who has tapped "Notify care
          team" and whose escalation hasn't been followed up yet. This
          section is intentionally rendered ABOVE the action buckets
          regardless of each patient's underlying action / risk band.
          Risk score on each card stays whatever the model produced --
          the priority lives in the row's POSITION, not its score. */}
      {q.data && q.data.length > 0 && grouped.requestedReview.length > 0 && (
        <section
          data-group="requested_review"
          className="scroll-mt-6"
          ref={(el) => {
            requestedReviewRef.current = el;
          }}
        >
          <button
            type="button"
            onClick={() => setReviewGroupOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-1 py-2 mb-2 group"
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: "#FF9500" }}
              aria-hidden
            />
            <span className="font-display text-[15px] font-bold text-foreground">
              Patient requested review
            </span>
            <span
              className="text-xs font-semibold rounded-full px-2.5 py-0.5"
              style={{
                backgroundColor: "rgba(255,149,0,0.15)",
                color: "#9A5A00",
              }}
            >
              {grouped.requestedReview.length}
            </span>
            <span className="flex-1" />
            <span
              className="text-muted-foreground text-sm font-semibold transition-transform"
              style={{
                transform: reviewGroupOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
              aria-hidden
            >
              ›
            </span>
          </button>
          {reviewGroupOpen && (
            <div className="space-y-3 mb-6">
              {grouped.requestedReview.map((p) => (
                <PatientCard
                  key={p.id}
                  p={p}
                  needsReview
                  onAddNote={() => setNoteTarget({ id: p.id, name: p.name })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {q.data && q.data.length > 0 &&
        ACTION_ORDER.map((action) => {
          const rows = grouped.buckets[action];
          if (rows.length === 0) return null;
          return (
            <PatientGroup
              key={action}
              action={action}
              count={rows.length}
              open={openGroups[action]}
              onToggle={() =>
                setOpenGroups((g) => ({ ...g, [action]: !g[action] }))
              }
              ref={(el) => {
                groupRefs.current[action] = el;
              }}
            >
              {rows.map((p) =>
                p.pending ? (
                  <PendingCard key={p.id} p={p} />
                ) : (
                  <PatientCard
                    key={p.id}
                    p={p}
                    needsReview={needsReviewSet.has(p.id)}
                    onAddNote={() => setNoteTarget({ id: p.id, name: p.name })}
                  />
                ),
              )}
            </PatientGroup>
          );
        })}

      {/* Archived patients section. Only rendered when the doctor
          opts in via "Show archived". These are stopped-treatment
          patients with no unresolved workflow item -- preserved for
          history and search but kept out of the active queue. */}
      {showArchived && q.data && grouped.archived.length > 0 && (
        <section data-group="archived" className="scroll-mt-6 mt-2">
          <button
            type="button"
            onClick={() => setArchivedOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-1 py-2 mb-2 group"
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: "#8A94A6" }}
              aria-hidden
            />
            <span className="font-display text-[15px] font-bold text-foreground">
              Archived
            </span>
            <span className="text-xs font-semibold text-muted-foreground bg-card rounded-full px-2.5 py-0.5">
              {grouped.archived.length}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              treatment stopped
            </span>
            <span className="flex-1" />
            <span
              className="text-muted-foreground text-sm font-semibold transition-transform"
              style={{ transform: archivedOpen ? "rotate(90deg)" : "rotate(0deg)" }}
              aria-hidden
            >
              ›
            </span>
          </button>
          {archivedOpen && (
            <div className="space-y-3 mb-6 opacity-90">
              {grouped.archived.map((p) => (
                <PatientCard
                  key={p.id}
                  p={p}
                  needsReview={needsReviewSet.has(p.id)}
                  onAddNote={() => setNoteTarget({ id: p.id, name: p.name })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {noteTarget && (
        <AddNoteModal
          patientId={noteTarget.id}
          patientName={noteTarget.name}
          onClose={() => setNoteTarget(null)}
        />
      )}
      {showInvite && (
        <InvitePatientModal onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

/**
 * Pending-activation card: the patient has been invited but the mobile
 * app hasn't claimed the account yet. We deliberately do NOT show risk
 * badges, signals, or check-in summaries -- there's no data to score.
 * Doctors get a copy/resend control so they can nudge the patient.
 */
function PendingCard({ p }: { p: PatientRow }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(
    p.activationToken
      ? `${window.location.origin}/invite/${p.activationToken}`
      : null,
  );
  const [copied, setCopied] = useState(false);
  const [smsCopied, setSmsCopied] = useState(false);
  const resend = useMutation({
    mutationFn: () => api.resendInvite(p.id),
    onSuccess: (r) => {
      setLink(r.inviteLink);
      qc.invalidateQueries({ queryKey: ["patients"] });
    },
  });
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  // Copy a SMS-shaped message including the patient's first name and
  // the activation link. Doctors paste this straight into iMessage or
  // their EHR's SMS dispatcher -- the body must be one short line so
  // it survives carrier 160-char splits even with longer names.
  async function copySms() {
    if (!link) return;
    const firstName = (p.name || "").trim().split(/\s+/)[0] || "there";
    const body = `Hi ${firstName}, your clinician invited you to viva. Set up your account here: ${link}`;
    try {
      await navigator.clipboard.writeText(body);
      setSmsCopied(true);
      window.setTimeout(() => setSmsCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  // Two distinct sub-states of "pending": the doctor needs to know
  // whether the patient still hasn't installed the app vs. has the
  // app but hasn't logged a check-in yet. The first is solved by
  // resending the invite; the second is solved by nudging the patient
  // to open the app, so the controls below the divider differ too.
  const isInvited = p.status === "invited";
  const subtitle = isInvited
    ? "Awaiting account activation. Resend the link if needed."
    : "Connected. Awaiting first check-in.";
  // Stale-invite nudge: shows once the invite is 48h old and still
  // unclaimed. Renders the precise age so doctors can prioritise the
  // longest-stuck patients first ("Sent 4d ago" vs "Sent 2d ago").
  const showStale = isInvited && p.staleInvite === true;
  const inviteAge = p.inviteAgeHours ?? null;
  const staleLabel =
    inviteAge === null
      ? "Sent 48h+ ago"
      : inviteAge >= 48
        ? `Sent ${Math.floor(inviteAge / 24)}d ago`
        : `Sent ${inviteAge}h ago`;
  return (
    <div className="bg-card rounded-[20px] p-5 opacity-95">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[17px] text-foreground truncate">
            {p.name}
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-medium truncate">
            {p.phone ?? p.email}
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">
            {subtitle}
          </div>
        </div>
        <span
          className="px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap shrink-0 border"
          style={{
            backgroundColor: "rgba(56,182,255,0.10)",
            color: "#1F6B8F",
            borderColor: "rgba(56,182,255,0.30)",
          }}
        >
          Pending
        </span>
      </div>
      {showStale && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2"
          style={{ color: "#B8650A", backgroundColor: "rgba(255,149,0,0.10)" }}
          role="status"
          aria-label="Invite has not been activated for 48 hours or more"
        >
          <span aria-hidden>⏳</span>
          <span>Not activated yet · {staleLabel} · nudge the patient</span>
        </div>
      )}
      {isInvited && (
        <div className="mt-4 pt-4 border-t border-border flex items-stretch gap-2">
          <input
            readOnly
            value={link ?? "Generating..."}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 px-3 py-2 rounded-lg bg-background text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={copySms}
            disabled={!link}
            className="px-3 py-2 rounded-lg bg-background text-foreground text-xs font-semibold hover:opacity-80 disabled:opacity-60"
            title="Copy a ready-to-send SMS body with the activation link"
          >
            {smsCopied ? "Copied" : "Copy SMS"}
          </button>
          <button
            type="button"
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
            className="px-3 py-2 rounded-lg bg-background text-foreground text-xs font-semibold hover:opacity-80 disabled:opacity-60"
          >
            {resend.isPending ? "..." : "Resend"}
          </button>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  p: PatientRow;
  needsReview?: boolean;
  onAddNote: () => void;
}

function PatientCard({ p, needsReview, onAddNote }: CardProps) {
  // Inline follow-up logger. Hits the SAME backend endpoint the
  // detail page uses so analytics gets one consistent stream.
  const qc = useQueryClient();
  const followUp = useMutation({
    mutationFn: () => api.markPatientFollowUpCompleted(p.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["needs-review-ids"] });
      qc.invalidateQueries({ queryKey: ["patient", p.id, "care-events"] });
      qc.invalidateQueries({ queryKey: ["doctor-stats"] });
    },
  });

  // Row intelligence: same model as the detail page, scoped to the
  // leaner queue payload. Drives the issue-type chip, the one-line
  // summary, and the operational next-action hint.
  const intel = rowIntelligence(p, !!needsReview);
  const issueStyle = ISSUE_STYLE[intel.issueType];

  // Visibility rule for the inline follow-up button. Same triggers
  // as before -- open escalation, queue says needs-followup, or the
  // 12+ day disengagement signal -- so the CTA continues to appear
  // exactly where it did before this refactor.
  const showFollowUp =
    needsReview || p.action === "needs_followup" || p.inactive12d;

  const lastNote = p.lastNoteAt
    ? `Last note: ${relativeTime(p.lastNoteAt)}`
    : "No recent action";

  return (
    <Link
      href={`/patients/${p.id}`}
      className="block bg-card rounded-[20px] p-5 hover:bg-secondary active:scale-[0.995] transition-all cursor-pointer no-underline"
    >
      {/* Header. Patient name + issue-type chip on the left, the
          quick-action buttons on the right. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-[17px] text-foreground truncate min-w-0">
              {p.name}
            </div>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap shrink-0"
              style={{ backgroundColor: issueStyle.bg, color: issueStyle.fg }}
              title={`Issue type: ${ISSUE_LABEL[intel.issueType]}`}
            >
              {ISSUE_LABEL[intel.issueType]}
            </span>
            {needsReview && (
              <span
                className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: "#FF9500", color: "#FFFFFF" }}
                title="Patient requested review"
              >
                Review now
              </span>
            )}
            {p.archived && (
              <span
                className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full shrink-0 border"
                style={{
                  backgroundColor: "rgba(138,148,166,0.12)",
                  color: "#5A6478",
                  borderColor: "rgba(138,148,166,0.30)",
                }}
                title="Archived: treatment stopped, no unresolved workflow"
              >
                Archived
              </span>
            )}
            <span className="text-accent text-xl font-semibold leading-none shrink-0 sm:hidden ml-auto">
              →
            </span>
          </div>
          {/* Intelligent summary -- one short sentence that frames
              the situation in plain English. */}
          <div className="text-sm text-foreground mt-1.5 font-medium leading-snug">
            {intel.summary}
          </div>
          {/* Operational next-action hint + supporting context line. */}
          <div className="text-xs text-muted-foreground mt-1.5 font-medium flex items-center gap-2 flex-wrap">
            <span
              className="font-semibold"
              style={{ color: "#142240" }}
              title="Recommended next action"
            >
              ▸ {intel.nextAction}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{lastNote}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAddNote();
            }}
            className="px-3 py-1.5 rounded-full bg-background text-foreground text-xs font-semibold hover:bg-secondary border border-border transition-colors shrink-0"
          >
            + Note
          </button>
          {showFollowUp && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (followUp.isPending || followUp.isSuccess) return;
                followUp.mutate();
              }}
              disabled={followUp.isPending || followUp.isSuccess}
              title={
                needsReview
                  ? "Log doctor follow-up on this patient's open escalation"
                  : "Log an ad-hoc doctor follow-up touchpoint"
              }
              className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors shrink-0 disabled:opacity-80"
              style={
                followUp.isSuccess
                  ? {
                      backgroundColor: "rgba(52,199,89,0.15)",
                      color: "#1F6B36",
                      borderColor: "rgba(52,199,89,0.30)",
                    }
                  : needsReview
                  ? {
                      backgroundColor: "#1F6B36",
                      color: "#FFFFFF",
                      borderColor: "#1F6B36",
                    }
                  : undefined
              }
            >
              {followUp.isSuccess
                ? "✓ Follow-up logged"
                : followUp.isPending
                ? "Saving..."
                : needsReview
                ? "Log follow-up"
                : "+ Follow-up"}
            </button>
          )}
          <span className="text-accent text-xl font-semibold leading-none hidden sm:inline">
            →
          </span>
        </div>
      </div>
      {/* Footer. Single dense row of supporting metadata: drug, dose,
          last check-in, treatment concern. Intentionally rendered at
          xs/muted weight so it sits visually beneath the summary +
          next-action layer above. Treatment concern keeps a small
          colored dot so the band is parseable at a glance, but the
          score is shown as "30%" to give the number context. */}
      <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="truncate">
          <span className="font-semibold text-foreground/70">Drug:</span>{" "}
          {p.glp1Drug ?? "--"}
        </span>
        <span className="truncate">
          <span className="font-semibold text-foreground/70">Dose:</span>{" "}
          {p.dose ?? "--"}
        </span>
        <span className="truncate">
          <span className="font-semibold text-foreground/70">Last check-in:</span>{" "}
          {formatDate(p.lastCheckin)}
        </span>
        <span className="inline-flex items-center gap-1.5 ml-auto">
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: RISK_BAND_DOT[p.riskBand] }}
          />
          <span className="font-semibold text-foreground/70">
            Treatment concern:
          </span>
          <span>{RISK_BAND_LABEL[p.riskBand]}</span>
          <span className="tabular-nums">({p.riskScore}%)</span>
        </span>
      </div>
    </Link>
  );
}

// ---- InterventionWorklist (Phase 4) ----------------------------------------
// Renders the four priority buckets returned by /api/clinic/interventions:
//   1. Patient requested  (orange) -- patient explicitly asked for help
//   2. Worse              (red)    -- patient said the recommendation was worse
//   3. Elevated           (amber)  -- AI/risk model flagged high or urgent
//   4. Repeated           (purple) -- same trigger fired without resolution
//
// Each non-empty bucket gets its own collapsible section. The bucket
// shows the patient name, what was recommended, and how long ago the
// intervention was generated. Clicking a row routes to the patient
// detail page where the doctor can take action.

const INTERVENTION_BUCKET_META: Array<{
  key: keyof InterventionWorklistBuckets;
  label: string;
  helper: string;
  dot: string;
  pillBg: string;
  pillFg: string;
}> = [
  {
    key: "patientRequested",
    label: "Patient requested",
    helper: "patient asked to talk",
    dot: "#FF9500",
    pillBg: "rgba(255,149,0,0.15)",
    pillFg: "#9A5A00",
  },
  {
    key: "worse",
    label: "Worse after recommendation",
    helper: "patient says it's worse",
    dot: "#FF3B30",
    pillBg: "rgba(255,59,48,0.12)",
    pillFg: "#B5251D",
  },
  {
    key: "elevated",
    label: "Elevated risk",
    helper: "AI surfaced high risk",
    dot: "#F2A900",
    pillBg: "rgba(242,169,0,0.15)",
    pillFg: "#7A5400",
  },
  {
    key: "repeated",
    label: "Repeated symptom",
    helper: "no improvement yet",
    dot: "#A569FF",
    pillBg: "rgba(165,105,255,0.15)",
    pillFg: "#6336A8",
  },
];

interface InterventionWorklistBuckets {
  patientRequested: ClinicWorklistIntervention[];
  worse: ClinicWorklistIntervention[];
  elevated: ClinicWorklistIntervention[];
  repeated: ClinicWorklistIntervention[];
}

function InterventionWorklist({
  buckets,
}: {
  buckets: InterventionWorklistBuckets;
}) {
  const total =
    buckets.patientRequested.length +
    buckets.worse.length +
    buckets.elevated.length +
    buckets.repeated.length;
  if (total === 0) return null;
  return (
    <div className="mb-6">
      {INTERVENTION_BUCKET_META.map((meta) => {
        const rows = buckets[meta.key];
        if (rows.length === 0) return null;
        return (
          <InterventionBucketSection
            key={meta.key}
            label={meta.label}
            helper={meta.helper}
            dot={meta.dot}
            pillBg={meta.pillBg}
            pillFg={meta.pillFg}
            rows={rows}
          />
        );
      })}
    </div>
  );
}

function InterventionBucketSection({
  label,
  helper,
  dot,
  pillBg,
  pillFg,
  rows,
}: {
  label: string;
  helper: string;
  dot: string;
  pillBg: string;
  pillFg: string;
  rows: ClinicWorklistIntervention[];
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="scroll-mt-6 mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-1 py-2 mb-2"
      >
        <span
          aria-hidden
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: dot }}
        />
        <span className="font-display text-[15px] font-bold text-foreground">
          {label}
        </span>
        <span
          className="text-xs font-semibold rounded-full px-2.5 py-0.5"
          style={{ backgroundColor: pillBg, color: pillFg }}
        >
          {rows.length}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {helper}
        </span>
        <span className="flex-1" />
        <span
          className="text-muted-foreground text-sm font-semibold transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && (
        <ul className="space-y-2">
          {rows.map((iv) => (
            <li key={iv.id}>
              <Link
                href={`/patients/${iv.patientUserId}`}
                className="flex items-start gap-3 bg-card rounded-2xl px-4 py-3 hover:opacity-90 transition-opacity"
              >
                <span
                  aria-hidden
                  className="inline-block w-2 h-2 rounded-full shrink-0 mt-2"
                  style={{ backgroundColor: dot }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground text-sm">
                      {iv.patient?.name ?? `Patient #${iv.patientUserId}`}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">
                      {humanTrigger(iv.triggerType)}
                    </span>
                    {iv.generatedBy === "rules_fallback" && (
                      <span className="text-[10px] font-semibold text-muted-foreground rounded-full px-2 py-0.5 bg-background">
                        Fallback
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground font-medium mt-0.5 leading-snug truncate">
                    {iv.recommendation}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs shrink-0 mt-1">
                  {relativeTime(iv.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TRIGGER_LABEL_W: Record<string, string> = {
  nausea: "Nausea",
  constipation: "Constipation",
  low_energy: "Low energy",
  low_hydration: "Low hydration",
  low_food_intake: "Low food intake",
  missed_checkin: "Missed check-in",
  rapid_weight_change: "Weight change",
  worsening_symptom: "Worsening symptom",
  repeated_symptom: "Repeated symptom",
  patient_requested_review: "Patient requested",
};
function humanTrigger(t: string): string {
  return TRIGGER_LABEL_W[t] ?? t.replace(/_/g, " ");
}
