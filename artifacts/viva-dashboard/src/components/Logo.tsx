interface Props {
  size?: "sm" | "md" | "lg";
}

const SIZES: Record<NonNullable<Props["size"]>, number> = {
  sm: 96,
  md: 132,
  lg: 200,
};

// VIVA AI wordmark (navy pill with white "VIVA" + accent "AI"). Same source
// PNG used by the mobile app's <Logo /> and <VivaWordmark /> components so
// brand presentation stays exact across surfaces.
export function Logo({ size = "md" }: Props) {
  const width = SIZES[size];
  // Source asset is 318x106 -> preserve that aspect ratio.
  const height = Math.round(width * (106 / 318));
  const src = `${import.meta.env.BASE_URL}viva-logo.png`;
  return (
    <img
      src={src}
      alt="VIVA AI"
      width={width}
      height={height}
      style={{ width, height }}
      draggable={false}
    />
  );
}
