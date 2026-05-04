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
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .mfaEnrollStart()
      .then((r) => {
        if (cancelled) return;
        setSecret(r.secret);
        setQrcode(r.qrcodeDataUrl);
        setStage("verify");
      })
      .catch((e) => {
        if (cancelled) return;
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

  function copySetupKey() {
    void navigator.clipboard.writeText(secret).then(() => {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 sm:px-6 py-8 sm:py-10">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <ClinicLockup variant="hero" />
        </div>

        <div className="bg-card rounded-[20px] p-5 sm:p-7 space-y-5">
          {stage === "loading" && (
            <>
              <div>
                <h1 className="font-display text-[22px] font-bold text-foreground mb-2">
                  Secure your Viva Clinic account
                </h1>
                <p className="text-sm text-muted-foreground">Loading setup...</p>
              </div>
            </>
          )}

          {stage === "verify" && (
            <>
              <div>
                <h1 className="font-display text-[22px] font-bold text-foreground mb-2">
                  Secure your Viva Clinic account
                </h1>
                <p className="text-sm text-muted-foreground mb-3">
                  To protect patient information, Viva uses a one-time 6-digit
                  code when you sign in.
                </p>
                <p className="text-sm text-muted-foreground">
                  Your code comes from an authenticator app.
                </p>
              </div>

              <div className="rounded-2xl bg-background p-4 space-y-3">
                <h2 className="font-display text-[15px] font-bold text-foreground">
                  Need an authenticator app?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Download Google Authenticator from the App Store, then come
                  back to finish setup.
                </p>
                <a
                  href="https://apps.apple.com/us/app/google-authenticator/id388497605"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold text-sm px-5 py-2.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download Google Authenticator
                </a>
                <p className="text-xs text-muted-foreground">
                  Already use 1Password, Microsoft Authenticator or Authy? You
                  can use that too.
                </p>
              </div>

              <div className="space-y-1.5">
                <h2 className="font-display text-[15px] font-bold text-foreground">
                  Setup steps
                </h2>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Download or open an authenticator app</li>
                  <li>Add Viva Clinic using the setup key</li>
                  <li>Enter the 6-digit code</li>
                </ol>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl bg-background p-4 space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Setup key
                  </div>
                  <div className="break-all font-mono text-sm text-foreground leading-relaxed">
                    {secret}
                  </div>
                  <button
                    type="button"
                    onClick={copySetupKey}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:opacity-80 active:scale-[0.98] transition-all"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    {keyCopied ? "Copied!" : "Copy setup key"}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Open your authenticator app, tap +, choose "Enter setup key,"
                    then paste the setup key.
                  </p>
                </div>

                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-semibold">
                    Using another device? Scan this QR code
                  </summary>
                  <div className="mt-3 flex items-center justify-center bg-background rounded-2xl p-4">
                    {qrcode ? (
                      <img
                        src={qrcode}
                        alt="MFA QR code"
                        width={200}
                        height={200}
                      />
                    ) : null}
                  </div>
                </details>
              </div>

              <form onSubmit={onVerify} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    6-digit code
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
                  {busy ? "Verifying..." : "Finish setup"}
                </button>
              </form>
            </>
          )}

          {stage === "codes" && (
            <>
              <div>
                <h1 className="font-display text-[22px] font-bold text-foreground mb-2">
                  You're all set
                </h1>
              </div>
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
