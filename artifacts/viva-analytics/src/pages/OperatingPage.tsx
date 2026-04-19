import type { AnalyticsSummary } from "@/lib/types";
import { pctStr } from "@/lib/format";
import { Empty, PageHeader, SectionHead, StatCard } from "@/components/primitives";

/**
 * Operating metrics. Patient activity = check-ins ∪ intervention_events.
 * Doctor activity = doctor_notes ∪ status updates with source='doctor'.
 * Apple Health adoption derives from intervention_events.treatment_state_snapshot
 * dataTier='wearable' over 30d (no fake flag invented).
 */
export function OperatingPage({ data }: { data: AnalyticsSummary }) {
  const op = data.operating;
  if (!op) {
    return (
      <>
        <PageHeader title="Operating" />
        <Empty>The server didn't return an operating block.</Empty>
      </>
    );
  }
  const p = op.patients;
  const d = op.doctors;
  return (
    <>
      <PageHeader
        title="Operating"
        subtitle={`Activity over the last ${op.windowDays} days, derived directly from existing tables — no schema additions, no synthetic flags.`}
      />

      <SectionHead hint="Patient activity = check-ins ∪ intervention_events">
        Viva Care · patients
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
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

      <SectionHead hint="Doctor activity = notes ∪ status updates with source='doctor'">
        Viva Clinic · doctors
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
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
          sub={`Distinct patients with a note in last ${op.windowDays}d`}
          accent="#38B6FF"
        />
        <StatCard
          label="Status updates"
          value={d.treatmentStatusesUpdated}
          sub={`In last ${op.windowDays}d`}
        />
        <StatCard
          label="Notes written"
          value={d.notesWritten}
          sub={`In last ${op.windowDays}d`}
        />
        <StatCard
          label="Avg patients reviewed / doctor"
          value={d.avgPatientsReviewedPerDoctor.toFixed(1)}
          sub="Doctors with a panel"
        />
      </div>
    </>
  );
}
