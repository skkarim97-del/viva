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

interface StrategyRecord {
  strategyType: StrategyType;
  symptomTarget: SymptomTarget;
  date: string; // YYYY-MM-DD
  feedback: "better" | "same" | "worse" | null;
}

export interface DerivedWeights {
  successfulStrategyTypes: StrategyType[];
  failedStrategyTypes: StrategyType[];
  priorFailureCount7d: number;
  priorWorseCount7d: number;
}

function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0]!;
}

async function readRecords(): Promise<StrategyRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StrategyRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
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

function pruned(records: StrategyRecord[]): StrategyRecord[] {
  const cutoff = daysAgo(TTL_DAYS);
  return records.filter((r) => r.date >= cutoff);
}

export async function recordOutcome(
  strategyType: StrategyType,
  symptomTarget: SymptomTarget,
  feedback: "better" | "same" | "worse" | null,
): Promise<void> {
  const records = pruned(await readRecords());
  records.push({ strategyType, symptomTarget, date: today(), feedback });
  await writeRecords(records);
}

export async function deriveWeights(): Promise<DerivedWeights> {
  const records = pruned(await readRecords());
  const cutoff7d = daysAgo(7);
  const recent = records.filter((r) => r.date >= cutoff7d);

  const successSet = new Set<StrategyType>();
  const failSet = new Set<StrategyType>();
  let priorFailureCount7d = 0;
  let priorWorseCount7d = 0;

  for (const r of recent) {
    if (r.feedback === "better") {
      successSet.add(r.strategyType);
    } else if (r.feedback === "worse") {
      failSet.add(r.strategyType);
      priorWorseCount7d++;
      priorFailureCount7d++;
    } else if (r.feedback === "same") {
      failSet.add(r.strategyType);
      priorFailureCount7d++;
    }
  }

  // A strategy that also succeeded later is promoted back out of failSet
  for (const s of successSet) failSet.delete(s);

  return {
    successfulStrategyTypes: Array.from(successSet),
    failedStrategyTypes: Array.from(failSet),
    priorFailureCount7d,
    priorWorseCount7d,
  };
}
