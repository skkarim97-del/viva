// Central daily treatment state for Viva.
//
// One pure selector that produces a single `DailyTreatmentState` per
// render. Every recommendation surface on the Today screen reads
// projections of this object via `selectors.ts`. Nothing on Today
// re-derives directly from raw inputs; if a surface needs a new
// signal, add it here and project it through a selector.
//
// This file does NOT replace planEngine. planEngine still produces the
// detailed plan (workout pick, focus items, narrative). dailyState
// wraps planEngine's output and adds:
//   1. Treatment-aware lenses (stage, dose-day position, escalation).
//   2. Risk lenses (symptom / hydration / fueling burden).
//   3. A claims policy derived from data tier + freshness so the coach
//      and copy templates know what physiological claims they may make.
//   4. Data-sufficiency markers so consumers can detect "we don't have
//      enough to say much" and downgrade to a humble surface instead
//      of a confident-looking but weakly grounded plan.
//   5. The active symptom interventions for today (selection logic
//      lives here so symptomTips is no longer a parallel mini-brain).
//
// Decision hierarchy for `primaryFocus` and `treatmentDailyState` is
// strict precedence -- a higher tier always suppresses lower tiers.
// See computePrimaryFocus() for the exact ordering and the rationale
// tags emitted on each path.

import type {
  CompletionRecord,
  DailyPlan,
  GLP1DailyInputs,
  HealthMetrics,
  HydrationLevel,
  MedicationLogEntry,
  UserProfile,
  WellnessInputs,
} from "@/types";
import { buildTierContext, maxConfidenceForTier, type TierContext } from "./dataTier";
import {
  deriveSymptomTips,
  planActivityFromState,
  type SymptomKind,
  type SymptomTip,
} from "@/lib/symptomTips";

// ---------- Domain types -------------------------------------------------

export type TreatmentStage =
  | "first_30d"
  | "30_60d"
  | "60_90d"
  | "3_6m"
  | "6_12m"
  | "1y_plus"
  | "unknown";

// Position in the patient's dosing cycle. Assumes weekly dosing for
// now (the GLP-1 default); daily-dose brands collapse into mid_cycle.
export type DoseDayPosition =
  | "pre_dose"
  | "dose_day"
  | "day_1_post"
  | "day_2_post"
  | "day_3_post"
  | "mid_cycle"
  | "unknown";

export type RiskBand = "low" | "moderate" | "high";
export type MovementReadiness = "recovery" | "light" | "train";
export type EscalationNeed = "none" | "monitor" | "clinician";

// Internal name only. User-facing copy NEVER says "risk", "dropout",
// or "churn" -- this signal silently shifts the experience into
// higher-support mode (smaller goals, gentler copy, more reassurance,
// one-tap mini check-in) when something looks off.
export type AdherenceSignal = "stable" | "attention" | "rising";

export type PrimaryFocus =
  | "symptom_relief"
  | "continuity_support"
  | "hydration"
  | "fueling"
  | "recovery"
  | "movement"
  | "performance";

// Treatment-aware extension of the existing plan.dailyState. `escalate`
// and `support` are new bands above the legacy 4-state model, used
// when symptom or continuity concerns outrank the readiness branch.
export type TreatmentDailyState =
  | "escalate"
  | "recover"
  | "support"
  | "maintain"
  | "build"
  | "push";

export interface ClaimsPolicy {
  // What the engine + coach are allowed to assert today. Each gate is
  // derived from existing TierContext usability (sufficiency AND
  // freshness). If false, copy must not reference that signal.
  canCiteSleep: boolean;
  canCiteHRV: boolean;
  canCiteRecovery: boolean;
  canCiteSteps: boolean;
  // Showing an actual readiness number (e.g. "75/100") requires
  // physiological grounding -- subjective-only patients never see it.
  canQuantifyReadiness: boolean;
  // True only when at least one wearable physiological signal (HRV
  // or recovery proxy via RHR) is usable. Subjective-high alone does
  // NOT unlock physiological claims.
  physiologicalClaimsAllowed: boolean;
  // Final confidence label that copy templates and coach prompt use to
  // pick hedge level. Capped by maxConfidenceForTier().
  narrativeConfidence: "low" | "moderate" | "high";
}

export interface DataSufficiencyMarkers {
  checkinToday: boolean;
  healthFresh: boolean;
  baselineEstablished: boolean;
  profileComplete: boolean;
  daysOfHistory: number;
  // True when the engine has so little to work with that the Today
  // surface should swap from a confident plan to an "insufficient
  // data" prompt. This is the explicit replacement for the historical
  // "default to 70% readiness" silent fallback.
  insufficientForPlan: boolean;
}

export interface DailyTreatmentState {
  date: string;
  generatedAt: string;

  // Treatment context
  treatmentStage: TreatmentStage;
  doseDayPosition: DoseDayPosition;
  recentTitration: boolean;
  daysSinceLastDose: number | null;

  // Risk lenses
  symptomBurden: RiskBand;
  hydrationRisk: RiskBand;
  fuelingRisk: RiskBand;
  recoveryReadiness: RiskBand;
  movementReadiness: MovementReadiness;
  adherenceSignal: AdherenceSignal;
  escalationNeed: EscalationNeed;

  // Confidence + tier
  dataTier: "self_report" | "phone_health" | "wearable";
  claimsPolicy: ClaimsPolicy;
  dataSufficiency: DataSufficiencyMarkers;

  // Decision output
  primaryFocus: PrimaryFocus;
  treatmentDailyState: TreatmentDailyState;
  // Ordered list of rule IDs that fired, in precedence order. Used
  // for analytics + debugging + composing narrative copy that matches
  // what actually drove the day.
  rationale: string[];

  // Backing artifacts kept for migration period. New consumers should
  // reach for the lenses above + selectors; legacy consumers continue
  // to read `plan` directly until they're migrated.
  plan: DailyPlan;

  // Active symptom interventions for today, after suppression filter
  // has been applied by the caller (which holds the dismissed-tips
  // map). Selection of which tips to consider lives here so the
  // symptomTips file becomes a pure content catalog.
  interventions: SymptomTip[];
}

// ---------- Inputs to the selector ---------------------------------------

export interface SelectInputs {
  // The plan is computed and OWNED by AppContext (it carries
  // patient-toggled action completion state mutated in place when the
  // patient checks off a focus). Never re-run generateDailyPlan from
  // here -- accept the plan and wrap it.
  plan: DailyPlan;
  // From AppContext / health providers
  todayMetrics: HealthMetrics;
  recentMetrics: HealthMetrics[];
  inputs?: WellnessInputs;
  glp1Inputs?: GLP1DailyInputs;
  hydration?: HydrationLevel;
  bowelMovementToday?: boolean | null;
  profile: UserProfile;
  medicationLog?: MedicationLogEntry[];
  hasHealthData: boolean;
  availableMetricTypes: string[];
  completionHistory?: CompletionRecord[];
  // Suppression record for symptom tips, owned by the Today screen.
  // Null entry = never acked. Passing this in keeps selectDailyTreatmentState
  // pure (no internal state).
  dismissedTips?: Map<SymptomKind, { severity: 1 | 2 | 3; ackedAt: number }>;
  // For re-trigger window (worsening symptom should re-surface even
  // after ack). Defaults to 4h to match the Today screen's existing
  // SUPPRESSION_RETRIGGER_MS.
  suppressionRetriggerMs?: number;
  nowMs?: number;
}

// ---------- Sub-computers ------------------------------------------------

function computeTreatmentStage(profile: UserProfile): TreatmentStage {
  const bucket = profile?.medicationProfile?.timeOnMedicationBucket;
  switch (bucket) {
    case "less_30_days": return "first_30d";
    case "30_60_days": return "30_60d";
    case "60_90_days": return "60_90d";
    case "3_6_months": return "3_6m";
    case "6_12_months": return "6_12m";
    case "1_2_years":
    case "2_plus_years": return "1y_plus";
    default: return "unknown";
  }
}

function computeDoseDayPosition(
  log: MedicationLogEntry[] | undefined,
  brand: string | undefined,
): { position: DoseDayPosition; daysSinceLastDose: number | null } {
  if (!log || log.length === 0) return { position: "unknown", daysSinceLastDose: null };
  // Daily-dose brands (Rybelsus PO) don't have a meaningful weekly
  // post-dose window. We collapse to mid_cycle and let other lenses
  // do the work.
  const dailyBrands = new Set(["Rybelsus"]);
  if (brand && dailyBrands.has(brand)) return { position: "mid_cycle", daysSinceLastDose: 0 };

  const taken = log
    .filter(e => e.status === "taken" && e.date)
    .map(e => e.date)
    .sort();
  if (taken.length === 0) return { position: "unknown", daysSinceLastDose: null };
  const last = taken[taken.length - 1];
  const lastDate = new Date(last + "T12:00:00Z").getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z").getTime();
  const diffDays = Math.round((today - lastDate) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return { position: "unknown", daysSinceLastDose: null };
  if (diffDays === 0) return { position: "dose_day", daysSinceLastDose: 0 };
  if (diffDays === 1) return { position: "day_1_post", daysSinceLastDose: 1 };
  if (diffDays === 2) return { position: "day_2_post", daysSinceLastDose: 2 };
  if (diffDays === 3) return { position: "day_3_post", daysSinceLastDose: 3 };
  if (diffDays === 6) return { position: "pre_dose", daysSinceLastDose: 6 };
  if (diffDays >= 4 && diffDays <= 7) return { position: "mid_cycle", daysSinceLastDose: diffDays };
  return { position: "unknown", daysSinceLastDose: diffDays };
}

function computeSymptomBurden(g?: GLP1DailyInputs): RiskBand {
  if (!g) return "low";
  if (g.nausea === "severe" || g.digestion === "diarrhea") return "high";
  if (
    g.nausea === "moderate" ||
    g.digestion === "constipated" ||
    (g.appetite === "very_low" && (g.energy === "depleted" || g.energy === "tired"))
  ) {
    return "moderate";
  }
  if (g.nausea === "mild" || g.digestion === "bloated" || g.appetite === "low") return "low";
  return "low";
}

function computeHydrationRisk(h?: HydrationLevel | null, g?: GLP1DailyInputs): RiskBand {
  if (h === "dehydrated") return "high";
  if (h === "low") return "moderate";
  // Severe nausea + diarrhea is itself a hydration concern even when
  // the patient hasn't logged hydration.
  if (g?.nausea === "severe" && g?.digestion === "diarrhea") return "high";
  return "low";
}

function computeFuelingRisk(g?: GLP1DailyInputs): RiskBand {
  if (!g) return "low";
  if (g.appetite === "very_low" && g.energy === "depleted") return "high";
  if (g.appetite === "very_low" || (g.appetite === "low" && g.energy === "depleted")) return "moderate";
  if (g.appetite === "low") return "low";
  return "low";
}

function computeRecoveryReadiness(plan: DailyPlan): RiskBand {
  if (plan.dailyState === "recover") return "low";
  if (plan.dailyState === "maintain") return "moderate";
  return "high";
}

function computeMovementReadiness(plan: DailyPlan): MovementReadiness {
  if (plan.dailyState === "recover") return "recovery";
  if (plan.dailyState === "maintain") return "light";
  return "train";
}

function computeAdherenceSignal(args: {
  glp1Inputs?: GLP1DailyInputs;
  recentMetrics: HealthMetrics[];
  completionHistory?: CompletionRecord[];
  hasCheckinToday: boolean;
}): AdherenceSignal {
  // First-pass mobile signal -- intentionally conservative. Server
  // owns the authoritative cross-day silence/missed-checkin signal;
  // the mobile signal exists so the Today experience can shift mode
  // without round-tripping the server. Future P1 work expands the
  // input set (post-dose worsening, repeat-dismissal patterns,
  // negative trend follow-ups).
  let score = 0;
  if (!args.hasCheckinToday) score += 1;

  // Repeated low-energy days based on recent check-in metrics. We
  // approximate from completion history when energy isn't directly
  // recorded in metrics.
  const last7 = args.recentMetrics.slice(-7);
  const lowSleepDays = last7.filter(m => typeof m.sleepDuration === "number" && m.sleepDuration > 0 && m.sleepDuration < 6).length;
  if (lowSleepDays >= 3) score += 2;

  // Acute symptom burden today doesn't itself raise adherence
  // signal -- the symptom tier already handles that. We only flag
  // adherence when *patterns* over time look concerning.
  const completions = args.completionHistory ?? [];
  const recent5 = completions.slice(-5);
  const lowCompletion = recent5.filter(r => r.completionRate < 0.3).length;
  if (lowCompletion >= 3) score += 2;

  if (score >= 4) return "rising";
  if (score >= 2) return "attention";
  return "stable";
}

function computeEscalationNeed(args: {
  glp1Inputs?: GLP1DailyInputs;
  recentMetrics: HealthMetrics[];
}): EscalationNeed {
  const g = args.glp1Inputs;
  if (!g) return "none";
  const severeCluster =
    g.nausea === "severe" &&
    (g.appetite === "very_low" || g.appetite === "low") &&
    (g.energy === "depleted" || g.energy === "tired");
  if (!severeCluster) return "none";

  // Intra-day persistence: the patient already logged a severe-tier
  // value earlier today and is logging another severe-tier value
  // again. The same-day "previous*" fields are written by AppContext
  // when a category is edited later in the day (e.g. 9am nausea=severe,
  // 2pm patient updates appetite -> previousNausea snapshot was
  // severe). If a severe cluster TODAY also has a same-day previous
  // marker at severe/very-low, treat as persistent intra-day and
  // escalate from monitor to clinician. This is a deliberately
  // conservative trigger -- multi-day server-side escalation owns
  // the broader case.
  const persistentNausea = g.previousNausea === "severe" || g.previousNausea === "moderate";
  const persistentAppetite = g.previousAppetite === "very_low" || g.previousAppetite === "low";
  const persistentEnergy = g.previousEnergy === "depleted" || g.previousEnergy === "tired";
  const intraDayPersistent =
    [persistentNausea, persistentAppetite, persistentEnergy].filter(Boolean).length >= 2;

  // Diarrhea on top of the severe cluster is itself a clinician-tier
  // hydration-loss concern even on the first log of the day.
  const dehydrationLoad = g.digestion === "diarrhea";

  if (intraDayPersistent || dehydrationLoad) return "clinician";
  return "monitor";
}

function computePrimaryFocus(args: {
  escalationNeed: EscalationNeed;
  symptomBurden: RiskBand;
  hydrationRisk: RiskBand;
  fuelingRisk: RiskBand;
  recoveryReadiness: RiskBand;
  treatmentStage: TreatmentStage;
  doseDayPosition: DoseDayPosition;
  recentTitration: boolean;
  plan: DailyPlan;
  rationale: string[];
}): { focus: PrimaryFocus; state: TreatmentDailyState } {
  const r = args.rationale;
  // Tier 0: safety / clinician escalation
  if (args.escalationNeed === "clinician") {
    r.push("escalate.clinician");
    return { focus: "symptom_relief", state: "escalate" };
  }
  // Tier 1: acute symptom support
  if (args.symptomBurden === "high") {
    r.push("symptom.high");
    return { focus: "symptom_relief", state: "recover" };
  }
  // Tier 2: treatment-continuity support
  // Engages aggressively in the first 30 days OR when titration is
  // recent OR on day-of/day-after dose with prior post-dose burden.
  const earlyStage = args.treatmentStage === "first_30d";
  const postDoseConcern =
    (args.doseDayPosition === "day_1_post" || args.doseDayPosition === "day_2_post") &&
    args.symptomBurden !== "low";
  if (earlyStage || args.recentTitration || postDoseConcern) {
    r.push(earlyStage ? "continuity.early30d" :
           args.recentTitration ? "continuity.titration" :
           "continuity.postDose");
    // Don't hijack the workout band entirely -- continuity_support
    // implies "smaller, gentler day", not full rest, unless symptom
    // tier already pushed us there.
    return { focus: "continuity_support", state: "support" };
  }
  // Tier 3: hydration / fueling
  if (args.hydrationRisk === "high") {
    r.push("hydration.high");
    return { focus: "hydration", state: "support" };
  }
  if (args.fuelingRisk === "high") {
    r.push("fueling.high");
    return { focus: "fueling", state: "support" };
  }
  if (args.hydrationRisk === "moderate") {
    r.push("hydration.moderate");
    return { focus: "hydration", state: args.plan.dailyState as TreatmentDailyState };
  }
  if (args.fuelingRisk === "moderate") {
    r.push("fueling.moderate");
    return { focus: "fueling", state: args.plan.dailyState as TreatmentDailyState };
  }
  // Tier 4: recovery
  if (args.recoveryReadiness === "low") {
    r.push("recovery.low");
    return { focus: "recovery", state: "recover" };
  }
  // Tier 5/6: movement / performance via plan band
  if (args.plan.dailyState === "push") {
    r.push("performance.push");
    return { focus: "performance", state: "push" };
  }
  if (args.plan.dailyState === "build") {
    r.push("movement.build");
    return { focus: "movement", state: "build" };
  }
  if (args.plan.dailyState === "maintain") {
    r.push("movement.maintain");
    return { focus: "movement", state: "maintain" };
  }
  r.push("recovery.default");
  return { focus: "recovery", state: "recover" };
}

function computeClaimsPolicy(tierCtx: TierContext): ClaimsPolicy {
  const physiological = tierCtx.usableHrv || tierCtx.usableRhr;
  const narrativeConfidence = maxConfidenceForTier(tierCtx);
  return {
    canCiteSleep: tierCtx.usableSleep,
    canCiteHRV: tierCtx.usableHrv,
    canCiteRecovery: physiological,
    canCiteSteps: tierCtx.usableSteps,
    canQuantifyReadiness: tierCtx.tier === "wearable" && physiological,
    physiologicalClaimsAllowed: physiological,
    narrativeConfidence,
  };
}

function computeDataSufficiency(args: {
  hasCheckinToday: boolean;
  tierCtx: TierContext;
  profile: UserProfile;
}): DataSufficiencyMarkers {
  const t = args.tierCtx;
  const healthFresh = t.usableSleep || t.usableSteps || t.usableHrv || t.usableRhr;
  const baselineEstablished =
    (t.sufficiency.hasSleepHistory && t.sufficiency.hasStepsHistory) ||
    t.sufficiency.hasHrvBaseline ||
    t.sufficiency.hasRhrBaseline;
  const med = args.profile?.medicationProfile;
  const profileComplete = !!(med?.medicationBrand && med?.timeOnMedicationBucket);
  // Insufficient when we have neither a check-in today NOR fresh
  // health data NOR established baselines. This is the case where
  // the engine historically defaulted to a confident "70% readiness,
  // build day" plan -- now we surface an explicit prompt instead.
  const insufficientForPlan = !args.hasCheckinToday && !healthFresh && !baselineEstablished;
  return {
    checkinToday: args.hasCheckinToday,
    healthFresh,
    baselineEstablished,
    profileComplete,
    daysOfHistory: t.sufficiency.recentDays,
    insufficientForPlan,
  };
}

function computeInterventions(args: SelectInputs, planActivity: ReturnType<typeof planActivityFromState>): SymptomTip[] {
  const tips = deriveSymptomTips({
    nausea: args.glp1Inputs?.nausea ?? null,
    appetite: args.glp1Inputs?.appetite ?? null,
    digestion: args.glp1Inputs?.digestion ?? null,
    hydration: args.hydration ?? null,
    bowelMovementToday: args.bowelMovementToday ?? null,
    planActivity,
  });
  if (!args.dismissedTips || args.dismissedTips.size === 0) return tips;
  const now = args.nowMs ?? Date.now();
  const window = args.suppressionRetriggerMs ?? 4 * 60 * 60 * 1000;
  return tips.filter(t => {
    const ack = args.dismissedTips!.get(t.symptom);
    if (!ack) return true;
    if (t.severity > ack.severity) return true;
    if (now - ack.ackedAt >= window) return true;
    return false;
  });
}

// ---------- The selector -------------------------------------------------

export function selectDailyTreatmentState(args: SelectInputs): DailyTreatmentState {
  const {
    plan,
    todayMetrics,
    recentMetrics,
    inputs,
    glp1Inputs,
    profile,
    medicationLog,
    hasHealthData,
    availableMetricTypes,
    completionHistory,
  } = args;
  void hasHealthData;

  // 1. Build the tier context once and derive claims policy + sufficiency.
  const hasSubjectiveInputs = !!(
    inputs?.feeling || inputs?.energy || inputs?.stress ||
    inputs?.trainingIntent || glp1Inputs
  );
  const hasCheckinToday = !!(
    glp1Inputs?.energy || glp1Inputs?.appetite ||
    glp1Inputs?.nausea || glp1Inputs?.digestion ||
    inputs?.feeling || inputs?.energy
  );
  const tierCtx = buildTierContext(
    recentMetrics,
    todayMetrics,
    availableMetricTypes,
    hasSubjectiveInputs,
    args.nowMs ?? Date.now(),
  );

  // 3. Compute treatment + dose context.
  const treatmentStage = computeTreatmentStage(profile);
  const { position: doseDayPosition, daysSinceLastDose } = computeDoseDayPosition(
    medicationLog,
    profile?.medicationProfile?.medicationBrand,
  );
  const recentTitration = !!profile?.medicationProfile?.recentTitration;

  // 4. Compute risk lenses.
  const symptomBurden = computeSymptomBurden(glp1Inputs);
  const hydrationRisk = computeHydrationRisk(args.hydration, glp1Inputs);
  const fuelingRisk = computeFuelingRisk(glp1Inputs);
  const recoveryReadiness = computeRecoveryReadiness(plan);
  const movementReadiness = computeMovementReadiness(plan);
  const adherenceSignal = computeAdherenceSignal({
    glp1Inputs, recentMetrics, completionHistory, hasCheckinToday,
  });
  const escalationNeed = computeEscalationNeed({ glp1Inputs, recentMetrics });

  // 5. Apply the strict precedence cascade for primary focus.
  const rationale: string[] = [];
  const { focus: primaryFocus, state: treatmentDailyState } = computePrimaryFocus({
    escalationNeed,
    symptomBurden,
    hydrationRisk,
    fuelingRisk,
    recoveryReadiness,
    treatmentStage,
    doseDayPosition,
    recentTitration,
    plan,
    rationale,
  });

  // 6. Confidence + sufficiency.
  const claimsPolicy = computeClaimsPolicy(tierCtx);
  const dataSufficiency = computeDataSufficiency({
    hasCheckinToday,
    tierCtx,
    profile,
  });
  if (dataSufficiency.insufficientForPlan) {
    rationale.unshift("sufficiency.insufficient");
  }

  // 7. Symptom interventions, filtered against caller's dismiss map.
  const planActivity = planActivityFromState(plan.dailyState);
  const interventions = computeInterventions(args, planActivity);

  return {
    date: plan.date,
    generatedAt: new Date().toISOString(),
    treatmentStage,
    doseDayPosition,
    recentTitration,
    daysSinceLastDose,
    symptomBurden,
    hydrationRisk,
    fuelingRisk,
    recoveryReadiness,
    movementReadiness,
    adherenceSignal,
    escalationNeed,
    dataTier: tierCtx.tier,
    claimsPolicy,
    dataSufficiency,
    primaryFocus,
    treatmentDailyState,
    rationale,
    plan,
    interventions,
  };
}
