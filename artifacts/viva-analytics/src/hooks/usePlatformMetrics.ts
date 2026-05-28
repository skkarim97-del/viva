import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";
import type { PlatformScopeMetrics } from "@/lib/types";

// Fetches /internal/metrics optionally scoped to a single platform.
// Pass slug=null for the global (all-platforms) view.
export function usePlatformMetrics(key: string | null, slug: string | null) {
  const path = slug
    ? `/internal/metrics?platformSlug=${encodeURIComponent(slug)}`
    : "/internal/metrics";

  return useQuery<PlatformScopeMetrics, ApiError>({
    queryKey: ["platform-metrics", key, slug],
    queryFn: ({ signal }) =>
      apiGet<PlatformScopeMetrics>(path, key!, signal),
    enabled: !!key,
    retry: false,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
