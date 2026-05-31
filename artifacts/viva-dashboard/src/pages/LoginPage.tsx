import { useState } from "react";
import { api, HttpError } from "@/lib/api";
import { ClinicLockup } from "@/components/ClinicLockup";

type State = "idle" | "sent" | "error";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setState("idle");
    try {
      await api.requestMagicLink(email.trim().toLowerCase());
      setState("sent");
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        setState("error");
      } else {
        // Always show "sent" for non-rate-limit errors: enumeration prevention.
        setState("sent");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <ClinicLockup variant="hero" />
        </div>

        {state === "sent" ? (
          <div className="bg-card rounded-[20px] p-7 space-y-3 text-center">
            <p className="text-lg font-bold text-foreground">Check your email</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We sent a secure sign-in link to{" "}
              <span className="font-medium text-foreground">{email.trim().toLowerCase()}</span>
              . This link expires shortly.
            </p>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="text-xs text-muted-foreground underline mt-2"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="bg-card rounded-[20px] p-7 space-y-5"
          >
            <div>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                Enter your work email and we'll send you a secure sign-in link.
              </p>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground"
              />
            </div>
            {state === "error" && (
              <div
                className="text-sm font-medium rounded-xl px-4 py-3"
                style={{
                  color: "#B5251D",
                  backgroundColor: "rgba(255,59,48,0.10)",
                }}
              >
                Too many requests. Please wait a moment and try again.
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {busy ? "Sending..." : "Send sign-in link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
