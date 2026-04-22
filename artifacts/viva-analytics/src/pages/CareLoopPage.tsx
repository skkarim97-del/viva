import { useEffect, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KEY_STORAGE } from "@/lib/api";
import { useCareLoop } from "@/hooks/useCareLoop";
import { useCareLoopTrend } from "@/hooks/useCareLoopTrend";
import { pctStr } from "@/lib/format";
import {
  Card,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

/**
 * Care Loop = the dual-layer intervention funnel: what Viva surfaced
 * to patients, what got escalated to a doctor, what the doctors did
 * about it, and what the outcome looked like.
 *
 * Layout is tiered for the pilot operator:
 *   Primary    -- "is the loop working?" reach + response + closure
 *   Secondary  -- trend over time, source breakdown, doctor detail
 *   Outcomes   -- did the loop produce a positive follow-through?
 *   Diagnostic -- methodology / proxy notes
 */
export function CareLoopPage() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      setKey(window.localStorage.getItem(KEY_STORAGE));
    } catch {
      /* ignore */
    }
  }, []);
  const q = useCareLoop(key, 30);
  const trend = useCareLoopTrend(key, 30);

  if (q.isLoading || !q.data) {
    return (
      <>
        <PageHeader
          title="Care loop"
          subtitle="Did signals lead to doctor action and patient follow-through?"
        />
        <div className="text-muted-foreground py-16 text-center">
          {q.isError ? "Failed to load." : "Loading care loop…"}
        </div>
      </>
    );
  }

  const d = q.data;
  return (
    <>
      <PageHeader
        title="Care loop"
        subtitle={`Did signals lead to doctor action and patient follow-through? Last ${d.windowDays} days.`}
      />

      {/* PRIMARY -- the six numbers that say whether the loop is
          actually working. Reach (patients touched + escalations),
          response (% reviewed + time to review), and closure
          (follow-up + next-day check-in lift). Pulled from across
          the Viva / Escalation / Doctor layers so the pilot
          question can be answered without scrolling. */}
      <SectionHead hint="The numbers that say whether the loop is working">
        Primary metrics · is the loop working?
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <StatCard
          label="Patients touched"
          value={d.viva.distinctPatients.toLocaleString()}
          sub="distinct in window"
          accent="#5AC8FA"
        />
        <StatCard
          label="% of patients who escalated"
          value={pctStr(d.escalation.pctOfPatients)}
          sub={`${d.escalation.pctOfPatientsNumerator}/${d.escalation.pctOfPatientsDenominator} in panel`}
          accent="#FF9500"
        />
        <StatCard
          label="Total escalations"
          value={d.escalation.totalEscalations.toLocaleString()}
          sub={`${d.escalation.distinctPatients.toLocaleString()} patients escalated`}
          accent="#FF9500"
        />
        <StatCard
          label="% escalations reviewed"
          value={pctStr(d.doctor.reviewedPct)}
          sub={`${d.doctor.reviewedNumerator}/${d.doctor.reviewedDenominator}`}
          accent="#142240"
        />
        <StatCard
          label="Avg time to review"
          value={
            d.doctor.avgMinutesEscalationToReview == null
              ? "—"
              : formatMinutes(d.doctor.avgMinutesEscalationToReview)
          }
          sub="escalation → reviewed"
          accent="#142240"
        />
        <StatCard
          label="% follow-up completed"
          value={pctStr(d.doctor.followUpCompletedPct)}
          sub={`${d.doctor.followUpCompletedNumerator}/${d.doctor.followUpCompletedDenominator} escalations`}
          accent="#34C759"
        />
        <StatCard
          label="Next-day check-in"
          value={pctStr(d.viva.nextDayCheckinPctOfTouchedPatients)}
          sub={`${d.viva.nextDayCheckinNumerator}/${d.viva.nextDayCheckinDenominator} touched patients`}
          accent="#34C759"
        />
      </div>

      {/* SECONDARY -- movement over time leads, since the trend chart
          is the most operationally useful view (is the loop getting
          tighter day by day?). Then source breakdown and the
          clinician-side detail (notes, status, 24h response). */}
      <SectionHead hint="Daily counts and 24h response rate over the last 30 days">
        Secondary metrics · trend over time
      </SectionHead>
      <Card>
        {trend.isLoading || !trend.data ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            {trend.isError ? "Failed to load trend." : "Loading trend…"}
          </div>
        ) : (
          <CareLoopTrendChart points={trend.data.points} />
        )}
      </Card>

      <SectionHead hint="Where escalations come from and what doctors do with them">
        Loop detail · sources and doctor response
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Card>
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            Escalations by source
          </div>
          {Object.entries(d.escalation.bySource).length === 0 && (
            <div className="text-sm text-muted-foreground">No escalations.</div>
          )}
          <ul className="space-y-1 text-sm font-medium">
            {Object.entries(d.escalation.bySource).map(([src, n]) => (
              <li key={src} className="flex items-center justify-between">
                <span className="capitalize text-foreground">{src}</span>
                <span className="tabular-nums text-foreground">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <StatCard
          label="With doctor note"
          value={pctStr(d.doctor.withDoctorNotePct)}
          sub="of escalations"
          accent="#142240"
        />
        <StatCard
          label="Treatment status changed"
          value={pctStr(d.doctor.withTreatmentStatusUpdatedPct)}
          sub="of escalations"
          accent="#142240"
        />
        <StatCard
          label="Followed up within 24h"
          value={pctStr(d.doctor.followUpWithin24hPct)}
          sub={`${d.doctor.followUpWithin24hNumerator}/${d.doctor.followUpWithin24hDenominator} followed up`}
          accent="#34C759"
        />
        <StatCard
          label="Avg time to follow-up"
          value={
            d.doctor.avgMinutesEscalationToFollowUp == null
              ? "—"
              : formatMinutes(d.doctor.avgMinutesEscalationToFollowUp)
          }
          sub="escalation → follow-up"
          accent="#34C759"
        />
      </div>

      <SectionHead hint="Did the loop produce a positive follow-through?">
        Outcomes
      </SectionHead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <StatCard
          label="Resolved by Viva alone"
          value={pctStr(d.outcomes.resolvedByVivaAlonePct)}
          sub={`${d.outcomes.resolvedByVivaAloneNumerator}/${d.outcomes.resolvedByVivaAloneDenominator} touched, no escalation`}
          accent="#34C759"
        />
        <StatCard
          label="Escalated to doctor"
          value={pctStr(d.outcomes.escalatedPct)}
          sub={`${d.outcomes.escalatedNumerator}/${d.outcomes.escalatedDenominator} touched`}
          accent="#FF9500"
        />
        <StatCard
          label="Improved after doctor"
          value={pctStr(d.outcomes.improvedAfterDoctorPct)}
          sub={`${d.outcomes.improvedAfterDoctorNumerator}/${d.outcomes.improvedAfterDoctorDenominator} escalated`}
          accent="#142240"
        />
      </div>

      {/* TERTIARY -- raw counts and methodology. Diagnostic only;
          essential for trust but not for glance-and-go reading. */}
      <SectionHead hint="Lower-signal raw event volumes">
        Diagnostic metrics · raw counts
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <StatCard
          label="Total Viva events"
          value={d.viva.totalEvents.toLocaleString()}
          sub="coach + recommendations"
        />
        <StatCard
          label="Total follow-up events"
          value={d.doctor.totalFollowUpEvents.toLocaleString()}
          sub="raw count in window"
        />
      </div>

      <SectionHead>Diagnostic · how these are computed</SectionHead>
      <Card>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {Object.entries(d.notes).map(([k, v]) => (
            <li key={k}>
              <span className="font-semibold text-foreground">{k}: </span>
              {v}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// Trend chart. Two bars (escalations + follow-ups) on the left axis,
// one line (within-24h %) on the right axis. Recharts handles the
// dual-axis bookkeeping; we just keep the colors aligned with the
// rest of the page (orange = escalation, green = doctor / follow-up).
function CareLoopTrendChart({
  points,
}: {
  points: Array<{
    day: string;
    escalations: number;
    followUps: number;
    within24hPct: number | null;
    within24hNumerator: number;
    within24hDenominator: number;
  }>;
}) {
  // Recharts skips Line points whose value is null, which gives us
  // the truthful "no escalations that day" gap we want. We multiply
  // by 100 here so the right axis can read 0..100 directly.
  const data = points.map((p) => ({
    ...p,
    within24hPctDisplay:
      p.within24hPct == null ? null : Math.round(p.within24hPct * 1000) / 10,
    label: p.day.slice(5), // MM-DD -- 30 days fits cleanly
  }));
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 0, left: -8 }}
        >
          <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickLine={false}
            axisLine={{ stroke: "#E5E7EB" }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            yAxisId="left"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickLine={false}
            axisLine={{ stroke: "#E5E7EB" }}
            width={32}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickLine={false}
            axisLine={{ stroke: "#E5E7EB" }}
            tickFormatter={(v) => `${v}%`}
            width={36}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              fontSize: 12,
            }}
            formatter={(value: unknown, name: string) => {
              if (name === "Within 24h") {
                return value == null ? ["—", name] : [`${value}%`, name];
              }
              return [String(value), name];
            }}
          />
          <Legend
            verticalAlign="top"
            height={28}
            iconType="circle"
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar
            yAxisId="left"
            dataKey="escalations"
            name="Escalations"
            fill="#FF9500"
            radius={[3, 3, 0, 0]}
            maxBarSize={14}
          />
          <Bar
            yAxisId="left"
            dataKey="followUps"
            name="Follow-ups"
            fill="#34C759"
            radius={[3, 3, 0, 0]}
            maxBarSize={14}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="within24hPctDisplay"
            name="Within 24h"
            stroke="#142240"
            strokeWidth={2}
            dot={{ r: 3, fill: "#142240" }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
