import type { HealthMetrics, DailyPlan, FeelingType, EnergyLevel, StressLevel, HydrationLevel, TrainingIntent, GLP1DailyInputs } from "@/types";
import { buildTierContext, type TierContext } from "@/lib/engine/dataTier";

export interface TierDebugSnapshot {
  generatedAt: string;
  hasHealthData: boolean;
  dataTier: TierContext["tier"];
  recommendationConfidence: DailyPlan["recommendationConfidence"] | null;
  readiness: { score: number | null; label: string | null; state: string | null };
  availableMetricTypes: string[];
  hasSubjectiveInputs: boolean;
  sufficiency: TierContext["sufficiency"];
  freshness: TierContext["freshness"];
  usable: { sleep: boolean; steps: boolean; rhr: boolean; hrv: boolean };
  baselines: TierContext["baselines"];
  validBaselines: { sleep7d: boolean; rhr14d: boolean; hrv14d: boolean; stepsWeekly: boolean };
  deviations: TierContext["deviations"];
  firedNegativeSignals: string[];
  todaySnapshot: {
    date: string;
    hrv: number | null;
    restingHeartRate: number | null;
    sleepDuration: number | null;
    steps: number | null;
    recoveryScore: number | null;
  };
  historyDepth: { totalDays: number; oldest: string | null; newest: string | null };
}

interface BuildArgs {
  metrics: HealthMetrics[]; // full history
  recentMetrics: HealthMetrics[]; // last N used by planEngine
  todayMetrics: HealthMetrics | null;
  availableMetricTypes: string[];
  hasHealthData: boolean;
  dailyPlan: DailyPlan | null;
  wellnessInputs: {
    feeling: FeelingType;
    energy: EnergyLevel;
    stress: StressLevel;
    hydration: HydrationLevel;
    trainingIntent: TrainingIntent;
  };
  glp1Inputs: GLP1DailyInputs | null;
}

/**
 * Re-derive the same negative-signal flags the planEngine fires, so the QA screen can
 * display them without us having to plumb a separate diagnostic channel through every
 * recommendation cycle. Keep this in sync with planEngine signal logic.
 */
function deriveFiredSignals(args: BuildArgs, ctx: TierContext): string[] {
  const fired: string[] = [];
  const last7 = args.recentMetrics.slice(-7);
  const last3 = last7.slice(-3);
  const last5 = args.recentMetrics.slice(-5);
  const today = args.todayMetrics;

  if (today && ctx.usableSleep && today.sleepDuration > 0 && today.sleepDuration < 5) fired.push("sleepCritical");
  if (today && ctx.usableSleep && today.sleepDuration >= 5 && today.sleepDuration < 6.5) fired.push("sleepLow");
  if (last3.length >= 3 && last3.every(m => typeof m.recoveryScore === "number" && (m.recoveryScore as number) < 50)) {
    fired.push("consecutivePoorRecovery");
  }
  if (ctx.usableHrv && last5.length >= 5) {
    const hrvVals = last5.map(m => m.hrv).filter((v): v is number => typeof v === "number");
    if (hrvVals.length >= 4) {
      const first = hrvVals[0];
      const last = hrvVals[hrvVals.length - 1];
      if (first > 0 && (first - last) / first > 0.1) fired.push("hrvDeclining5");
    }
  }
  if (ctx.usableRhr && ctx.baselines.rhr14dBaseline !== null && today && typeof today.restingHeartRate === "number") {
    if (today.restingHeartRate - ctx.baselines.rhr14dBaseline >= 5) fired.push("rhrElevated");
  }
  const g = args.glp1Inputs;
  if (g?.nausea === "severe") fired.push("symptomsHeavy");
  if (g?.appetite === "low" || g?.appetite === "very_low") fired.push("appetiteLow");
  if (g?.digestion === "bloated" || g?.digestion === "constipated" || g?.digestion === "diarrhea") fired.push("digestiveDistress");
  if (args.wellnessInputs.stress === "high") fired.push("stressOverride");

  return fired;
}

export function buildTierDebugSnapshot(args: BuildArgs): TierDebugSnapshot {
  const hasSubjectiveInputs = !!(args.wellnessInputs.feeling || args.wellnessInputs.energy || args.wellnessInputs.stress || args.wellnessInputs.trainingIntent || args.glp1Inputs);
  const ctx = buildTierContext(args.recentMetrics, args.todayMetrics, args.availableMetricTypes, hasSubjectiveInputs, Date.now());

  const validBaselines = {
    sleep7d: ctx.baselines.sleep7dAvg !== null,
    rhr14d: ctx.baselines.rhr14dBaseline !== null,
    hrv14d: ctx.baselines.hrv14dBaseline !== null,
    stepsWeekly: ctx.baselines.stepsWeeklyBaseline !== null,
  };

  const fired = deriveFiredSignals(args, ctx);

  return {
    generatedAt: new Date().toISOString(),
    hasHealthData: args.hasHealthData,
    dataTier: args.dailyPlan?.dataTier ?? ctx.tier,
    recommendationConfidence: args.dailyPlan?.recommendationConfidence ?? null,
    readiness: {
      score: args.dailyPlan?.readinessScore ?? null,
      label: args.dailyPlan?.readinessLabel ?? null,
      state: args.dailyPlan?.dailyState ?? null,
    },
    availableMetricTypes: ctx.availableMetricTypes,
    hasSubjectiveInputs,
    sufficiency: ctx.sufficiency,
    freshness: ctx.freshness,
    usable: { sleep: ctx.usableSleep, steps: ctx.usableSteps, rhr: ctx.usableRhr, hrv: ctx.usableHrv },
    baselines: ctx.baselines,
    validBaselines,
    deviations: ctx.deviations,
    firedNegativeSignals: fired,
    todaySnapshot: {
      date: args.todayMetrics?.date ?? "(none)",
      hrv: args.todayMetrics?.hrv ?? null,
      restingHeartRate: args.todayMetrics?.restingHeartRate ?? null,
      sleepDuration: args.todayMetrics?.sleepDuration ?? null,
      steps: args.todayMetrics?.steps ?? null,
      recoveryScore: args.todayMetrics?.recoveryScore ?? null,
    },
    historyDepth: {
      totalDays: args.metrics.length,
      oldest: args.metrics[0]?.date ?? null,
      newest: args.metrics[args.metrics.length - 1]?.date ?? null,
    },
  };
}
