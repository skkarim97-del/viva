import type { AnalyticsSummary } from "@/lib/types";
import { pctStr } from "@/lib/format";
import { STOP_REASON_DISPLAY } from "@/lib/types";
import {
  Card,
  Chip,
  Empty,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

// Day-range labels for the "Churn by cohort" table. We label by exact
// day ranges so the cohort meaning is explicit on the page where churn
// is being read. Ranges match deriveStopTiming exactly: ≤30, ≤60, ≤90,
// then >90. Day 30 lives in d0_30, day 60 in d31_60, day 90 in d61_90;
// anything past 90 lands in d90_plus.
type CohortKey = "d0_30" | "d31_60" | "d61_90" | "d90_plus";
const COHORT_KEYS: readonly CohortKey[] = [
  "d0_30",
  "d31_60",
  "d61_90",
  "d90_plus",
] as const;
const COHORT_LABEL: Record<CohortKey, string> = {
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: ">90 days",
};

/**
 * Retention page. Active vs stopped vs unknown across the whole panel.
 * % still on treatment excludes unknowns from the denominator so
 * unconfirmed cohorts do not deflate the rate.
 */
export function RetentionPage({ data }: { data: AnalyticsSummary }) {
  const t = data.treatmentStatus;
  const sanity = data.dataSanity;
  if (!t) {
    return (
      <>
        <PageHeader title="Retention" />
        <Empty>The server didn't return a treatment-status block.</Empty>
      </>
    );
  }
  const onTreatmentDenom = t.active + t.stopped;
  const tone =
    t.pctStillOnTreatment >= 0.85
      ? "good"
      : t.pctStillOnTreatment >= 0.65
        ? "warn"
        : "bad";
  const accent =
    tone === "good" ? "#34C759" : tone === "warn" ? "#FF9500" : "#FF3B30";

  return (
    <>
      <PageHeader
        title="Retention"
        subtitle="Treatment status, stop reasons, and when patients stop. The denominator for % still on treatment excludes unknowns, so unconfirmed cohorts don't deflate the rate."
        right={
          sanity ? (
            <Chip tone={sanity.ok ? "good" : "bad"}>
              {sanity.ok ? "Data reconciled" : "Data mismatch"}
            </Chip>
          ) : undefined
        }
      />

      <SectionHead>Treatment status</SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <StatCard
          label="% churned"
          value={
            onTreatmentDenom > 0
              ? pctStr(1 - t.pctStillOnTreatment)
              : "—"
          }
          sub={`${t.stopped} of ${onTreatmentDenom} confirmed`}
          accent="#FF3B30"
        />
        <StatCard
          label="Total churned"
          value={t.stopped}
          sub="Off treatment"
          accent="#FF3B30"
        />
        <StatCard
          label="% still on treatment"
          value={
            onTreatmentDenom > 0 ? pctStr(t.pctStillOnTreatment) : "—"
          }
          sub={`${t.active} of ${onTreatmentDenom} confirmed`}
          accent={accent}
        />
        <StatCard
          label="Active patients"
          value={t.active}
          sub="Currently on treatment"
          accent="#34C759"
        />
        <StatCard
          label="Total panel"
          value={t.totalPatients}
          sub={`${t.unknown} unconfirmed`}
          accent="#38B6FF"
        />
      </div>

      {t.topStopReasons.length > 0 && (
        <>
          <SectionHead>Stop reasons (share of total patients)</SectionHead>
          <Card>
            <div className="mb-2.5 text-[11px] text-muted-foreground">
              Each row's percentage is that reason's share of the full
              panel of {t.totalPatients} patients (active + stopped +
              unknown), not just the {t.stopped} who stopped.
            </div>
            <div className="flex flex-col gap-2.5">
              {t.topStopReasons.map((r) => {
                // Backend's r.pct uses stoppedTotal as the denominator;
                // recompute against totalPatients so the bar and label
                // match the section heading. Falls back to the original
                // pct only if totalPatients is 0 (which would already
                // mean the page is empty).
                const pctOfTotal =
                  t.totalPatients > 0 ? r.count / t.totalPatients : r.pct;
                return (
                  <div key={r.reason} className="flex items-center gap-3 text-sm">
                    <div className="flex-1 truncate">
                      {STOP_REASON_DISPLAY[r.reason] ?? r.reason}
                    </div>
                    <div className="w-40 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.round(pctOfTotal * 100)}%` }}
                      />
                    </div>
                    <div className="w-40 text-right text-muted-foreground tabular-nums">
                      {r.count} of {t.totalPatients} ({Math.round(pctOfTotal * 100)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {t.cohortRetention && t.cohortRetention.buckets.length > 0 && (
        <>
          <SectionHead>Churn by cohort</SectionHead>
          <Card>
            <div className="overflow-x-auto -mx-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-[11px] uppercase tracking-wide">
                    <th className="text-left font-semibold px-2 py-1.5">Cohort</th>
                    <th className="text-right font-semibold px-2 py-1.5">Total patients</th>
                    <th className="text-right font-semibold px-2 py-1.5">Active</th>
                    <th className="text-right font-semibold px-2 py-1.5">Stopped</th>
                    <th className="text-right font-semibold px-2 py-1.5">% still active</th>
                    <th className="text-right font-semibold px-2 py-1.5">% churned</th>
                  </tr>
                </thead>
                <tbody>
                  {t.cohortRetention.buckets.map((row) => {
                    const denom = row.active + row.stopped;
                    const activePct = denom > 0 ? row.active / denom : null;
                    const churnPct = denom > 0 ? row.stopped / denom : null;
                    const label =
                      row.bucket === "unknown"
                        ? "Unknown (no start date)"
                        : COHORT_LABEL[row.bucket];
                    return (
                      <tr key={row.bucket} className="border-t border-border">
                        <td className="px-2 py-2">{label}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{row.total}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{row.active}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{row.stopped}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {activePct == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            pctStr(activePct)
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {churnPct == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            pctStr(churnPct)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              % still active and % churned both use active + stopped as the
              denominator (they sum to 100%). Patients with treatment status
              "unknown" are counted in Total but excluded from those rates
              so they don't deflate either side.
            </div>
          </Card>
        </>
      )}

      {t.stopped > 0 && t.stopReasonByTiming.length > 0 && (
        <>
          <SectionHead>Stop reasons by cohort</SectionHead>
          <Card>
            <div className="overflow-x-auto -mx-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-[11px] uppercase tracking-wide">
                    <th className="text-left font-semibold px-2 py-1.5">Reason</th>
                    {COHORT_KEYS.map((k) => (
                      <th
                        key={k}
                        className="text-right font-semibold px-2 py-1.5"
                      >
                        {COHORT_LABEL[k]}
                      </th>
                    ))}
                    <th className="text-right font-semibold px-2 py-1.5">Unknown</th>
                  </tr>
                </thead>
                <tbody>
                  {t.stopReasonByTiming.map((row) => {
                    const rowTotal =
                      row.d0_30 +
                      row.d31_60 +
                      row.d61_90 +
                      row.d90_plus +
                      row.unknown;
                    const fmt = (n: number) =>
                      rowTotal === 0
                        ? "—"
                        : `${Math.round((n / rowTotal) * 100)}%`;
                    return (
                      <tr key={row.reason} className="border-t border-border">
                        <td className="px-2 py-2">
                          {STOP_REASON_DISPLAY[row.reason] ?? row.reason}
                        </td>
                        {COHORT_KEYS.map((k) => (
                          <td
                            key={k}
                            className="px-2 py-2 text-right tabular-nums"
                          >
                            {fmt(row[k])}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {fmt(row.unknown)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Each row sums to 100% across the timing buckets, showing
              when patients stopped for that reason. Empty rows show "—".
            </div>
          </Card>
        </>
      )}

      {t.topStopReasons.length === 0 && t.stopTiming.knownDenom === 0 && (
        <Empty>
          No stops recorded yet. As soon as a doctor logs a stop reason or
          timing on a patient, the breakdowns above will populate.
        </Empty>
      )}
    </>
  );
}
