import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api, type Action, type PatientRow } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";
import { ActionBadge } from "@/components/ActionBadge";
import { PatientGroup } from "@/components/PatientGroup";
import { AddNoteModal } from "@/components/AddNoteModal";
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

      {q.data && q.data.length > 0 &&
        ACTION_ORDER.map((action) => {
          const rows = grouped[action];
          if (rows.length === 0) return null;
          // Stable starts collapsed at scale -- doctors don't need to
          // see the calm patients first thing in the morning.
          const defaultOpen = action !== "stable";
          return (
            <PatientGroup
              key={action}
              action={action}
              count={rows.length}
              defaultOpen={defaultOpen}
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
  // Three lines under the name (in priority order):
  //   1. Signal line -- urgent red+bold for needs_followup, amber for
  //      monitor; falls back to email when no rules fired.
  //   2. Last action line -- "Last note: 2d ago" or "No recent action",
  //      so doctors don't double-up follow-ups.
  const lastNote = p.lastNoteAt
    ? `Last note: ${relativeTime(p.lastNoteAt)}`
    : "No recent action";

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
          {p.signals.length > 0 ? (
            p.action === "needs_followup" ? (
              <div
                className="text-sm mt-1.5 font-bold flex items-center gap-1.5 truncate"
                style={{ color: "#B5251D" }}
              >
                <span aria-hidden>⚠️</span>
                <span className="truncate">{p.signals.join(" · ")}</span>
              </div>
            ) : (
              <div
                className="text-xs mt-1 font-semibold truncate"
                style={{ color: "#B8650A" }}
              >
                {p.signals.join(" · ")}
              </div>
            )
          ) : (
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
