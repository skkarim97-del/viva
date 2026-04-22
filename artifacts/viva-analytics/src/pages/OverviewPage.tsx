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
        subtitle="Pilot executive summary, refreshed every minute. Pick a section below to dig deeper."
        right={
          sanity ? (
            <Chip tone={sanity.ok ? "good" : "bad"}>
              {sanity.ok ? "Data reconciled" : "Data mismatch"}
            </Chip>
          ) : undefined
        }
      />

      {/* PRIMARY -- the four numbers a pilot operator should read
          first. Plus total panel for context (so the others aren't
          read in a vacuum). */}
      <SectionHead hint="Across the whole panel — the numbers to read first">
        Primary metrics · pilot health
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <StatCard
          label="Weekly active patients"
          value={op?.patients.wau ?? "—"}
          sub={op ? `${op.patients.activated} activated` : "Last 7 days"}
          accent="#34C759"
        />
        <StatCard
          label="Doctors active 7d"
          value={op?.doctors.wau ?? "—"}
          sub={op ? `${op.doctors.withPanel} with a panel` : undefined}
          accent="#142240"
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
          label="Patients reviewed (30d)"
          value={op?.doctors.patientsReviewed ?? "—"}
          sub={
            op
              ? `Avg ${op.doctors.avgPatientsReviewedPerDoctor.toFixed(1)} / doctor`
              : undefined
          }
          accent="#38B6FF"
        />
        <StatCard
          label="Total patients"
          value={op?.patients.total ?? "—"}
          sub={op ? `${op.patients.activated} activated` : undefined}
          accent="#38B6FF"
        />
      </div>

      {/* SECONDARY -- jump-off into the deep-dive pages. Care loop
          and Usage are the two newer pilot-critical surfaces, so they
          lead. */}
      <SectionHead hint="Deep-dive into a specific signal">
        Secondary · jump in
      </SectionHead>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <JumpCard
          to="/care-loop"
          label="Care loop"
          desc="Did Viva signals lead to doctor action and patient follow-through? Patients touched, escalations, % reviewed, time to review, follow-up rate."
        />
        <JumpCard
          to="/operating"
          label="Operating"
          desc="Activation, weekly active patients, completing check-ins, coach engagement. Doctor activity and write volume."
        />
        <JumpCard
          to="/retention"
          label="Retention"
          desc="% still on treatment, total churned, inactive 12+d, stop reasons, churn by cohort."
        />
        <JumpCard
          to="/behavior"
          label="System behavior"
          desc="Next-day check-in lift after intervention, engagement uplift, symptom trend, top intervention types."
        />
        <JumpCard
          to="/usage"
          label="Usage"
          desc="Meaningful sessions, when the apps are opened, top users, session length (descriptive)."
        />
        <JumpCard
          to="/patients"
          label="Drill-down"
          desc="Patient and doctor tables — exactly the rows that produced the rollups above."
        />
      </div>

      {sanity && (
        <>
          <SectionHead>Diagnostic · data reconciliation</SectionHead>
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
