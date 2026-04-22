import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KEY_STORAGE } from "@/lib/api";
import { useUsage, type UsageTopUser } from "@/hooks/useUsage";
import { pctStr } from "@/lib/format";
import {
  Card,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

/**
 * Usage = pilot-grade product activity. Reads /internal/analytics/usage
 * and shows when patients and doctors actually open the apps, how long
 * their sessions are, and which events are flowing. Distinct from
 * Operating (DAU/WAU/MAU on top of clinical tables) -- this page is
 * sourced exclusively from the analytics_events stream.
 */
export function UsagePage() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      setKey(window.localStorage.getItem(KEY_STORAGE));
    } catch {
      /* ignore */
    }
  }, []);
  const q = useUsage(key, 7);

  if (q.isLoading || !q.data) {
    return (
      <>
        <PageHeader
          title="Usage"
          subtitle="When patients and doctors open the apps, last 7 days."
        />
        <div className="text-muted-foreground py-16 text-center">
          {q.isError ? "Failed to load." : "Loading usage…"}
        </div>
      </>
    );
  }

  const d = q.data;
  const patientLen = d.sessionLengthByRole.patient;
  const doctorLen = d.sessionLengthByRole.doctor;
  const tzCov = d.timezoneCoverage;
  const tzLabel =
    tzCov.coveragePct == null
      ? "no sessions yet"
      : tzCov.coveragePct >= 0.999
        ? "local time"
        : tzCov.coveragePct <= 0.001
          ? "UTC (no client tz reported yet)"
          : `${pctStr(tzCov.coveragePct)} local · rest UTC`;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle={`Engagement and usage timing over the last ${d.windowDays} days, sourced from the analytics stream.`}
      />

      {/* PRIMARY -- pilot question: are patients and doctors actually
          using the apps in a way that produces value? Meaningful % is
          the headline; raw session counts give context (denominator). */}
      <SectionHead hint="Sessions that completed a key action (patient: check-in · doctor: opened a patient)">
        Primary metrics · meaningful engagement
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Patient meaningful %"
          value={pctStr(patientLen.meaningfulPct)}
          sub={`${patientLen.meaningfulSessions.toLocaleString()}/${patientLen.sessions.toLocaleString()} sessions`}
          accent="#34C759"
        />
        <StatCard
          label="Doctor meaningful %"
          value={pctStr(doctorLen.meaningfulPct)}
          sub={`${doctorLen.meaningfulSessions.toLocaleString()}/${doctorLen.sessions.toLocaleString()} sessions`}
          accent="#34C759"
        />
        <StatCard
          label="Patient sessions"
          value={patientLen.sessions.toLocaleString()}
          sub="distinct in window"
          accent="#5AC8FA"
        />
        <StatCard
          label="Doctor sessions"
          value={doctorLen.sessions.toLocaleString()}
          sub="distinct in window"
          accent="#142240"
        />
      </div>

      {/* SECONDARY -- usage timing and concentration. Helpful for
          operating decisions (when to staff coverage, who the heaviest
          users are) but not pilot-defining on their own. */}
      <SectionHead hint={`Sessions per start hour · ${tzLabel}`}>
        Secondary metrics · when the apps are opened
      </SectionHead>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <Card>
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            Patients
          </div>
          <HourChart data={d.patientsByHour} fill="#5AC8FA" />
        </Card>
        <Card>
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            Doctors
          </div>
          <HourChart data={d.doctorsByHour} fill="#142240" />
        </Card>
      </div>

      {/* Top users. Plain ranked lists -- no avatars, no joins.
          user_id is sufficient for the operator who is going to drill
          in via the Patients / Doctors tabs anyway. */}
      <SectionHead hint="Heaviest users by session count">
        Top users
      </SectionHead>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <TopUsersList title="Patients" rows={d.topUsers.patients} />
        <TopUsersList title="Doctors" rows={d.topUsers.doctors} />
      </div>

      {/* TERTIARY -- diagnostic. Session length is descriptive only;
          a 10s session that lands a check-in is a win, a 5min wander
          is not. Event flow helps spot a client that stopped firing.
          Timezone coverage is just for transparency on the chart axis. */}
      <SectionHead hint="Descriptive only — not a success metric">
        Diagnostic metrics · session length
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Patient avg length"
          value={fmtSecs(patientLen.avgSecs)}
          sub={`median ${fmtSecs(patientLen.medianSecs)} · p95 ${fmtSecs(patientLen.p95Secs)}`}
          accent="#5AC8FA"
        />
        <StatCard
          label="Patient meaningful avg length"
          value={fmtSecs(patientLen.avgSecsMeaningful)}
          sub="check-in sessions only"
          accent="#5AC8FA"
        />
        <StatCard
          label="Doctor avg length"
          value={fmtSecs(doctorLen.avgSecs)}
          sub={`median ${fmtSecs(doctorLen.medianSecs)} · p95 ${fmtSecs(doctorLen.p95Secs)}`}
          accent="#142240"
        />
        <StatCard
          label="Doctor meaningful avg length"
          value={fmtSecs(doctorLen.avgSecsMeaningful)}
          sub="patient-view sessions only"
          accent="#142240"
        />
      </div>
      <Card>
        <div className="text-sm text-muted-foreground">
          Session length is approximate and descriptive only. Short sessions can
          still be successful if a key action was completed (see the meaningful
          engagement cards above). Treat avg/median as descriptive, not a
          success metric.
        </div>
      </Card>

      {/* Event-name flow check. Helps spot the case where one of the
          clients silently stopped firing a particular event. */}
      <SectionHead hint="Raw counts per event_name + role">
        Event flow
      </SectionHead>
      <Card>
        {d.eventCounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No events in window.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="font-semibold py-1.5">Event</th>
                <th className="font-semibold py-1.5">Role</th>
                <th className="font-semibold py-1.5 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {d.eventCounts.map((e, i) => (
                <tr key={`${e.eventName}-${e.userType}-${i}`} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 font-medium text-foreground">{e.eventName}</td>
                  <td className="py-1.5 capitalize text-muted-foreground">{e.userType}</td>
                  <td className="py-1.5 text-right tabular-nums text-foreground">
                    {e.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SectionHead>How these are computed</SectionHead>
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

function HourChart({ data, fill }: { data: number[]; fill: string }) {
  const rows = data.map((sessions, hour) => ({
    hour: hour.toString().padStart(2, "0"),
    sessions,
  }));
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={{ stroke: "#E5E7EB" }}
            interval={2}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "#6B7280" }}
            tickLine={false}
            axisLine={{ stroke: "#E5E7EB" }}
            width={32}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              fontSize: 12,
            }}
            formatter={(v: unknown) => [String(v), "Sessions"]}
            labelFormatter={(h) => `${h}:00`}
          />
          <Bar dataKey="sessions" fill={fill} radius={[3, 3, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopUsersList({
  title,
  rows,
}: {
  title: string;
  rows: UsageTopUser[];
}) {
  return (
    <Card>
      <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No sessions in window.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li
              key={`${r.userType}-${r.userId}`}
              className="flex items-center justify-between"
            >
              <span className="font-medium text-foreground">#{r.userId}</span>
              <span className="text-muted-foreground tabular-nums">
                {r.sessions.toLocaleString()} session{r.sessions === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function fmtSecs(secs: number): string {
  if (!secs) return "0s";
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = secs / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}
