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

// Plan adherence: pilot KPI block derived from analytics_events rows
// where event_name in ('plan_item_completed','plan_item_skipped',
// 'plan_item_viewed'). Backend returns `null` instead of zeroed
// counters when no plan_item_* events exist yet, so the analytics page
// can render an honest "no data yet" state instead of a misleading
// 0% adherence number.
export interface PlanAdherenceBlock {
  windowDays: number;
  totalPatientsWithPlanItems: number;
  itemsCompleted: number;
  itemsSkipped: number;
  itemsViewedNotActioned: number;
  byCategory: Array<{
    category: string;
    completed: number;
    skipped: number;
    viewedOnly: number;
    completionRate: number; // completed / (completed + skipped)
  }>;
}

export interface OpenEscalationsBlock {
  open: number;
  reviewedLast7d: number;
  followUpPendingLast7d: number;
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
  // Soft-signal disengagement: patients still considered active or
  // unknown who have not checked in for >=12 days. Computed server-side
  // from patient_checkins.date and patients.activated_at; never written
  // back to treatment_status.
  disengagement?: {
    thresholdDays: number;
    inactive12d: number;
    considered: number;
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

// ---------------------------------------------------------- pilot block
//
// Composite "Pilot Metrics" KPIs computed server-side from existing
// data (no new raw events). Documented in
// artifacts/api-server/src/lib/pilotMetrics.ts. Wire-format kept
// optional so a server outage in the pilot computation cannot break
// the rest of the analytics page.

export type PilotRiskBand = "low" | "medium" | "high";

export interface PilotRiskCategory {
  code: string;
  label: string;
  patients: number;
  pct: number; // 0..1, share of cohort
}

export interface PilotRiskBlock {
  flaggedPatients: number;
  pctFlagged: number;
  avgSignalsPerPatient: number;
  topCategories: PilotRiskCategory[];
  bandDistribution: Record<PilotRiskBand, number>;
}

export interface PilotInterventionsBlock {
  triggered: number;
  perPatient: number;
  engaged: number;
  pctEngaged: number;
  autoResolved: number;
  pctAutoResolved: number;
  escalated: number;
  pctEscalated: number;
}

export interface PilotProviderBlock {
  patientsEscalated: number;
  escalationsRaw: number;
  escalationsDeduped: number;
  avgTimeToFollowUpHours: number | null;
  timeToFollowUpDenom: number;
  pctReviewed: number;
  pctActedOn: number;
}

// Scope describes which slice of the cohort a metrics block covers.
// Optional; absent = whole-cohort (every patient on every Viva platform
// under every doctor). Present when the caller restricted by platform
// and/or doctor; the UI uses these labels in the FrozenBanner and the
// scope pill in the list view so an operator can tell at a glance
// which customer / provider the numbers describe.
export interface PilotScope {
  platformId: number | null;
  platformName: string | null;
  platformSlug: string | null;
  doctorId: number | null;
  doctorName: string | null;
}

export interface PilotBlock {
  windowDays: number;
  // Server-supplied YYYY-MM-DD strings describing the window. Optional
  // because older deployments and the empty-cohort short-circuit may
  // not carry them; the page falls back to "—" when missing.
  windowStartDate?: string;
  windowEndDate?: string;
  scope?: PilotScope;
  cohort: { activated: number };
  risk: PilotRiskBlock;
  interventions: PilotInterventionsBlock;
  provider: PilotProviderBlock;
  rules: {
    autoResolveWindowHours: number;
    engagementWindowHours: number;
    escalationDedupeHours: number;
    riskBandSource: string;
    engagementJoin: string;
    actedOnDefinition: string;
    reviewedDefinition: string;
  };
}

// ---------------------------------------------------------- pilot snapshots
//
// Frozen pilot-metrics readouts. List view returns metadata only
// (cheap to render); detail view returns the full row including the
// metrics blob. Wire shape mirrors `pilotSnapshotsTable` in
// @workspace/db -- if a column is added there, mirror it here.

export interface PilotSnapshotSummary {
  id: number;
  cohortStartDate: string; // YYYY-MM-DD
  cohortEndDate: string; // YYYY-MM-DD
  generatedAt: string; // ISO timestamp
  generatedByUserId: number | null;
  generatedByLabel: string;
  // Legacy free-text column from before the platform model existed.
  // Always null on snapshots created after the platform rollout; the
  // UI ignores it and prefers platformName below.
  clinicName: string | null;
  // Scope: who the snapshot describes. All four nullable for the
  // historical "whole pilot" snapshots; platformName/doctorName are
  // server-resolved via join (not stored on the row) so renaming a
  // platform reflects everywhere immediately.
  platformId: number | null;
  platformName: string | null;
  platformSlug: string | null;
  doctorUserId: number | null;
  doctorName: string | null;
  metricDefinitionVersion: string;
  patientCount: number;
  notes: string | null;
}

export interface PilotSnapshotDetail extends PilotSnapshotSummary {
  metrics: PilotBlock;
}

export interface PilotSnapshotListResponse {
  snapshots: PilotSnapshotSummary[];
}

// Scope inputs are optional; both null/undefined = whole-cohort.
type SnapshotScopeInputs = {
  platformId?: number | null;
  doctorId?: number | null;
};

export type PilotSnapshotCreateRequest =
  | ({
      preset: "day15" | "day30";
      notes?: string;
      generatedByLabel?: string;
    } & SnapshotScopeInputs)
  | ({
      cohortStartDate: string;
      cohortEndDate: string;
      notes?: string;
      generatedByLabel?: string;
    } & SnapshotScopeInputs);

// Selectors for scope dropdowns. `doctors[].platformId` lets the UI
// filter the doctor list whenever a platform is picked.
export interface PilotPlatformOption {
  id: number;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
}
export interface PilotDoctorOption {
  id: number;
  name: string;
  platformId: number | null;
}
export interface PilotScopesResponse {
  platforms: PilotPlatformOption[];
  doctors: PilotDoctorOption[];
}

export interface AnalyticsSummary {
  generatedAt: string;
  operating?: OperatingBlock;
  treatmentStatus?: TreatmentStatusBlock;
  health?: HealthBlock;
  drilldown?: DrilldownBlock;
  dataSanity?: DataSanityBlock;
  pilot?: PilotBlock;
  // null means "no plan_item_* analytics events yet" -- the operator
  // sees an honest empty state, not a misleading 0% adherence number.
  planAdherence?: PlanAdherenceBlock | null;
  openEscalations?: OpenEscalationsBlock;
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
