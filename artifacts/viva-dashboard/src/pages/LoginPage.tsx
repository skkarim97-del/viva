import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { HttpError } from "@/lib/api";
import { ClinicLockup } from "@/components/ClinicLockup";

export function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const me = await login(email.trim().toLowerCase(), password);
      if (me.role === "doctor") {
        // The Gate will route to /onboarding if the wizard isn't done.
        setLocation(me.needsOnboarding ? "/onboarding" : "/");
      } else {
        setErr(
          "This account is a patient account. Please use the VIVA mobile app.",
        );
      }
    } catch (e2) {
      if (e2 instanceof HttpError && e2.status === 401) {
        setErr("Email or password is incorrect.");
      } else {
        setErr("Sign-in failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        {/* Hero variant of the shared lockup -- larger and centered so
            signed-out auth surfaces have brand presence, but the same
            "viva. / Clinic" composition as the in-app header. */}
        <div className="mb-8">
          <ClinicLockup variant="hero" />
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-card rounded-[20px] p-7 space-y-5"
        >
          <div>
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
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground"
            />
          </div>
          {err && (
            <div
              className="text-sm font-medium rounded-xl px-4 py-3"
              style={{
                color: "#B5251D",
                backgroundColor: "rgba(255,59,48,0.10)",
              }}
            >
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-5 text-xs text-muted-foreground text-center">
          New to Viva?{" "}
          <Link href="/signup" className="text-foreground font-semibold underline">
            Create a clinician account
          </Link>
        </div>
      </div>
    </div>
  );
}
