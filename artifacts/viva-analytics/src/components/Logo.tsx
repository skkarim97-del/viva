interface Props {
  size?: "sm" | "md" | "lg";
  variant?: "color" | "white";
}

const SIZES: Record<NonNullable<Props["size"]>, number> = {
  sm: 96,
  md: 132,
  lg: 200,
};

// Shared brand wordmark. Same source asset as viva-dashboard /
// pulse-pilot so the three surfaces feel like one product.
export function Logo({ size = "md", variant = "color" }: Props) {
  const width = SIZES[size];
  const height = Math.round(width * (1068 / 2318));
  const file = variant === "white" ? "viva-logo-nobg.png" : "viva-logo.png";
  const src = `${import.meta.env.BASE_URL}${file}?v=2026041901`;
  return (
    <img
      src={src}
      alt="Viva"
      width={width}
      height={height}
      style={{ width, height }}
      draggable={false}
    />
  );
}
