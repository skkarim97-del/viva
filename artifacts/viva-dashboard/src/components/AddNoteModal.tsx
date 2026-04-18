import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Small inline modal for logging a care-team note from the patient queue
 * without the doctor having to navigate into the detail page. After a
 * successful save we invalidate both the queue (so the "Last note: just
 * now" line refreshes) and the per-patient notes query.
 */
interface Props {
  patientId: number;
  patientName: string;
  onClose: () => void;
}

export function AddNoteModal({ patientId, patientName, onClose }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus + close on Escape, so the modal feels like a quick action
  // rather than a context switch.
  useEffect(() => {
    taRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: (body: string) => api.addPatientNote(patientId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patient", patientId, "notes"] });
      onClose();
    },
  });

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && !save.isPending;

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
          Add note
        </div>
        <h2 className="font-display text-[20px] font-bold text-foreground mt-1">
          {patientName}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate(trimmed);
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
              disabled={!canSave}
              className="px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-60"
            >
              {save.isPending ? "Saving..." : "Save note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
