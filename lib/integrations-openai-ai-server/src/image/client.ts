import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

// =====================================================================
// Lazy OpenAI image client (HIPAA pilot safe-mode compatible)
// =====================================================================
// See lib/integrations-openai-ai-server/src/client.ts for the full
// rationale. Same pattern: defer instantiation and the env-var
// presence check to first property access so the api-server can
// boot in pilot/production safe mode WITHOUT the
// AI_INTEGRATIONS_OPENAI_* env vars provisioned.
//
// NOTE: this module is transitively pulled into the api-server
// bundle via the root barrel (lib/integrations-openai-ai-server/
// src/index.ts re-exports generateImageBuffer / editImages from
// ./image), even though no api-server code path calls them. Without
// this lazy wrapper, the eager throw at module load crashes the EB
// container before safe-mode runtime gates can run.
//
// Image generation is NOT a pilot PHI surface and is never invoked
// in the api-server. If anyone ever calls generateImageBuffer or
// editImages without provisioning the integration, they get the
// same loud error as before -- at call time, not import time.
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

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = response.data[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBase64 = response.data[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
