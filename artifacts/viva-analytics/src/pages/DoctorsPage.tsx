import { useMemo, useState } from "react";
import type { AnalyticsSummary, DoctorDrillRow } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Card, Empty, PageHeader } from "@/components/primitives";

type Sort =
  | "name"
  | "patientCount"
  | "activePatients"
  | "stoppedPatients"
  | "notesWritten"
  | "statusesUpdated";

/**
 * Per-doctor drill-down. Sortable columns let the team see who's
 * carrying the load and who hasn't logged in. Patients with no doctor
 * assigned are filtered upstream — they show in the patients table.
 */
export function DoctorsPage({ data }: { data: AnalyticsSummary }) {
  const rows = data.drilldown?.doctors ?? [];
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("patientCount");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo<DoctorDrillRow[]>(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle)
      );
    });
    const mul = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * mul;
      const av = a[sort] as number;
      const bv = b[sort] as number;
      return (av - bv) * mul;
    });
  }, [rows, q, sort, dir]);

  function header(label: string, key: Sort, align: "left" | "right" = "right") {
    const active = sort === key;
    return (
      <th
        className={`${align === "left" ? "text-left" : "text-right"} font-semibold px-2 py-1.5 cursor-pointer select-none`}
        onClick={() => {
          if (active) setDir(dir === "asc" ? "desc" : "asc");
          else {
            setSort(key);
            setDir(key === "name" ? "asc" : "desc");
          }
        }}
      >
        <span className={active ? "text-foreground" : ""}>
          {label}
          {active && (
            <span className="ml-1 text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>
          )}
        </span>
      </th>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Doctors" />
        <Empty>No doctors in the system yet.</Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Doctors"
        subtitle="Every clinician in the system. Click a column header to sort."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email"
            className="flex-1 min-w-[220px] px-3 py-1.5 rounded-xl border border-border bg-background text-sm outline-none focus:border-foreground/60"
          />
          <div className="text-xs text-muted-foreground tabular-nums ml-auto">
            {filtered.length} / {rows.length}
          </div>
        </div>
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-[11px] uppercase tracking-wide">
                {header("Doctor", "name", "left")}
                {header("Patients", "patientCount")}
                {header("Active", "activePatients")}
                {header("Stopped", "stoppedPatients")}
                {header("Notes (30d)", "notesWritten")}
                {header("Status updates (30d)", "statusesUpdated")}
                <th className="text-left font-semibold px-2 py-1.5">Last active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground">
                    No doctors match.
                  </td>
                </tr>
              )}
              {filtered.map((d) => (
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
    </>
  );
}
