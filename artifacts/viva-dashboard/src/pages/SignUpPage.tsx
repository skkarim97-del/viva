import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api, HttpError } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * Step 1 of doctor onboarding: account creation. Intentionally minimal --
 * name, work email, password. Tone is clinical (no "join our community"
 * or wellness language) because Viva is a monitoring platform, not a
 * consumer wellness app.
 */
export function SignUpPage() {
  const { setMe } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      // Drop any stale identity-scoped cache before adopting the new
      // session, mirroring the login() pattern.
      qc.clear();
      const me = await api.signup(
        name.trim(),
        email.trim().toLowerCase(),
        password,
      );
      setMe(me);
      // New accounts always start in the wizard; the Gate would route
      // there anyway, but doing it here avoids a one-frame flash of /.
      setLocation("/onboarding");
    } catch (e2) {
      if (e2 instanceof HttpError && e2.status === 409) {
        setErr("An account with that email already exists. Please sign in.");
      } else {
        setErr("We couldn't create your account. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" />
          <p className="mt-5 text-muted-foreground text-sm font-medium">
            Create your clinician account
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="bg-card rounded-[20px] p-7 space-y-5"
        >
          <Field label="Full name">
            <input
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Dr. Jane Kim"
            />
          </Field>
          <Field label="Work email">
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="jane.kim@clinic.com"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="At least 8 characters"
            />
          </Field>
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
            {busy ? "Creating account..." : "Create account"}
          </button>
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            Viva is a clinician-facing monitoring platform. Patients use a
            separate mobile app to submit daily check-ins.
          </p>
        </form>
        <div className="mt-5 text-xs text-muted-foreground text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground font-semibold underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full px-4 py-3 rounded-xl bg-background text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}
