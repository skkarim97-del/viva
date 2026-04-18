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
    return <div className="text-ink-mute py-12 text-center">Loading...</div>;
  }
  if (patient.isError || !patient.data) {
    return (
      <div className="text-bad bg-bad/10 rounded-md px-4 py-3">
        Could not load patient.
      </div>
    );
  }

  const p = patient.data;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="text-sm text-ink-mute hover:text-navy inline-block"
      >
        ← All patients
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-line p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold text-navy">
              {p.name}
            </h1>
            <div className="text-ink-mute text-sm mt-1">{p.email}</div>
            <div className="text-ink-soft text-sm mt-3">
              <span className="font-semibold">{p.glp1Drug ?? "No drug recorded"}</span>
              {p.startedOn && (
                <span className="text-ink-mute"> · started {fmtDate(p.startedOn)}</span>
              )}
            </div>
          </div>
          {risk.data && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-ink-mute mb-1.5">
                Risk
              </div>
              <RiskBadge band={risk.data.band} score={risk.data.score} size="md" />
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Risk explanation */}
        <section className="bg-white rounded-xl border border-line p-6">
          <h2 className="font-display text-lg font-bold text-navy mb-3">
            Why this risk band
          </h2>
          {risk.data && risk.data.rules.length === 0 && (
            <p className="text-ink-soft text-sm">
              No risk signals fired in the recent window.
            </p>
          )}
          {risk.data && risk.data.rules.length > 0 && (
            <ul className="space-y-2">
              {risk.data.rules.map((r) => (
                <li
                  key={r.code}
                  className="flex items-start gap-3 text-sm bg-mist rounded-md px-3 py-2"
                >
                  <span className="font-mono text-xs text-ink-mute mt-0.5">
                    +{r.weight}
                  </span>
                  <span className="text-ink-soft">{r.label}</span>
                </li>
              ))}
            </ul>
          )}
          {risk.data && (
            <div className="text-xs text-ink-mute mt-4">
              Computed {fmtDate(risk.data.asOf)}
            </div>
          )}
        </section>

        {/* Recent check-ins */}
        <section className="bg-white rounded-xl border border-line p-6">
          <h2 className="font-display text-lg font-bold text-navy mb-3">
            Recent check-ins
          </h2>
          {checkins.isPending && (
            <div className="text-ink-mute text-sm">Loading...</div>
          )}
          {checkins.data && checkins.data.length === 0 && (
            <div className="text-ink-mute text-sm">No check-ins logged yet.</div>
          )}
          {checkins.data && checkins.data.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {checkins.data.slice(0, 14).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between bg-mist rounded-md px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-semibold text-navy">
                      {fmtDate(c.date)}
                    </div>
                    <div className="text-xs text-ink-mute">
                      Mood {c.mood}/5
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="px-2 py-0.5 bg-white rounded border border-line text-ink-soft">
                      Energy: {ENERGY_LABEL[c.energy]}
                    </span>
                    <span className="px-2 py-0.5 bg-white rounded border border-line text-ink-soft">
                      Nausea: {NAUSEA_LABEL[c.nausea]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Notes */}
      <section className="bg-white rounded-xl border border-line p-6">
        <h2 className="font-display text-lg font-bold text-navy mb-3">
          Care team notes
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v.length === 0) return;
            addNote.mutate(v);
          }}
          className="mb-4"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a note for the care team..."
            className="w-full px-3 py-2 rounded-md border border-line bg-mist focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={addNote.isPending || draft.trim().length === 0}
              className="px-4 py-2 rounded-md bg-navy text-white font-semibold text-sm hover:bg-navy-soft transition-colors disabled:opacity-60"
            >
              {addNote.isPending ? "Saving..." : "Save note"}
            </button>
          </div>
        </form>
        {notes.data && notes.data.length === 0 && (
          <div className="text-ink-mute text-sm">No notes yet.</div>
        )}
        {notes.data && notes.data.length > 0 && (
          <ul className="space-y-3">
            {notes.data.map((n) => (
              <li
                key={n.id}
                className="bg-mist rounded-md px-4 py-3 group relative"
              >
                <div className="text-sm text-ink whitespace-pre-wrap">
                  {n.body}
                </div>
                <div className="text-xs text-ink-mute mt-2 flex items-center justify-between">
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Delete this note?")) delNote.mutate(n.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-bad hover:underline transition-opacity"
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
