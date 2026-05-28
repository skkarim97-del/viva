import { useState } from "react";
import { KEY_STORAGE } from "@/lib/api";
import { pctStr } from "@/lib/format";
import type { PlatformScopeMetrics } from "@/lib/types";
import { usePlatforms } from "@/hooks/usePlatforms";
import { usePlatformMetrics } from "@/hooks/usePlatformMetrics";
import {
  Card,
  Chip,
  Empty,
  PageHeader,
  SectionHead,
  StatCard,
} from "@/components/primitives";

export function PlatformScopePage() {
  const operatorKey =
    typeof window !== "undefined"
      ? window.localStorage.getItem(KEY_STORAGE)
      : null;

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const platforms = usePlatforms(operatorKey);
  const metrics = usePlatformMetrics(operatorKey, selectedSlug);

  return (
    <>
      <PageHeader
        title="Platform Metrics"
        subtitle="View key metrics globally or filtered to a single telehealth platform. Internal-only."
        right={
          <ScopeSelector
            slug={selectedSlug}
            onChange={setSelectedSlug}
            options={Array.isArray(platforms.data) ? platforms.data : []}
            loading={platforms.isLoading}
          />
        }
      />

      {metrics.isLoading && (
        <div className="text-muted-foreground py-16 text-center">
          Loading metrics…
        </div>
      )}
      {metrics.isError && (
        <div className="text-destructive py-16 text-center">
          {metrics.error?.detail || metrics.error?.message || "Failed to load metrics."}
        </div>
      )}
      {metrics.data && <MetricsView data={metrics.data} />}
    </>
  );
}

// ------------------------------------------------------- scope selector

function ScopeSelector({
  slug,
  onChange,
  options,
  loading,
}: {
  slug: string | null;
  onChange: (slug: string | null) => void;
  options: { id: number; name: string; slug: string }[];
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-muted-foreground font-semibold uppercase tracking-wide">
        Scope
      </span>
      <select
        value={slug ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        <option value="">All Platforms</option>
        {options.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ------------------------------------------------------- metrics view

function MetricsView({ data }: { data: PlatformScopeMetrics }) {
  const isGlobal = data.scope === "global";

  return (
    <div className="space-y-6">
      {/* Scope badge */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted-foreground">Showing:</span>
        {isGlobal ? (
          <Chip tone="neutral">All platforms (global)</Chip>
        ) : (
          <Chip tone="accent">{data.platformName ?? data.platformSlug}</Chip>
        )}
        <span className="text-[11px] text-muted-foreground">
          as of {new Date(data.generatedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Funnel */}
      <SectionHead hint="Patient funnel from invite to engagement">
        Funnel
      </SectionHead>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Invites sent"
          value={data.invitesSent.toLocaleString()}
        />
        <StatCard
          label="Activated"
          value={data.activated.toLocaleString()}
          sub={`${pctStr(data.activationRate)} activation rate`}
        />
        <StatCard
          label="Completed first check-in"
          value={data.completedFirstCheckin.toLocaleString()}
          sub={
            data.activated > 0
              ? `${pctStr(data.completedFirstCheckin / data.activated)} of activated`
              : undefined
          }
        />
        <StatCard
          label="Checked in last 7 d"
          value={data.checkedInLast7.toLocaleString()}
          sub={
            data.activated > 0
              ? `${pctStr(data.checkedInLast7 / data.activated)} of activated`
              : undefined
          }
        />
      </div>

      {/* Engagement */}
      <SectionHead hint="Ongoing engagement signals">
        Engagement
      </SectionHead>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          label="Avg check-ins / active"
          value={data.avgCheckinsPerActive.toFixed(1)}
        />
        <StatCard
          label="No check-in after invite"
          value={data.noCheckinAfterInvite.toLocaleString()}
          sub={
            data.invitesSent > 0
              ? `${pctStr(data.noCheckinAfterInvite / data.invitesSent)} of invites`
              : undefined
          }
        />
        <StatCard
          label="Needs follow-up"
          value={data.needsFollowup.toLocaleString()}
        />
      </div>

      {/* Drop-off */}
      <SectionHead hint="Patients with no check-in for N+ days after their last one">
        Drop-off
      </SectionHead>
      <Card>
        <div className="grid grid-cols-3 divide-x divide-border text-center">
          <DropoffStat
            label="3 days+"
            value={data.dropoff.threeDaysPlus}
            denom={data.activated}
          />
          <DropoffStat
            label="5 days+"
            value={data.dropoff.fiveDaysPlus}
            denom={data.activated}
          />
          <DropoffStat
            label="7 days+"
            value={data.dropoff.sevenDaysPlus}
            denom={data.activated}
          />
        </div>
      </Card>

      {data.activated === 0 && (
        <Empty>No activated patients yet for this scope.</Empty>
      )}
    </div>
  );
}

function DropoffStat({
  label,
  value,
  denom,
}: {
  label: string;
  value: number;
  denom: number;
}) {
  return (
    <div className="px-4 py-3">
      <div className="font-display text-[22px] font-bold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mt-1.5">
        {label}
      </div>
      {denom > 0 && (
        <div className="text-[11px] text-muted-foreground mt-1">
          {pctStr(value / denom)} of activated
        </div>
      )}
    </div>
  );
}
