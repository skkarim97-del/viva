import type { Action } from "@/lib/api";

/**
 * Workflow chip that turns the patient's signals into a directive: should
 * the doctor act now, watch this patient, or move on? The action is
 * computed server-side (see api-server/src/lib/risk.ts deriveAction) so
 * the list and detail views always agree, including on the hard-escalation
 * overrides for silence and severe-nausea spikes.
 */

interface Props {
  action: Action;
  size?: "sm" | "md";
}

const STYLES: Record<Action, { bg: string; text: string; label: string }> = {
  // Filled solid red -- the alarm. Pulls the eye first; this row is today's work.
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
  // Patient invited but hasn't claimed the mobile app yet. Amber tint
  // (not red) because it's not clinically urgent, just operationally
  // pending until they connect.
  pending: {
    bg: "rgba(255,159,10,0.14)",
    text: "#B8650A",
    label: "Pending activation",
  },
};

export function ActionBadge({ action, size = "sm" }: Props) {
  const s = STYLES[action];
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
