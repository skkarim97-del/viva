import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, HttpError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ClinicLockup } from "@/components/ClinicLockup";

// HIPAA pilot doctor MFA per-session step-up (T007). Rendered by the
// Gate in App.tsx whenever a doctor session has mfaEnrolledAt set but
// session.mfaVerified is false. On success the mfaStatus query is
// invalidated so the Gate re-renders into the protected app.
//
// Two input modes, toggled inline:
//   - 6-digit TOTP from the authenticator app (default)
//   - 11-character recovery code (single-use)
export function MfaVerifyPage() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "totp") {
        await api.mfaVerify({ code: code.trim() });
      } else {
        await api.mfaVerify({ recoveryCode: code.trim() });
      }
      qc.invalidateQueries({ queryKey: ["mfa-status"] });
    } catch (e2) {
      if (e2 instanceof HttpError && e2.status === 429) {
        setErr("Too many attempts. Please wait a minute and try again.");
      } else if (e2 instanceof HttpError && e2.status === 400) {
        setErr(
          mode === "totp"
            ? "That code didn't match. Try the next one your app shows."
            : "That recovery code didn't match or has already been used.",
        );
      } else {
        setErr("Verification failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: "totp" | "recovery") {
    setMode(next);
    setCode("");
    setErr(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <ClinicLockup variant="hero" />
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-card rounded-[20px] p-7 space-y-5"
        >
          <div>
            <h1 className="font-display text-[22px] font-bold text-foreground mb-2">
              Verify it's you
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "totp"
                ? "Enter the 6-digit code from your authenticator app to view patient charts."
                : "Enter one of the single-use recovery codes you saved when you set up two-factor sign-in."}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {mode === "totp" ? "Authenticator code" : "Recovery code"}
            </label>
            <input
              inputMode={mode === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              pattern={mode === "totp" ? "[0-9]{6}" : undefined}
              maxLength={mode === "totp" ? 6 : 32}
              required
              value={code}
              onChange={(e) =>
                setCode(
                  mode === "totp"
                    ? e.target.value.replace(/\D/g, "")
                    : e.target.value,
                )
              }
              className="w-full px-4 py-3 rounded-xl bg-background text-foreground font-mono text-lg tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-accent"
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
            disabled={
              busy || (mode === "totp" ? code.length !== 6 : code.length < 4)
            }
            className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {busy ? "Verifying..." : "Verify"}
          </button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() =>
                switchMode(mode === "totp" ? "recovery" : "totp")
              }
              className="text-muted-foreground underline"
            >
              {mode === "totp"
                ? "Use a recovery code instead"
                : "Use my authenticator app instead"}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="text-muted-foreground underline"
            >
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
