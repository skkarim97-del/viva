import type { AnalyticsSummary } from "@/lib/types";
import { pctStr } from "@/lib/format";
import { STOP_REASON_DISPLAY, TIMING_DISPLAY } from "@/lib/types";
import {
  Card,
  Chip,
  Empty,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

// Day-range labels for the "Churn by cohort" table. We label by exact
// day ranges (not Early/Mid/Late) so the cohort meaning is explicit on
// the page where churn is being read.
// Day ranges match deriveStopTiming exactly: early ≤30, mid ≤90, late >90.
// Day 90 lives in mid, so the late column says ">90" (not "90+") to stay
// consistent with TIMING_DISPLAY ("Late (>90d)") elsewhere on the page.
const COHORT_LABEL: Record<"early" | "mid" | "late", string> = {
  early: "0–30 days",
  mid: "31–90 days",
  late: ">90 days",
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
          label="% still on treatment"
          value={pctStr(t.pctStillOnTreatment)}
          sub={`${t.active} of ${onTreatmentDenom} confirmed`}
          accent={accent}
        />
        <StatCard label="On treatment" value={t.active} sub="Currently active" accent="#34C759" />
        <StatCard label="Stopped" value={t.stopped} sub="Off treatment" accent="#FF3B30" />
        <StatCard label="Unknown" value={t.unknown} sub="Pending confirmation" accent="#6B7A90" />
        <StatCard label="Total panel" value={t.totalPatients} accent="#38B6FF" />
      </div>

      {t.topStopReasons.length > 0 && (
        <>
          <SectionHead>Stop reasons</SectionHead>
          <Card>
            <div className="flex flex-col gap-2.5">
              {t.topStopReasons.map((r) => (
                <div key={r.reason} className="flex items-center gap-3 text-sm">
                  <div className="flex-1 truncate">
                    {STOP_REASON_DISPLAY[r.reason] ?? r.reason}
                  </div>
                  <div className="w-40 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.round(r.pct * 100)}%` }}
                    />
                  </div>
                  <div className="w-24 text-right text-muted-foreground tabular-nums">
                    {r.count} ({Math.round(r.pct * 100)}%)
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {t.stopTiming.knownDenom > 0 && (
        <>
          <SectionHead>Stop timing</SectionHead>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {(["early", "mid", "late"] as const).map((k) => {
              const stopped = t.stopTiming[k];
              // Cohort-level churn rate: stopped ÷ (active + stopped) in
              // the same time bucket. Uses cohortRetention so the
              // denominator includes patients who are still on treatment
              // and didn't churn -- a real per-cohort churn signal, not
              // just this bucket's share of total stops.
              const cohort = t.cohortRetention?.buckets.find(
                (b) => b.bucket === k,
              );
              const denom = cohort ? cohort.active + cohort.stopped : 0;
              const churnPct = denom > 0 ? stopped / denom : null;
              return (
                <StatCard
                  key={k}
                  label={TIMING_DISPLAY[k]}
                  value={stopped}
                  sub={
                    churnPct == null
                      ? "patients stopped"
                      : `${stopped} stopped • ${pctStr(churnPct)} churn in cohort`
                  }
                />
              );
            })}
            {t.stopTiming.unknown > 0 && (
              <StatCard
                label="Unknown timing"
                value={t.stopTiming.unknown}
                sub="Missing start date"
                accent="#6B7A90"
              />
            )}
          </div>
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
                    <th className="text-right font-semibold px-2 py-1.5">0–30d</th>
                    <th className="text-right font-semibold px-2 py-1.5">31–90d</th>
                    <th className="text-right font-semibold px-2 py-1.5">90+d</th>
                    <th className="text-right font-semibold px-2 py-1.5">Unknown</th>
                  </tr>
                </thead>
                <tbody>
                  {t.stopReasonByTiming.map((row) => (
                    <tr key={row.reason} className="border-t border-border">
                      <td className="px-2 py-2">
                        {STOP_REASON_DISPLAY[row.reason] ?? row.reason}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.early}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.mid}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.late}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {row.unknown}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
