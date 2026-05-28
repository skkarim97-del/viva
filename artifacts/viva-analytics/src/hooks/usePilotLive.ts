import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";
import type { PilotLiveResponse } from "@/lib/types";

// Fetches /internal/analytics/pilot/live scoped to one platform (or global).
// Pass slug=null for the whole-cohort (all-platforms) view.
export function usePilotLive(key: string | null, slug: string | null) {
  const path = slug
    ? `/internal/analytics/pilot/live?platformSlug=${encodeURIComponent(slug)}`
    : "/internal/analytics/pilot/live";

  return useQuery<PilotLiveResponse, ApiError>({
    queryKey: ["pilot-live", key, slug],
    queryFn: ({ signal }) =>
      apiGet<PilotLiveResponse>(path, key!, signal),
    enabled: !!key,
    retry: false,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
