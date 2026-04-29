import type { AnalyticsSummary, PilotBlock } from "@/lib/types";
import { pctStr } from "@/lib/format";
import {
  Card,
  Chip,
  Empty,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

/**
 * Pilot Metrics -- the cohort-level KPI page partners ask about.
 * Composed entirely from existing raw data via the server-side
 * computePilotMetrics helper. Reads its slice of the shared summary
 * cache; if the server fails to compute the block we render an
 * empty state rather than crash the whole dashboard.
 *
 * Three KPI groups:
 *   1. Earlier Risk Visibility -- how much risk we surface at all
 *   2. Intervention Performance -- volume + resolution
 *   3. Provider Leverage        -- escalation handling, time-to-action
 *
 * The 30-day external readout (frozen snapshot) is intentionally NOT
 * wired here -- the server-side endpoint is registered but disabled
 * until HIPAA prerequisites are resolved.
 */
export function PilotMetricsPage({ data }: { data: AnalyticsSummary }) {
  const pilot = data.pilot;

  if (!pilot) {
    return (
      <>
        <PageHeader
          title="Pilot Metrics"
          subtitle="Composite KPIs for the pilot cohort. Live, internal-only."
        />
        <Card>
          <Empty>
            Pilot metrics are temporarily unavailable. The rest of the
            dashboard is still up — try refreshing in a minute.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pilot Metrics"
        subtitle={`Cohort-level KPIs over the last ${pilot.windowDays} days. Internal — not for partner sharing yet.`}
        right={
          <Chip tone="muted">
            Cohort {pilot.cohort.activated} activated
          </Chip>
        }
      />

      <RiskSection pilot={pilot} />
      <InterventionSection pilot={pilot} />
      <ProviderSection pilot={pilot} />
      <RulesNote pilot={pilot} />
    </>
  );
}

// ----- A. Earlier Risk Visibility ----------------------------------

function RiskSection({ pilot }: { pilot: PilotBlock }) {
  const r = pilot.risk;
  return (
    <>
      <SectionHead hint="Are we seeing trouble before the doctor would have?">
        Earlier risk visibility
      </SectionHead>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-4">
        <StatCard
          label="% patients flagged at risk"
          value={pctStr(r.pctFlagged)}
          sub={`${r.flaggedPatients} of ${pilot.cohort.activated}`}
          accent={r.pctFlagged >= 0.4 ? "#B5251D" : "#142240"}
        />
        <StatCard
          label="Avg. risk signals per patient"
          value={r.avgSignalsPerPatient.toFixed(2)}
          sub="Fired rules / cohort"
          accent="#142240"
        />
        <StatCard
          label="High-risk patients"
          value={r.bandDistribution.high}
          sub={`${r.bandDistribution.medium} medium · ${r.bandDistribution.low} low`}
          accent="#B5251D"
        />
      </div>

      <Card>
        <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Top risk categories (% of cohort affected)
        </div>
        {r.topCategories.length === 0 ? (
          <Empty>No fired risk rules across the cohort right now.</Empty>
        ) : (
          <div className="space-y-2">
            {r.topCategories.map((c) => (
              <CategoryRow
                key={c.code}
                label={c.label}
                count={c.patients}
                pct={c.pct}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ----- B. Intervention Performance ---------------------------------

function InterventionSection({ pilot }: { pilot: PilotBlock }) {
  const i = pilot.interventions;
  return (
    <>
      <SectionHead hint={`Auto-resolve and engagement windows: ${pilot.rules.autoResolveWindowHours}h`}>
        Intervention performance
      </SectionHead>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">
        <StatCard
          label="# interventions triggered"
          value={i.triggered}
          sub={`${i.perPatient.toFixed(2)} per patient`}
          accent="#142240"
        />
        <StatCard
          label="% engaged with"
          value={pctStr(i.pctEngaged)}
          sub={`${i.engaged} of ${i.triggered}`}
          accent="#38B6FF"
        />
        <StatCard
          label="% auto-resolved (48h)"
          value={pctStr(i.pctAutoResolved)}
          sub={`${i.autoResolved} no escalation`}
          accent="#34C759"
        />
        <StatCard
          label="% escalated (48h)"
          value={pctStr(i.pctEscalated)}
          sub={`${i.escalated} escalated`}
          accent="#FF9500"
        />
      </div>
      <div className="text-[11px] text-muted-foreground mb-4">
        Engagement is a loose join (same patient + intervention feedback within{" "}
        {pilot.rules.engagementWindowHours}h). Tighten by linking
        intervention_feedback to a specific intervention_event.id when ready.
      </div>
    </>
  );
}

// ----- C. Provider Leverage ----------------------------------------

function ProviderSection({ pilot }: { pilot: PilotBlock }) {
  const p = pilot.provider;
  const tHours = p.avgTimeToFollowUpHours;
  return (
    <>
      <SectionHead hint={`Escalations deduped per patient per ${pilot.rules.escalationDedupeHours}h`}>
        Provider leverage
      </SectionHead>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">
        <StatCard
          label="# patients escalated"
          value={p.patientsEscalated}
          sub={`${p.escalationsDeduped} escalations · ${p.escalationsRaw} raw`}
          accent="#142240"
        />
        <StatCard
          label="Avg. time-to-follow-up"
          value={fmtHours(tHours)}
          sub={
            p.timeToFollowUpDenom > 0
              ? `Across ${p.timeToFollowUpDenom} linked follow-ups`
              : "No linked follow-ups yet"
          }
          accent="#38B6FF"
        />
        <StatCard
          label="% escalations reviewed"
          value={pctStr(p.pctReviewed)}
          sub="doctor_reviewed before next escalation"
          accent="#142240"
        />
        <StatCard
          label="% escalations acted on"
          value={pctStr(p.pctActedOn)}
          sub="follow_up_completed linked"
          accent={p.pctActedOn >= 0.6 ? "#34C759" : "#FF9500"}
        />
      </div>
    </>
  );
}

// ----- Rules footnote ---------------------------------------------

function RulesNote({ pilot }: { pilot: PilotBlock }) {
  const r = pilot.rules;
  return (
    <Card>
      <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        How these are computed
      </div>
      <ul className="text-[12px] text-muted-foreground space-y-1.5 leading-relaxed">
        <li>
          <strong>Cohort:</strong> all activated patients (no per-doctor scope at the operator-key level).
        </li>
        <li>
          <strong>Window:</strong> last {pilot.windowDays} days for event volumes.
        </li>
        <li>
          <strong>Risk:</strong> {r.riskBandSource.replace(/_/g, " ")} from the same lib/risk.computeRisk used by the doctor dashboard. Not materialized.
        </li>
        <li>
          <strong>Auto-resolve:</strong> intervention with no escalation_requested by the same patient within {r.autoResolveWindowHours}h.
        </li>
        <li>
          <strong>Engagement:</strong> {r.engagementJoin.replace(/_/g, " ")}. Type-matching deferred until the schema is tightened.
        </li>
        <li>
          <strong>Escalation dedupe:</strong> per patient per {r.escalationDedupeHours}h. Raw count shown alongside for sanity.
        </li>
        <li>
          <strong>Reviewed:</strong> {r.reviewedDefinition.replace(/_/g, " ")}.
        </li>
        <li>
          <strong>Acted on:</strong> {r.actedOnDefinition.replace(/_/g, " ")} — doctor_reviewed alone does NOT count.
        </li>
        <li>
          <strong>External readout:</strong> the frozen 30-day snapshot endpoint is registered but disabled until HIPAA prerequisites are resolved.
        </li>
      </ul>
    </Card>
  );
}

// ----- helpers -----------------------------------------------------

function CategoryRow({
  label,
  count,
  pct,
}: {
  label: string;
  count: number;
  pct: number;
}) {
  const widthPct = Math.max(2, Math.round(pct * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] mb-1">
        <span className="font-semibold text-[#142240]">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {pctStr(pct)} · {count}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-[rgba(20,34,64,0.08)] overflow-hidden"
        aria-hidden
      >
        <div
          className="h-full bg-[#38B6FF]"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) {
    const m = Math.round(h * 60);
    return `${m}m`;
  }
  if (h < 24) return `${h.toFixed(1)}h`;
  const d = h / 24;
  return `${d.toFixed(1)}d`;
}
