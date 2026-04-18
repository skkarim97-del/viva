import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, HttpError, type InviteResult } from "@/lib/api";

/**
 * Lightweight in-dashboard "Invite patient" flow.
 *
 * Mirrors the onboarding wizard's per-patient logic (name + phone
 * required, medication/dose optional) but lives as a modal so the
 * doctor never gets bounced back through full onboarding just to add
 * one more patient. After a successful invite, the modal swaps to the
 * sent-state with copy-link / copy-SMS / resend controls -- same
 * affordances the onboarding screen offers -- and refreshes the
 * patient queue underneath.
 */

interface Props {
  onClose: () => void;
}

const inputClass =
  "w-full px-3.5 py-2.5 rounded-xl bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground";

export function InvitePatientModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [glp1Drug, setGlp1Drug] = useState("");
  const [dose, setDose] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [smsCopied, setSmsCopied] = useState(false);
  const [resending, setResending] = useState(false);

  // Esc closes the modal -- standard expectation for keyboard users
  // and matches AddNoteModal behavior elsewhere in the dashboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName || !cleanPhone) {
      setErr("Name and phone number are required.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.invitePatient({
        name: cleanName,
        phone: cleanPhone,
        glp1Drug: glp1Drug.trim() || null,
        dose: dose.trim() || null,
      });
      setSent(r);
      // Refresh the queue so the new pending card shows up immediately
      // when the doctor closes the modal.
      qc.invalidateQueries({ queryKey: ["patients"] });
    } catch (e2) {
      if (e2 instanceof HttpError && e2.status === 409) {
        setErr("That phone number is already on the platform.");
      } else {
        setErr("Could not send the invite. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function copySms() {
    if (!sent) return;
    const firstName =
      (sent.name || "").trim().split(/\s+/)[0] || "there";
    const body = `Hi ${firstName}, here's your Viva activation link: ${sent.inviteLink}`;
    try {
      await navigator.clipboard.writeText(body);
      setSmsCopied(true);
      window.setTimeout(() => setSmsCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function resend() {
    if (!sent) return;
    setResending(true);
    try {
      const r = await api.resendInvite(sent.id);
      setSent({ ...sent, inviteLink: r.inviteLink });
    } catch {
      setErr("Could not regenerate the invite. Please try again.");
    } finally {
      setResending(false);
    }
  }

  function inviteAnother() {
    setSent(null);
    setName("");
    setPhone("");
    setGlp1Drug("");
    setDose("");
    setErr(null);
    setCopied(false);
    setSmsCopied(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(10,22,40,0.45)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-patient-title"
        className="w-full max-w-md bg-background rounded-[20px] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2
              id="invite-patient-title"
              className="font-display text-[20px] font-bold text-foreground leading-tight"
            >
              {sent ? "Invite sent" : "Invite a patient"}
            </h2>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              {sent
                ? "Share this activation link with your patient."
                : "Send an activation link in under a minute."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2 py-1"
          >
            ×
          </button>
        </div>

        {!sent && (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className={inputClass}
            />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={glp1Drug}
                onChange={(e) => setGlp1Drug(e.target.value)}
                placeholder="Medication (optional)"
                className={inputClass}
              />
              <input
                type="text"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder="Dose (optional)"
                className={inputClass}
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

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 text-sm"
              >
                {busy ? "Sending..." : "Send invite"}
              </button>
            </div>
          </form>
        )}

        {sent && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="font-semibold text-foreground text-sm truncate">
                    {sent.name}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium truncate">
                    {sent.phone ?? ""}
                  </div>
                </div>
                <span
                  className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0"
                  style={{
                    color: "#1E7A3C",
                    backgroundColor: "rgba(48,209,88,0.14)",
                  }}
                >
                  Invite sent
                </span>
              </div>
              <input
                readOnly
                value={sent.inviteLink}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full px-3 py-2 rounded-lg bg-background text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent mb-2"
              />
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={copySms}
                  className="flex-1 px-3 py-2 rounded-lg bg-background text-foreground text-xs font-semibold hover:opacity-80"
                  title="Copy a ready-to-send SMS body with the activation link"
                >
                  {smsCopied ? "Copied" : "Copy SMS"}
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={resending}
                  className="px-3 py-2 rounded-lg bg-background text-foreground text-xs font-semibold hover:opacity-80 disabled:opacity-60"
                >
                  {resending ? "..." : "Resend"}
                </button>
              </div>
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

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={inviteAnother}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                + Invite another
              </button>
              <button
                type="button"
                onClick={onClose}
                className="bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-2xl hover:opacity-90 text-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
