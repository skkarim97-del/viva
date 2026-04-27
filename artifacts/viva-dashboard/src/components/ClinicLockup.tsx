import { Logo } from "@/components/Logo";

interface Props {
  // "header" mirrors the Shell header exactly: size="sm", left-aligned,
  // small "Clinic" label that nudges right by ~13px so the cap-C
  // optically aligns with the visible "v" of the wordmark (309/2318
  // pixels of the logo PNG are transparent left padding).
  // "hero" is the larger centered lockup used by signed-out auth
  // surfaces (login, signup) -- same brand, more presence.
  variant?: "header" | "hero";
  // Optional subtitle line shown beneath "Clinic" on the hero variant.
  // Ignored by the header variant (the dashboard header has no
  // subtitle slot and we don't want to bolt one on).
  subtitle?: string;
}

// Shared "viva. / Clinic" brand lockup. Centralised so every Viva
// Clinic surface (Shell header, login, signup, onboarding) renders the
// same composition, font and spacing -- the previous /onboarding view
// shipped with just the wordmark, which broke the product-label
// system the rest of the app uses.
export function ClinicLockup({ variant = "header", subtitle }: Props) {
  if (variant === "hero") {
    return (
      <div className="flex flex-col items-center">
        <Logo size="lg" />
        <span className="font-display text-[28px] font-bold text-foreground tracking-tight -mt-1">
          Clinic
        </span>
        {subtitle && (
          <p className="mt-4 text-muted-foreground text-sm font-medium">
            {subtitle}
          </p>
        )}
      </div>
    );
  }
  // Header variant: same DOM/classes as Shell.tsx so the two surfaces
  // are pixel-identical. Caller supplies the wrapping <a>/<Link> if it
  // wants the lockup to be a navigation target.
  return (
    <div className="flex flex-col items-start">
      <Logo size="sm" />
      <span className="font-display text-[15px] font-bold text-foreground tracking-tight -mt-0.5 ml-[13px]">
        Clinic
      </span>
    </div>
  );
}
