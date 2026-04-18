import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Two-step inline modal for logging a care-team note from the queue.
 *
 *   Step 1 (compose): textarea + Save / Cancel.
 *   Step 2 (outcome): "Did this resolve the issue?" Yes / No / Skip.
 *
 * The actual POST happens once the doctor picks an outcome (or Skip),
 * so the note + its resolved flag land in a single insert. This is the
 * seed of a worked-vs-didn't-work training signal we'll learn from later.
 */
interface Props {
  patientId: number;
  patientName: string;
  onClose: () => void;
}

type Step = "compose" | "outcome";

export function AddNoteModal({ patientId, patientName, onClose }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("compose");
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (step === "compose") taRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  // Synchronous lock so two rapid clicks on Yes / No / Skip don't race
  // past the disabled-button check (which only flips after React
  // re-renders). Without this we'd insert duplicate notes with
  // conflicting `resolved` values.
  const submittingRef = useRef(false);
  const save = useMutation({
    mutationFn: (resolved: boolean | null) =>
      api.addPatientNote(patientId, draft.trim(), resolved),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patient", patientId, "notes"] });
      onClose();
    },
    onError: () => {
      submittingRef.current = false;
    },
  });

  function submit(resolved: boolean | null) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    save.mutate(resolved);
  }

  const trimmed = draft.trim();
  const canAdvance = trimmed.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(20,34,64,0.55)" }}
      onClick={onClose}
    >
      <div
        className="bg-card rounded-[20px] w-full max-w-md p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {step === "compose" ? "Add note" : "Outcome"}
        </div>
        <h2 className="font-display text-[20px] font-bold text-foreground mt-1">
          {patientName}
        </h2>

        {step === "compose" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canAdvance) setStep("outcome");
            }}
            className="mt-4"
          >
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              placeholder="e.g. Called patient, scheduled tele-visit Thursday."
              className="w-full px-4 py-3 rounded-xl bg-background text-foreground font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm resize-y"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-2xl bg-background text-foreground font-semibold text-sm hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canAdvance}
                className="px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-60"
              >
                Continue
              </button>
            </div>
          </form>
        )}

        {step === "outcome" && (
          <div className="mt-4">
            <div
              className="text-xs px-4 py-3 rounded-xl bg-background text-foreground font-medium whitespace-pre-wrap line-clamp-3"
              aria-label="Note preview"
            >
              {trimmed}
            </div>
            <div className="mt-5 text-sm font-semibold text-foreground">
              Did this resolve the issue?
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              We use this to learn which actions actually move the needle.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => submit(true)}
                className="px-4 py-3 rounded-2xl font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-60"
                style={{ backgroundColor: "#34C759", color: "#0A2E14" }}
              >
                Yes, resolved
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => submit(false)}
                className="px-4 py-3 rounded-2xl font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-60"
                style={{ backgroundColor: "#FF3B30", color: "#FFFFFF" }}
              >
                No, still open
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep("compose")}
                disabled={save.isPending}
                className="text-xs text-muted-foreground font-semibold hover:text-foreground transition-colors disabled:opacity-60"
              >
                ← Edit note
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => submit(null)}
                className="text-xs text-muted-foreground font-semibold hover:text-foreground transition-colors disabled:opacity-60"
              >
                {save.isPending ? "Saving..." : "Skip & save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
