import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api, HttpError, type InviteResult } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * Step 2 of doctor onboarding: build the patient panel. This is the
 * critical step strategically -- the platform only becomes useful once
 * patients are actively checking in, so we make patient invites a
 * prerequisite to entering the dashboard rather than an optional task.
 *
 * The form intentionally stays minimal: clinic name once, then a
 * repeatable name/email/medication/dose row per patient. Email is the
 * only required patient field because it's the channel for the invite.
 */

interface Draft {
  name: string;
  email: string;
  glp1Drug: string;
  dose: string;
}

const EMPTY: Draft = { name: "", email: "", glp1Drug: "", dose: "" };

export function OnboardingPage() {
  const { me, setMe } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [clinic, setClinic] = useState(me?.clinicName ?? "");
  const [drafts, setDrafts] = useState<Draft[]>([{ ...EMPTY }]);
  // Successful invites accumulate here so the doctor can copy each
  // link without losing context. Keyed by index so resend can update
  // a specific row in place.
  const [sent, setSent] = useState<InviteResult[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  function updateDraft(i: number, patch: Partial<Draft>) {
    setDrafts((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setDrafts((rows) => [...rows, { ...EMPTY }]);
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
    const cleanClinic = clinic.trim();
    if (!cleanClinic) {
      setErr("Please enter your clinic name.");
      return;
    }
    // Filter to rows the doctor actually filled in. Empty rows are
    // ignored so they don't have to manually delete blank lines.
    const ready = drafts
      .map((d) => ({
        name: d.name.trim(),
        email: d.email.trim().toLowerCase(),
        glp1Drug: d.glp1Drug.trim(),
        dose: d.dose.trim(),
      }))
      .filter((d) => d.email.length > 0);
    if (ready.length === 0) {
      setErr("Add at least one patient to enable monitoring.");
      return;
    }
    for (const d of ready) {
      if (!d.name) {
        setErr("Each patient needs a name.");
        return;
      }
    }
    setBusy(true);
    try {
      // Persist the clinic name first so it's saved even if a patient
      // invite later collides on email and the doctor has to retry.
      if (cleanClinic !== me?.clinicName) {
        await api.setClinic(cleanClinic);
      }
      const results: InviteResult[] = [];
      for (const d of ready) {
        try {
          const r = await api.invitePatient({
            name: d.name,
            email: d.email,
            glp1Drug: d.glp1Drug || null,
            dose: d.dose || null,
          });
          results.push(r);
        } catch (e2) {
          if (e2 instanceof HttpError && e2.status === 409) {
            setErr(`${d.email} is already on the platform. Skipping.`);
          } else {
            throw e2;
          }
        }
      }
      setSent((s) => [...s, ...results]);
      setDrafts([{ ...EMPTY }]);
      // Refresh the cached identity so needsOnboarding flips to false
      // and the Gate stops bouncing the doctor back here.
      const fresh = await api.me();
      setMe(fresh);
      qc.invalidateQueries({ queryKey: ["patients"] });
    } catch {
      setErr("Something went wrong sending invites. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    setLocation("/");
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
            Patients must connect to Viva to enable monitoring.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <section className="bg-card rounded-[20px] p-6">
            <h2 className="font-display text-[15px] font-bold text-foreground mb-3">
              Clinic
            </h2>
            <input
              type="text"
              required
              value={clinic}
              onChange={(e) => setClinic(e.target.value)}
              placeholder="Clinic or practice name"
              className={inputClass}
            />
          </section>

          <section className="bg-card rounded-[20px] p-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display text-[15px] font-bold text-foreground">
                Invite patients
              </h2>
              <span className="text-xs text-muted-foreground font-medium">
                Email is required
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-medium mb-4 leading-relaxed">
              Patients will receive an invite to download the Viva app and begin
              daily check-ins. Monitoring data appears here only after their
              first check-in.
            </p>

            <div className="space-y-4">
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
                    type="email"
                    value={d.email}
                    onChange={(e) => updateDraft(i, { email: e.target.value })}
                    placeholder="patient@email.com"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={d.glp1Drug}
                    onChange={(e) =>
                      updateDraft(i, { glp1Drug: e.target.value })
                    }
                    placeholder="Medication (e.g. semaglutide)"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={d.dose}
                    onChange={(e) => updateDraft(i, { dose: e.target.value })}
                    placeholder="Dose (e.g. 1mg weekly)"
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

            <button
              type="button"
              onClick={addRow}
              className="mt-3 text-sm font-semibold text-accent hover:opacity-80"
            >
              + Add another patient
            </button>
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
                onClick={finish}
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
              {busy ? "Sending invites..." : "Send invites"}
            </button>
          </div>
        </form>

        {hasSent && (
          <section className="mt-8 bg-card rounded-[20px] p-6">
            <h2 className="font-display text-[15px] font-bold text-foreground mb-1">
              Invites sent
            </h2>
            <p className="text-xs text-muted-foreground font-medium mb-4">
              Share each link directly with the patient if email isn't reaching
              them. Each link can be used once.
            </p>
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
                        {row.email}
                      </div>
                    </div>
                    <span
                      className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                      style={{ color: "#B8650A", backgroundColor: "rgba(255,159,10,0.14)" }}
                    >
                      Pending activation
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
