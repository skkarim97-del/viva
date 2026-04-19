import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

// Internal analytics roll-up. Sister page to InternalDashboardPage --
// uses the same operator-key gating, kept on its own URL so the
// existing operator dashboard stays focused on activation/funnel
// stats while this page focuses on intervention -> outcome
// attribution. Function over form.

interface OutcomeBucket {
  total: number;
  adherenceImproved: number;
  symptomImproved: number;
  symptomWorsened: number;
  nextDayCheckin: number;
  reengagedAfterLow: number;
}

interface HealthBlock {
  windowDays: number;
  nextDayCheckinAfterIntervention: { users: number; denom: number; pct: number };
  engagementImproved3d: { users: number; denom: number; pct: number };
  topInterventions: Array<{ type: string; count: number }>;
  symptomTrend: {
    direction: "improving" | "worsening" | "flat" | "no_data";
    improved: number;
    worsened: number;
    stable: number;
  };
}

interface TreatmentStatusBlock {
  totalPatients: number;
  active: number;
  stopped: number;
  unknown: number;
  pctStillOnTreatment: number;
  topStopReasons: Array<{ reason: string; count: number; pct: number }>;
  stopTiming: {
    early: number;
    mid: number;
    late: number;
    unknown: number;
    knownDenom: number;
  };
  stopReasonByTiming: Array<{
    reason: string;
    early: number;
    mid: number;
    late: number;
    unknown: number;
  }>;
}

interface AnalyticsSummary {
  generatedAt: string;
  windowDays: number;
  health?: HealthBlock;
  treatmentStatus?: TreatmentStatusBlock;
  totals: { interventionEvents: number };
  byInterventionType: Record<string, OutcomeBucket>;
  byCommunicationMode: Record<string, OutcomeBucket>;
  byPrimaryFocus: Record<string, OutcomeBucket>;
  byConfidenceBand: Record<string, OutcomeBucket>;
  topPathwaysToEscalation: Array<{
    interventionType: string;
    count: number;
  }>;
  reengagementAfterCoach: { reengaged: number; coachInterventions: number };
}

const KEY_STORAGE = "viva.internalKey";

async function fetchSummary(key: string): Promise<AnalyticsSummary> {
  const res = await fetch("/api/internal/analytics/summary", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) throw new Error("invalid_key");
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "internal_metrics_disabled");
  }
  if (!res.ok) throw new Error("analytics_failed");
  return (await res.json()) as AnalyticsSummary;
}

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good" ? "#047857" : tone === "bad" ? "#b91c1c" : "#111827";
  return (
    <div
      style={{
        flex: 1,
        minWidth: 180,
        padding: "12px 14px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && (
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function HealthPanel({ h }: { h: HealthBlock }) {
  const pctStr = (p: number) => `${Math.round(p * 100)}%`;
  const trendLabel: Record<HealthBlock["symptomTrend"]["direction"], string> = {
    improving: "Improving",
    worsening: "Worsening",
    flat: "Flat",
    no_data: "No data",
  };
  const trendTone: Record<
    HealthBlock["symptomTrend"]["direction"],
    "good" | "bad" | "neutral"
  > = {
    improving: "good",
    worsening: "bad",
    flat: "neutral",
    no_data: "neutral",
  };
  const t = h.symptomTrend;
  const trendSub =
    t.direction === "no_data"
      ? "No outcome snapshots yet."
      : `${t.improved} improved · ${t.worsened} worsened · ${t.stable} stable`;
  const top = h.topInterventions;
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
        Is this actually working?
      </h2>
      <p
        style={{
          marginTop: 4,
          marginBottom: 12,
          color: "#6b7280",
          fontSize: 12,
        }}
      >
        Raw signal across the full population over the last {h.windowDays} days.
        No segmentation.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Stat
          label="Next-day check-in after intervention"
          value={pctStr(h.nextDayCheckinAfterIntervention.pct)}
          sub={`${h.nextDayCheckinAfterIntervention.users} of ${h.nextDayCheckinAfterIntervention.denom} users`}
          tone={
            h.nextDayCheckinAfterIntervention.denom === 0
              ? "neutral"
              : h.nextDayCheckinAfterIntervention.pct >= 0.5
                ? "good"
                : "neutral"
          }
        />
        <Stat
          label="Engagement improving over 3 days"
          value={pctStr(h.engagementImproved3d.pct)}
          sub={`${h.engagementImproved3d.users} of ${h.engagementImproved3d.denom} users`}
          tone={
            h.engagementImproved3d.denom === 0
              ? "neutral"
              : h.engagementImproved3d.pct >= 0.3
                ? "good"
                : "neutral"
          }
        />
        <Stat
          label="Symptom trend"
          value={trendLabel[t.direction]}
          sub={trendSub}
          tone={trendTone[t.direction]}
        />
        <Stat
          label="Top interventions"
          value={top.length === 0 ? "—" : `${top.length}`}
          sub={
            top.length === 0
              ? "No interventions logged yet."
              : top.map((r) => `${r.type} (${r.count})`).join(" · ")
          }
        />
      </div>
    </section>
  );
}

function BucketTable({
  title,
  data,
}: {
  title: string;
  data: Record<string, OutcomeBucket>;
}) {
  const rows = Object.entries(data).sort((a, b) => b[1].total - a[1].total);
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
      <p style={{ marginTop: 4, marginBottom: 12, color: "#6b7280", fontSize: 12 }}>
        Outcomes attributed to the next 7 days after each intervention.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
            <th style={{ padding: "6px 8px" }}>Group</th>
            <th style={{ padding: "6px 8px" }}>N</th>
            <th style={{ padding: "6px 8px" }}>Adherence ↑</th>
            <th style={{ padding: "6px 8px" }}>Symptom ↑</th>
            <th style={{ padding: "6px 8px" }}>Symptom ↓</th>
            <th style={{ padding: "6px 8px" }}>Next-day checkin</th>
            <th style={{ padding: "6px 8px" }}>Re-engaged</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 12, color: "#9ca3af" }}>
                No data yet.
              </td>
            </tr>
          )}
          {rows.map(([k, b]) => (
            <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{k}</td>
              <td style={{ padding: "6px 8px" }}>{b.total}</td>
              <td style={{ padding: "6px 8px" }}>
                {b.adherenceImproved} ({pct(b.adherenceImproved, b.total)})
              </td>
              <td style={{ padding: "6px 8px" }}>
                {b.symptomImproved} ({pct(b.symptomImproved, b.total)})
              </td>
              <td style={{ padding: "6px 8px" }}>
                {b.symptomWorsened} ({pct(b.symptomWorsened, b.total)})
              </td>
              <td style={{ padding: "6px 8px" }}>
                {b.nextDayCheckin} ({pct(b.nextDayCheckin, b.total)})
              </td>
              <td style={{ padding: "6px 8px" }}>
                {b.reengagedAfterLow} ({pct(b.reengagedAfterLow, b.total)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function InternalAnalyticsPage() {
  const [key, setKey] = useState<string>("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY_STORAGE);
      if (stored) setSavedKey(stored);
    } catch {
      /* localStorage blocked */
    }
  }, []);

  const q = useQuery<AnalyticsSummary, Error>({
    queryKey: ["internal-analytics", savedKey],
    queryFn: () => fetchSummary(savedKey!),
    enabled: !!savedKey,
    refetchInterval: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (q.isError && q.error?.message === "invalid_key" && savedKey) {
      setSavedKey(null);
      setKeyError("That access key did not work. Please re-enter it.");
      try {
        window.localStorage.removeItem(KEY_STORAGE);
      } catch {
        /* ignore */
      }
    }
  }, [q.isError, q.error, savedKey]);

  if (!savedKey) {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Internal analytics
        </h1>
        <p style={{ color: "#6b7280", marginBottom: 16, fontSize: 14 }}>
          Enter the operator key to view intervention-to-outcome aggregates.
        </p>
        {keyError && (
          <div style={{ color: "#b91c1c", marginBottom: 12, fontSize: 13 }}>
            {keyError}
          </div>
        )}
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          type="password"
          placeholder="operator key"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            marginBottom: 12,
          }}
        />
        <button
          onClick={() => {
            const trimmed = key.trim();
            if (!trimmed) return;
            try {
              window.localStorage.setItem(KEY_STORAGE, trimmed);
            } catch {
              /* ignore */
            }
            setSavedKey(trimmed);
            setKey("");
            setKeyError(null);
          }}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "#111827",
            color: "white",
            border: 0,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Continue
        </button>
      </div>
    );
  }

  if (q.isLoading) {
    return (
      <div style={{ padding: 32, color: "#6b7280" }}>Loading analytics...</div>
    );
  }
  if (q.isError) {
    return (
      <div style={{ padding: 32, color: "#b91c1c" }}>
        {q.error?.message || "Failed to load analytics."}
      </div>
    );
  }
  const data = q.data;
  if (!data) return null;

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: 24,
        background: "#f9fafb",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Internal analytics</h1>
        <div style={{ color: "#6b7280", fontSize: 12 }}>
          {data.totals.interventionEvents} interventions ·{" "}
          {data.windowDays}d outcome window · refreshed{" "}
          {new Date(data.generatedAt).toLocaleTimeString()}
        </div>
      </header>

      {data.health && <HealthPanel h={data.health} />}
      {data.treatmentStatus && (
        <TreatmentStatusPanel t={data.treatmentStatus} />
      )}

      <BucketTable
        title="Outcomes by intervention type"
        data={data.byInterventionType}
      />
      <BucketTable
        title="Outcomes by communication mode"
        data={data.byCommunicationMode}
      />
      <BucketTable
        title="Outcomes by primary focus (treatment state)"
        data={data.byPrimaryFocus}
      />
      <BucketTable
        title="Outcomes by signal confidence band"
        data={data.byConfidenceBand}
      />

      <section
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          Top pathways to clinician escalation
        </h2>
        <p
          style={{
            marginTop: 4,
            marginBottom: 12,
            color: "#6b7280",
            fontSize: 12,
          }}
        >
          Interventions whose patient escalated to a clinician within 7 days.
        </p>
        {data.topPathwaysToEscalation.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>No escalations.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.topPathwaysToEscalation.map((r) => (
              <li key={r.interventionType}>
                <span style={{ fontFamily: "monospace" }}>
                  {r.interventionType}
                </span>
                {" — "}
                {r.count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          Re-engagement after coach
        </h2>
        <p
          style={{
            marginTop: 4,
            marginBottom: 12,
            color: "#6b7280",
            fontSize: 12,
          }}
        >
          Of patients who hit a coach intervention while previously low-adherence,
          how many re-engaged within 7 days.
        </p>
        <div style={{ fontSize: 14 }}>
          {data.reengagementAfterCoach.reengaged} /{" "}
          {data.reengagementAfterCoach.coachInterventions} (
          {pct(
            data.reengagementAfterCoach.reengaged,
            data.reengagementAfterCoach.coachInterventions,
          )}
          )
        </div>
      </section>
    </div>
  );
}

const STOP_REASON_DISPLAY: Record<string, string> = {
  side_effects: "Side effects",
  cost_or_insurance: "Cost or insurance",
  lack_of_efficacy: "Lack of efficacy",
  patient_choice_or_motivation: "Patient choice or motivation",
  other: "Other",
  unknown: "Unspecified",
};
const TIMING_DISPLAY: Record<"early" | "mid" | "late", string> = {
  early: "Early (≤30d)",
  mid: "Mid (31-90d)",
  late: "Late (>90d)",
};

function TreatmentStatusPanel({ t }: { t: TreatmentStatusBlock }) {
  const pctStr = `${Math.round(t.pctStillOnTreatment * 100)}%`;
  const tone =
    t.pctStillOnTreatment >= 0.85
      ? "good"
      : t.pctStillOnTreatment >= 0.65
      ? "neutral"
      : "bad";
  return (
    <section
      style={{
        padding: 16,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        Treatment status retention
      </h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat
          label="% still on treatment"
          value={pctStr}
          sub={`${t.active} of ${t.active + t.stopped} confirmed`}
          tone={tone as "good" | "bad" | "neutral"}
        />
        <Stat
          label="On treatment"
          value={String(t.active)}
          sub="Currently active"
          tone="good"
        />
        <Stat
          label="Stopped"
          value={String(t.stopped)}
          sub="Off treatment"
          tone={t.stopped > 0 ? "bad" : "neutral"}
        />
        <Stat
          label="Unknown"
          value={String(t.unknown)}
          sub="Pending confirmation"
        />
        <Stat label="Total panel" value={String(t.totalPatients)} />
      </div>
      {t.topStopReasons.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <RetentionSubhead>Stop reasons</RetentionSubhead>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {t.topStopReasons.map((r) => (
              <li key={r.reason}>
                {STOP_REASON_DISPLAY[r.reason] ?? r.reason}
                <span style={{ color: "#6b7280" }}>
                  {" · "}
                  {r.count} ({Math.round(r.pct * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {t.stopTiming.knownDenom > 0 && (
        <div style={{ marginTop: 14 }}>
          <RetentionSubhead>Stop timing</RetentionSubhead>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {(["early", "mid", "late"] as const).map((k) => {
              const n = t.stopTiming[k];
              const pct =
                t.stopTiming.knownDenom > 0
                  ? Math.round((n / t.stopTiming.knownDenom) * 100)
                  : 0;
              return (
                <Stat
                  key={k}
                  label={TIMING_DISPLAY[k]}
                  value={String(n)}
                  sub={`${pct}% of known`}
                />
              );
            })}
            {t.stopTiming.unknown > 0 && (
              <Stat
                label="Unknown timing"
                value={String(t.stopTiming.unknown)}
                sub="Missing start date"
              />
            )}
          </div>
        </div>
      )}

      {t.stopReasonByTiming.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <RetentionSubhead>Reason × timing</RetentionSubhead>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: "#6b7280" }}>
                <th style={{ padding: "6px 8px" }}>Reason</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>
                  Early
                </th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>
                  Mid
                </th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>
                  Late
                </th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>
                  Unknown
                </th>
              </tr>
            </thead>
            <tbody>
              {t.stopReasonByTiming.map((row) => (
                <tr
                  key={row.reason}
                  style={{ borderTop: "1px solid #f3f4f6" }}
                >
                  <td style={{ padding: "6px 8px" }}>
                    {STOP_REASON_DISPLAY[row.reason] ?? row.reason}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    {row.early}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    {row.mid}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    {row.late}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      color: "#9ca3af",
                    }}
                  >
                    {row.unknown}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RetentionSubhead({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: "#6b7280",
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 6,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </div>
  );
}
