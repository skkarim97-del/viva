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
              const n = t.stopTiming[k];
              const pct =
                t.stopTiming.knownDenom > 0
                  ? Math.round((n / t.stopTiming.knownDenom) * 100)
                  : 0;
              return (
                <StatCard
                  key={k}
                  label={TIMING_DISPLAY[k]}
                  value={n}
                  sub={`${pct}% of known timing`}
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

      {t.stopReasonByTiming.length > 0 && (
        <>
          <SectionHead>Reason × timing</SectionHead>
          <Card>
            <div className="overflow-x-auto -mx-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-[11px] uppercase tracking-wide">
                    <th className="text-left font-semibold px-2 py-1.5">Reason</th>
                    <th className="text-right font-semibold px-2 py-1.5">Early</th>
                    <th className="text-right font-semibold px-2 py-1.5">Mid</th>
                    <th className="text-right font-semibold px-2 py-1.5">Late</th>
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
