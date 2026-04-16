export type MedicationBrand = "wegovy" | "ozempic" | "zepbound" | "mounjaro" | "saxenda" | "other";

export interface DoseOption {
  value: number;
  unit: string;
  frequency: "weekly" | "daily";
  label: string;
}

export interface MedicationInfo {
  brand: MedicationBrand;
  displayName: string;
  genericName: string;
  indication: string;
  frequency: "weekly" | "daily";
  doses: DoseOption[];
}

export const MEDICATION_DATABASE: Record<Exclude<MedicationBrand, "other">, MedicationInfo> = {
  wegovy: {
    brand: "wegovy",
    displayName: "Wegovy",
    genericName: "semaglutide",
    indication: "weight loss",
    frequency: "weekly",
    doses: [
      { value: 0.25, unit: "mg", frequency: "weekly", label: "0.25 mg weekly" },
      { value: 0.5, unit: "mg", frequency: "weekly", label: "0.5 mg weekly" },
      { value: 1.0, unit: "mg", frequency: "weekly", label: "1.0 mg weekly" },
      { value: 1.7, unit: "mg", frequency: "weekly", label: "1.7 mg weekly" },
      { value: 2.4, unit: "mg", frequency: "weekly", label: "2.4 mg weekly" },
    ],
  },
  ozempic: {
    brand: "ozempic",
    displayName: "Ozempic",
    genericName: "semaglutide",
    indication: "weight loss",
    frequency: "weekly",
    doses: [
      { value: 0.25, unit: "mg", frequency: "weekly", label: "0.25 mg weekly" },
      { value: 0.5, unit: "mg", frequency: "weekly", label: "0.5 mg weekly" },
      { value: 1.0, unit: "mg", frequency: "weekly", label: "1.0 mg weekly" },
      { value: 2.0, unit: "mg", frequency: "weekly", label: "2.0 mg weekly" },
    ],
  },
  zepbound: {
    brand: "zepbound",
    displayName: "Zepbound",
    genericName: "tirzepatide",
    indication: "weight loss",
    frequency: "weekly",
    doses: [
      { value: 2.5, unit: "mg", frequency: "weekly", label: "2.5 mg weekly" },
      { value: 5, unit: "mg", frequency: "weekly", label: "5 mg weekly" },
      { value: 7.5, unit: "mg", frequency: "weekly", label: "7.5 mg weekly" },
      { value: 10, unit: "mg", frequency: "weekly", label: "10 mg weekly" },
      { value: 12.5, unit: "mg", frequency: "weekly", label: "12.5 mg weekly" },
      { value: 15, unit: "mg", frequency: "weekly", label: "15 mg weekly" },
    ],
  },
  mounjaro: {
    brand: "mounjaro",
    displayName: "Mounjaro",
    genericName: "tirzepatide",
    indication: "weight loss",
    frequency: "weekly",
    doses: [
      { value: 2.5, unit: "mg", frequency: "weekly", label: "2.5 mg weekly" },
      { value: 5, unit: "mg", frequency: "weekly", label: "5 mg weekly" },
      { value: 7.5, unit: "mg", frequency: "weekly", label: "7.5 mg weekly" },
      { value: 10, unit: "mg", frequency: "weekly", label: "10 mg weekly" },
      { value: 12.5, unit: "mg", frequency: "weekly", label: "12.5 mg weekly" },
      { value: 15, unit: "mg", frequency: "weekly", label: "15 mg weekly" },
    ],
  },
  saxenda: {
    brand: "saxenda",
    displayName: "Saxenda",
    genericName: "liraglutide",
    indication: "weight loss",
    frequency: "daily",
    doses: [
      { value: 0.6, unit: "mg", frequency: "daily", label: "0.6 mg daily" },
      { value: 1.2, unit: "mg", frequency: "daily", label: "1.2 mg daily" },
      { value: 1.8, unit: "mg", frequency: "daily", label: "1.8 mg daily" },
      { value: 2.4, unit: "mg", frequency: "daily", label: "2.4 mg daily" },
      { value: 3.0, unit: "mg", frequency: "daily", label: "3.0 mg daily" },
    ],
  },
};

export const BRAND_OPTIONS: { key: MedicationBrand; label: string }[] = [
  { key: "wegovy", label: "Wegovy" },
  { key: "ozempic", label: "Ozempic" },
  { key: "zepbound", label: "Zepbound" },
  { key: "mounjaro", label: "Mounjaro" },
  { key: "saxenda", label: "Saxenda" },
  { key: "other", label: "Other GLP-1 / weight loss med" },
];

export const TELEHEALTH_PLATFORMS = [
  "Ro",
  "Hims & Hers",
  "WeightWatchers Clinic",
  "Sequence",
  "Noom Med",
  "Found",
  "Calibrate",
  "Form Health",
  "Sesame",
  "PlushCare",
  "LifeMD",
  "Push Health",
  "Mochi Health",
  "Fridays",
  "Henry Meds",
  "Joinamble",
  "Teladoc",
  "Local doctor / clinic",
  "Other",
];

export const TIME_ON_MED_OPTIONS = [
  { key: "less_1_month" as const, label: "Less than 1 month" },
  { key: "1_3_months" as const, label: "1 to 3 months" },
  { key: "3_6_months" as const, label: "3 to 6 months" },
  { key: "6_9_months" as const, label: "6 to 9 months" },
  { key: "9_12_months" as const, label: "9 to 12 months" },
  { key: "1_1_5_years" as const, label: "1 to 1.5 years" },
  { key: "1_5_2_years" as const, label: "1.5 to 2 years" },
  { key: "2_plus_years" as const, label: "2+ years" },
];

export type TimeOnMedBucket = (typeof TIME_ON_MED_OPTIONS)[number]["key"];

export function getBrandGeneric(brand: MedicationBrand): string {
  if (brand === "other") return "unknown";
  return MEDICATION_DATABASE[brand].genericName;
}

export function getBrandDisplayName(brand: MedicationBrand): string {
  if (brand === "other") return "Other";
  return MEDICATION_DATABASE[brand].displayName;
}

export function getDoseOptions(brand: MedicationBrand | string): DoseOption[] {
  if (!brand || brand === "other") return [];
  const key = String(brand).toLowerCase() as Exclude<MedicationBrand, "other">;
  const info = MEDICATION_DATABASE[key];
  return info ? info.doses : [];
}

export function getMedicationFrequency(brand: MedicationBrand | string): "weekly" | "daily" {
  if (!brand || brand === "other") return "weekly";
  const key = String(brand).toLowerCase() as Exclude<MedicationBrand, "other">;
  const info = MEDICATION_DATABASE[key];
  return info ? info.frequency : "weekly";
}

export function normalizeBrand(brand: string | undefined | null): MedicationBrand {
  if (!brand) return "other";
  const key = String(brand).toLowerCase();
  if (key === "other") return "other";
  return (key in MEDICATION_DATABASE) ? (key as MedicationBrand) : "other";
}

export function getDoseTier(brand: MedicationBrand | string, doseValue: number): "low" | "mid" | "high" {
  const key = brand.toLowerCase() as MedicationBrand;
  if (key === "other" || !(key in MEDICATION_DATABASE)) return "mid";
  const info = MEDICATION_DATABASE[key as Exclude<MedicationBrand, "other">];
  const doses = info.doses.map(d => d.value);
  const maxDose = Math.max(...doses);
  const midpoint = maxDose * 0.5;
  if (doseValue <= midpoint * 0.6) return "low";
  if (doseValue >= midpoint * 1.4) return "high";
  return "mid";
}

export function formatDoseDisplay(brand: MedicationBrand | string, doseValue: number, doseUnit: string, frequency: "weekly" | "daily"): string {
  const key = brand.toLowerCase() as MedicationBrand;
  const brandName = (key === "other" || !(key in MEDICATION_DATABASE)) ? "" : getBrandDisplayName(key);
  const doseStr = `${doseValue} ${doseUnit} ${frequency}`;
  return brandName ? `${brandName} ${String.fromCharCode(183)} ${doseStr}` : doseStr;
}
