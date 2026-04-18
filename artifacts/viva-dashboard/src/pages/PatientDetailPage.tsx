import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Checkin } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";

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
              {p.email}
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
              <RiskBadge band={risk.data.band} score={risk.data.score} size="md" />
            </div>
          )}
        </div>
      </div>

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
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
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
