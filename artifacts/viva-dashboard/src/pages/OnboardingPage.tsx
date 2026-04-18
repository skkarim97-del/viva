import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api, HttpError, type InviteResult } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * Step 2 of doctor onboarding: build the patient panel.
 *
 * The form is intentionally minimal -- practice name once, then a
 * repeating row per patient. Only name + phone are required so the
 * doctor can finish onboarding in under a minute. Empty rows are
 * silently ignored on submit so the doctor never has to manually
 * delete the trailing blank row that auto-add creates.
 */

interface Draft {
  name: string;
  phone: string;
  glp1Drug: string;
  dose: string;
}

const EMPTY: Draft = { name: "", phone: "", glp1Drug: "", dose: "" };

function isFilled(d: Draft): boolean {
  return d.name.trim().length > 0 || d.phone.trim().length > 0;
}

export function OnboardingPage() {
  const { me, setMe } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [practice, setPractice] = useState(me?.clinicName ?? "");
  const [drafts, setDrafts] = useState<Draft[]>([{ ...EMPTY }]);
  const [sent, setSent] = useState<InviteResult[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [smsCopied, setSmsCopied] = useState<number | null>(null);

  function updateDraft(i: number, patch: Partial<Draft>) {
    setDrafts((rows) => {
      const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      // Auto-append a fresh blank row whenever the doctor starts
      // filling the last one. Keeps the form feeling lightweight --
      // they don't have to hunt for an "Add patient" button.
      const last = next[next.length - 1]!;
      if (isFilled(last)) next.push({ ...EMPTY });
      return next;
    });
  }
  function removeRow(i: number) {
    setDrafts((rows) => (rows.length === 1 ? rows : rows.filter((_, idx) => idx !== i)));
  }

  async function copyLink(link: string, idx: number) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(idx);
      window.setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard blocked -- the link is also visible in the input */
    }
  }

  // Copy a SMS-shaped activation message. Doctors paste this into
  // iMessage / their EHR -- the body must stay short (one line) so it
  // survives carrier 160-char splits with longer patient names.
  async function copySms(name: string, link: string, idx: number) {
    const firstName = (name || "").trim().split(/\s+/)[0] || "there";
    const body = `Hi ${firstName}, here's your Viva activation link: ${link}`;
    try {
      await navigator.clipboard.writeText(body);
      setSmsCopied(idx);
      window.setTimeout(() => setSmsCopied((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function resend(patientId: number, idx: number) {
    try {
      const r = await api.resendInvite(patientId);
      setSent((s) =>
        s.map((row, i) => (i === idx ? { ...row, inviteLink: r.inviteLink } : row)),
      );
    } catch {
      setErr("Could not regenerate that invite. Please try again.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanPractice = practice.trim();
    if (!cleanPractice) {
      setErr("Please enter your practice name.");
      return;
    }
    const ready = drafts
      .map((d) => ({
        name: d.name.trim(),
        phone: d.phone.trim(),
        glp1Drug: d.glp1Drug.trim(),
        dose: d.dose.trim(),
      }))
      .filter(isFilled);
    if (ready.length === 0) {
      setErr("Add at least one patient to enable monitoring.");
      return;
    }
    for (const d of ready) {
      if (!d.name || !d.phone) {
        setErr("Each patient needs a name and phone number.");
        return;
      }
    }
    setBusy(true);
    try {
      if (cleanPractice !== me?.clinicName) {
        await api.setClinic(cleanPractice);
      }
      const results: InviteResult[] = [];
      for (const d of ready) {
        try {
          const r = await api.invitePatient({
            name: d.name,
            phone: d.phone,
            glp1Drug: d.glp1Drug || null,
            dose: d.dose || null,
          });
          results.push(r);
        } catch (e2) {
          if (e2 instanceof HttpError && e2.status === 409) {
            setErr(`${d.phone} is already on the platform. Skipping.`);
          } else {
            throw e2;
          }
        }
      }
      setSent((s) => [...s, ...results]);
      setDrafts([{ ...EMPTY }]);
      qc.invalidateQueries({ queryKey: ["patients"] });
      // We deliberately do NOT refresh `me` here. The auth context's
      // needsOnboarding flag is what keeps the OnboardingPage mounted;
      // refreshing it now would unmount this page mid-flow and the
      // doctor would never see the "Invites sent" confirmation. We
      // refresh in finish() instead, when the doctor explicitly
      // navigates to the dashboard.
    } catch {
      setErr("Something went wrong sending invites. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const hasSent = sent.length > 0;

  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Logo size="md" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Step 2 of 2
          </span>
        </div>

        <div className="mb-7">
          <h1 className="font-display text-[28px] font-bold text-foreground leading-tight">
            Set up your patient panel
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5 font-medium">
            Patients will receive a link to download the Viva app and begin check-ins.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <section className="bg-card rounded-[20px] p-6">
            <h2 className="font-display text-[15px] font-bold text-foreground mb-3">
              Practice name
            </h2>
            <input
              type="text"
              required
              value={practice}
              onChange={(e) => setPractice(e.target.value)}
              placeholder="e.g. Cedar Endocrinology"
              className={inputClass}
            />
          </section>

          <section className="bg-card rounded-[20px] p-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display text-[15px] font-bold text-foreground">
                Invite patients
              </h2>
              <span className="text-xs text-muted-foreground font-medium">
                Name and phone required
              </span>
            </div>

            <div className="space-y-3">
              {drafts.map((d, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-background p-4 grid grid-cols-1 md:grid-cols-2 gap-3 relative"
                >
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => updateDraft(i, { name: e.target.value })}
                    placeholder="Full name"
                    className={inputClass}
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={d.phone}
                    onChange={(e) => updateDraft(i, { phone: e.target.value })}
                    placeholder="Phone number"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={d.glp1Drug}
                    onChange={(e) =>
                      updateDraft(i, { glp1Drug: e.target.value })
                    }
                    placeholder="Medication (optional)"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={d.dose}
                    onChange={(e) => updateDraft(i, { dose: e.target.value })}
                    placeholder="Dose (optional)"
                    className={inputClass}
                  />
                  {drafts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card text-muted-foreground text-xs font-bold flex items-center justify-center hover:text-foreground"
                      aria-label="Remove patient row"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

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

          <div className="flex items-center justify-between gap-3">
            {hasSent && (
              <button
                type="button"
                onClick={async () => {
                  // Refresh `me` here so needsOnboarding flips to
                  // false BEFORE we route, otherwise the Gate would
                  // immediately bounce us back to /onboarding.
                  try {
                    const fresh = await api.me();
                    setMe(fresh);
                  } catch {
                    /* fall through; the gate will resolve on next load */
                  }
                  setLocation("/");
                }}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                Go to dashboard →
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="ml-auto bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-2xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {busy ? "Sending invites..." : "Send invites & continue"}
            </button>
          </div>
        </form>

        {hasSent && (
          <section className="mt-8 bg-card rounded-[20px] p-6">
            <h2 className="font-display text-[15px] font-bold text-foreground mb-4">
              Invites sent
            </h2>
            <ul className="space-y-3">
              {sent.map((row, idx) => (
                <li
                  key={row.id}
                  className="rounded-2xl bg-background p-4 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground text-sm truncate">
                        {row.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-medium truncate">
                        {row.phone ?? ""}
                      </div>
                    </div>
                    <span
                      className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                      style={{
                        color: "#1E7A3C",
                        backgroundColor: "rgba(48,209,88,0.14)",
                      }}
                    >
                      Invite sent
                    </span>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <input
                      readOnly
                      value={row.inviteLink}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 px-3 py-2 rounded-lg bg-card text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => copyLink(row.inviteLink, idx)}
                      className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90"
                    >
                      {copied === idx ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => copySms(row.name, row.inviteLink, idx)}
                      className="px-3 py-2 rounded-lg bg-card text-foreground text-xs font-semibold hover:opacity-80"
                      title="Copy a ready-to-send SMS body with the activation link"
                    >
                      {smsCopied === idx ? "Copied" : "Copy SMS"}
                    </button>
                    <button
                      type="button"
                      onClick={() => resend(row.id, idx)}
                      className="px-3 py-2 rounded-lg bg-card text-foreground text-xs font-semibold hover:opacity-80"
                    >
                      Resend
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "w-full px-3.5 py-2.5 rounded-xl bg-card text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted-foreground";
