// =====================================================================
// Pilot production: AI fully disabled (HIPAA, no-BAA stance)
// =====================================================================
// This stub replaces every previous import of
// `@workspace/integrations-openai-ai-server` from the api-server.
// Effect: the OpenAI SDK and the integration lib are NOT pulled
// into the production bundle at all -- esbuild tree-shakes them
// because nothing in the api-server graph references them anymore.
//
// Why a stub instead of deleting the call sites:
//   * The intervention engine and the coach route still contain the
//     AI code paths so we can re-enable them in a future, properly
//     BAA-covered architecture without re-wiring everything.
//   * Those paths are already runtime-gated (COACH_PILOT_MODE=safe
//     for /coach/chat, INTERVENTION_AI_MODE=fallback for the
//     intervention engine). Both default to the safe value in
//     production, so the stub below is never reached.
//   * If a future change accidentally removes a gate, accessing
//     the stub throws a loud, unmistakable error at call time --
//     it does NOT silently fall back to a real OpenAI call, and it
//     cannot crash the server at boot.
//
// To re-enable AI in a future release:
//   1. Stand up a BAA-covered AI surface (separate deid pipeline).
//   2. Restore the real imports from
//      `@workspace/integrations-openai-ai-server` in the two
//      original call sites.
//   3. Remove the production safety assert entry for the
//      corresponding API key in artifacts/api-server/src/index.ts
//      ONLY if that vendor's BAA is signed.
// =====================================================================

const ERR =
  "AI is disabled in pilot production. The OpenAI integration is not available in this build. " +
  "If you reached this code path, a safe-mode gate (COACH_PILOT_MODE / INTERVENTION_AI_MODE) was bypassed -- fix the gate, do not re-enable the client.";

type AnyOpenAI = Record<string | symbol, unknown>;

export const openai = new Proxy({} as AnyOpenAI, {
  get() {
    throw new Error(ERR);
  },
  apply() {
    throw new Error(ERR);
  },
  construct() {
    throw new Error(ERR);
  },
}) as never;
