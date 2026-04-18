/**
 * Compact "x ago" formatter. We use shorthand units (s/m/h/d) because
 * notes and check-ins typically read at a glance -- "Dr. Kim · 2m ago"
 * is denser than "2 minutes ago" without losing meaning.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Whole-day gap between today and an ISO date (YYYY-MM-DD or full ISO).
 * Returns 0 for today, 1 for yesterday, etc. Used to drive the
 * "Last check-in N days ago" callout.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / (1000 * 60 * 60 * 24)));
}
