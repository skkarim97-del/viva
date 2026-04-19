import { Link } from "wouter";
import type { AnalyticsSummary } from "@/lib/types";
import { pctStr } from "@/lib/format";
import {
  Card,
  Chip,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

/**
 * Overview = the page someone hits when they want to know "how is the
 * product doing today?" without committing to a deep-dive. Shows the
 * 6 numbers that matter most + one row of jump-off cards into the
 * specialised sections.
 */
export function OverviewPage({ data }: { data: AnalyticsSummary }) {
  const op = data.operating;
  const ts = data.treatmentStatus;
  const sanity = data.dataSanity;

  return (
    <>
      <PageHeader
        title="Today at Viva"
        subtitle="The headline numbers, refreshed every minute. Pick a section in the sidebar to dig deeper."
        right={
          sanity ? (
            <Chip tone={sanity.ok ? "good" : "bad"}>
              {sanity.ok ? "Data reconciled" : "Data mismatch"}
            </Chip>
          ) : undefined
        }
      />

      <SectionHead hint="Across the whole panel">
        Headline
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <StatCard
          label="Total patients"
          value={op?.patients.total ?? "—"}
          sub={
            op
              ? `${op.patients.activated} activated`
              : undefined
          }
          accent="#38B6FF"
        />
        <StatCard
          label="Active today"
          value={op?.patients.activeToday ?? "—"}
          sub="Check-in or app intervention"
          accent="#34C759"
        />
        <StatCard
          label="WAU patients"
          value={op?.patients.wau ?? "—"}
          sub="Last 7 days"
        />
        <StatCard
          label="On treatment"
          value={ts ? pctStr(ts.pctStillOnTreatment) : "—"}
          sub={
            ts
              ? `${ts.active} of ${ts.active + ts.stopped} confirmed`
              : undefined
          }
          accent="#34C759"
        />
        <StatCard
          label="Doctors active 7d"
          value={op?.doctors.wau ?? "—"}
          sub={op ? `${op.doctors.withPanel} with a panel` : undefined}
          accent="#142240"
        />
        <StatCard
          label="Notes (30d)"
          value={op?.doctors.notesWritten ?? "—"}
          sub={op ? `${op.doctors.treatmentStatusesUpdated} status updates` : undefined}
        />
      </div>

      <SectionHead>Jump in</SectionHead>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <JumpCard
          to="/operating"
          label="Operating"
          desc="DAU · WAU · MAU. Apple Health, check-ins, coaching adoption. Doctor activity."
        />
        <JumpCard
          to="/retention"
          label="Retention & churn"
          desc="% still on treatment, top stop reasons, when patients stop, reason × timing matrix."
        />
        <JumpCard
          to="/behavior"
          label="System behavior"
          desc="Next-day check-in lift after intervention, engagement uplift, top intervention types."
        />
        <JumpCard
          to="/patients"
          label="Drill-down"
          desc="Patient and doctor tables — exactly the rows that produced the rollups above."
        />
      </div>

      {sanity && (
        <>
          <SectionHead>Data reconciliation</SectionHead>
          <Card>
            <div className="text-sm flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <Stat label="Total panel" value={sanity.totalPatientsRow} />
              <Stat label="Σ by status" value={sanity.sumByStatus} />
              <Stat label="Stopped" value={sanity.stoppedRow} />
              <Stat label="Σ by reason" value={sanity.stoppedSumByReason} />
              <Stat label="Σ by timing" value={sanity.stoppedSumByTiming} />
              <Chip tone={sanity.ok ? "good" : "bad"}>
                {sanity.ok ? "Reconciled" : "Mismatch"}
              </Chip>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function JumpCard({
  to,
  label,
  desc,
}: {
  to: string;
  label: string;
  desc: string;
}) {
  return (
    <Link
      href={to}
      className="block bg-card border border-border rounded-2xl p-4 hover:border-foreground/30 transition-colors"
    >
      <div className="font-display font-bold text-foreground text-[15px] mb-1">
        {label} <span className="text-accent">→</span>
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed">
        {desc}
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      {label}:{" "}
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}
