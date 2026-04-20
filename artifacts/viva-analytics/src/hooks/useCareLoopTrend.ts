import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";

// Daily time-series for the escalation -> follow-up loop.
// `within24hPct` is null for days with zero escalations -- the chart
// renders that as a gap rather than a misleading 0%.

export interface CareLoopTrendPoint {
  day: string; // YYYY-MM-DD (server timezone)
  escalations: number;
  followUps: number;
  within24hPct: number | null;
  within24hNumerator: number;
  within24hDenominator: number;
}

export interface CareLoopTrend {
  windowDays: number;
  generatedAt: string;
  points: CareLoopTrendPoint[];
}

export function useCareLoopTrend(key: string | null, days = 30) {
  return useQuery<CareLoopTrend, ApiError>({
    queryKey: ["analytics-care-loop-trend", key, days],
    queryFn: ({ signal }) =>
      apiGet<CareLoopTrend>(
        `/internal/care-loop/trend?days=${days}`,
        key!,
        signal,
      ),
    enabled: !!key,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
}
