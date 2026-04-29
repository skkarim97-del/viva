import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type {
  PilotScopesResponse,
  PilotSnapshotCreateRequest,
  PilotSnapshotDetail,
  PilotSnapshotListResponse,
  PilotSnapshotSummary,
} from "@/lib/types";

// React Query wrappers for the pilot-snapshots endpoints. List + detail
// share the same operator key as the rest of the analytics product;
// mutations invalidate the list so a freshly created snapshot shows up
// immediately without a manual refresh.

export function usePilotSnapshotsList(key: string | null) {
  return useQuery<PilotSnapshotSummary[], ApiError>({
    queryKey: ["pilot-snapshots", key],
    queryFn: async ({ signal }) => {
      const data = await apiGet<PilotSnapshotListResponse>(
        "/internal/analytics/pilot/snapshots",
        key!,
        signal,
      );
      return data.snapshots;
    },
    enabled: !!key,
    retry: false,
    staleTime: 30_000,
  });
}

export function usePilotSnapshotDetail(key: string | null, id: number | null) {
  return useQuery<PilotSnapshotDetail, ApiError>({
    queryKey: ["pilot-snapshot", key, id],
    queryFn: ({ signal }) =>
      apiGet<PilotSnapshotDetail>(
        `/internal/analytics/pilot/snapshots/${id}`,
        key!,
        signal,
      ),
    enabled: !!key && id != null,
    retry: false,
    // Snapshots are immutable: once fetched, they never change.
    staleTime: Infinity,
  });
}

export function useCreatePilotSnapshot(key: string | null) {
  const qc = useQueryClient();
  return useMutation<PilotSnapshotDetail, ApiError, PilotSnapshotCreateRequest>(
    {
      mutationFn: (body) =>
        apiPost<PilotSnapshotCreateRequest, PilotSnapshotDetail>(
          "/internal/analytics/pilot/snapshot",
          key!,
          body,
        ),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["pilot-snapshots", key] });
      },
    },
  );
}

// Selectors for the New Snapshot panel + live-view scope picker.
// Whole-cohort by default; this query feeds the dropdowns. Cached
// generously because platforms/doctors don't change mid-session.
export function usePilotScopes(key: string | null) {
  return useQuery<PilotScopesResponse, ApiError>({
    queryKey: ["pilot-scopes", key],
    queryFn: ({ signal }) =>
      apiGet<PilotScopesResponse>(
        "/internal/analytics/pilot/scopes",
        key!,
        signal,
      ),
    enabled: !!key,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
