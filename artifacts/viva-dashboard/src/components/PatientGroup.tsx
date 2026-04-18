import { forwardRef, type ReactNode } from "react";
import type { Action } from "@/lib/api";

/**
 * Collapsible queue section. Each action ("Needs follow-up", "Monitor",
 * "Stable") gets its own group with a count chip in the header so the
 * 40-patient queue is mentally segmented instead of reading as one
 * uninterrupted scroll.
 *
 * Open state is fully controlled by the parent so the summary bar can
 * focus a section (open + scroll) by name from outside the group.
 */

interface Props {
  action: Action;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

const HEADER: Record<Action, { label: string; dot: string }> = {
  needs_followup: { label: "Needs follow-up", dot: "#FF3B30" },
  monitor: { label: "Monitor", dot: "#FF9500" },
  stable: { label: "Stable", dot: "#34C759" },
};

export const PatientGroup = forwardRef<HTMLElement, Props>(function PatientGroup(
  { action, count, open, onToggle, children },
  ref,
) {
  const h = HEADER[action];
  return (
    <section ref={ref} data-group={action} className="scroll-mt-6">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-1 py-2 mb-2 group"
      >
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: h.dot }}
          aria-hidden
        />
        <span className="font-display text-[15px] font-bold text-foreground">
          {h.label}
        </span>
        <span className="text-xs font-semibold text-muted-foreground bg-card rounded-full px-2.5 py-0.5">
          {count}
        </span>
        <span className="flex-1" />
        <span
          className="text-muted-foreground text-sm font-semibold transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && <div className="space-y-3 mb-6">{children}</div>}
    </section>
  );
});
