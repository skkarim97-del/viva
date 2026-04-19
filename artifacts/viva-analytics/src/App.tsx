import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Shell } from "@/components/Shell";
import { KeyGate } from "@/components/KeyGate";
import { OverviewPage } from "@/pages/OverviewPage";
import { OperatingPage } from "@/pages/OperatingPage";
import { RetentionPage } from "@/pages/RetentionPage";
import { BehaviorPage } from "@/pages/BehaviorPage";
import { PatientsPage } from "@/pages/PatientsPage";
import { DoctorsPage } from "@/pages/DoctorsPage";
import NotFound from "@/pages/not-found";

import { KEY_STORAGE } from "@/lib/api";
import { useSummary } from "@/hooks/useSummary";
import type { AnalyticsSummary } from "@/lib/types";

/**
 * Viva Analytics root. Operator-key gated. Shell + 6 sidebar routes,
 * all reading from the same shared summary query so the cache is hot
 * across navigation.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: false, staleTime: 30_000 },
  },
});

function GatedApp() {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Read the key from localStorage on first render. Wrapped in try/catch
  // because some browsing modes block storage entirely.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY_STORAGE);
      if (stored) setSavedKey(stored);
    } catch {
      /* localStorage blocked */
    }
  }, []);

  const q = useSummary(savedKey);

  // If the server rejects the key, drop it and surface a fresh prompt.
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
      <KeyGate
        error={keyError}
        onSubmit={(k) => {
          try {
            window.localStorage.setItem(KEY_STORAGE, k);
          } catch {
            /* ignore */
          }
          setSavedKey(k);
          setKeyError(null);
        }}
      />
    );
  }

  function signOut() {
    try {
      window.localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* ignore */
    }
    setSavedKey(null);
  }

  return (
    <Shell generatedAt={q.data?.generatedAt ?? null} onSignOut={signOut}>
      {q.isLoading && (
        <div className="text-muted-foreground py-16 text-center">
          Loading analytics…
        </div>
      )}
      {q.isError && (
        <div className="text-destructive py-16 text-center">
          {q.error?.detail || q.error?.message || "Failed to load analytics."}
        </div>
      )}
      {q.data && <Routes data={q.data} />}
    </Shell>
  );
}

function Routes({ data }: { data: AnalyticsSummary }) {
  return (
    <Switch>
      <Route path="/" component={() => <OverviewPage data={data} />} />
      <Route path="/operating" component={() => <OperatingPage data={data} />} />
      <Route path="/retention" component={() => <RetentionPage data={data} />} />
      <Route path="/behavior" component={() => <BehaviorPage data={data} />} />
      <Route path="/patients" component={() => <PatientsPage data={data} />} />
      <Route path="/doctors" component={() => <DoctorsPage data={data} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // wouter `base` strips the artifact preview-path prefix so route
  // paths in <Route> stay clean ("/", "/operating", ...).
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <GatedApp />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
