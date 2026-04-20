import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type CareEvent,
  type Checkin,
  type StopReason,
  type StopTimingBucket,
  type SymptomFlag,
  type TreatmentStatus,
} from "@/lib/api";
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
  const weight = useQuery({
    queryKey: ["patient", id, "weight"],
    queryFn: () => api.patientWeight(id),
  });
  // Care events power the dual-layer intervention surface: the amber
  // escalation banner up top and the doctor-side audit trail below
  // the notes section.
  const care = useQuery({
    queryKey: ["patient", id, "care-events"],
    queryFn: () => api.careEvents(id),
  });
  const markReviewed = useMutation({
    mutationFn: () => api.markPatientReviewed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", id, "care-events"] });
      qc.invalidateQueries({ queryKey: ["needs-review-ids"] });
    },
  });

  const [draft, setDraft] = useState("");
  // Local state for the treatment-status editor. We don't keep these in
  // a separate query; mutating PATCH returns the fresh PatientDetail
  // and we just push it into the patient cache.
  const [statusEditOpen, setStatusEditOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<TreatmentStatus>("active");
  const [stopReasonDraft, setStopReasonDraft] =
    useState<StopReason>("side_effects");
  const [stopNoteDraft, setStopNoteDraft] = useState("");
  const setStatusMut = useMutation({
    mutationFn: () =>
      api.setTreatmentStatus(id, {
        status: statusDraft,
        stopReason:
          statusDraft === "stopped" ? stopReasonDraft : undefined,
        stopNote:
          statusDraft === "stopped" && stopNoteDraft.trim()
            ? stopNoteDraft.trim()
            : null,
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(["patient", id], fresh);
      qc.invalidateQueries({ queryKey: ["patients"] });
      setStatusEditOpen(false);
    },
  });
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

      {/* Escalation banner. Renders amber + CTA when the patient has
          requested care-team review and no doctor_reviewed event has
          fired since. After reviewing, collapses to a quiet line so
          the audit trail is still visible without screaming for
          attention. */}
      {care.data?.escalationOpen && care.data.lastEscalationAt && (
        <div
          className="rounded-[20px] px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{
            backgroundColor: "rgba(255,149,0,0.10)",
            color: "#8B4F00",
          }}
        >
          <span aria-hidden className="text-lg">🛟</span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-sm">
              Patient requested more support
            </div>
            <div className="text-xs mt-0.5 opacity-80 font-medium">
              {relativeTime(care.data.lastEscalationAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => markReviewed.mutate()}
            disabled={markReviewed.isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: "#142240", color: "#fff" }}
          >
            {markReviewed.isPending ? "Marking..." : "Mark as reviewed"}
          </button>
        </div>
      )}
      {care.data && !care.data.escalationOpen && care.data.lastReviewAt && (
        <div className="text-xs text-muted-foreground font-medium">
          {(() => {
            const reviewer = care.data.events.find(
              (e) =>
                e.type === "doctor_reviewed" &&
                e.occurredAt === care.data!.lastReviewAt,
            );
            const who = reviewer?.actorName
              ? `Dr. ${reviewer.actorName.split(" ").slice(-1)[0]}`
              : "Care team";
            return `Reviewed by ${who} · ${relativeTime(care.data.lastReviewAt)}`;
          })()}
        </div>
      )}

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
            {weight.data?.latest && (
              <div
                className="text-muted-foreground text-xs mt-2 font-medium flex items-center gap-2"
                aria-label="Latest weight"
              >
                <span className="text-foreground font-semibold">
                  {Math.round(weight.data.latest.weightLbs)} lbs
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {weight.data.daysSinceLast === 0
                    ? "logged today"
                    : weight.data.daysSinceLast === 1
                    ? "1 day ago"
                    : `${weight.data.daysSinceLast} days ago`}
                </span>
                {/* Direction + amount only -- intentionally neutral
                    styling. We don't render up = bad / down = good
                    color cues; weight change is clinical context for
                    the doctor, not a value judgment. */}
                {(weight.data.trend === "up" || weight.data.trend === "down") &&
                  weight.data.prior && (
                    <span className="text-muted-foreground">
                      {weight.data.trend === "up" ? "↑" : "↓"}{" "}
                      {Math.abs(
                        Math.round(
                          weight.data.latest.weightLbs -
                            weight.data.prior.weightLbs,
                        ),
                      )}{" "}
                      lbs
                    </span>
                  )}
              </div>
            )}
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

      {/* Treatment status. Doctor-owned source of truth for whether
          this patient is currently on GLP-1 therapy. Drives whether
          they show up in the active panel and feeds the retention
          KPIs in /internal/analytics. We deliberately keep it to
          three states (active / stopped / unknown) so the control
          stays unambiguous; risk-band/at-risk is derived elsewhere. */}
      <TreatmentStatusCard
        status={p.treatmentStatus}
        source={p.treatmentStatusSource}
        stopReason={p.stopReason}
        stopNote={p.stopNote}
        stopTimingBucket={p.stopTimingBucket}
        daysOnTreatment={p.daysOnTreatment}
        updatedAt={p.treatmentStatusUpdatedAt}
        editing={statusEditOpen}
        onEdit={() => {
          setStatusDraft(p.treatmentStatus);
          setStopReasonDraft((p.stopReason as StopReason) ?? "side_effects");
          setStopNoteDraft(p.stopNote ?? "");
          setStatusEditOpen(true);
        }}
        onCancel={() => setStatusEditOpen(false)}
        onSave={() => setStatusMut.mutate()}
        saving={setStatusMut.isPending}
        errorMessage={
          setStatusMut.isError
            ? (setStatusMut.error as Error).message
            : null
        }
        statusDraft={statusDraft}
        setStatusDraft={setStatusDraft}
        stopReasonDraft={stopReasonDraft}
        setStopReasonDraft={setStopReasonDraft}
        stopNoteDraft={stopNoteDraft}
        setStopNoteDraft={setStopNoteDraft}
      />

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
                  {/* Closed-loop signals -- these are what convert
                      "we showed advice" into "is the advice working?". */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium">
                    <span className="text-muted-foreground">
                      {f.guidanceShown
                        ? "Guidance acknowledged"
                        : "Guidance not yet acknowledged"}
                    </span>
                    {f.trendResponse && (
                      <span
                        className="px-2 py-0.5 rounded-md font-semibold"
                        style={(() => {
                          if (f.trendResponse === "better") {
                            return { backgroundColor: "rgba(30,142,62,0.12)", color: "#1E8E3E" };
                          }
                          if (f.trendResponse === "worse") {
                            return { backgroundColor: "rgba(255,59,48,0.12)", color: "#B5251D" };
                          }
                          return { backgroundColor: "rgba(20,34,64,0.08)", color: "#142240" };
                        })()}
                      >
                        Patient reports{" "}
                        {f.trendResponse === "better"
                          ? "better"
                          : f.trendResponse === "worse"
                            ? "worse"
                            : "same"}
                      </span>
                    )}
                    {f.clinicianRequested && (
                      <span
                        className="px-2 py-0.5 rounded-md font-semibold"
                        style={{
                          backgroundColor: "rgba(255,149,0,0.14)",
                          color: "#9A5B00",
                        }}
                      >
                        Patient requested clinician
                      </span>
                    )}
                  </div>
                  {f.suggestFollowup && f.escalationReasons.length > 0 && (
                    <div className="mt-2 text-[11px] text-muted-foreground font-medium">
                      <span className="uppercase tracking-wider">
                        Why escalated:
                      </span>{" "}
                      <span className="text-foreground">
                        {f.escalationReasons.join(" · ")}
                      </span>
                    </div>
                  )}
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

      {/* Care-events audit trail. Compact list of doctor-side actions
          + patient escalations so the doctor can see the loop without
          leaving the page. We hide the high-volume viva-side
          coach_message / recommendation_shown rows here -- those live
          in analytics, not in the per-patient view. */}
      {care.data && care.data.events.length > 0 && (() => {
        const visible = care.data.events.filter(
          (e) =>
            e.type === "doctor_reviewed" ||
            e.type === "doctor_note" ||
            e.type === "treatment_status_updated" ||
            e.type === "escalation_requested",
        );
        if (visible.length === 0) return null;
        return (
          <section className="bg-card rounded-[20px] p-6">
            <SectionTitle>Care loop activity</SectionTitle>
            <ul className="space-y-2">
              {visible.slice(0, 12).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 text-sm font-medium"
                >
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        e.source === "patient"
                          ? "#FF9500"
                          : e.source === "doctor"
                          ? "#142240"
                          : "#5AC8FA",
                    }}
                  />
                  <span className="text-foreground">
                    {careEventLabel(e)}
                  </span>
                  <span className="text-muted-foreground text-xs ml-auto">
                    {relativeTime(e.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}
    </div>
  );
}

// Compact human label for the care-events audit trail. Kept as a plain
// switch so adding a new event type is a one-line edit.
function careEventLabel(e: CareEvent): string {
  switch (e.type) {
    case "escalation_requested":
      return "Patient requested more support";
    case "doctor_reviewed":
      return e.actorName
        ? `${e.actorName} marked as reviewed`
        : "Marked as reviewed";
    case "doctor_note":
      return e.actorName
        ? `${e.actorName} added a note`
        : "Care note added";
    case "treatment_status_updated": {
      const status = (e.metadata?.status as string) ?? "updated";
      return `Treatment status set to ${status}`;
    }
    default:
      return e.type;
  }
}

// ---- TreatmentStatusCard ---------------------------------------------------
// Pulled out of PatientDetailPage so the JSX above stays scannable.
// Read-mode shows a colored chip + "edited by ..." line. Edit-mode is
// a tiny inline form -- no modal, no separate page -- because doctors
// will hit this constantly during weekly reviews and a modal would
// add a click for nothing.

const STATUS_LABEL: Record<TreatmentStatus, string> = {
  active: "On treatment",
  stopped: "Stopped",
  unknown: "Unknown",
};
const STATUS_STYLE: Record<TreatmentStatus, { bg: string; fg: string }> = {
  active: { bg: "rgba(52,199,89,0.12)", fg: "#1F7A3A" },
  stopped: { bg: "rgba(255,59,48,0.12)", fg: "#B5251D" },
  unknown: { bg: "rgba(142,142,147,0.16)", fg: "#4A4A55" },
};
const STOP_REASON_LABEL: Record<StopReason, string> = {
  side_effects: "Side effects",
  cost_or_insurance: "Cost or insurance",
  lack_of_efficacy: "Lack of efficacy",
  patient_choice_or_motivation: "Patient choice or motivation",
  other: "Other",
};
const SOURCE_LABEL: Record<"doctor" | "patient" | "system", string> = {
  doctor: "you",
  patient: "patient",
  system: "system",
};

const STOP_TIMING_LABEL: Record<StopTimingBucket, string> = {
  d0_30: "0 to 30 days",
  d31_60: "31 to 60 days",
  d61_90: "61 to 90 days",
  d90_plus: "More than 90 days",
  unknown: "",
};

function TreatmentStatusCard(props: {
  status: TreatmentStatus;
  source: "doctor" | "patient" | "system" | null;
  stopReason: StopReason | null;
  stopNote: string | null;
  stopTimingBucket: StopTimingBucket;
  daysOnTreatment: number | null;
  updatedAt: string | null;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  errorMessage: string | null;
  statusDraft: TreatmentStatus;
  setStatusDraft: (s: TreatmentStatus) => void;
  stopReasonDraft: StopReason;
  setStopReasonDraft: (r: StopReason) => void;
  stopNoteDraft: string;
  setStopNoteDraft: (n: string) => void;
}) {
  const style = STATUS_STYLE[props.status];
  return (
    <section className="bg-card rounded-[20px] p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-display text-[18px] font-semibold text-foreground">
            Treatment status
          </h2>
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ backgroundColor: style.bg, color: style.fg }}
          >
            {STATUS_LABEL[props.status]}
          </span>
          {props.status === "stopped" && props.stopReason && (
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
              style={{
                backgroundColor: "rgba(142,142,147,0.16)",
                color: "#4A4A55",
              }}
            >
              {STOP_REASON_LABEL[props.stopReason]}
            </span>
          )}
        </div>
        {!props.editing && (
          <button
            type="button"
            onClick={props.onEdit}
            className="text-sm font-semibold text-foreground bg-background hover:bg-muted rounded-lg px-3 py-1.5 transition-colors"
          >
            Update
          </button>
        )}
      </div>

      {!props.editing && (
        <>
          {/* Stop timing line. Only meaningful when status='stopped' AND
              we have both a startedOn date and an updatedAt date.
              Server returns daysOnTreatment=null in any other case. */}
          {props.status === "stopped" && props.daysOnTreatment !== null && (
            <div className="text-sm text-foreground mt-3 font-medium">
              Stopped {props.daysOnTreatment} day
              {props.daysOnTreatment === 1 ? "" : "s"} after starting
              treatment
              {props.stopTimingBucket !== "unknown" && (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {STOP_TIMING_LABEL[props.stopTimingBucket]}
                </span>
              )}
            </div>
          )}
          {props.status === "stopped" && props.stopNote && (
            <p className="text-sm text-foreground mt-3 leading-relaxed">
              {props.stopNote}
            </p>
          )}
          {props.updatedAt && props.source && (
            <div className="text-xs text-muted-foreground mt-3 font-medium">
              Set by {SOURCE_LABEL[props.source]} ·{" "}
              {relativeTime(props.updatedAt)}
            </div>
          )}
        </>
      )}

      {props.editing && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_LABEL) as TreatmentStatus[]).map((s) => {
              const selected = props.statusDraft === s;
              const sStyle = STATUS_STYLE[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => props.setStatusDraft(s)}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: selected ? sStyle.bg : "transparent",
                    color: selected ? sStyle.fg : "#4A4A55",
                    border: `1px solid ${
                      selected ? sStyle.fg : "rgba(142,142,147,0.3)"
                    }`,
                  }}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
          {props.statusDraft === "stopped" && (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Reason
                </label>
                <select
                  value={props.stopReasonDraft}
                  onChange={(e) =>
                    props.setStopReasonDraft(e.target.value as StopReason)
                  }
                  className="bg-background rounded-lg px-3 py-2 text-sm font-medium text-foreground w-full max-w-xs"
                >
                  {(Object.keys(STOP_REASON_LABEL) as StopReason[]).map(
                    (r) => (
                      <option key={r} value={r}>
                        {STOP_REASON_LABEL[r]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Note (optional)
                </label>
                <textarea
                  value={props.stopNoteDraft}
                  onChange={(e) => props.setStopNoteDraft(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Context for the care team"
                  className="bg-background rounded-lg px-3 py-2 text-sm font-medium text-foreground w-full"
                />
              </div>
            </>
          )}
          {props.errorMessage && (
            <div
              className="text-xs font-semibold rounded-lg px-3 py-2"
              style={{
                backgroundColor: "rgba(255,59,48,0.10)",
                color: "#B5251D",
              }}
            >
              {props.errorMessage}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={props.onSave}
              disabled={props.saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#142240" }}
            >
              {props.saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={props.onCancel}
              disabled={props.saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-foreground bg-background hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
