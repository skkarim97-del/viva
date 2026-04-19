import { useEffect, useState } from "react";
import { KEY_STORAGE } from "@/lib/api";
import { useCareLoop } from "@/hooks/useCareLoop";
import { pctStr } from "@/lib/format";
import {
  Card,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

/**
 * Care Loop = the dual-layer intervention funnel: what Viva surfaced
 * to patients, what got escalated to a doctor, what the doctors did
 * about it, and what the outcome looked like.
 *
 * Reads its own endpoint (not the bundled summary) so the queries
 * stay independent and we can iterate on the funnel SQL without
 * regenerating the rest of analytics.
 */
export function CareLoopPage() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      setKey(window.localStorage.getItem(KEY_STORAGE));
    } catch {
      /* ignore */
    }
  }, []);
  const q = useCareLoop(key, 30);

  if (q.isLoading || !q.data) {
    return (
      <>
        <PageHeader
          title="Care loop"
          subtitle="Viva → escalation → doctor → outcome, last 30 days."
        />
        <div className="text-muted-foreground py-16 text-center">
          {q.isError ? "Failed to load." : "Loading care loop…"}
        </div>
      </>
    );
  }

  const d = q.data;
  return (
    <>
      <PageHeader
        title="Care loop"
        subtitle={`Viva → escalation → doctor → outcome, last ${d.windowDays} days.`}
      />

      {/* Layer 1: Viva. What the AI did. */}
      <SectionHead hint="Viva-Care, the patient-facing layer">
        Viva
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <StatCard
          label="Total Viva events"
          value={d.viva.totalEvents.toLocaleString()}
          sub="coach + recommendations"
          accent="#5AC8FA"
        />
        <StatCard
          label="Patients touched"
          value={d.viva.distinctPatients.toLocaleString()}
          sub="distinct in window"
          accent="#5AC8FA"
        />
        <StatCard
          label="Next-day check-in"
          value={pctStr(d.viva.nextDayCheckinPctOfTouchedPatients)}
          sub={`${d.viva.nextDayCheckinNumerator}/${d.viva.nextDayCheckinDenominator} touched`}
          accent="#34C759"
        />
      </div>

      {/* Layer 2: Escalation. Where Viva was not enough. */}
      <SectionHead hint='"Need more support" or system-driven escalations'>
        Escalation
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <StatCard
          label="Total escalations"
          value={d.escalation.totalEscalations.toLocaleString()}
          accent="#FF9500"
        />
        <StatCard
          label="Patients escalated"
          value={d.escalation.distinctPatients.toLocaleString()}
          accent="#FF9500"
        />
        <Card>
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            By source
          </div>
          {Object.entries(d.escalation.bySource).length === 0 && (
            <div className="text-sm text-muted-foreground">No escalations.</div>
          )}
          <ul className="space-y-1 text-sm font-medium">
            {Object.entries(d.escalation.bySource).map(([src, n]) => (
              <li key={src} className="flex items-center justify-between">
                <span className="capitalize text-foreground">{src}</span>
                <span className="tabular-nums text-foreground">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Layer 3: Doctor. The clinician response. */}
      <SectionHead hint="What clinicians did with the escalations">
        Doctor
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Reviewed in window"
          value={pctStr(d.doctor.reviewedPct)}
          sub={`${d.doctor.reviewedNumerator}/${d.doctor.reviewedDenominator}`}
          accent="#142240"
        />
        <StatCard
          label="Avg time to review"
          value={
            d.doctor.avgMinutesEscalationToReview == null
              ? "—"
              : formatMinutes(d.doctor.avgMinutesEscalationToReview)
          }
          sub="escalation → reviewed"
          accent="#142240"
        />
        <StatCard
          label="With doctor note"
          value={pctStr(d.doctor.withDoctorNotePct)}
          sub="of escalations"
          accent="#142240"
        />
        <StatCard
          label="Treatment status changed"
          value={pctStr(d.doctor.withTreatmentStatusUpdatedPct)}
          sub="of escalations"
          accent="#142240"
        />
      </div>

      {/* Layer 4: Outcomes. Did the loop work? */}
      <SectionHead hint="Did the loop produce a positive follow-through?">
        Outcomes
      </SectionHead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <StatCard
          label="Resolved by Viva alone"
          value={pctStr(d.outcomes.resolvedByVivaAlonePct)}
          sub={`${d.outcomes.resolvedByVivaAloneNumerator}/${d.outcomes.resolvedByVivaAloneDenominator} touched, no escalation`}
          accent="#34C759"
        />
        <StatCard
          label="Escalated to doctor"
          value={pctStr(d.outcomes.escalatedPct)}
          sub={`${d.outcomes.escalatedNumerator}/${d.outcomes.escalatedDenominator} touched`}
          accent="#FF9500"
        />
        <StatCard
          label="Improved after doctor"
          value={pctStr(d.outcomes.improvedAfterDoctorPct)}
          sub={`${d.outcomes.improvedAfterDoctorNumerator}/${d.outcomes.improvedAfterDoctorDenominator} escalated`}
          accent="#142240"
        />
      </div>

      {/* Proxy notes -- so the operator who reads these numbers knows
          exactly what each percent is computed from. Unsexy, essential. */}
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

function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
