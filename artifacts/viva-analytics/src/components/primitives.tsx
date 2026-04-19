import type { ReactNode } from "react";

// ---------------------------------------------------------- primitives
// Visual building blocks shared across every analytics page. These are
// intentionally not shadcn components — analytics needs denser default
// padding and tabular numerics that the shared kit doesn't ship.

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card rounded-2xl border border-border p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h1 className="font-display text-[22px] font-bold text-foreground leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function SectionHead({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mt-6 mb-2 flex items-baseline justify-between gap-3">
      <div className="font-display text-[12px] font-bold text-muted-foreground uppercase tracking-wider">
        {children}
      </div>
      {hint && (
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent = "#142240",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden bg-card border border-border rounded-2xl px-4 py-3.5">
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
        style={{ backgroundColor: accent }}
      />
      <div className="font-display text-[22px] font-bold text-foreground leading-none tabular-nums">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground font-semibold mt-2 uppercase tracking-wide">
        {label}
      </div>
      {sub && (
        <div className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
          {sub}
        </div>
      )}
    </div>
  );
}

type ChipTone = "neutral" | "good" | "warn" | "bad" | "muted" | "accent";

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: ChipTone;
}) {
  const styles: Record<ChipTone, { bg: string; fg: string }> = {
    neutral: { bg: "rgba(20,34,64,0.08)", fg: "#142240" },
    good: { bg: "rgba(52,199,89,0.13)", fg: "#1F8A3E" },
    warn: { bg: "rgba(255,149,0,0.13)", fg: "#B8650A" },
    bad: { bg: "rgba(255,59,48,0.13)", fg: "#B5251D" },
    muted: { bg: "rgba(107,122,144,0.13)", fg: "#6B7A90" },
    accent: { bg: "rgba(56,182,255,0.15)", fg: "#0B6BAA" },
  };
  const s = styles[tone];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground py-10 text-center">
      {children}
    </div>
  );
}

export function statusTone(
  s: "active" | "stopped" | "unknown",
): "good" | "bad" | "muted" {
  return s === "active" ? "good" : s === "stopped" ? "bad" : "muted";
}
export function statusLabel(s: "active" | "stopped" | "unknown"): string {
  return s === "active" ? "Active" : s === "stopped" ? "Stopped" : "Unknown";
}
