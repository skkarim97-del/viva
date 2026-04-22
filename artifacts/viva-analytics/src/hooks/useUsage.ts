import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";

// Pilot product-usage summary. Reads /internal/analytics/usage and
// gives the analytics page a single typed shape to render. This is
// deliberately kept separate from the bundled summary -- the analytics
// stream is its own pipeline, and we want the rest of the dashboard
// to keep working even if this endpoint stalls.

export interface UsageTopUser {
  userType: string;
  userId: number;
  sessions: number;
  lastSeenAt: string;
}

export interface UsageSessionLength {
  sessions: number;
  avgSecs: number;
  p50Secs: number;
  p95Secs: number;
}

export interface UsageEventCount {
  eventName: string;
  userType: string;
  count: number;
}

export interface UsageSummary {
  windowDays: number;
  generatedAt: string;
  patientsByHour: number[];
  doctorsByHour: number[];
  topUsers: {
    patients: UsageTopUser[];
    doctors: UsageTopUser[];
  };
  sessionLengthByRole: {
    patient: UsageSessionLength;
    doctor: UsageSessionLength;
  };
  eventCounts: UsageEventCount[];
  notes: Record<string, string>;
}

export function useUsage(key: string | null, days = 7) {
  return useQuery<UsageSummary, ApiError>({
    queryKey: ["analytics-usage", key, days],
    queryFn: ({ signal }) =>
      apiGet<UsageSummary>(`/internal/analytics/usage?days=${days}`, key!, signal),
    enabled: !!key,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
}
