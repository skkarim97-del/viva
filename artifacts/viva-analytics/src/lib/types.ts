// Wire-format types served by GET /api/internal/analytics/summary.
// Kept loose (every block optional) so a future server change that
// strips a field cannot crash the UI — pages only render what's there.

export interface PatientsBlock {
  total: number;
  activated: number;
  activeToday: number;
  dau: number;
  wau: number;
  mau: number;
  appleHealthConnected: number;
  pctAppleHealthConnected: number;
  completingCheckins: number;
  pctCompletingCheckins: number;
  coachEngaged: number;
  pctEngagingCoaching: number;
}

export interface DoctorsBlock {
  total: number;
  withPanel: number;
  dau: number;
  wau: number;
  mau: number;
  patientsReviewed: number;
  treatmentStatusesUpdated: number;
  notesWritten: number;
  avgPatientsReviewedPerDoctor: number;
}

export interface OperatingBlock {
  windowDays: number;
  patients: PatientsBlock;
  doctors: DoctorsBlock;
}

export interface TreatmentStatusBlock {
  totalPatients: number;
  active: number;
  stopped: number;
  unknown: number;
  pctStillOnTreatment: number;
  topStopReasons: Array<{ reason: string; count: number; pct: number }>;
  stopTiming: {
    d0_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
    unknown: number;
    knownDenom: number;
  };
  stopReasonByTiming: Array<{
    reason: string;
    d0_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
    unknown: number;
  }>;
  cohortRetention?: {
    buckets: Array<{
      bucket: "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown";
      total: number;
      active: number;
      stopped: number;
      unknown: number;
    }>;
  };
}

export interface HealthBlock {
  windowDays: number;
  nextDayCheckinAfterIntervention: { users: number; denom: number; pct: number };
  engagementImproved3d: { users: number; denom: number; pct: number };
  topInterventions: Array<{ type: string; count: number }>;
  symptomTrend: {
    direction: "improving" | "worsening" | "flat" | "no_data";
    improved: number;
    worsened: number;
    stable: number;
  };
}

export interface PatientDrillRow {
  id: number;
  name: string;
  email: string;
  doctorName: string;
  doctorId: number;
  treatmentStatus: "active" | "stopped" | "unknown";
  stopReason: string | null;
  stopTimingBucket: "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown";
  daysOnTreatment: number | null;
  lastCheckin: string | null;
  appleHealthConnected: boolean;
}

export interface DoctorDrillRow {
  id: number;
  name: string;
  email: string;
  patientCount: number;
  activePatients: number;
  stoppedPatients: number;
  notesWritten: number;
  statusesUpdated: number;
  lastActiveAt: string | null;
}

export interface DrilldownBlock {
  patients: PatientDrillRow[];
  doctors: DoctorDrillRow[];
}

export interface DataSanityBlock {
  totalPatientsRow: number;
  sumByStatus: number;
  stoppedRow: number;
  stoppedSumByReason: number;
  stoppedSumByTiming: number;
  ok: boolean;
}

export interface AnalyticsSummary {
  generatedAt: string;
  operating?: OperatingBlock;
  treatmentStatus?: TreatmentStatusBlock;
  health?: HealthBlock;
  drilldown?: DrilldownBlock;
  dataSanity?: DataSanityBlock;
}

// ---------------------------------------------------------- display maps

export const STOP_REASON_DISPLAY: Record<string, string> = {
  side_effects: "Side effects",
  cost_or_insurance: "Cost or insurance",
  lack_of_efficacy: "Lack of efficacy",
  patient_choice_or_motivation: "Patient choice or motivation",
  other: "Other",
  unknown: "Unspecified",
};

export const TIMING_DISPLAY: Record<
  "d0_30" | "d31_60" | "d61_90" | "d90_plus",
  string
> = {
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: ">90 days",
};
