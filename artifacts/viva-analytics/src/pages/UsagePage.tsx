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

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle={`Product activity over the last ${d.windowDays} days, sourced from the analytics stream.`}
      />

      {/* Session length summary up top -- this is the headline number
          for "are people actually using the product or just opening it
          and bouncing". */}
      <SectionHead hint="Per-role session length and totals">
        Sessions
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Patient sessions"
          value={patientLen.sessions.toLocaleString()}
          sub="distinct in window"
          accent="#5AC8FA"
        />
        <StatCard
          label="Patient avg length"
          value={fmtSecs(patientLen.avgSecs)}
          sub={`p50 ${fmtSecs(patientLen.p50Secs)} · p95 ${fmtSecs(patientLen.p95Secs)}`}
          accent="#5AC8FA"
        />
        <StatCard
          label="Doctor sessions"
          value={doctorLen.sessions.toLocaleString()}
          sub="distinct in window"
          accent="#142240"
        />
        <StatCard
          label="Doctor avg length"
          value={fmtSecs(doctorLen.avgSecs)}
          sub={`p50 ${fmtSecs(doctorLen.p50Secs)} · p95 ${fmtSecs(doctorLen.p95Secs)}`}
          accent="#142240"
        />
      </div>

      {/* Hour-of-day bars. Two charts, same axis, so the operator can
          compare patient vs doctor opening patterns at a glance.
          Server-local hour because that's how the team will read it
          ("doctors open it after lunch"). */}
      <SectionHead hint="Distinct sessions per hour-of-day (server local)">
        When the apps are opened
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
