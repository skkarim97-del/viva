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

      {/* PIPELINE HEALTH -- compact dot strip answering "is data
          flowing?" before any numbers are read. Six stages: activation,
          check-ins, interventions, feedback, escalations, provider reviews. */}
      <DataHealthStrip data={data} />

      {/* VIVA PULSE -- synthesised observations from available data.
          Surfaces the 2-4 most operationally relevant signals so the
          operator doesn't have to infer them from raw numbers. */}
      <VivaPulse data={data} />

      {/* PRIMARY -- eight numbers covering both the engagement funnel
          and the clinical response loop. Expanded from five to answer
          "are patients engaging?", "are interventions firing?", and
          "are escalations being addressed?" in one glance. */}
      <SectionHead hint="Across the whole panel, the numbers to read first">
        Primary metrics · pilot health
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Weekly active patients"
          value={op?.patients.wau ?? "—"}
          sub={op ? `${op.patients.activated} activated` : "Last 7 days"}
          accent="#34C759"
        />
        <StatCard
          label="Check-in completion"
          value={op ? pctStr(op.patients.pctCompletingCheckins) : "—"}
          sub={
            op
              ? `${op.patients.completingCheckins} of ${op.patients.activated} activated`
              : undefined
          }
          accent={
            op
              ? op.patients.pctCompletingCheckins >= 0.6
                ? "#34C759"
                : op.patients.pctCompletingCheckins >= 0.35
                  ? "#FF9500"
                  : "#FF3B30"
              : "#38B6FF"
          }
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
          label="Interventions triggered"
          value={data.pilot?.interventions.triggered ?? "—"}
          sub={
            data.pilot
              ? `${pctStr(data.pilot.interventions.pctEngaged)} engaged`
              : "Last 30 days"
          }
          accent={
            data.pilot
              ? data.pilot.interventions.pctEngaged >= 0.5
                ? "#34C759"
                : "#FF9500"
              : "#38B6FF"
          }
        />
        <StatCard
          label="Escalations open"
          value={data.openEscalations?.open ?? "—"}
          sub={
            data.openEscalations
              ? `${data.openEscalations.reviewedLast7d} reviewed last 7d`
              : undefined
          }
          accent={
            data.openEscalations && data.openEscalations.open > 0
              ? "#FF9500"
              : "#34C759"
          }
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
          desc="Patient and doctor tables: exactly the rows that produced the rollups above."
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

// ---- DataHealthStrip -----------------------------------------------
// One dot per pipeline stage. Green = data flowing normally. Orange =
// data present but below expected threshold. Grey = no events yet (not
// necessarily broken — pilot may just be early). Distinguishes "no data
// yet" from "possible issue" so the operator knows whether to debug or
// just wait.

type PipelineStatus = "ok" | "warn" | "no_data";

interface PipelineIndicator {
  label: string;
  status: PipelineStatus;
  detail: string;
}

const STATUS_COLOR: Record<PipelineStatus, string> = {
  ok: "#34C759",
  warn: "#FF9500",
  no_data: "#8B95A5",
};

function buildPipeline(data: AnalyticsSummary): PipelineIndicator[] {
  const op = data.operating;
  const pilot = data.pilot;
  const esc = data.openEscalations;
  const indicators: PipelineIndicator[] = [];

  // 1. Activation
  if (!op) {
    indicators.push({ label: "Activation", status: "no_data", detail: "no operating data" });
  } else if (op.patients.activated === 0) {
    indicators.push({ label: "Activation", status: "no_data", detail: "0 patients activated" });
  } else {
    indicators.push({ label: "Activation", status: "ok", detail: `${op.patients.activated} activated` });
  }

  // 2. Check-ins
  if (!op) {
    indicators.push({ label: "Check-ins", status: "no_data", detail: "no operating data" });
  } else if (op.patients.completingCheckins === 0) {
    indicators.push({ label: "Check-ins", status: "no_data", detail: "0 completing" });
  } else if (op.patients.pctCompletingCheckins < 0.2) {
    indicators.push({ label: "Check-ins", status: "warn", detail: `${pctStr(op.patients.pctCompletingCheckins)} completing` });
  } else {
    indicators.push({ label: "Check-ins", status: "ok", detail: `${pctStr(op.patients.pctCompletingCheckins)} completing` });
  }

  // 3. Interventions
  if (!pilot) {
    indicators.push({ label: "Interventions", status: "no_data", detail: "pilot metrics unavailable" });
  } else if (pilot.interventions.triggered === 0) {
    indicators.push({ label: "Interventions", status: "no_data", detail: "0 triggered" });
  } else {
    indicators.push({ label: "Interventions", status: "ok", detail: `${pilot.interventions.triggered} triggered` });
  }

  // 4. Patient feedback / engagement
  if (!pilot) {
    indicators.push({ label: "Feedback", status: "no_data", detail: "pilot metrics unavailable" });
  } else if (pilot.interventions.triggered === 0) {
    indicators.push({ label: "Feedback", status: "no_data", detail: "no interventions yet" });
  } else if (pilot.interventions.pctEngaged < 0.1) {
    indicators.push({ label: "Feedback", status: "warn", detail: `${pctStr(pilot.interventions.pctEngaged)} engagement rate` });
  } else {
    indicators.push({ label: "Feedback", status: "ok", detail: `${pctStr(pilot.interventions.pctEngaged)} engaged` });
  }

  // 5. Escalations
  if (!esc) {
    indicators.push({ label: "Escalations", status: "no_data", detail: "no escalation data" });
  } else {
    // High open count isn't a data issue — just surfaces the number.
    const status: PipelineStatus = esc.open > 10 ? "warn" : "ok";
    indicators.push({ label: "Escalations", status, detail: `${esc.open} open` });
  }

  // 6. Provider reviews
  if (!pilot) {
    indicators.push({ label: "Provider reviews", status: "no_data", detail: "pilot metrics unavailable" });
  } else if (pilot.provider.patientsEscalated === 0) {
    indicators.push({ label: "Provider reviews", status: "no_data", detail: "no escalations yet" });
  } else if (pilot.provider.pctReviewed < 0.4) {
    indicators.push({ label: "Provider reviews", status: "warn", detail: `${pctStr(pilot.provider.pctReviewed)} reviewed` });
  } else {
    indicators.push({ label: "Provider reviews", status: "ok", detail: `${pctStr(pilot.provider.pctReviewed)} reviewed` });
  }

  return indicators;
}

function DataHealthStrip({ data }: { data: AnalyticsSummary }) {
  const indicators = buildPipeline(data);
  return (
    <>
      <SectionHead hint="Is data flowing through all six pipeline stages?">
        Data flow · pipeline health
      </SectionHead>
      <Card className="py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          {indicators.map((ind) => (
            <div key={ind.label} className="flex items-center gap-1.5 text-[12px]">
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLOR[ind.status] }}
              />
              <span className="font-semibold text-foreground">{ind.label}</span>
              <span className="text-muted-foreground">{ind.detail}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// ---- VivaPulse -----------------------------------------------------
// Synthesised observations, up to 4. Each is grounded in a specific
// metric so the operator can click through to the relevant section.
// Deliberately conservative: only fires if the signal is meaningful
// enough to act on or useful enough to surface.

type ObsLevel = "ok" | "warn" | "info";

interface Obs {
  level: ObsLevel;
  text: string;
}

const OBS_DOT: Record<ObsLevel, string> = {
  ok: "#34C759",
  warn: "#FF9500",
  info: "#38B6FF",
};

function buildObservations(data: AnalyticsSummary): Obs[] {
  const obs: Obs[] = [];
  const op = data.operating;
  const pilot = data.pilot;
  const ts = data.treatmentStatus;
  const esc = data.openEscalations;
  const plan = data.planAdherence;

  // Check-in completion
  if (op && op.patients.activated > 0) {
    if (op.patients.pctCompletingCheckins < 0.2) {
      obs.push({
        level: "warn",
        text: `Only ${pctStr(op.patients.pctCompletingCheckins)} of activated patients are completing check-ins — onboarding or engagement issue likely.`,
      });
    } else if (op.patients.pctCompletingCheckins >= 0.7) {
      obs.push({
        level: "ok",
        text: `${pctStr(op.patients.pctCompletingCheckins)} of activated patients are completing check-ins — strong engagement baseline.`,
      });
    } else {
      obs.push({
        level: "info",
        text: `${pctStr(op.patients.pctCompletingCheckins)} check-in completion. Stable, with room to improve.`,
      });
    }
  }

  // Intervention engagement and auto-resolution
  if (pilot && pilot.interventions.triggered > 0) {
    if (pilot.interventions.pctEngaged < 0.3) {
      obs.push({
        level: "warn",
        text: `Intervention engagement is ${pctStr(pilot.interventions.pctEngaged)} — patients are receiving Viva's suggestions but mostly not acting on them.`,
      });
    } else if (pilot.interventions.pctAutoResolved >= 0.5) {
      obs.push({
        level: "ok",
        text: `${pctStr(pilot.interventions.pctAutoResolved)} of interventions auto-resolved without escalation — Viva is handling most issues at the app layer.`,
      });
    }
  }

  // Escalation review rate
  if (pilot && pilot.provider.patientsEscalated > 0) {
    if (pilot.provider.pctReviewed < 0.5) {
      obs.push({
        level: "warn",
        text: `Only ${pctStr(pilot.provider.pctReviewed)} of escalations reviewed by a doctor — more than half are pending provider response.`,
      });
    } else if (pilot.provider.pctActedOn >= 0.7) {
      obs.push({
        level: "ok",
        text: `Providers acted on ${pctStr(pilot.provider.pctActedOn)} of escalations — the care loop is closing well.`,
      });
    }
  } else if (esc && esc.open > 5) {
    obs.push({
      level: "warn",
      text: `${esc.open} escalations are currently open. Check provider review queue.`,
    });
  }

  // Plan adherence
  if (obs.length < 4) {
    if (plan === null) {
      obs.push({
        level: "info",
        text: "No plan activity events received yet. Plan adherence tracking will activate once patients interact with care plans.",
      });
    } else if (plan && plan.totalPatientsWithPlanItems > 0) {
      const denom = plan.itemsCompleted + plan.itemsSkipped;
      const adherencePct = denom > 0 ? plan.itemsCompleted / denom : null;
      if (adherencePct !== null) {
        if (adherencePct < 0.4) {
          obs.push({
            level: "warn",
            text: `Plan adherence is ${pctStr(adherencePct)} — patients are skipping most care plan items.`,
          });
        } else {
          obs.push({
            level: "info",
            text: `Plan adherence is ${pctStr(adherencePct)} across ${plan.totalPatientsWithPlanItems} patients with care plans.`,
          });
        }
      }
    }
  }

  // Disengagement (fallback filler if still below 2)
  if (obs.length < 2 && ts?.disengagement && ts.disengagement.inactive12d > 0) {
    const pct =
      ts.disengagement.considered > 0
        ? ts.disengagement.inactive12d / ts.disengagement.considered
        : null;
    obs.push({
      level: "warn",
      text: `${ts.disengagement.inactive12d} patients${pct ? ` (${pctStr(pct)})` : ""} haven't checked in for 12+ days — outreach recommended.`,
    });
  }

  // Wearable coverage (informational filler)
  if (obs.length < 3 && op && op.patients.activated > 0) {
    if (op.patients.pctAppleHealthConnected < 0.2) {
      obs.push({
        level: "info",
        text: `${pctStr(op.patients.pctAppleHealthConnected)} of patients have Apple Health connected — wearable data coverage is limited.`,
      });
    } else if (op.patients.pctAppleHealthConnected >= 0.5) {
      obs.push({
        level: "info",
        text: `${pctStr(op.patients.pctAppleHealthConnected)} of patients have Apple Health connected — good wearable data coverage.`,
      });
    }
  }

  return obs.slice(0, 4);
}

function VivaPulse({ data }: { data: AnalyticsSummary }) {
  const observations = buildObservations(data);
  if (observations.length === 0) return null;
  return (
    <>
      <SectionHead hint="Synthesised from pilot data — not a clinical assessment">
        What Viva is noticing
      </SectionHead>
      <Card>
        <ul className="space-y-2.5">
          {observations.map((obs, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px]">
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full mt-[3px] shrink-0"
                style={{ backgroundColor: OBS_DOT[obs.level] }}
              />
              <span className="text-foreground leading-snug">{obs.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// ---- shared helpers ------------------------------------------------

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
