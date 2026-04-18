import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { HttpError } from "@/lib/api";

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
        // patients don't have a UI here -- log them right back out
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
    <div className="min-h-screen flex items-center justify-center bg-mist px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-navy">
            VIVA <span className="text-accent">·</span> Clinic
          </h1>
          <p className="mt-2 text-ink-mute text-sm">
            Care team sign in
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-xl shadow-sm border border-line p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-md border border-line bg-mist focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-md border border-line bg-mist focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          {err && (
            <div className="text-sm text-bad bg-bad/10 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-navy text-white font-semibold py-2.5 rounded-md hover:bg-navy-soft transition-colors disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <div className="text-xs text-ink-mute text-center pt-2 border-t border-line">
            Demo doctor: <span className="font-mono">doctor@vivaai.demo</span>
            <br />
            Demo password: <span className="font-mono">viva-demo-2026</span>
          </div>
        </form>
      </div>
    </div>
  );
}
