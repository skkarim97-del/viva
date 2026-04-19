interface Props {
  size?: "sm" | "md" | "lg";
}

const SIZES: Record<NonNullable<Props["size"]>, number> = {
  sm: 96,
  md: 132,
  lg: 200,
};

// Viva wordmark (the "viva." brandmark). Same source PNG used by the
// mobile app's <Logo /> and <VivaWordmark /> components so brand
// presentation stays exact across surfaces. "Viva" is the master
// brand; product surfaces (Clinic, Analytics, Care) appear as a
// separate label stacked beneath this mark.
export function Logo({ size = "md" }: Props) {
  const width = SIZES[size];
  // Source asset is 2318x1068 -> preserve that aspect ratio.
  const height = Math.round(width * (1068 / 2318));
  // Cache-bust the asset URL whenever we ship a new wordmark so
  // browsers (and any CDN edge) cannot serve a stale PNG. Bump the
  // version suffix any time viva-logo.png is replaced.
  const src = `${import.meta.env.BASE_URL}viva-logo.png?v=2026041801`;
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
