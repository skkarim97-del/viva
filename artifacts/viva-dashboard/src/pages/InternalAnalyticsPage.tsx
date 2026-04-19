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

interface AnalyticsSummary {
  generatedAt: string;
  windowDays: number;
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
