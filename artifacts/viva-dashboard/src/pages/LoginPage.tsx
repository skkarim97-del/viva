import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { HttpError } from "@/lib/api";
import { Logo } from "@/components/Logo";

export function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("doctor@vivaai.demo");
  const [password, setPassword] = useState("viva-demo-2026");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const me = await login(email.trim().toLowerCase(), password);
      if (me.role === "doctor") {
        setLocation("/");
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
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" />
          <p className="mt-5 text-muted-foreground text-sm font-medium">
            Care team sign in
          </p>
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

        <div className="mt-5 text-xs text-muted-foreground text-center leading-relaxed">
          Demo doctor: <span className="text-foreground font-semibold">doctor@vivaai.demo</span>
          <br />
          Demo password: <span className="text-foreground font-semibold">viva-demo-2026</span>
        </div>
      </div>
    </div>
  );
}
