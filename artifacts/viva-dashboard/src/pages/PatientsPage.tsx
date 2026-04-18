import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api, type PatientRow } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";

// Highest-risk first so the care team triages without scanning. Within a
// band we order by score, and break ties on the most recent check-in
// (older silence first) to keep the worst signals at the top.
const BAND_RANK: Record<PatientRow["riskBand"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function sortByRisk(rows: PatientRow[]): PatientRow[] {
  return [...rows].sort((a, b) => {
    const band = BAND_RANK[a.riskBand] - BAND_RANK[b.riskBand];
    if (band !== 0) return band;
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

export function PatientsPage() {
  const q = useQuery({ queryKey: ["patients"], queryFn: api.patients });
  const sorted = useMemo(() => (q.data ? sortByRisk(q.data) : []), [q.data]);

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

      {sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((p) => (
            <Link
              key={p.id}
              href={`/patients/${p.id}`}
              className="block bg-card rounded-[20px] p-5 hover:bg-secondary active:scale-[0.995] transition-all"
            >
              {/* Two-row layout keeps name+risk on top and metadata below
                  so labels never collide on narrower viewports. */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[17px] text-foreground truncate">
                    {p.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-medium truncate">
                    {p.email}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
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
          ))}
        </div>
      )}
    </div>
  );
}
