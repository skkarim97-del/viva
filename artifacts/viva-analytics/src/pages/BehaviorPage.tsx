import type { AnalyticsSummary, HealthBlock } from "@/lib/types";
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
 * System behavior — what the product is *doing* and how patients are
 * responding. Comes from the `health` block on the analytics endpoint
 * (intervention events + symptom snapshots).
 */
export function BehaviorPage({ data }: { data: AnalyticsSummary }) {
  const h = data.health;
  if (!h) {
    return (
      <>
        <PageHeader title="System behavior" />
        <Empty>The server didn't return a behavior block.</Empty>
      </>
    );
  }
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
  return (
    <>
      <PageHeader
        title="System behavior"
        subtitle={`Behavioral signals attributed to interventions across the whole population. ${h.windowDays}-day window.`}
      />

      <SectionHead>Behavioral lift</SectionHead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
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

      <SectionHead>Top intervention types</SectionHead>
      <Card>
        {h.topInterventions.length === 0 ? (
          <Empty>No interventions logged in this window.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {h.topInterventions.map((r) => (
              <Chip key={r.type} tone="neutral">
                {r.type} · {r.count}
              </Chip>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
