import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Lightweight panel-health header that sits between the page title and
 * the grouped patient queue. Four stat blocks, no charts, no density
 * -- a calm snapshot, not the center of attention.
 *
 * The queue stays the main event; this row exists so the doctor can
 * answer "how is my panel today?" in one glance.
 */
interface Props {
  needsFollowupCount: number;
  silentCount: number;
  totalPatients: number;
  requestedReviewCount: number;
  // Called when the doctor clicks a stat that should focus a queue
  // section. The parent page handles both expanding the matching group
  // and scrolling to it so the click "lands" even when the section was
  // collapsed.
  onFocusNeedsFollowup: () => void;
  onFocusSilent: () => void;
  onFocusRequestedReview: () => void;
}

interface Stat {
  label: string;
  value: number;
  accent: string; // bg color for the small left rail
  onClick?: () => void;
}

export function SummaryBar({
  needsFollowupCount,
  silentCount,
  totalPatients,
  requestedReviewCount,
  onFocusNeedsFollowup,
  onFocusSilent,
  onFocusRequestedReview,
}: Props) {
  const stats = useQuery({ queryKey: ["doctor-stats"], queryFn: api.doctorStats });
  const actionsToday = stats.data?.actionsToday ?? 0;

  const items: Stat[] = [
    // Patient-requested review tile mirrors the orange dot/pill styling
    // used for the priority section header below, so the visual link
    // between tile and section is unmistakable. The count is driven by
    // the same dataset that produces the section, so they stay aligned.
    {
      label: "Patient requested review",
      value: requestedReviewCount,
      accent: "#FF9500",
      onClick: onFocusRequestedReview,
    },
    {
      label: "Needs follow-up",
      value: needsFollowupCount,
      accent: "#FF3B30",
      onClick: onFocusNeedsFollowup,
    },
    {
      label: "No check-in (3+ days)",
      value: silentCount,
      accent: "#FFB23B",
      onClick: onFocusSilent,
    },
    {
      label: "Actions taken today",
      value: actionsToday,
      accent: "#142240",
    },
    {
      label: "Total patients",
      value: totalPatients,
      accent: "#38B6FF",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-7">
      {items.map((s) => {
        const interactive = !!s.onClick;
        const Tag = interactive ? "button" : "div";
        return (
          <Tag
            key={s.label}
            type={interactive ? "button" : undefined}
            onClick={s.onClick}
            className={`relative overflow-hidden bg-card rounded-2xl px-5 py-4 text-left ${
              interactive
                ? "hover:bg-secondary active:scale-[0.99] transition-all cursor-pointer"
                : ""
            }`}
          >
            {/* Subtle left rail in the metric's accent color -- adds
                category cueing without shouting. */}
            <span
              aria-hidden
              className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
              style={{ backgroundColor: s.accent }}
            />
            <div className="font-display text-[28px] font-bold text-foreground leading-none tabular-nums">
              {s.value}
            </div>
            <div className="text-xs text-muted-foreground font-semibold mt-2 truncate">
              {s.label}
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
