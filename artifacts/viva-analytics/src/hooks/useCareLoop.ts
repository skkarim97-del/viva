import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";

// Funnel response from /internal/care-loop/summary. The shape mirrors
// the four sections the doctors and ops team look at: what Viva did,
// what got escalated, what the doctors did, and what came out of it.

export interface CareLoopSummary {
  windowDays: number;
  generatedAt: string;
  viva: {
    totalEvents: number;
    distinctPatients: number;
    nextDayCheckinPctOfTouchedPatients: number;
    nextDayCheckinNumerator: number;
    nextDayCheckinDenominator: number;
  };
  escalation: {
    totalEscalations: number;
    distinctPatients: number;
    bySource: Record<string, number>;
  };
  doctor: {
    reviewedPct: number;
    reviewedNumerator: number;
    reviewedDenominator: number;
    avgMinutesEscalationToReview: number | null;
    withDoctorNotePct: number;
    withTreatmentStatusUpdatedPct: number;
    // Explicit follow-up loop. followUpCompletedPct uses
    // total escalations as the denominator (one escalation = one
    // potential follow-up). totalFollowUpEvents is just the raw
    // count of follow_up_completed rows in the window, useful as a
    // sanity check for unlinked follow-ups.
    followUpCompletedPct: number;
    followUpCompletedNumerator: number;
    followUpCompletedDenominator: number;
    totalFollowUpEvents: number;
    avgMinutesEscalationToFollowUp: number | null;
    followUpWithin24hPct: number;
    followUpWithin24hNumerator: number;
    followUpWithin24hDenominator: number;
  };
  outcomes: {
    resolvedByVivaAlonePct: number;
    resolvedByVivaAloneNumerator: number;
    resolvedByVivaAloneDenominator: number;
    escalatedPct: number;
    escalatedNumerator: number;
    escalatedDenominator: number;
    improvedAfterDoctorPct: number;
    improvedAfterDoctorNumerator: number;
    improvedAfterDoctorDenominator: number;
  };
  notes: Record<string, string>;
}

export function useCareLoop(key: string | null, days = 30) {
  return useQuery<CareLoopSummary, ApiError>({
    queryKey: ["analytics-care-loop", key, days],
    queryFn: ({ signal }) =>
      apiGet<CareLoopSummary>(
        `/internal/care-loop/summary?days=${days}`,
        key!,
        signal,
      ),
    enabled: !!key,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
}
