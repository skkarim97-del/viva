interface Props {
  band: "low" | "medium" | "high";
  score?: number;
  size?: "sm" | "md";
}

// Color tokens mirror the mobile app's status palette: success green,
// warning amber, destructive red. Soft tinted backgrounds match the
// "icon container" treatment in MetricCard (color + "15" alpha).
const STYLES: Record<
  Props["band"],
  { bg: string; dot: string; text: string; label: string }
> = {
  low: {
    bg: "rgba(52,199,89,0.13)",
    dot: "#34C759",
    text: "#1F8A3E",
    label: "Low",
  },
  medium: {
    bg: "rgba(255,149,0,0.13)",
    dot: "#FF9500",
    text: "#B8650A",
    label: "Medium",
  },
  high: {
    bg: "rgba(255,59,48,0.13)",
    dot: "#FF3B30",
    text: "#B5251D",
    label: "High",
  },
};

export function RiskBadge({ band, score, size = "sm" }: Props) {
  const s = STYLES[band];
  const padding =
    size === "md" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${padding}`}
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: s.dot }}
      />
      {s.label}
      {typeof score === "number" && (
        <span className="opacity-70 font-medium">{score}</span>
      )}
    </span>
  );
}
