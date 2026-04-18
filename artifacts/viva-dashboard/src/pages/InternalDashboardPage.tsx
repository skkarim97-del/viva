import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

// Internal-only operating dashboard for Viva. NOT shown to clinicians.
// Reached via /internal, gated by the INTERNAL_API_KEY operator key
// (entered once and stored in localStorage). The clinician dashboard
// stays focused on patient triage; product analytics live here.

interface InternalMetrics {
  generatedAt: string;
  invitesSent: number;
  activated: number;
  activationRate: number;
  completedFirstCheckin: number;
  checkedInLast7: number;
  noCheckinAfterInvite: number;
  dropoff: {
    threeDaysPlus: number;
    fiveDaysPlus: number;
    sevenDaysPlus: number;
  };
  avgCheckinsPerActive: number;
  needsFollowup: number;
}

const KEY_STORAGE = "viva.internalKey";

async function fetchMetrics(key: string): Promise<InternalMetrics> {
  const res = await fetch("/api/internal/metrics", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) throw new Error("invalid_key");
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "internal_metrics_disabled");
  }
  if (!res.ok) throw new Error("metrics_failed");
  return (await res.json()) as InternalMetrics;
}

function pct(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

function num(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

export function InternalDashboardPage() {
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

  const q = useQuery<InternalMetrics, Error>({
    queryKey: ["internal-metrics", savedKey],
    queryFn: () => fetchMetrics(savedKey!),
    enabled: !!savedKey,
    refetchInterval: 60_000,
    retry: false,
  });

  // If a stored key turned out to be invalid (e.g. rotated), clear it
  // and prompt for a fresh one without forcing a manual logout.
  useEffect(() => {
    if (q.isError && q.error?.message === "invalid_key" && savedKey) {
      setSavedKey(null);
      setKeyError("That access key did not work. Please re-enter it.");
      try {
        window.localStorage.removeItem(KEY_STORAGE);
      } catch {
        /* no-op */
      }
    }
  }, [q.isError, q.error, savedKey]);

  function submitKey(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem(KEY_STORAGE, trimmed);
    } catch {
      /* no-op */
    }
    setSavedKey(trimmed);
    setKeyError(null);
  }

  function signOutInternal() {
    try {
      window.localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* no-op */
    }
    setSavedKey(null);
    setKey("");
  }

  if (!savedKey) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <form
          onSubmit={submitKey}
          className="w-full max-w-sm bg-card rounded-[20px] p-6"
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Viva Internal
          </div>
          <h1 className="font-display text-[22px] font-bold text-foreground mt-1.5 mb-1">
            Operator access
          </h1>
          <p className="text-xs text-muted-foreground font-medium mb-5">
            This dashboard is for the Viva team. Enter the internal access
            key to view activation and retention metrics.
          </p>
          <input
            type="password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Internal access key"
            className="w-full px-3.5 py-2.5 rounded-xl bg-background text-foreground text-sm font-medium font-mono focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground"
          />
          {keyError && (
            <div
              className="text-xs font-semibold mt-3"
              style={{ color: "#B5251D" }}
            >
              {keyError}
            </div>
          )}
          <button
            type="submit"
            className="mt-4 w-full bg-primary text-primary-foreground font-semibold py-2.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="max-w-6xl mx-auto px-6 pt-8 pb-5 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Viva Internal
          </div>
          <h1 className="font-display text-[28px] font-bold text-foreground leading-tight mt-1">
            Activation & retention
          </h1>
          {q.data && (
            <div className="text-xs text-muted-foreground font-medium mt-1">
              Live from production database · refreshed{" "}
              {new Date(q.data.generatedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={signOutInternal}
          className="px-4 py-2 rounded-2xl bg-card text-foreground text-sm font-semibold hover:bg-secondary"
        >
          Sign out
        </button>
      </header>
      <div className="max-w-6xl mx-auto px-6">
        <div className="h-px bg-border mb-8" />
      </div>
      <main className="max-w-6xl mx-auto px-6 pb-16">
        {q.isPending && (
          <div className="text-muted-foreground py-12 text-center">
            Loading metrics...
          </div>
        )}
        {q.isError && q.error?.message !== "invalid_key" && (
          <div
            className="rounded-xl px-4 py-3 font-medium text-sm"
            style={{
              color: "#B5251D",
              backgroundColor: "rgba(255,59,48,0.10)",
            }}
          >
            {q.error.message === "internal_metrics_disabled"
              ? "Internal metrics are disabled. Set the INTERNAL_API_KEY deployment secret to enable this dashboard."
              : `Could not load metrics: ${q.error.message}`}
          </div>
        )}
        {q.data && (
          <>
            <Section title="Invite funnel">
              <Stat
                label="Invites sent"
                value={num(q.data.invitesSent)}
                hint="count(patientsTable) — every row is one invite the doctor sent."
              />
              <Stat
                label="Activated"
                value={num(q.data.activated)}
                hint="count(patientsTable WHERE activatedAt IS NOT NULL) — patient claimed the account in the mobile app."
              />
              <Stat
                label="Activation rate"
                value={pct(q.data.activationRate)}
                hint="activated / invitesSent."
              />
              <Stat
                label="Completed first check-in"
                value={num(q.data.completedFirstCheckin)}
                hint="count(distinct patientUserId in patientCheckinsTable) — patients with ≥1 check-in ever."
              />
            </Section>

            <Section title="Engagement">
              <Stat
                label="Checked in (last 7 days)"
                value={num(q.data.checkedInLast7)}
                hint="count(distinct patientUserId in patientCheckinsTable WHERE date ≥ today−6)."
              />
              <Stat
                label="Avg check-ins per active patient"
                value={q.data.avgCheckinsPerActive.toFixed(2)}
                hint="total check-ins last 7d / distinct patients with a check-in last 7d."
              />
              <Stat
                label="Needs follow-up"
                value={num(q.data.needsFollowup)}
                hint="Activated patients whose live risk action = needs_followup, computed from lib/risk on the last 14 days of check-ins."
              />
              <Stat
                label="No check-in after invite"
                value={num(q.data.noCheckinAfterInvite)}
                hint="patients with NO row in patientCheckinsTable — invited or activated, never submitted a single check-in."
              />
            </Section>

            <Section title="Drop-off (silence since last check-in)">
              <Stat
                label="3+ days silent"
                value={num(q.data.dropoff.threeDaysPlus)}
                hint="patients whose max(checkin date) is ≥3 days ago. Excludes patients with zero check-ins (counted above)."
              />
              <Stat
                label="5+ days silent"
                value={num(q.data.dropoff.fiveDaysPlus)}
                hint="patients whose max(checkin date) is ≥5 days ago."
              />
              <Stat
                label="7+ days silent"
                value={num(q.data.dropoff.sevenDaysPlus)}
                hint="patients whose max(checkin date) is ≥7 days ago."
              />
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {children}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-card rounded-[20px] p-5">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="font-display text-[32px] font-bold text-foreground leading-tight mt-1">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground font-medium mt-3 leading-relaxed">
        {hint}
      </div>
    </div>
  );
}
