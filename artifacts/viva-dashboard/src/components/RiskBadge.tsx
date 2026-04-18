interface Props {
  band: "low" | "medium" | "high";
  score?: number;
  size?: "sm" | "md";
}

const STYLES: Record<Props["band"], { bg: string; text: string; label: string }> = {
  low: { bg: "bg-good/15", text: "text-good", label: "Low" },
  medium: { bg: "bg-warn/15", text: "text-warn", label: "Medium" },
  high: { bg: "bg-bad/15", text: "text-bad", label: "High" },
};

export function RiskBadge({ band, score, size = "sm" }: Props) {
  const s = STYLES[band];
  const padding = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${padding} ${s.bg} ${s.text}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {s.label}
      {typeof score === "number" && (
        <span className="opacity-60 font-medium">{score}</span>
      )}
    </span>
  );
}
