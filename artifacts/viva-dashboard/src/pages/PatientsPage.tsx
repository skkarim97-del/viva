import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Action, type PatientRow } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";
import { ActionBadge } from "@/components/ActionBadge";
import { PatientGroup } from "@/components/PatientGroup";
import { AddNoteModal } from "@/components/AddNoteModal";
import { InvitePatientModal } from "@/components/InvitePatientModal";
import { SummaryBar } from "@/components/SummaryBar";
import { relativeTime } from "@/lib/relativeTime";

// The queue is grouped by action so a 40-patient list reads as three
// short sections instead of one long scroll. Inside each group we sort
// by score desc, then break ties on the longest-silent patient so the
// worst signals always surface to the top of their group.
// Pending sits at the bottom: they're operationally important to track,
// but they have no clinical signals to act on yet. Active workflow
// states stay at the top of the queue.
const ACTION_ORDER: Action[] = ["needs_followup", "monitor", "stable", "pending"];

function sortRows(rows: PatientRow[]): PatientRow[] {
  return [...rows].sort((a, b) => {
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

// Urgency scaling for silence-based signals. Within "Needs follow-up"
// a 5-day gap should not look identical to a 12-day gap. We parse the
// "No check-in for Xd" / "Never checked in" primary signal and pick a
// color + optional URGENT prefix so the longest-silent patients punch
// through their own group.
type SilenceSeverity = "amber" | "red" | "deepRed";

function silenceSeverity(daysSilent: number | null): SilenceSeverity | null {
  if (daysSilent === null) return null;
  if (daysSilent >= 8) return "deepRed";
  if (daysSilent >= 5) return "red";
  if (daysSilent >= 3) return "amber";
  return null;
}

function parseSilenceDays(signal: string | undefined): number | null {
  if (!signal) return null;
  if (signal === "Never checked in") return 999;
  const m = /^No check-in for (\d+)d$/.exec(signal);
  return m ? Number(m[1]) : null;
}

const SEVERITY_STYLE: Record<
  SilenceSeverity,
  { color: string; bold: boolean; prefix: string | null; size: "sm" | "xs" }
> = {
  amber: { color: "#B8650A", bold: false, prefix: null, size: "xs" },
  red: { color: "#B5251D", bold: true, prefix: null, size: "sm" },
  deepRed: { color: "#7A1410", bold: true, prefix: "URGENT:", size: "sm" },
};

export function PatientsPage() {
  const q = useQuery({ queryKey: ["patients"], queryFn: api.patients });
  // Cheap sibling lookup -- ids of patients whose most-recent
  // escalation_requested has not been followed by a doctor_reviewed.
  // Used to badge worklist rows without bloating the main /patients
  // payload.
  const needsReview = useQuery({
    queryKey: ["needs-review-ids"],
    queryFn: api.needsReviewIds,
    staleTime: 30_000,
  });
  const needsReviewSet = useMemo(
    () => new Set(needsReview.data?.ids ?? []),
    [needsReview.data],
  );
  const [, setLocation] = useLocation();
  const grouped = useMemo(() => {
    const buckets: Record<Action, PatientRow[]> = {
      needs_followup: [],
      monitor: [],
      stable: [],
      pending: [],
    };
    if (q.data) {
      for (const p of q.data) buckets[p.action].push(p);
      for (const k of ACTION_ORDER) buckets[k] = sortRows(buckets[k]);
    }
    return buckets;
  }, [q.data]);

  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  // Group open-state lifted into the page so the SummaryBar can focus
  // a section (force-open + scroll) when a stat card is clicked.
  // Defaults match the focus-mode brief: only Needs follow-up open.
  const [openGroups, setOpenGroups] = useState<Record<Action, boolean>>({
    needs_followup: true,
    monitor: false,
    stable: false,
    pending: false,
  });
  const groupRefs = useRef<Record<Action, HTMLElement | null>>({
    needs_followup: null,
    monitor: null,
    stable: null,
    pending: null,
  });
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

  // Silence stat counts patients whose last check-in is 3+ days old
  // OR who never checked in. Computed client-side from the queue
  // payload so we don't need a second round trip.
  const silentCount = useMemo(() => {
    if (!q.data) return 0;
    const now = Date.now();
    return q.data.filter((p) => {
      if (!p.lastCheckin) return true;
      const days = Math.floor(
        (now - new Date(p.lastCheckin).getTime()) / (1000 * 60 * 60 * 24),
      );
      return days >= 3;
    }).length;
  }, [q.data]);

  return (
    <div>
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="font-display text-[28px] font-bold text-foreground leading-tight">
            Your patients
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5 font-medium">
            Live risk band based on the last 14 days of check-ins.
          </p>
        </div>
        <div className="flex items-center gap-4">
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
            from the onboarding wizard, then their daily check-ins will appear
            here.
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

      {q.data && grouped.pending.length > 0 && (
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
          needsFollowupCount={grouped.needs_followup.length}
          silentCount={silentCount}
          totalPatients={q.data.length}
          onFocusNeedsFollowup={() => focusGroup("needs_followup")}
          onFocusSilent={() => focusGroup("needs_followup")}
        />
      )}

      {q.data && q.data.length > 0 &&
        ACTION_ORDER.map((action) => {
          const rows = grouped[action];
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
        <ActionBadge action="pending" />
      </div>
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
  const lastNote = p.lastNoteAt
    ? `Last note: ${relativeTime(p.lastNoteAt)}`
    : "No recent action";

  // Pick the signal style. If the primary signal is silence-based, we
  // override the default action color with a 3-tier urgency scale so a
  // 12-day gap visually outranks a 5-day gap inside the same group.
  const daysSilent = parseSilenceDays(p.signals[0]);
  const severity = silenceSeverity(daysSilent);
  const joined = p.signals.join(" · ");
  let signalNode: React.ReactNode = null;
  if (p.signals.length > 0) {
    if (severity) {
      const s = SEVERITY_STYLE[severity];
      signalNode = (
        <div
          className={`mt-1.5 flex items-center gap-1.5 truncate ${
            s.size === "sm" ? "text-sm" : "text-xs"
          } ${s.bold ? "font-bold" : "font-semibold"}`}
          style={{ color: s.color }}
        >
          {s.bold && <span aria-hidden>⚠️</span>}
          {s.prefix && (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold shrink-0"
              style={{ backgroundColor: s.color, color: "#FFFFFF" }}
            >
              {s.prefix}
            </span>
          )}
          <span className="truncate">{joined}</span>
        </div>
      );
    } else if (p.action === "needs_followup") {
      signalNode = (
        <div
          className="text-sm mt-1.5 font-bold flex items-center gap-1.5 truncate"
          style={{ color: "#B5251D" }}
        >
          <span aria-hidden>⚠️</span>
          <span className="truncate">{joined}</span>
        </div>
      );
    } else {
      signalNode = (
        <div
          className="text-xs mt-1 font-semibold truncate"
          style={{ color: "#B8650A" }}
        >
          {joined}
        </div>
      );
    }
  }

  return (
    <Link
      href={`/patients/${p.id}`}
      className="block bg-card rounded-[20px] p-5 hover:bg-secondary active:scale-[0.995] transition-all cursor-pointer no-underline"
    >
      {/* Header. On <sm we stack: name row (with arrow) on top, then
          a wrapping pill row underneath. From sm+ we restore the
          original two-column layout with pills hugging the right
          edge. This kills the mobile overflow without changing the
          desktop information density. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold text-[17px] text-foreground truncate flex-1 min-w-0">
              {p.name}
            </div>
            {needsReview && (
              <span
                className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: "#FF9500", color: "#FFFFFF" }}
                title="Patient requested more support"
              >
                Needs review
              </span>
            )}
            {/* Arrow rides with the name on mobile so the pill row
                below stays clean; on desktop the arrow sits with
                the pill cluster (rendered below). */}
            <span className="text-accent text-xl font-semibold leading-none shrink-0 sm:hidden">
              →
            </span>
          </div>
          {signalNode ?? (
            <div className="text-xs text-muted-foreground mt-1 font-medium truncate">
              {p.phone ?? p.email}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1 font-medium truncate">
            {lastNote}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end min-w-0">
          <button
            type="button"
            onClick={(e) => {
              // Don't navigate -- this is the inline quick action.
              e.preventDefault();
              e.stopPropagation();
              onAddNote();
            }}
            className="px-3 py-1.5 rounded-full bg-background text-foreground text-xs font-semibold hover:bg-secondary border border-border transition-colors shrink-0"
          >
            + Note
          </button>
          <ActionBadge action={p.action} />
          {p.inactive12d && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border bg-amber-50 text-amber-700 border-amber-200"
              title="No check-in for 12+ days"
            >
              Inactive 12d+
            </span>
          )}
          <RiskBadge band={p.riskBand} score={p.riskScore} />
          <span className="text-accent text-xl font-semibold leading-none hidden sm:inline">
            →
          </span>
        </div>
      </div>
      {/* Body. Stacks on mobile with inline "LABEL value" rows so each
          field gets a full line and nothing truncates aggressively.
          From sm+ restores the original 3-column grid. */}
      <div className="mt-4 pt-4 border-t border-border flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:gap-x-5 sm:gap-y-3">
        <div className="min-w-0 flex items-baseline gap-2 sm:block">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
            Drug
          </div>
          <div className="text-sm text-foreground font-medium sm:mt-1 truncate">
            {p.glp1Drug ?? "--"}
          </div>
        </div>
        <div className="min-w-0 flex items-baseline gap-2 sm:block">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
            Dose
          </div>
          <div className="text-sm text-foreground font-medium sm:mt-1 truncate">
            {p.dose ?? "--"}
          </div>
        </div>
        <div className="min-w-0 flex items-baseline gap-2 sm:block">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
            Last check-in
          </div>
          <div className="text-sm text-foreground font-medium sm:mt-1 truncate">
            {formatDate(p.lastCheckin)}
          </div>
        </div>
      </div>
    </Link>
  );
}
