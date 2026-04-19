import { useState } from "react";
import { Logo } from "@/components/Logo";

/**
 * Operator-key gate. Stand-alone full-screen prompt rendered before the
 * shell, so the unauthorised state never shows the sidebar/landing.
 * The same key gates /viva-dashboard's /internal* pages — one key,
 * shared across the internal product surface.
 */
export function KeyGate({
  onSubmit,
  error,
}: {
  onSubmit: (key: string) => void;
  error: string | null;
}) {
  const [key, setKey] = useState("");
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="px-6 py-5 border-b border-border bg-card">
        {/* Brand lockup matches Viva Clinic and Viva Care: viva.
            wordmark stacked over the product label. No separators. */}
        <div className="max-w-md mx-auto flex flex-col items-start">
          <Logo size="sm" />
          <span className="font-display text-[15px] font-bold text-foreground tracking-tight -mt-0.5 ml-px">
            Analytics
          </span>
        </div>
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-6 py-12">
        <div className="bg-card border border-border rounded-2xl p-6">
          <h1 className="font-display text-[18px] font-bold text-foreground mb-1">
            Operator key required
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            Viva Analytics is internal-only. Patients use Viva Care, doctors
            use Viva Clinic. Enter your operator key to continue.
          </p>
          {error && (
            <div className="text-sm font-semibold text-destructive mb-3">
              {error}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = key.trim();
              if (t) onSubmit(t);
            }}
          >
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type="password"
              placeholder="operator key"
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background mb-3 outline-none focus:border-foreground/60"
            />
            <button
              type="submit"
              className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 active:scale-[0.99] transition-all"
            >
              Continue
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
