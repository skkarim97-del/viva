import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";
import type { PilotPlatformOption } from "@/lib/types";

export function usePlatforms(key: string | null) {
  return useQuery<PilotPlatformOption[], ApiError>({
    queryKey: ["platforms", key],
    queryFn: ({ signal }) =>
      apiGet<PilotPlatformOption[]>("/internal/platforms", key!, signal),
    enabled: !!key,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
