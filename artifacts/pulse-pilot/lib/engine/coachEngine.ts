import type {
  UserProfile,
  HealthMetrics,
  MedicationLogEntry,
  FeelingType,
  EnergyLevel,
  StressLevel,
  HydrationLevel,
  TrainingIntent,
  EnergyDaily,
  AppetiteLevel,
  NauseaLevel,
  DigestionStatus,
  PatientSummary,
} from "@/types";
import type { DailyInsights } from "@/data/insights";
import { buildTitrationContext } from "./titrationHelper";
import type {
  DailyTreatmentState,
  TreatmentDailyState,
  TreatmentStage,
  DoseDayPosition,
  RiskBand,
  EscalationNeed,
  AdherenceSignal,
  PrimaryFocus,
  ClaimsPolicy,
  CommunicationMode,
  SignalConfidenceMap,
} from "./dailyState";
import { selectStatusChip, selectHero } from "./selectors";

// CoachContext is now a projection of DailyTreatmentState plus the
// raw inputs the coach prompt needs (profile, medication, history).
// Anything the coach is allowed to *claim* about physiology is gated
// through dailyState.claimsPolicy. There is no parallel tier
// computation here -- the central state is the single source of
// truth.
export interface CoachContext {
  todayMetrics: {
    hrv: number | null;
    restingHeartRate: number | null;
    sleepDuration: number;
    sleepQuality: number | null;
    steps: number;
    recoveryScore: number | null;
    weight: number | null;
    strain: number | null;
    caloriesBurned: number;
    activeCalories: number;
  };
  profile: {
    name?: string;
    age: number;
    sex: string;
    weight: number;
    goalWeight: number;
    goals: string[];
    glp1Medication?: string;
    glp1Duration?: string;
    proteinConfidence?: string;
    strengthTrainingBaseline?: string;
  };
  medicationProfile?: {
    medicationBrand: string;
    genericName: string;
    doseValue: number;
    doseUnit: string;
    frequency: string;
    recentTitration: boolean;
    timeOnMedicationBucket: string;
    daysSinceDoseChange?: number | null;
    previousDoseValue?: number | null;
    titrationIntensity?: "none" | "mild" | "moderate" | "peak";
  };
  recentDoseLog: { date: string; status: string; doseValue: number; doseUnit: string }[];

  // Self-report inputs (always allowed; not gated by claimsPolicy).
  userFeeling: FeelingType;
  userEnergy: EnergyLevel;
  userStress: StressLevel;
  userHydration: HydrationLevel;
  userTrainingIntent: TrainingIntent;
  glp1DailyInputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    nausea: NauseaLevel;
    digestion: DigestionStatus;
  };

  // Derived stats. Forwarded only when claimsPolicy permits the
  // matching claim, so the model cannot reference them otherwise.
  hrvBaseline?: number;
  sleepDebt?: number;
  recoveryTrend?: "improving" | "declining" | "stable";
  sleepInsight?: string;

  streakDays: number;
  weeklyCompletionRate: number;
  todayCompletionRate: number;
  patientSummary?: PatientSummary;

  // Central treatment state, projected for the API server.
  treatmentState?: {
    treatmentDailyState: TreatmentDailyState;
    primaryFocus: PrimaryFocus;
    escalationNeed: EscalationNeed;
    treatmentStage: TreatmentStage;
    doseDayPosition: DoseDayPosition;
    recentTitration: boolean;
    daysSinceLastDose: number | null;
    symptomBurden: RiskBand;
    hydrationRisk: RiskBand;
    fuelingRisk: RiskBand;
    recoveryReadiness: RiskBand;
    adherenceSignal: AdherenceSignal;
    insufficientForPlan: boolean;
    claimsPolicy: ClaimsPolicy;
    // Per-signal confidence is part of claimsPolicy. We forward it
    // explicitly here too so the server prompt can render confidence
    // hedge guidance per signal without re-deriving anything.
    signalConfidence: SignalConfidenceMap;
    // Behavior strategy for tone selection on the server side.
    communicationMode: CommunicationMode;
    dataTier: "self_report" | "phone_health" | "wearable";
    statusChipLabel: string;
    heroHeadline: string;
    heroDrivers: string[];
    interventionTitles: string[];
    rationale: string[];
  };
}

export function computeHrvBaseline(metrics: HealthMetrics[]): number | undefined {
  if (metrics.length < 7) return undefined;
  const hrvVals = metrics.slice(-7).map(m => m.hrv).filter((v): v is number => typeof v === "number");
  if (hrvVals.length === 0) return undefined;
  return Math.round(hrvVals.reduce((s, v) => s + v, 0) / hrvVals.length);
}

export function computeSleepDebt(metrics: HealthMetrics[]): number | undefined {
  if (metrics.length < 3) return undefined;
  return +(metrics.slice(-3).reduce((s, m) => s + Math.max(0, 7.5 - m.sleepDuration), 0)).toFixed(1);
}

export function computeRecoveryTrend(metrics: HealthMetrics[]): "improving" | "declining" | "stable" | undefined {
  if (metrics.length < 3) return undefined;
  const scores = metrics.slice(-3).map(m => m.recoveryScore).filter((v): v is number => typeof v === "number");
  if (scores.length < 2) return undefined;
  const diff = scores[scores.length - 1] - scores[0];
  if (diff > 5) return "improving";
  if (diff < -5) return "declining";
  return "stable";
}

export function buildCoachContext(
  todayMetrics: HealthMetrics,
  metrics: HealthMetrics[],
  profile: UserProfile,
  dailyState: DailyTreatmentState | null,
  insights: DailyInsights | null,
  medicationLog: MedicationLogEntry[],
  glp1Inputs: {
    energy: EnergyDaily;
    appetite: AppetiteLevel;
    nausea: NauseaLevel;
    digestion: DigestionStatus;
  },
  wellnessInputs: {
    feeling: FeelingType;
    energy: EnergyLevel;
    stress: StressLevel;
    hydration: HydrationLevel;
    trainingIntent: TrainingIntent;
  },
  streakDays: number,
  weeklyConsistency: number,
  todayCompletionRate: number,
  patientSummary?: PatientSummary | null,
): CoachContext {
  // Single source of truth: dailyState.claimsPolicy. If no state was
  // computed yet (cold start before any check-in), treat as
  // physiologically-blind self_report tier and let the API server
  // surface "tell me how today is going" framing.
  const denyAllSignal = (reason: string) => ({
    isAvailable: false,
    canCite: false,
    confidenceLevel: "none" as const,
    confidenceReason: reason,
  });
  const policy: ClaimsPolicy = dailyState?.claimsPolicy ?? {
    canCiteSleep: false,
    canCiteHRV: false,
    canCiteRecovery: false,
    canCiteSteps: false,
    canQuantifyReadiness: false,
    physiologicalClaimsAllowed: false,
    narrativeConfidence: "low",
    signalConfidence: {
      hrv:           denyAllSignal("no daily treatment state available yet"),
      rhr:           denyAllSignal("no daily treatment state available yet"),
      sleepDuration: denyAllSignal("no daily treatment state available yet"),
      sleepQuality:  denyAllSignal("no daily treatment state available yet"),
      recovery:      denyAllSignal("no daily treatment state available yet"),
      activity:      denyAllSignal("no daily treatment state available yet"),
    },
  };

  const hrvBaseline = computeHrvBaseline(metrics);
  const sleepDebt = computeSleepDebt(metrics);
  const recoveryTrend = computeRecoveryTrend(metrics);

  return {
    todayMetrics: {
      // Wearable / physiological metrics: only forward when claims
      // policy explicitly permits citing them. Null on the wire =
      // suppressed line in the prompt = model cannot reference.
      hrv: policy.canCiteHRV ? todayMetrics.hrv : null,
      restingHeartRate: policy.canCiteHRV ? todayMetrics.restingHeartRate : null,
      sleepDuration: policy.canCiteSleep ? todayMetrics.sleepDuration : 0,
      sleepQuality: policy.canCiteSleep && policy.physiologicalClaimsAllowed ? todayMetrics.sleepQuality : null,
      steps: policy.canCiteSteps ? todayMetrics.steps : 0,
      recoveryScore: policy.canCiteRecovery ? todayMetrics.recoveryScore : null,
      weight: todayMetrics.weight,
      strain: policy.physiologicalClaimsAllowed ? todayMetrics.strain : null,
      caloriesBurned: policy.canCiteSteps ? todayMetrics.caloriesBurned : 0,
      activeCalories: policy.canCiteSteps ? todayMetrics.activeCalories : 0,
    },
    profile: {
      name: profile.name || undefined,
      age: profile.age,
      sex: profile.sex,
      weight: profile.weight,
      goalWeight: profile.goalWeight,
      goals: profile.goals,
      glp1Medication: profile.glp1Medication,
      glp1Duration: profile.glp1Duration,
      proteinConfidence: profile.proteinConfidence,
      strengthTrainingBaseline: profile.strengthTrainingBaseline,
    },
    medicationProfile: profile.medicationProfile ? (() => {
      const titration = buildTitrationContext(profile.medicationProfile);
      return {
        medicationBrand: profile.medicationProfile!.medicationBrand,
        genericName: profile.medicationProfile!.genericName,
        doseValue: profile.medicationProfile!.doseValue,
        doseUnit: profile.medicationProfile!.doseUnit,
        frequency: profile.medicationProfile!.frequency,
        recentTitration: profile.medicationProfile!.recentTitration,
        timeOnMedicationBucket: profile.medicationProfile!.timeOnMedicationBucket,
        daysSinceDoseChange: titration.daysSinceDoseChange,
        previousDoseValue: titration.previousDoseValue,
        titrationIntensity: titration.titrationIntensity,
      };
    })() : undefined,
    recentDoseLog: medicationLog.slice(-5).map(e => ({ date: e.date, status: e.status, doseValue: e.doseValue, doseUnit: e.doseUnit })),
    userFeeling: wellnessInputs.feeling,
    userEnergy: wellnessInputs.energy,
    userStress: wellnessInputs.stress,
    userHydration: wellnessInputs.hydration,
    userTrainingIntent: wellnessInputs.trainingIntent,
    glp1DailyInputs: glp1Inputs,
    sleepInsight: policy.canCiteSleep ? insights?.sleepIntelligence?.insight : undefined,
    hrvBaseline: policy.canCiteHRV ? hrvBaseline : undefined,
    sleepDebt: policy.canCiteSleep ? sleepDebt : undefined,
    recoveryTrend: policy.canCiteRecovery ? recoveryTrend : undefined,
    streakDays,
    weeklyCompletionRate: weeklyConsistency,
    todayCompletionRate,
    patientSummary: patientSummary ?? undefined,
    treatmentState: dailyState ? (() => {
      const chip = selectStatusChip(dailyState);
      const hero = selectHero(dailyState);
      return {
        treatmentDailyState: dailyState.treatmentDailyState,
        primaryFocus: dailyState.primaryFocus,
        escalationNeed: dailyState.escalationNeed,
        treatmentStage: dailyState.treatmentStage,
        doseDayPosition: dailyState.doseDayPosition,
        recentTitration: dailyState.recentTitration,
        daysSinceLastDose: dailyState.daysSinceLastDose,
        symptomBurden: dailyState.symptomBurden,
        hydrationRisk: dailyState.hydrationRisk,
        fuelingRisk: dailyState.fuelingRisk,
        recoveryReadiness: dailyState.recoveryReadiness,
        adherenceSignal: dailyState.adherenceSignal,
        insufficientForPlan: dailyState.dataSufficiency.insufficientForPlan,
        claimsPolicy: dailyState.claimsPolicy,
        signalConfidence: dailyState.claimsPolicy.signalConfidence,
        communicationMode: dailyState.communicationMode,
        dataTier: dailyState.dataTier,
        statusChipLabel: chip.label,
        heroHeadline: hero.headline,
        heroDrivers: hero.drivers,
        interventionTitles: dailyState.interventions.slice(0, 2).map(i => i.title),
        rationale: dailyState.rationale.slice(0, 6),
      };
    })() : undefined,
  };
}
