import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Checkin, type SymptomFlag } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";
import { ActionBadge } from "@/components/ActionBadge";
import { relativeTime, daysSince } from "@/lib/relativeTime";

const SYMPTOM_LABEL: Record<SymptomFlag["symptom"], string> = {
  nausea: "Nausea",
  constipation: "Constipation",
  low_appetite: "Low appetite",
};
const SEVERITY_LABEL: Record<SymptomFlag["severity"], string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};
const PERSISTENCE_LABEL: Record<SymptomFlag["persistence"], string> = {
  transient: "Transient",
  persistent: "Persistent",
  worsening: "Worsening",
};
// Severity drives the chip color so the most actionable flag pops
// visually without us also having to add an icon legend.
const SEVERITY_STYLE: Record<
  SymptomFlag["severity"],
  { bg: string; fg: string }
> = {
  mild: { bg: "rgba(56,182,255,0.10)", fg: "#0B6FAA" },
  moderate: { bg: "rgba(255,149,0,0.12)", fg: "#B8650A" },
  severe: { bg: "rgba(255,59,48,0.12)", fg: "#B5251D" },
};

const ENERGY_LABEL: Record<Checkin["energy"], string> = {
  depleted: "Depleted",
  tired: "Tired",
  good: "Good",
  great: "Great",
};
const NAUSEA_LABEL: Record<Checkin["nausea"], string> = {
  none: "None",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

function fmtDate(d: string): string {
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[18px] font-semibold text-foreground mb-4">
      {children}
    </h2>
  );
}

export function PatientDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const patient = useQuery({
    queryKey: ["patient", id],
    queryFn: () => api.patient(id),
  });
  const checkins = useQuery({
    queryKey: ["patient", id, "checkins"],
    queryFn: () => api.patientCheckins(id),
  });
  const risk = useQuery({
    queryKey: ["patient", id, "risk"],
    queryFn: () => api.patientRisk(id),
  });
  const notes = useQuery({
    queryKey: ["patient", id, "notes"],
    queryFn: () => api.patientNotes(id),
  });

  const [draft, setDraft] = useState("");
  const addNote = useMutation({
    mutationFn: (body: string) => api.addPatientNote(id, body),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["patient", id, "notes"] });
    },
  });
  const delNote = useMutation({
    mutationFn: (noteId: number) => api.deletePatientNote(id, noteId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", id, "notes"] }),
  });

  if (patient.isPending) {
    return (
      <div className="text-muted-foreground py-12 text-center">Loading...</div>
    );
  }
  if (patient.isError || !patient.data) {
    return (
      <div
        className="rounded-xl px-4 py-3 font-medium"
        style={{ color: "#B5251D", backgroundColor: "rgba(255,59,48,0.10)" }}
      >
        Could not load patient.
      </div>
    );
  }

  const p = patient.data;

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground inline-block font-medium transition-colors"
      >
        ← All patients
      </Link>

      {/* Header card */}
      <div className="bg-card rounded-[20px] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[28px] font-bold text-foreground leading-tight break-words">
              {p.name}
            </h1>
            <div className="text-muted-foreground text-sm mt-1.5 font-medium break-all">
              {p.phone ?? p.email}
            </div>
            <div className="text-foreground text-sm mt-5 font-medium">
              {p.glp1Drug ?? "No drug recorded"}
              {p.dose && (
                <span className="text-muted-foreground font-normal">
                  {" · "}{p.dose}
                </span>
              )}
              {p.startedOn && (
                <span className="text-muted-foreground font-normal">
                  {" · started "}{fmtDate(p.startedOn)}
                </span>
              )}
            </div>
          </div>
          {risk.data && (
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Risk
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <ActionBadge action={risk.data.action} size="md" />
                <RiskBadge band={risk.data.band} score={risk.data.score} size="md" />
              </div>
            </div>
          )}
        </div>
        {/* Suggested action line: turns the diagnosis into a verb. Lives
            inside the header card directly under the risk pills so the
            doctor sees "what to do" before reading the rule list. */}
        {risk.data?.suggestedAction && (
          <div
            className="mt-5 pt-5 border-t border-border flex items-start gap-3 text-sm font-semibold"
            style={{ color: "#142240" }}
          >
            <span
              className="text-[10px] uppercase tracking-wider font-semibold shrink-0 mt-0.5"
              style={{ color: "#6B7280" }}
            >
              Suggested
            </span>
            <span>{risk.data.suggestedAction}</span>
          </div>
        )}
      </div>

      {/* Last check-in gap callout. Surfaces the strongest churn signal
          (silence) without making the doctor scan the timeline first. */}
      {checkins.data && checkins.data.length > 0 && (() => {
        const gap = daysSince(checkins.data[0]!.date);
        if (gap < 2) return null;
        const urgent = gap >= 5;
        return (
          <div
            className="rounded-[20px] px-5 py-4 flex items-center gap-3 font-semibold text-sm"
            style={{
              backgroundColor: urgent
                ? "rgba(255,59,48,0.10)"
                : "rgba(255,149,0,0.10)",
              color: urgent ? "#B5251D" : "#B8650A",
            }}
          >
            <span aria-hidden>{urgent ? "⚠️" : "⏱"}</span>
            <span>
              Last check-in: {gap} day{gap === 1 ? "" : "s"} ago
            </span>
          </div>
        );
      })()}

      {/* Symptom flags. Distinct from churn-risk rules: this is the
          clinical-symptom layer. Surfaced ABOVE the risk explanation
          because a worsening symptom is more actionable than a
          7-day energy trend. */}
      {risk.data && risk.data.symptomFlags.length > 0 && (
        <section className="bg-card rounded-[20px] p-6">
          <SectionTitle>Symptom flags</SectionTitle>
          <ul className="space-y-3">
            {risk.data.symptomFlags.map((f) => {
              const sev = SEVERITY_STYLE[f.severity];
              return (
                <li
                  key={f.symptom}
                  className="bg-background rounded-xl px-4 py-3.5"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-display text-[15px] font-semibold text-foreground">
                        {SYMPTOM_LABEL[f.symptom]}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                        {PERSISTENCE_LABEL[f.persistence]} ·{" "}
                        {f.daysObserved} of last {f.windowDays} day
                        {f.windowDays === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <span
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                        style={{ backgroundColor: sev.bg, color: sev.fg }}
                      >
                        {SEVERITY_LABEL[f.severity]}
                      </span>
                      {f.suggestFollowup && (
                        <span
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                          style={{
                            backgroundColor: "rgba(255,59,48,0.12)",
                            color: "#B5251D",
                          }}
                        >
                          Follow up
                        </span>
                      )}
                    </div>
                  </div>
                  {f.contributors.length > 0 && (
                    <div className="mt-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                        Likely contributors
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {f.contributors.map((c) => (
                          <span
                            key={c}
                            className="px-2 py-0.5 rounded-md text-xs text-foreground bg-card font-medium"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2.5 text-xs text-muted-foreground font-medium">
                    {f.guidanceShown
                      ? "Patient has seen self-management guidance"
                      : "Patient has not yet acknowledged guidance"}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Risk explanation */}
        <section className="bg-card rounded-[20px] p-6">
          <SectionTitle>Why this risk band</SectionTitle>
          {risk.data && risk.data.rules.length === 0 && (
            <p className="text-foreground text-sm font-medium">
              No risk signals fired in the recent window.
            </p>
          )}
          {risk.data && risk.data.rules.length > 0 && (
            <ul className="space-y-2.5">
              {risk.data.rules.map((r) => (
                <li
                  key={r.code}
                  className="flex items-start gap-3 text-sm bg-background rounded-xl px-4 py-3"
                >
                  <span className="font-semibold text-xs text-accent mt-0.5 shrink-0 w-7">
                    +{r.weight}
                  </span>
                  <span className="text-foreground font-medium">
                    {r.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {risk.data && (
            <div className="text-xs text-muted-foreground mt-4 font-medium">
              Computed {fmtDate(risk.data.asOf)}
            </div>
          )}
        </section>

        {/* Recent check-ins */}
        <section className="bg-card rounded-[20px] p-6">
          <SectionTitle>Recent check-ins</SectionTitle>
          {checkins.isPending && (
            <div className="text-muted-foreground text-sm">Loading...</div>
          )}
          {checkins.data && checkins.data.length === 0 && (
            <div className="text-muted-foreground text-sm">
              No check-ins logged yet.
            </div>
          )}
          {checkins.data && checkins.data.length > 0 && (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {checkins.data.slice(0, 14).map((c) => (
                <div
                  key={c.id}
                  className="bg-background rounded-xl px-4 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">
                        {fmtDate(c.date)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                        Mood {c.mood}/5
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs justify-end">
                      <span className="px-2.5 py-1 bg-card rounded-lg text-foreground font-semibold whitespace-nowrap">
                        {ENERGY_LABEL[c.energy]}
                      </span>
                      <span className="px-2.5 py-1 bg-card rounded-lg text-foreground font-semibold whitespace-nowrap">
                        Nausea: {NAUSEA_LABEL[c.nausea]}
                      </span>
                    </div>
                  </div>
                  {c.notes && c.notes.trim().length > 0 && (
                    <div className="mt-2 text-sm text-foreground italic leading-snug">
                      &ldquo;{c.notes}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Notes */}
      <section className="bg-card rounded-[20px] p-6">
        <SectionTitle>Care team notes</SectionTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v.length === 0) return;
            addNote.mutate(v);
          }}
          className="mb-5"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a note for the care team..."
            className="w-full px-4 py-3 rounded-xl bg-background text-foreground font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-y"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={addNote.isPending || draft.trim().length === 0}
              className="px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-60"
            >
              {addNote.isPending ? "Saving..." : "Save note"}
            </button>
          </div>
        </form>
        {notes.data && notes.data.length === 0 && (
          <div className="text-muted-foreground text-sm font-medium">
            No notes yet.
          </div>
        )}
        {notes.data && notes.data.length > 0 && (
          <ul className="space-y-3">
            {notes.data.map((n) => (
              <li
                key={n.id}
                className="bg-background rounded-xl px-4 py-3.5 group relative"
              >
                <div className="text-sm text-foreground whitespace-pre-wrap font-medium">
                  {n.body}
                </div>
                <div className="text-xs text-muted-foreground mt-2.5 flex items-center justify-between font-medium">
                  <span title={new Date(n.createdAt).toLocaleString()}>
                    <span className="text-foreground font-semibold">
                      {n.doctorName || "Care team"}
                    </span>
                    <span className="mx-1.5 opacity-50">·</span>
                    {relativeTime(n.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Delete this note?")) delNote.mutate(n.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity font-semibold"
                    style={{ color: "#B5251D" }}
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
