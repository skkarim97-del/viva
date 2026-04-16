import type { ChatMessage } from "@/types";

export interface CoachThreadSummary {
  topic: string;
  takeaway: string;
  nextStep?: string;
  exchangeCount: number;
  lastTimestamp: number;
}

const TOPIC_KEYWORDS: { keys: string[]; topic: string }[] = [
  { keys: ["nausea", "vomit", "queasy"], topic: "Nausea management" },
  { keys: ["side effect", "side-effect"], topic: "Side effects" },
  { keys: ["protein"], topic: "Protein intake" },
  { keys: ["hydrat", "water", "fluid"], topic: "Hydration" },
  { keys: ["sleep", "tired", "rest"], topic: "Sleep & rest" },
  { keys: ["exercise", "workout", "train", "lift", "cardio"], topic: "Training" },
  { keys: ["dose", "dosage", "titration", "increase"], topic: "Dose changes" },
  { keys: ["weight", "scale", "plateau", "stall"], topic: "Weight progress" },
  { keys: ["appetite", "hunger", "eating"], topic: "Appetite" },
  { keys: ["constipat", "diarrhea", "digest", "stomach", "bloat"], topic: "Digestion" },
  { keys: ["energy", "fatigue"], topic: "Energy" },
  { keys: ["mood", "stress", "anxious"], topic: "Mood & stress" },
];

function inferTopic(messages: ChatMessage[]): string {
  const userText = messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content.toLowerCase())
    .join(" ");
  for (const { keys, topic } of TOPIC_KEYWORDS) {
    if (keys.some((k) => userText.includes(k))) return topic;
  }
  const firstUser = messages.find((m) => m.role === "user")?.content.trim();
  if (firstUser) {
    const trimmed = firstUser.replace(/\s+/g, " ").slice(0, 40);
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1) + (firstUser.length > 40 ? "..." : "");
  }
  return "Coach conversation";
}

function firstSentence(text: string, max = 140): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/[^.!?]+[.!?]/);
  const sentence = (m ? m[0] : cleaned).trim();
  if (sentence.length <= max) return sentence;
  return sentence.slice(0, max - 1).trimEnd() + "...";
}

const NEXT_STEP_PATTERNS = [
  /\b(?:try|consider|focus on|aim for|start with|begin with|stick to|prioritize|drink|eat|log|track|take|rest|walk|stretch|breathe|reach out)\b[^.!?\n]+[.!?]/i,
];

function extractNextStep(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, " ").trim();
  for (const re of NEXT_STEP_PATTERNS) {
    const m = cleaned.match(re);
    if (m) {
      let s = m[0].trim();
      if (s.length > 120) s = s.slice(0, 117).trimEnd() + "...";
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
  return undefined;
}

/**
 * Build a small, on-device summary of the active coach thread for the Today card.
 * No extra API call: derived from the last few messages so it updates immediately
 * after every successful exchange.
 */
export function summarizeCoachThread(messages: ChatMessage[]): CoachThreadSummary | null {
  if (!messages || messages.length === 0) return null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastAssistant && !lastUser) return null;

  const topic = inferTopic(messages);
  const takeawaySource = lastAssistant?.content || lastUser?.content || "";
  const takeaway = firstSentence(takeawaySource, 140);
  const nextStep = lastAssistant ? extractNextStep(lastAssistant.content) : undefined;
  const exchangeCount = messages.filter((m) => m.role === "user").length;
  const lastTimestamp = messages[messages.length - 1].timestamp;

  return {
    topic,
    takeaway,
    nextStep: nextStep && nextStep !== takeaway ? nextStep : undefined,
    exchangeCount,
    lastTimestamp,
  };
}
