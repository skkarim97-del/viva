import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";
import type { AnalyticsSummary } from "@/lib/types";

/**
 * Single shared query for the whole summary endpoint. Every page reads
 * from this same cache key, so navigating between sections is instant
 * and the auto-refresh ticks for everyone at once.
 */
export function useSummary(key: string | null) {
  return useQuery<AnalyticsSummary, ApiError>({
    queryKey: ["analytics-summary", key],
    queryFn: ({ signal }) => apiGet<AnalyticsSummary>("/internal/analytics/summary", key!, signal),
    enabled: !!key,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
}
