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
  totalPatients: number;
  // Top operational tiles, aligned with the dashboard intelligence
  // model: Review now (open escalations), Follow up today (priority
  // ladder), and the issue-type counts for engagement vs clinical.
  reviewNowCount: number;
  followUpTodayCount: number;
  engagementCount: number;
  clinicalCount: number;
  // Called when the doctor clicks a stat that should focus a queue
  // section. The parent page handles both expanding the matching group
  // and scrolling to it so the click "lands" even when the section was
  // collapsed.
  onFocusReviewNow: () => void;
  onFocusFollowUpToday: () => void;
}

interface Stat {
  label: string;
  value: number;
  accent: string; // bg color for the small left rail
  onClick?: () => void;
}

export function SummaryBar({
  totalPatients,
  reviewNowCount,
  followUpTodayCount,
  engagementCount,
  clinicalCount,
  onFocusReviewNow,
  onFocusFollowUpToday,
}: Props) {
  const stats = useQuery({ queryKey: ["doctor-stats"], queryFn: api.doctorStats });
  const actionsToday = stats.data?.actionsToday ?? 0;

  // Tile order matches the dashboard intelligence model:
  //   1. Total patients          (panel size, neutral)
  //   2. Review now              (open escalations -- top priority,
  //                               matches the orange section header)
  //   3. Follow up today         (priority ladder: needs_followup,
  //                               worsening symptom, 7+ day silence)
  //   4. Engagement concerns     (issue type = engagement)
  //   5. Clinical concerns       (issue type = clinical)
  //   6. Actions taken today     (rolling activity)
  const items: Stat[] = [
    {
      label: "Total Patients",
      value: totalPatients,
      accent: "#38B6FF",
    },
    {
      label: "Review Now",
      value: reviewNowCount,
      accent: "#FF9500",
      onClick: onFocusReviewNow,
    },
    {
      label: "Follow Up Today",
      value: followUpTodayCount,
      accent: "#FF3B30",
      onClick: onFocusFollowUpToday,
    },
    {
      label: "Engagement Concerns",
      value: engagementCount,
      accent: "#FFB23B",
    },
    {
      label: "Clinical Concerns",
      value: clinicalCount,
      accent: "#B5251D",
    },
    {
      label: "Actions Taken Today",
      value: actionsToday,
      accent: "#142240",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-7">
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
