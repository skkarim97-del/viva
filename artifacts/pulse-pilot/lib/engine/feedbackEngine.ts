import type { DailyAction, ActionCategory } from "@/types";

const CATEGORY_FEEDBACK: Record<string, string[]> = {
  move: [
    "Movement logged. Activity helps preserve muscle on treatment.",
    "Done. Even moderate movement supports digestion and energy.",
    "Active minutes in the bank. Consistency here adds up fast.",
  ],
  fuel: [
    "Fueling checked off. Protein at every meal protects lean mass.",
    "Nutrition logged. Your body uses this to recover and rebuild.",
    "Solid fueling today. This helps offset appetite suppression.",
  ],
  hydrate: [
    "Hydration on track. This helps manage nausea and fatigue.",
    "Water intake logged. Staying hydrated supports energy and digestion.",
    "Hydration done. Electrolytes help your body absorb more of it.",
  ],
  recover: [
    "Recovery prioritized. Sleep is your strongest lever on treatment.",
    "Rest logged. Your body does its best repair work overnight.",
    "Recovery checked off. Aim for a consistent wind-down tonight.",
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
    return "All actions complete. Days like this build real momentum on treatment.";
  }

  return pool[Math.floor(Math.random() * pool.length)];
}
