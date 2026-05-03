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
        subtitle={`Pilot adoption and engagement over the last ${op.windowDays} days, derived from existing tables — no schema additions, no synthetic flags.`}
      />

      {/* PRIMARY -- pilot adoption: who got activated, who is coming
          back this week, and are they doing the things that justify
          the product (check-ins + coach engagement). */}
      <SectionHead hint="Patient activity = check-ins ∪ intervention_events">
        Primary metrics · patient adoption
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Activated patients"
          value={p.activated}
          sub={`of ${p.total} total in panel`}
          accent="#38B6FF"
        />
        <StatCard
          label="Weekly active patients"
          value={p.wau}
          sub="Distinct in last 7 days"
          accent="#34C759"
        />
        <StatCard
          label="Completing check-ins"
          value={pctStr(p.pctCompletingCheckins)}
          sub={`${p.completingCheckins} of ${p.activated} in last 7d`}
          accent="#34C759"
        />
        <StatCard
          label="Engaging with coach"
          value={pctStr(p.pctEngagingCoaching)}
          sub={`${p.coachEngaged} of ${p.activated} in last 30d`}
          accent="#34C759"
        />
      </div>

      {/* PRIMARY -- doctor side. Weekly active doctors and what they
          actually did with their panel. Avg-per-doctor is here so the
          number isn't read in isolation as good or bad. */}
      <SectionHead hint="Doctor activity = notes ∪ status updates with source='doctor'">
        Primary metrics · doctor adoption
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Weekly active doctors"
          value={d.wau}
          sub={`of ${d.withPanel} with a panel`}
          accent="#142240"
        />
        <StatCard
          label="Patients reviewed"
          value={d.patientsReviewed}
          sub={`Distinct patients with a note in last ${op.windowDays}d`}
          accent="#38B6FF"
        />
        <StatCard
          label="Avg patients reviewed / doctor"
          value={d.avgPatientsReviewedPerDoctor.toFixed(1)}
          sub="Doctors with a panel"
          accent="#142240"
        />
        <StatCard
          label="Total doctors"
          value={d.total}
          sub={`${d.withPanel} with a panel`}
        />
      </div>

      {/* SECONDARY -- raw counts and shorter / longer windows. Useful
          for rate-of-change reading but not the primary pilot signal. */}
      <SectionHead hint="Activity over today / 7d / 30d windows">
        Secondary metrics · activity windows and write volume
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Total patients"
          value={p.total}
          sub="Whole panel"
        />
        <StatCard
          label="Patients active today"
          value={p.activeToday}
          sub="Check-in or app intervention today"
        />
        <StatCard label="Patient DAU" value={p.dau} sub="Today" />
        <StatCard label="Patient MAU" value={p.mau} sub="Last 30 days" />
        <StatCard label="Doctor DAU" value={d.dau} sub="Today" />
        <StatCard label="Doctor MAU" value={d.mau} sub="Last 30 days" />
        <StatCard
          label="Notes written"
          value={d.notesWritten}
          sub={`In last ${op.windowDays}d`}
        />
        <StatCard
          label="Status updates"
          value={d.treatmentStatusesUpdated}
          sub={`In last ${op.windowDays}d`}
        />
      </div>

      {/* PILOT KPI -- plan adherence. Backed by analytics_events
          plan_item_* rows. Renders an honest empty state when the
          backend returned `null` (no plan_item_* events yet) instead
          of a misleading 0%. */}
      <SectionHead hint="From analytics_events: plan_item_completed / skipped / viewed (last 30d)">
        Pilot KPI · personalized plan adherence
      </SectionHead>
      {data.planAdherence ? (
        (() => {
          const pa = data.planAdherence;
          const denom = pa.itemsCompleted + pa.itemsSkipped;
          const overall = denom > 0 ? pa.itemsCompleted / denom : 0;
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <StatCard
                  label="Patients with plan items"
                  value={pa.totalPatientsWithPlanItems}
                  sub={`Last ${pa.windowDays}d, distinct`}
                  accent="#38B6FF"
                />
                <StatCard
                  label="Items completed"
                  value={pa.itemsCompleted}
                  sub={`${pa.itemsSkipped} skipped, ${pa.itemsViewedNotActioned} viewed only`}
                  accent="#34C759"
                />
                <StatCard
                  label="Completion rate"
                  value={pctStr(overall)}
                  sub={`Completed ÷ (completed + skipped), ${denom} actions`}
                  accent="#34C759"
                />
                <StatCard
                  label="Categories with activity"
                  value={pa.byCategory.length}
                  sub="Distinct plan categories"
                  accent="#142240"
                />
              </div>
              {pa.byCategory.length > 0 ? (
                <div className="rounded-[14px] border border-black/10 overflow-hidden mt-2">
                  <table className="w-full text-xs">
                    <thead className="bg-black/[0.03]">
                      <tr className="text-left font-semibold">
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2 text-right">Completed</th>
                        <th className="px-3 py-2 text-right">Skipped</th>
                        <th className="px-3 py-2 text-right">Viewed only</th>
                        <th className="px-3 py-2 text-right">Completion rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pa.byCategory.map((r) => (
                        <tr key={r.category} className="border-t border-black/5">
                          <td className="px-3 py-2 font-medium">{r.category}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.completed}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.skipped}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.viewedOnly}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pctStr(r.completionRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          );
        })()
      ) : (
        <Empty>
          No plan_item_* analytics events in the window yet. Adherence will
          start populating once patients begin actioning their personalized
          plan items.
        </Empty>
      )}

      {/* PILOT KPI -- open escalations. Backed by care_events directly.
          Shows current backlog plus 7d activity so an empty inbox doesn't
          read as "nothing happening" when the team has been clearing it. */}
      <SectionHead hint="From care_events: latest escalation > latest doctor_reviewed per patient">
        Pilot KPI · escalation queue
      </SectionHead>
      {data.openEscalations ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <StatCard
            label="Open escalations"
            value={data.openEscalations.open}
            sub="Awaiting doctor_reviewed"
            accent={data.openEscalations.open > 0 ? "#FF9500" : "#34C759"}
          />
          <StatCard
            label="Reviewed in last 7d"
            value={data.openEscalations.reviewedLast7d}
            sub="Doctor cleared the badge"
            accent="#34C759"
          />
          <StatCard
            label="Follow-up pending (7d)"
            value={data.openEscalations.followUpPendingLast7d}
            sub="Reviewed but not yet followed up"
            accent="#142240"
          />
        </div>
      ) : (
        <Empty>No escalation data available right now.</Empty>
      )}

      {/* TERTIARY -- nice to know, not pilot-defining. Apple Health
          adoption matters longer-term but not for "did the loop work
          this month". */}
      <SectionHead hint="Adoption detail; not pilot-defining on its own">
        Diagnostic metrics · supporting adoption
      </SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <StatCard
          label="Apple Health connected"
          value={pctStr(p.pctAppleHealthConnected)}
          sub={`${p.appleHealthConnected} of ${p.activated} activated`}
        />
      </div>
    </>
  );
}
