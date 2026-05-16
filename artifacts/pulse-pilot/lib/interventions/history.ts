/**
 * Local intervention outcome store backed by AsyncStorage.
 *
 * v1: device-local only. Records are pruned after TTL_DAYS.
 * TODO: sync with server history API when available.
 *
 * Security / safety constraints:
 *  - Stores only structured tags (strategyType, symptomTarget, date, feedback).
 *  - No free-text PHI is persisted.
 *  - All reads/writes are best-effort; errors are swallowed so the card
 *    degrades gracefully to stateless selection.
 *
 * Future agentic upgrade path:
 *  - Replace deriveWeights() with a server-side model that learns
 *    patient-specific response patterns across sessions.
 *  - recordOutcome() can become a thin client wrapper around that API.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StrategyType, SymptomTarget } from "./types";

const KEY = "@viva_intervention_history";
const TTL_DAYS = 14;

// "requested_review" means the patient asked for care-team review — not the
// same as "worse" (symptoms explicitly worsened). It contributes to the overall
// "things haven't resolved" count but must not inflate the "worsening" signal.
type Feedback = "better" | "same" | "worse" | "requested_review" | null;

interface StrategyRecord {
  strategyType: StrategyType;
  symptomTarget: SymptomTarget;
  date: string; // YYYY-MM-DD
  feedback: Feedback;
}

export interface DerivedWeights {
  // Per-symptom maps — always filter by the current symptom target so a
  // strategy that failed for nausea is not suppressed when used for sleep.
  successfulBySymptom: Partial<Record<SymptomTarget, StrategyType[]>>;
  failedBySymptom: Partial<Record<SymptomTarget, StrategyType[]>>;
  // Cross-symptom counts used only as an overall escalation signal.
  priorFailureCount7d: number;
  priorWorseCount7d: number;
}

function toDateString(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

function cutoffDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return toDateString(d);
}

async function readRecords(): Promise<StrategyRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StrategyRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: StrategyRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* best-effort */
  }
}

export async function recordOutcome(
  strategyType: StrategyType,
  symptomTarget: SymptomTarget,
  feedback: Feedback,
): Promise<void> {
  const cutoff = cutoffDate(TTL_DAYS);
  const records = (await readRecords()).filter((r) => r.date >= cutoff);
  records.push({ strategyType, symptomTarget, date: toDateString(new Date()), feedback });
  await writeRecords(records);
}

export async function deriveWeights(): Promise<DerivedWeights> {
  const cutoff14 = cutoffDate(TTL_DAYS);
  const cutoff7 = cutoffDate(7);
  const all = (await readRecords()).filter((r) => r.date >= cutoff14);
  const recent = all.filter((r) => r.date >= cutoff7);

  const successBySymptom: Partial<Record<SymptomTarget, Set<StrategyType>>> = {};
  const failBySymptom: Partial<Record<SymptomTarget, Set<StrategyType>>> = {};
  let priorFailureCount7d = 0;
  let priorWorseCount7d = 0;

  for (const r of recent) {
    const sym = r.symptomTarget;
    if (r.feedback === "better") {
      (successBySymptom[sym] ??= new Set()).add(r.strategyType);
    } else if (r.feedback === "worse") {
      (failBySymptom[sym] ??= new Set()).add(r.strategyType);
      priorWorseCount7d++;
      priorFailureCount7d++;
    } else if (r.feedback === "same") {
      (failBySymptom[sym] ??= new Set()).add(r.strategyType);
      priorFailureCount7d++;
    } else if (r.feedback === "requested_review") {
      priorFailureCount7d++;
    }
  }

  // A strategy that later succeeded for the same symptom is promoted back out.
  for (const sym of Object.keys(failBySymptom) as SymptomTarget[]) {
    const successes = successBySymptom[sym];
    if (successes) {
      for (const s of successes) failBySymptom[sym]!.delete(s);
    }
  }

  const toArrayMap = (
    m: Partial<Record<SymptomTarget, Set<StrategyType>>>,
  ): Partial<Record<SymptomTarget, StrategyType[]>> => {
    const result: Partial<Record<SymptomTarget, StrategyType[]>> = {};
    for (const [sym, set] of Object.entries(m) as [SymptomTarget, Set<StrategyType>][]) {
      result[sym] = Array.from(set);
    }
    return result;
  };

  return {
    successfulBySymptom: toArrayMap(successBySymptom),
    failedBySymptom: toArrayMap(failBySymptom),
    priorFailureCount7d,
    priorWorseCount7d,
  };
}
