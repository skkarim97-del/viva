import type { DailyAction, ActionCategory } from "@/types";

const CATEGORY_FEEDBACK: Record<string, string[]> = {
  move: [
    "Nice work getting active today.",
    "Movement done. Your body appreciates it.",
    "Active minutes logged. Keep it up.",
  ],
  fuel: [
    "Great job fueling well today.",
    "Nutrition on track. Your body needs this.",
    "Good fueling. Protein helps preserve muscle.",
  ],
  hydrate: [
    "Hydration goal hit. Well done.",
    "Staying hydrated supports everything else.",
    "Water intake is solid today.",
  ],
  recover: [
    "Recovery prioritized. Smart move.",
    "Rest is productive. Your body is rebuilding.",
    "Recovery checked off. Sleep well tonight.",
  ],
};

export function generateCompletionFeedback(
  action: DailyAction,
  completed: boolean,
  completedCount: number,
  total: number,
): string | null {
  if (!completed) return null;

  const pool = CATEGORY_FEEDBACK[action.category];
  if (!pool) return null;

  if (completedCount === total) {
    return "All actions complete. Excellent day.";
  }

  return pool[Math.floor(Math.random() * pool.length)];
}
