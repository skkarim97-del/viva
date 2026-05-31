import type { ActionCategory } from "@/types";

export const GI_OVERRIDES: Partial<Record<ActionCategory, { title: string; subtitle: string }>> = {
  move: {
    title: "Gentle walk",
    subtitle: "5–10 min after food if tolerated.",
  },
  fuel: {
    title: "Small bland meals",
    subtitle: "Crackers, toast, rice or soup in small portions.",
  },
  hydrate: {
    title: "Slow fluids",
    subtitle: "Small sips every few minutes. Avoid large amounts at once.",
  },
  recover: {
    title: "Lower intensity",
    subtitle: "Keep today light while symptoms settle.",
  },
};
