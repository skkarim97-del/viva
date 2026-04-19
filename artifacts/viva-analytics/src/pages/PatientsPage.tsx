import { useMemo, useState } from "react";
import type { AnalyticsSummary, PatientDrillRow } from "@/lib/types";
import { STOP_REASON_DISPLAY, TIMING_DISPLAY } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import {
  Card,
  Chip,
  Empty,
  PageHeader,
  statusLabel,
  statusTone,
} from "@/components/primitives";

type StatusFilter = "all" | "active" | "stopped" | "unknown";

/**
 * Per-patient drill-down. The denominator for every rollup elsewhere
 * in the app comes from this table — what you see here *is* the data,
 * not a sample. Search + status filter let you slice without writing
 * SQL.
 */
export function PatientsPage({ data }: { data: AnalyticsSummary }) {
  const rows = data.drilldown?.patients ?? [];
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [appleOnly, setAppleOnly] = useState(false);

  const filtered = useMemo<PatientDrillRow[]>(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.treatmentStatus !== statusFilter) return false;
      if (appleOnly && !r.appleHealthConnected) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle) ||
        r.doctorName.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, statusFilter, appleOnly]);

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Patients" />
        <Empty>No patients in the system yet.</Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="Every patient in the panel. The numbers in Operating and Retention are derived directly from these rows."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, or doctor"
            className="flex-1 min-w-[220px] px-3 py-1.5 rounded-xl border border-border bg-background text-sm outline-none focus:border-foreground/60"
          />
          <div className="flex gap-1">
            {(["all", "active", "stopped", "unknown"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground border border-border hover:bg-secondary"
                }`}
              >
                {s === "all" ? "All" : statusLabel(s)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAppleOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              appleOnly
                ? "bg-accent/15 text-accent border-accent/30"
                : "bg-background text-muted-foreground border-border hover:bg-secondary"
            }`}
          >
            Apple Health only
          </button>
          <div className="text-xs text-muted-foreground tabular-nums ml-auto">
            {filtered.length} / {rows.length}
          </div>
        </div>
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-[11px] uppercase tracking-wide">
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
                  <td colSpan={8} className="px-2 py-8 text-center text-muted-foreground">
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
                    {r.treatmentStatus === "stopped" && r.stopTimingBucket !== "unknown"
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
    </>
  );
}
