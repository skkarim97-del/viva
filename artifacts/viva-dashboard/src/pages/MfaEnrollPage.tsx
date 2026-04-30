import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, HttpError } from "@/lib/api";
import { ClinicLockup } from "@/components/ClinicLockup";

// HIPAA pilot doctor MFA enrollment (T007). Three sub-steps:
//   1. fetch secret + qrcode from /me/mfa/enroll/start
//   2. user types the 6-digit TOTP from their authenticator app
//   3. show one-time recovery codes, then let the user continue
//
// The Gate in App.tsx renders this whenever a doctor session has no
// mfaEnrolledAt. The "Continue to dashboard" button invalidates the
// mfaStatus query so the Gate re-checks and naturally moves on.
export function MfaEnrollPage() {
  const qc = useQueryClient();
  const [stage, setStage] = useState<"loading" | "verify" | "codes">(
    "loading",
  );
  const [secret, setSecret] = useState<string>("");
  const [qrcode, setQrcode] = useState<string>("");
  const [otpauthUrl, setOtpauthUrl] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .mfaEnrollStart()
      .then((r) => {
        if (cancelled) return;
        setSecret(r.secret);
        setQrcode(r.qrcodeDataUrl);
        setOtpauthUrl(r.otpauthUrl);
        setStage("verify");
      })
      .catch((e) => {
        if (cancelled) return;
        // 409 = the doctor is already enrolled (e.g. another tab beat
        // us to it). Bounce back to the gate which will route to the
        // verify page or onward as appropriate.
        if (e instanceof HttpError && e.status === 409) {
          qc.invalidateQueries({ queryKey: ["mfa-status"] });
          return;
        }
        setErr("Couldn't start enrollment. Please refresh and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [qc]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api.mfaEnrollVerify(code.trim());
      setRecoveryCodes(r.recoveryCodes);
      setStage("codes");
    } catch (e2) {
      if (e2 instanceof HttpError && e2.status === 429) {
        setErr("Too many attempts. Please wait a minute and try again.");
      } else if (e2 instanceof HttpError && e2.status === 400) {
        setErr("That code didn't match. Try the next one your app shows.");
      } else {
        setErr("Verification failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onContinue() {
    qc.invalidateQueries({ queryKey: ["mfa-status"] });
  }

  function copyCodes() {
    void navigator.clipboard
      .writeText(recoveryCodes.join("\n"))
      .catch(() => {});
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <ClinicLockup variant="hero" />
        </div>

        <div className="bg-card rounded-[20px] p-7 space-y-5">
          <div>
            <h1 className="font-display text-[22px] font-bold text-foreground mb-2">
              Set up two-factor sign-in
            </h1>
            <p className="text-sm text-muted-foreground">
              Patient charts are protected by a second factor. Use an
              authenticator app like 1Password, Authy, or Google
              Authenticator to scan the code below.
            </p>
          </div>

          {stage === "loading" && (
            <div className="text-sm text-muted-foreground">Loading...</div>
          )}

          {stage === "verify" && (
            <>
              <div className="flex items-center justify-center bg-background rounded-2xl p-4">
                {qrcode ? (
                  <img
                    src={qrcode}
                    alt="MFA QR code"
                    width={200}
                    height={200}
                  />
                ) : null}
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold">
                  Can't scan? Enter the secret manually
                </summary>
                <div className="mt-2 break-all rounded-xl bg-background p-3 font-mono text-foreground">
                  {secret}
                </div>
                <div className="mt-2 break-all">
                  Or open this link on your phone:{" "}
                  <span className="font-mono">{otpauthUrl}</span>
                </div>
              </details>

              <form onSubmit={onVerify} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    6-digit code from your app
                  </label>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, ""))
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
                  disabled={busy || code.length !== 6}
                  className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
                >
                  {busy ? "Verifying..." : "Verify and continue"}
                </button>
              </form>
            </>
          )}

          {stage === "codes" && (
            <>
              <div className="rounded-xl bg-background p-4 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recovery codes
                </div>
                <p className="text-xs text-muted-foreground">
                  Save these somewhere safe. Each one can be used once if
                  you lose access to your authenticator app. We won't show
                  them again.
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {recoveryCodes.map((c) => (
                    <div
                      key={c}
                      className="rounded-lg bg-card px-3 py-2 text-foreground"
                    >
                      {c}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={copyCodes}
                  className="text-xs font-semibold underline text-foreground"
                >
                  Copy all to clipboard
                </button>
              </div>
              <label className="flex items-start gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I've saved my recovery codes somewhere safe.
                </span>
              </label>
              <button
                type="button"
                disabled={!acknowledged}
                onClick={onContinue}
                className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
              >
                Continue to dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
