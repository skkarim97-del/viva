import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/Logo";

/**
 * Viva Analytics -- internal operating dashboard for the Viva team.
 * Lives at /viva-analytics. Bypasses the clinician auth gate; uses
 * the same operator bearer key as /internal and /internal/analytics
 * (one key, three internal surfaces).
 *
 * Visually a sibling to viva clinic: same Montserrat type, same
 * card / chip / table primitives, same navy + accent palette. Built
 * desktop-first with stacked layouts on narrow viewports.
 */

// ---------------------------------------------------------------- types

interface PatientsBlock {
  total: number;
  activated: number;
  activeToday: number;
  dau: number;
  wau: number;
  mau: number;
  appleHealthConnected: number;
  pctAppleHealthConnected: number;
  completingCheckins: number;
  pctCompletingCheckins: number;
  coachEngaged: number;
  pctEngagingCoaching: number;
}
interface DoctorsBlock {
  total: number;
  withPanel: number;
  dau: number;
  wau: number;
  mau: number;
  patientsReviewed: number;
  treatmentStatusesUpdated: number;
  notesWritten: number;
  avgPatientsReviewedPerDoctor: number;
}
interface OperatingBlock {
  windowDays: number;
  patients: PatientsBlock;
  doctors: DoctorsBlock;
}

interface TreatmentStatusBlock {
  totalPatients: number;
  active: number;
  stopped: number;
  unknown: number;
  pctStillOnTreatment: number;
  topStopReasons: Array<{ reason: string; count: number; pct: number }>;
  stopTiming: {
    early: number;
    mid: number;
    late: number;
    unknown: number;
    knownDenom: number;
  };
  stopReasonByTiming: Array<{
    reason: string;
    early: number;
    mid: number;
    late: number;
    unknown: number;
  }>;
}

interface HealthBlock {
  windowDays: number;
  nextDayCheckinAfterIntervention: { users: number; denom: number; pct: number };
  engagementImproved3d: { users: number; denom: number; pct: number };
  topInterventions: Array<{ type: string; count: number }>;
  symptomTrend: {
    direction: "improving" | "worsening" | "flat" | "no_data";
    improved: number;
    worsened: number;
    stable: number;
  };
}

interface PatientDrillRow {
  id: number;
  name: string;
  email: string;
  doctorName: string;
  doctorId: number;
  treatmentStatus: "active" | "stopped" | "unknown";
  stopReason: string | null;
  stopTimingBucket: "early" | "mid" | "late" | "unknown";
  daysOnTreatment: number | null;
  lastCheckin: string | null;
  appleHealthConnected: boolean;
}
interface DoctorDrillRow {
  id: number;
  name: string;
  email: string;
  patientCount: number;
  activePatients: number;
  stoppedPatients: number;
  notesWritten: number;
  statusesUpdated: number;
  lastActiveAt: string | null;
}
interface DrilldownBlock {
  patients: PatientDrillRow[];
  doctors: DoctorDrillRow[];
}

interface DataSanityBlock {
  totalPatientsRow: number;
  sumByStatus: number;
  stoppedRow: number;
  stoppedSumByReason: number;
  stoppedSumByTiming: number;
  ok: boolean;
}

interface AnalyticsSummary {
  generatedAt: string;
  operating?: OperatingBlock;
  treatmentStatus?: TreatmentStatusBlock;
  health?: HealthBlock;
  drilldown?: DrilldownBlock;
  dataSanity?: DataSanityBlock;
}

// ----------------------------------------------------------- key gating

const KEY_STORAGE = "viva.internalKey";

async function fetchSummary(key: string): Promise<AnalyticsSummary> {
  const res = await fetch("/api/internal/analytics/summary", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) throw new Error("invalid_key");
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "internal_metrics_disabled");
  }
  if (!res.ok) throw new Error("analytics_failed");
  return (await res.json()) as AnalyticsSummary;
}

// --------------------------------------------------------- format utils

function pctStr(p: number, fallback = "—"): string {
  if (!Number.isFinite(p)) return fallback;
  return `${Math.round(p * 100)}%`;
}
function ratio(num: number, denom: number, fallback = "—"): string {
  if (!denom) return fallback;
  return `${Math.round((num / denom) * 100)}%`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

const STOP_REASON_DISPLAY: Record<string, string> = {
  side_effects: "Side effects",
  cost_or_insurance: "Cost or insurance",
  lack_of_efficacy: "Lack of efficacy",
  patient_choice_or_motivation: "Patient choice or motivation",
  other: "Other",
  unknown: "Unspecified",
};
const TIMING_DISPLAY: Record<"early" | "mid" | "late", string> = {
  early: "Early (≤30d)",
  mid: "Mid (31–90d)",
  late: "Late (>90d)",
};

// ---------------------------------------------------------- ui primitives

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="font-display text-[18px] font-bold text-foreground leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return (
    <div className="font-display text-[13px] font-bold text-foreground mt-4 mb-2 uppercase tracking-wide">
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent = "#142240",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden bg-card rounded-2xl px-5 py-4">
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
        style={{ backgroundColor: accent }}
      />
      <div className="font-display text-[24px] font-bold text-foreground leading-none tabular-nums">
        {value}
      </div>
      <div className="text-xs text-muted-foreground font-semibold mt-2">
        {label}
      </div>
      {sub && (
        <div className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
          {sub}
        </div>
      )}
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl p-5 ${className}`}>{children}</div>
  );
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "muted";
}) {
  const styles: Record<typeof tone, { bg: string; fg: string }> = {
    neutral: { bg: "rgba(20,34,64,0.08)", fg: "#142240" },
    good: { bg: "rgba(52,199,89,0.13)", fg: "#1F8A3E" },
    warn: { bg: "rgba(255,149,0,0.13)", fg: "#B8650A" },
    bad: { bg: "rgba(255,59,48,0.13)", fg: "#B5251D" },
    muted: { bg: "rgba(107,122,144,0.13)", fg: "#6B7A90" },
  };
  const s = styles[tone];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {children}
    </span>
  );
}

function statusTone(s: "active" | "stopped" | "unknown") {
  return s === "active" ? "good" : s === "stopped" ? "bad" : "muted";
}
function statusLabel(s: "active" | "stopped" | "unknown") {
  return s === "active" ? "Active" : s === "stopped" ? "Stopped" : "Unknown";
}

// ---------------------------------------------------------- panel: header

function Header({ generatedAt }: { generatedAt: string | null }) {
  return (
    <header className="bg-background">
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Logo size="sm" />
          <div className="leading-tight">
            <div className="font-display text-[18px] font-bold text-foreground">
              Viva Analytics
            </div>
            <div className="text-xs text-muted-foreground">
              Internal operating dashboard
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {generatedAt
            ? `Refreshed ${new Date(generatedAt).toLocaleTimeString()}`
            : ""}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6">
        <div className="h-px bg-border" />
      </div>
    </header>
  );
}

// ---------------------------------------------------------- panel: gate

function KeyGate({
  onSubmit,
  error,
}: {
  onSubmit: (key: string) => void;
  error: string | null;
}) {
  const [key, setKey] = useState("");
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header generatedAt={null} />
      <main className="flex-1 max-w-md w-full mx-auto px-6 py-12">
        <Card>
          <h1 className="font-display text-[20px] font-bold text-foreground mb-1">
            Operator key required
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            Viva Analytics is internal-only. Enter the operator key to continue.
          </p>
          {error && (
            <div className="text-sm font-semibold text-destructive mb-3">
              {error}
            </div>
          )}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
            placeholder="operator key"
            className="w-full px-4 py-2.5 rounded-2xl border border-border bg-background mb-3 outline-none focus:border-foreground/60"
          />
          <button
            type="button"
            onClick={() => {
              const t = key.trim();
              if (t) onSubmit(t);
            }}
            className="w-full px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold hover:opacity-90 active:scale-[0.99] transition-all"
          >
            Continue
          </button>
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------- panels

function OperatingSection({ o }: { o: OperatingBlock }) {
  const p = o.patients;
  const d = o.doctors;
  return (
    <Section
      title="Operating metrics"
      subtitle={`Activity from existing tables (check-ins + interventions for patients, notes + status updates for doctors). ${o.windowDays}-day window.`}
    >
      <SubHead>viva care · patients</SubHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total patients"
          value={p.total}
          sub={`${p.activated} activated`}
          accent="#38B6FF"
        />
        <StatCard
          label="Active today"
          value={p.activeToday}
          sub="Check-in or app intervention today"
          accent="#34C759"
        />
        <StatCard label="DAU" value={p.dau} sub="Today" />
        <StatCard label="WAU" value={p.wau} sub="Last 7 days" />
        <StatCard label="MAU" value={p.mau} sub="Last 30 days" />
        <StatCard
          label="Apple Health connected"
          value={pctStr(p.pctAppleHealthConnected)}
          sub={`${p.appleHealthConnected} of ${p.activated} activated`}
        />
        <StatCard
          label="Completing check-ins"
          value={pctStr(p.pctCompletingCheckins)}
          sub={`${p.completingCheckins} of ${p.activated} in last 7d`}
        />
        <StatCard
          label="Engaging with coach"
          value={pctStr(p.pctEngagingCoaching)}
          sub={`${p.coachEngaged} of ${p.activated} in last 30d`}
        />
      </div>

      <SubHead>viva clinic · doctors</SubHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total doctors"
          value={d.total}
          sub={`${d.withPanel} with a patient panel`}
          accent="#142240"
        />
        <StatCard label="DAU" value={d.dau} sub="Today" />
        <StatCard label="WAU" value={d.wau} sub="Last 7 days" />
        <StatCard label="MAU" value={d.mau} sub="Last 30 days" />
        <StatCard
          label="Patients reviewed"
          value={d.patientsReviewed}
          sub={`Distinct patients with a note in last ${o.windowDays}d`}
          accent="#38B6FF"
        />
        <StatCard
          label="Treatment statuses updated"
          value={d.treatmentStatusesUpdated}
          sub={`In last ${o.windowDays}d`}
        />
        <StatCard
          label="Notes written"
          value={d.notesWritten}
          sub={`In last ${o.windowDays}d`}
        />
        <StatCard
          label="Avg patients reviewed / doctor"
          value={d.avgPatientsReviewedPerDoctor.toFixed(1)}
          sub="Doctors with a panel"
        />
      </div>
    </Section>
  );
}

function RetentionSection({
  t,
  sanity,
}: {
  t: TreatmentStatusBlock;
  sanity?: DataSanityBlock;
}) {
  const onTreatmentDenom = t.active + t.stopped;
  const tone =
    t.pctStillOnTreatment >= 0.85
      ? "good"
      : t.pctStillOnTreatment >= 0.65
        ? "warn"
        : "bad";
  return (
    <Section
      title="Retention & churn"
      subtitle="Active vs stopped vs unknown across the whole panel. % still on treatment excludes unknowns from the denominator so unconfirmed cohorts don't deflate the rate."
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard
          label="% still on treatment"
          value={pctStr(t.pctStillOnTreatment)}
          sub={`${t.active} of ${onTreatmentDenom} confirmed`}
          accent={
            tone === "good" ? "#34C759" : tone === "warn" ? "#FF9500" : "#FF3B30"
          }
        />
        <StatCard label="On treatment" value={t.active} sub="Currently active" accent="#34C759" />
        <StatCard label="Stopped" value={t.stopped} sub="Off treatment" accent="#FF3B30" />
        <StatCard label="Unknown" value={t.unknown} sub="Pending confirmation" accent="#6B7A90" />
        <StatCard label="Total panel" value={t.totalPatients} accent="#38B6FF" />
      </div>

      {t.topStopReasons.length > 0 && (
        <Card className="mb-4">
          <SubHead>Stop reasons</SubHead>
          <div className="flex flex-col gap-2">
            {t.topStopReasons.map((r) => (
              <div
                key={r.reason}
                className="flex items-center gap-3 text-sm"
              >
                <div className="flex-1 truncate">
                  {STOP_REASON_DISPLAY[r.reason] ?? r.reason}
                </div>
                <div className="w-32 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.round(r.pct * 100)}%` }}
                  />
                </div>
                <div className="w-20 text-right text-muted-foreground tabular-nums">
                  {r.count} ({Math.round(r.pct * 100)}%)
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {t.stopTiming.knownDenom > 0 && (
        <Card className="mb-4">
          <SubHead>Stop timing</SubHead>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["early", "mid", "late"] as const).map((k) => {
              const n = t.stopTiming[k];
              const p = t.stopTiming.knownDenom > 0
                ? Math.round((n / t.stopTiming.knownDenom) * 100)
                : 0;
              return (
                <StatCard
                  key={k}
                  label={TIMING_DISPLAY[k]}
                  value={n}
                  sub={`${p}% of known timing`}
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
        </Card>
      )}

      {t.stopReasonByTiming.length > 0 && (
        <Card className="mb-4">
          <SubHead>Reason × timing</SubHead>
          <div className="overflow-x-auto -mx-2">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
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
      )}

      {sanity && (
        <Card>
          <SubHead>Data sanity</SubHead>
          <div className="text-sm flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span>
              Total panel:{" "}
              <span className="font-semibold tabular-nums">{sanity.totalPatientsRow}</span>
            </span>
            <span>
              Sum by status:{" "}
              <span className="font-semibold tabular-nums">{sanity.sumByStatus}</span>
            </span>
            <span>
              Stopped:{" "}
              <span className="font-semibold tabular-nums">{sanity.stoppedRow}</span>
            </span>
            <span>
              Σ by reason:{" "}
              <span className="font-semibold tabular-nums">{sanity.stoppedSumByReason}</span>
            </span>
            <span>
              Σ by timing:{" "}
              <span className="font-semibold tabular-nums">{sanity.stoppedSumByTiming}</span>
            </span>
            <Chip tone={sanity.ok ? "good" : "bad"}>
              {sanity.ok ? "Reconciled" : "Mismatch"}
            </Chip>
          </div>
        </Card>
      )}
    </Section>
  );
}

function SystemBehaviorSection({ h }: { h: HealthBlock }) {
  const trendLabel: Record<HealthBlock["symptomTrend"]["direction"], string> = {
    improving: "Improving",
    worsening: "Worsening",
    flat: "Flat",
    no_data: "No data",
  };
  const trendAccent: Record<HealthBlock["symptomTrend"]["direction"], string> = {
    improving: "#34C759",
    worsening: "#FF3B30",
    flat: "#6B7A90",
    no_data: "#6B7A90",
  };
  const t = h.symptomTrend;
  const trendSub =
    t.direction === "no_data"
      ? "No outcome snapshots yet"
      : `${t.improved} improved · ${t.worsened} worsened · ${t.stable} stable`;
  const top = h.topInterventions;
  return (
    <Section
      title="System behavior"
      subtitle={`Behavioral signals attributed to interventions across the population. ${h.windowDays}-day window.`}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Next-day check-in after intervention"
          value={pctStr(h.nextDayCheckinAfterIntervention.pct)}
          sub={`${h.nextDayCheckinAfterIntervention.users} of ${h.nextDayCheckinAfterIntervention.denom} users`}
          accent="#38B6FF"
        />
        <StatCard
          label="Engagement improving (3d)"
          value={pctStr(h.engagementImproved3d.pct)}
          sub={`${h.engagementImproved3d.users} of ${h.engagementImproved3d.denom} users`}
          accent="#34C759"
        />
        <StatCard
          label="Symptom trend"
          value={trendLabel[t.direction]}
          sub={trendSub}
          accent={trendAccent[t.direction]}
        />
      </div>
      <Card>
        <SubHead>Top interventions</SubHead>
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No interventions logged in this window.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {top.map((r) => (
              <Chip key={r.type} tone="neutral">
                {r.type} · {r.count}
              </Chip>
            ))}
          </div>
        )}
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------- drilldown

function PatientTable({ rows }: { rows: PatientDrillRow[] }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<"all" | "active" | "stopped" | "unknown">("all");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.treatmentStatus !== statusFilter)
        return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle) ||
        r.doctorName.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, statusFilter]);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, or doctor"
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-2xl border border-border bg-background text-sm outline-none focus:border-foreground/60"
        />
        <div className="flex gap-1">
          {(["all", "active", "stopped", "unknown"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-2xl text-xs font-semibold transition-all ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-secondary"
              }`}
            >
              {s === "all" ? "All" : statusLabel(s)}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums ml-auto">
          {filtered.length} / {rows.length}
        </div>
      </div>
      <div className="overflow-x-auto -mx-2">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="text-left font-semibold px-2 py-1.5">Patient</th>
              <th className="text-left font-semibold px-2 py-1.5">Doctor</th>
              <th className="text-left font-semibold px-2 py-1.5">Status</th>
              <th className="text-left font-semibold px-2 py-1.5">Stop reason</th>
              <th className="text-left font-semibold px-2 py-1.5">Stop timing</th>
              <th className="text-right font-semibold px-2 py-1.5">Days on tx</th>
              <th className="text-left font-semibold px-2 py-1.5">Apple Health</th>
              <th className="text-left font-semibold px-2 py-1.5">Last check-in</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-2 py-6 text-center text-muted-foreground"
                >
                  No patients match.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-2 py-2">
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </td>
                <td className="px-2 py-2">{r.doctorName}</td>
                <td className="px-2 py-2">
                  <Chip tone={statusTone(r.treatmentStatus)}>
                    {statusLabel(r.treatmentStatus)}
                  </Chip>
                </td>
                <td className="px-2 py-2">
                  {r.stopReason
                    ? STOP_REASON_DISPLAY[r.stopReason] ?? r.stopReason
                    : "—"}
                </td>
                <td className="px-2 py-2">
                  {r.treatmentStatus === "stopped" &&
                  r.stopTimingBucket !== "unknown"
                    ? TIMING_DISPLAY[r.stopTimingBucket]
                    : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.daysOnTreatment ?? "—"}
                </td>
                <td className="px-2 py-2">
                  {r.appleHealthConnected ? (
                    <Chip tone="good">Connected</Chip>
                  ) : (
                    <Chip tone="muted">Not seen</Chip>
                  )}
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {fmtDate(r.lastCheckin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DoctorTable({ rows }: { rows: DoctorDrillRow[] }) {
  return (
    <Card>
      <div className="overflow-x-auto -mx-2">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="text-left font-semibold px-2 py-1.5">Doctor</th>
              <th className="text-right font-semibold px-2 py-1.5">Patients</th>
              <th className="text-right font-semibold px-2 py-1.5">Active</th>
              <th className="text-right font-semibold px-2 py-1.5">Stopped</th>
              <th className="text-right font-semibold px-2 py-1.5">Notes (30d)</th>
              <th className="text-right font-semibold px-2 py-1.5">Status updates (30d)</th>
              <th className="text-left font-semibold px-2 py-1.5">Last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-6 text-center text-muted-foreground"
                >
                  No doctors yet.
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-2 py-2">
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.email}</div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{d.patientCount}</td>
                <td className="px-2 py-2 text-right tabular-nums">{d.activePatients}</td>
                <td className="px-2 py-2 text-right tabular-nums">{d.stoppedPatients}</td>
                <td className="px-2 py-2 text-right tabular-nums">{d.notesWritten}</td>
                <td className="px-2 py-2 text-right tabular-nums">{d.statusesUpdated}</td>
                <td className="px-2 py-2 text-muted-foreground">
                  {fmtDate(d.lastActiveAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DrilldownSection({ d }: { d: DrilldownBlock }) {
  const [tab, setTab] = useState<"patients" | "doctors">("patients");
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Drill-down"
      subtitle="Inspect the underlying rows the dashboard numbers come from."
    >
      <div className="bg-card rounded-2xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-5 py-4 text-left"
        >
          <span className="font-display text-[15px] font-bold text-foreground">
            {open ? "Hide tables" : "Show tables"}
          </span>
          <span className="text-xs text-muted-foreground">
            {d.patients.length} patients · {d.doctors.length} doctors
          </span>
          <span className="flex-1" />
          <span
            aria-hidden
            className="text-muted-foreground transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ›
          </span>
        </button>
        {open && (
          <div className="px-5 pb-5">
            <div className="flex gap-1 mb-3">
              {(["patients", "doctors"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-2xl text-xs font-semibold transition-all ${
                    tab === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {t === "patients"
                    ? `Patients (${d.patients.length})`
                    : `Doctors (${d.doctors.length})`}
                </button>
              ))}
            </div>
            {tab === "patients" ? (
              <PatientTable rows={d.patients} />
            ) : (
              <DoctorTable rows={d.doctors} />
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------- root page

export function VivaAnalyticsPage() {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY_STORAGE);
      if (stored) setSavedKey(stored);
    } catch {
      /* localStorage blocked */
    }
  }, []);

  const q = useQuery<AnalyticsSummary, Error>({
    queryKey: ["viva-analytics", savedKey],
    queryFn: () => fetchSummary(savedKey!),
    enabled: !!savedKey,
    refetchInterval: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (q.isError && q.error?.message === "invalid_key" && savedKey) {
      setSavedKey(null);
      setKeyError("That access key did not work. Please re-enter it.");
      try {
        window.localStorage.removeItem(KEY_STORAGE);
      } catch {
        /* ignore */
      }
    }
  }, [q.isError, q.error, savedKey]);

  if (!savedKey) {
    return (
      <KeyGate
        error={keyError}
        onSubmit={(k) => {
          try {
            window.localStorage.setItem(KEY_STORAGE, k);
          } catch {
            /* ignore */
          }
          setSavedKey(k);
          setKeyError(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header generatedAt={q.data?.generatedAt ?? null} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {q.isLoading && (
          <div className="text-muted-foreground py-16 text-center">
            Loading analytics…
          </div>
        )}
        {q.isError && (
          <div className="text-destructive py-16 text-center">
            {q.error?.message || "Failed to load analytics."}
          </div>
        )}
        {q.data && (
          <>
            {q.data.operating && <OperatingSection o={q.data.operating} />}
            {q.data.treatmentStatus && (
              <RetentionSection
                t={q.data.treatmentStatus}
                sanity={q.data.dataSanity}
              />
            )}
            {q.data.health && <SystemBehaviorSection h={q.data.health} />}
            {q.data.drilldown && <DrilldownSection d={q.data.drilldown} />}
          </>
        )}
      </main>
      <footer className="text-center text-xs text-muted-foreground pb-8">
        viva analytics · internal
      </footer>
    </div>
  );
}
