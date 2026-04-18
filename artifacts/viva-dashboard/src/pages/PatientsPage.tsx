import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api, type Action, type PatientRow } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";
import { ActionBadge } from "@/components/ActionBadge";
import { PatientGroup } from "@/components/PatientGroup";
import { AddNoteModal } from "@/components/AddNoteModal";
import { SummaryBar } from "@/components/SummaryBar";
import { relativeTime } from "@/lib/relativeTime";

// The queue is grouped by action so a 40-patient list reads as three
// short sections instead of one long scroll. Inside each group we sort
// by score desc, then break ties on the longest-silent patient so the
// worst signals always surface to the top of their group.
const ACTION_ORDER: Action[] = ["needs_followup", "monitor", "stable"];

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
  const grouped = useMemo(() => {
    const buckets: Record<Action, PatientRow[]> = {
      needs_followup: [],
      monitor: [],
      stable: [],
    };
    if (q.data) {
      for (const p of q.data) buckets[p.action].push(p);
      for (const k of ACTION_ORDER) buckets[k] = sortRows(buckets[k]);
    }
    return buckets;
  }, [q.data]);

  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);

  // Group open-state lifted into the page so the SummaryBar can focus
  // a section (force-open + scroll) when a stat card is clicked.
  // Defaults match the focus-mode brief: only Needs follow-up open.
  const [openGroups, setOpenGroups] = useState<Record<Action, boolean>>({
    needs_followup: true,
    monitor: false,
    stable: false,
  });
  const groupRefs = useRef<Record<Action, HTMLElement | null>>({
    needs_followup: null,
    monitor: null,
    stable: null,
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
        {q.data && (
          <div className="text-sm text-muted-foreground font-medium">
            {q.data.length} patient{q.data.length === 1 ? "" : "s"}
          </div>
        )}
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
        <div className="text-muted-foreground bg-card rounded-[20px] p-12 text-center font-medium">
          You don't have any patients assigned yet.
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
              {rows.map((p) => (
                <PatientCard
                  key={p.id}
                  p={p}
                  onAddNote={() => setNoteTarget({ id: p.id, name: p.name })}
                />
              ))}
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
    </div>
  );
}

interface CardProps {
  p: PatientRow;
  onAddNote: () => void;
}

function PatientCard({ p, onAddNote }: CardProps) {
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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[17px] text-foreground truncate">
            {p.name}
          </div>
          {signalNode ?? (
            <div className="text-xs text-muted-foreground mt-1 font-medium truncate">
              {p.email}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1 font-medium truncate">
            {lastNote}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 justify-end">
          <button
            type="button"
            onClick={(e) => {
              // Don't navigate -- this is the inline quick action.
              e.preventDefault();
              e.stopPropagation();
              onAddNote();
            }}
            className="px-3 py-1.5 rounded-full bg-background text-foreground text-xs font-semibold hover:bg-secondary border border-border transition-colors"
          >
            + Note
          </button>
          <ActionBadge action={p.action} />
          <RiskBadge band={p.riskBand} score={p.riskScore} />
          <span className="text-accent text-xl font-semibold leading-none">
            →
          </span>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-x-5 gap-y-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Drug
          </div>
          <div className="text-sm text-foreground font-medium mt-1 truncate">
            {p.glp1Drug ?? "--"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Dose
          </div>
          <div className="text-sm text-foreground font-medium mt-1 truncate">
            {p.dose ?? "--"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Last check-in
          </div>
          <div className="text-sm text-foreground font-medium mt-1 truncate">
            {formatDate(p.lastCheckin)}
          </div>
        </div>
      </div>
    </Link>
  );
}
