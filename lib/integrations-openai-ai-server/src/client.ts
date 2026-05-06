import OpenAI from "openai";

// =====================================================================
// Lazy OpenAI client (HIPAA pilot safe-mode compatible)
// =====================================================================
// In pilot/production safe mode (COACH_PILOT_MODE=safe and
// INTERVENTION_AI_MODE=fallback) no code path ever calls into this
// client: /api/coach/chat short-circuits to a 403 before touching it,
// and the intervention engine stays in deterministic-template mode.
// We must therefore allow the server to boot WITHOUT the
// AI_INTEGRATIONS_OPENAI_* env vars provisioned -- otherwise the
// module-level throw crashes the api-server before safe-mode even has
// a chance to gate the request.
//
// The Proxy below preserves the previous synchronous call shape
// (`openai.chat.completions.create(...)`) used everywhere in the
// codebase. Instantiation -- and the env-var presence check -- is
// deferred to the first property access. If anyone ever DOES reach a
// code path that uses this client without the env vars set, they get
// the same loud error as before, just at call time instead of
// import time.
//
// Production safety assert in artifacts/api-server/src/index.ts
// continues to BLOCK OPENAI_API_KEY / ANTHROPIC_API_KEY /
// GEMINI_API_KEY from being set in production, so a misconfigured
// env can never silently route PHI to a non-BAA AI vendor.
// =====================================================================

let cachedClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient;

  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  cachedClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return cachedClient;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getOpenAIClient(), prop, receiver);
  },
});
