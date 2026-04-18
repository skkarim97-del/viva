/**
 * Workflow chip that turns the risk score into a directive: should the
 * doctor act now, watch this patient, or move on? Lives next to the
 * risk pill so the eye lands on a verb, not a number.
 *
 * Thresholds match the user spec:
 *   60+ -> Needs follow-up, 30-59 -> Monitor, <30 -> Stable.
 */

interface Props {
  score: number;
  size?: "sm" | "md";
}

type Action = "needs_followup" | "monitor" | "stable";

function actionFor(score: number): Action {
  if (score >= 60) return "needs_followup";
  if (score >= 30) return "monitor";
  return "stable";
}

const STYLES: Record<Action, { bg: string; text: string; label: string }> = {
  // Filled solid -- this is the alarm. Pulls the eye first.
  needs_followup: {
    bg: "#FF3B30",
    text: "#FFFFFF",
    label: "Needs follow-up",
  },
  // Filled solid amber -- still a directive, just less urgent.
  monitor: {
    bg: "#FF9500",
    text: "#FFFFFF",
    label: "Monitor",
  },
  // Tinted -- "do nothing" should not shout.
  stable: {
    bg: "rgba(52,199,89,0.13)",
    text: "#1F8A3E",
    label: "Stable",
  },
};

export function ActionBadge({ score, size = "sm" }: Props) {
  const s = STYLES[actionFor(score)];
  const padding =
    size === "md" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${padding}`}
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}
