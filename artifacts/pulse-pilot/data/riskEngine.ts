import type {
  HealthMetrics,
  GLP1DailyInputs,
  CompletionRecord,
  RiskDriver,
  RiskLevel,
  DropoutRiskResult,
} from "@/types";
import { translateRiskToUserMessage } from "./riskTranslation";

interface RiskEngineInput {
  recentMetrics: HealthMetrics[];
  dailyInputs: GLP1DailyInputs[];
  completionHistory: CompletionRecord[];
}

function computeBaseline(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function checkRecoveryBreakdown(metrics: HealthMetrics[]): RiskDriver | null {
  if (metrics.length < 7) return null;

  const last14 = metrics.slice(-14);
  const last7 = metrics.slice(-7);
  const baseline = last14.length >= 14 ? last14.slice(0, 7) : last14;

  const baselineHrv = computeBaseline(baseline.map(m => m.hrv));
  const currentHrv = computeBaseline(last7.map(m => m.hrv));
  const hrvDropPct = baselineHrv > 0 ? ((baselineHrv - currentHrv) / baselineHrv) * 100 : 0;

  const baselineRhr = computeBaseline(baseline.map(m => m.restingHeartRate));
  const currentRhr = computeBaseline(last7.map(m => m.restingHeartRate));
  const rhrRisePct = baselineRhr > 0 ? ((currentRhr - baselineRhr) / baselineRhr) * 100 : 0;

  const baselineSleep = computeBaseline(baseline.map(m => m.sleepDuration));
  const currentSleep = computeBaseline(last7.map(m => m.sleepDuration));
  const sleepDrop = baselineSleep - currentSleep;

  const hrvFlag = hrvDropPct >= 15;
  const rhrFlag = rhrRisePct >= 5;
  const sleepFlag = sleepDrop >= 0.75;

  if ((hrvFlag || rhrFlag) && sleepFlag) {
    return {
      category: "recovery",
      label: "Recovery signals are lower than your recent baseline",
      score: 25,
    };
  }
  return null;
}

function checkActivityDecline(metrics: HealthMetrics[]): RiskDriver | null {
  if (metrics.length < 7) return null;

  const last7 = metrics.slice(-7);
  const avgSteps = computeBaseline(last7.map(m => m.steps));
  const current3 = last7.slice(-3);
  const recent3Avg = computeBaseline(current3.map(m => m.steps));

  const dropPct = avgSteps > 0 ? ((avgSteps - recent3Avg) / avgSteps) * 100 : 0;
  const consecutiveLow = current3.every(m => m.steps < 3000);

  if (dropPct >= 25 || consecutiveLow) {
    return {
      category: "activity",
      label: "Movement has dropped compared to your recent pattern",
      score: 20,
    };
  }
  return null;
}

function checkFuelingBreakdown(inputs: GLP1DailyInputs[]): RiskDriver | null {
  if (inputs.length < 2) return null;

  const recent = inputs.slice(-3);
  const lowAppetiteDays = recent.filter(i => i.appetite === "very_low").length;
  const poorProtein = recent.some(i => i.proteinConfidence === "poor");
  const poorHydration = recent.some(i => i.hydration === "poor");

  if (lowAppetiteDays >= 2 && (poorProtein || poorHydration)) {
    return {
      category: "fueling",
      label: "Appetite and fueling have been consistently low",
      score: 25,
    };
  }

  if (lowAppetiteDays >= 2) {
    return {
      category: "fueling",
      label: "Appetite has been very low recently",
      score: 15,
    };
  }

  if (poorProtein && poorHydration) {
    return {
      category: "fueling",
      label: "Protein and hydration need attention",
      score: 15,
    };
  }

  return null;
}

function checkSymptomLoad(inputs: GLP1DailyInputs[]): RiskDriver | null {
  if (inputs.length < 2) return null;

  const recent = inputs.slice(-3);
  const heavyDays = recent.filter(i => i.sideEffects === "moderate" || i.sideEffects === "rough").length;

  if (heavyDays >= 2) {
    return {
      category: "symptoms",
      label: "Side effects have been heavier than usual recently",
      score: 20,
    };
  }
  return null;
}

function checkConsistencyBreakdown(completionHistory: CompletionRecord[], inputs: GLP1DailyInputs[]): RiskDriver | null {
  const recent7 = completionHistory.slice(-7);
  if (recent7.length < 3) return null;

  const avgCompletion = computeBaseline(recent7.map(r => r.completionRate));
  const missedDays = 7 - recent7.length;
  const lowCompletion = avgCompletion < 40;

  const recentInputs = inputs.slice(-7);
  const intentVsActual = recentInputs.filter(i =>
    i.movementIntent === "strength" || i.movementIntent === "walk"
  ).length;
  const actualMoveDays = recent7.filter(r =>
    r.actions.some(a => a.category === "move" && a.completed)
  ).length;
  const divergence = intentVsActual > 0 && actualMoveDays < intentVsActual * 0.5;

  if (missedDays >= 3 || lowCompletion || divergence) {
    return {
      category: "consistency",
      label: "Check-in consistency has dropped recently",
      score: 10,
    };
  }
  return null;
}

export function calculateDropoutRisk(input: RiskEngineInput): DropoutRiskResult {
  const drivers: RiskDriver[] = [];

  const recoveryDriver = checkRecoveryBreakdown(input.recentMetrics);
  if (recoveryDriver) drivers.push(recoveryDriver);

  const activityDriver = checkActivityDecline(input.recentMetrics);
  if (activityDriver) drivers.push(activityDriver);

  const fuelingDriver = checkFuelingBreakdown(input.dailyInputs);
  if (fuelingDriver) drivers.push(fuelingDriver);

  const symptomDriver = checkSymptomLoad(input.dailyInputs);
  if (symptomDriver) drivers.push(symptomDriver);

  const consistencyDriver = checkConsistencyBreakdown(input.completionHistory, input.dailyInputs);
  if (consistencyDriver) drivers.push(consistencyDriver);

  const riskScore = drivers.reduce((sum, d) => sum + d.score, 0);

  let riskLevel: RiskLevel = "low";
  if (riskScore >= 71) riskLevel = "high";
  else if (riskScore >= 41) riskLevel = "elevated";
  else if (riskScore >= 21) riskLevel = "mild";

  const interventionFocus = drivers.map(d => d.category);

  const { userMessage, supportHeadline } = translateRiskToUserMessage(riskLevel, drivers);

  return {
    riskLevel,
    riskScore,
    riskDrivers: drivers,
    interventionFocus,
    userMessage,
    supportHeadline,
  };
}
