import type { MedicationProfile } from "@/types";

export interface TitrationContext {
  recentTitration: boolean;
  daysSinceDoseChange: number | null;
  previousDoseValue: number | null;
  previousDoseUnit: string | null;
  currentDoseValue: number;
  currentDoseUnit: string;
  doseChangeDate: string | null;
  isWithinTitrationWindow: boolean;
  titrationWindowDays: number;
  titrationIntensity: "none" | "mild" | "moderate" | "peak";
}

const TITRATION_WINDOW_DAYS = 14;

export function computeDaysSinceDoseChange(doseChangeDate: string | null | undefined): number | null {
  if (!doseChangeDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = doseChangeDate.split("-").map(Number);
  const changeDate = new Date(parts[0], parts[1] - 1, parts[2]);
  changeDate.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - changeDate.getTime()) / 86400000);
  return Math.max(0, diff);
}

export function buildTitrationContext(medicationProfile?: MedicationProfile): TitrationContext {
  if (!medicationProfile) {
    return {
      recentTitration: false,
      daysSinceDoseChange: null,
      previousDoseValue: null,
      previousDoseUnit: null,
      currentDoseValue: 0,
      currentDoseUnit: "mg",
      doseChangeDate: null,
      isWithinTitrationWindow: false,
      titrationWindowDays: TITRATION_WINDOW_DAYS,
      titrationIntensity: "none",
    };
  }

  const daysSince = computeDaysSinceDoseChange(medicationProfile.doseChangeDate);
  const isRecent = medicationProfile.recentTitration === true;
  const isWithinWindow = isRecent && daysSince !== null && daysSince <= TITRATION_WINDOW_DAYS;

  let titrationIntensity: TitrationContext["titrationIntensity"] = "none";
  if (isWithinWindow && daysSince !== null) {
    if (daysSince <= 3) titrationIntensity = "peak";
    else if (daysSince <= 7) titrationIntensity = "moderate";
    else if (daysSince <= TITRATION_WINDOW_DAYS) titrationIntensity = "mild";
  }

  return {
    recentTitration: isRecent,
    daysSinceDoseChange: daysSince,
    previousDoseValue: medicationProfile.previousDoseValue ?? null,
    previousDoseUnit: medicationProfile.previousDoseUnit ?? null,
    currentDoseValue: medicationProfile.doseValue,
    currentDoseUnit: medicationProfile.doseUnit,
    doseChangeDate: medicationProfile.doseChangeDate ?? null,
    isWithinTitrationWindow: isWithinWindow,
    titrationWindowDays: TITRATION_WINDOW_DAYS,
    titrationIntensity,
  };
}

export function titrationReadinessPenalty(ctx: TitrationContext): number {
  if (!ctx.isWithinTitrationWindow) return 0;
  switch (ctx.titrationIntensity) {
    case "peak": return 15;
    case "moderate": return 10;
    case "mild": return 5;
    default: return 0;
  }
}

export function titrationSeverityBoost(ctx: TitrationContext): number {
  if (!ctx.isWithinTitrationWindow) return 0;
  switch (ctx.titrationIntensity) {
    case "peak": return 5;
    case "moderate": return 3;
    case "mild": return 1;
    default: return 0;
  }
}
