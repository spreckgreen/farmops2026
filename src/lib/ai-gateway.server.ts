import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getServerEnv } from "./server-env.server";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-ai-gateway",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

/**
 * Returns an OpenAI-compatible AI provider. If CUSTOM_AI_BASE_URL and
 * CUSTOM_AI_API_KEY are both set, requests are routed to that endpoint.
 * Otherwise falls back to the Lovable AI Gateway using LOVABLE_API_KEY.
 *
 * CUSTOM_AI_MODEL is resolved via getServerEnv (vault-first, env fallback)
 * so it can be updated at runtime from the self-host settings UI without a
 * redeploy.
 */
// Bundled Ollama defaults — match docker-compose.yml's `ollama` service.
// Used as a last-resort fallback when no CUSTOM_AI_* env vars are set and no
// LOVABLE_API_KEY is available, so a fresh install (or a dev shell without a
// .env) still has a working AI backend instead of throwing at first call.
const BUNDLED_OLLAMA_BASE_URL = "http://ollama:11434/v1";
const BUNDLED_OLLAMA_API_KEY = "ollama";
const BUNDLED_OLLAMA_MODEL = "llama3.2:3b";

export async function createAiProvider(): Promise<{
  provider: ReturnType<typeof createOpenAICompatible>;
  modelOverride: string | undefined;
}> {
  const customBase = process.env.CUSTOM_AI_BASE_URL;
  const customKey = process.env.CUSTOM_AI_API_KEY;
  const modelOverride = (await getServerEnv("CUSTOM_AI_MODEL")) || undefined;
  if (customBase && customKey) {
    return {
      provider: createOpenAICompatible({
        name: "custom-ai",
        baseURL: customBase,
        headers: { Authorization: `Bearer ${customKey}` },
      }),
      modelOverride,
    };
  }
  const apiKey = process.env.LOVABLE_API_KEY;
  if (apiKey) {
    return {
      provider: createLovableAiGatewayProvider(apiKey),
      modelOverride,
    };
  }
  // Last-resort fallback: bundled Ollama. Never throws — if the container
  // isn't actually running, the outgoing chat request will fail with a
  // network error at call time, which is easier to diagnose than a
  // module-init throw during SSR/prerender.
  return {
    provider: createOpenAICompatible({
      name: "bundled-ollama",
      baseURL: BUNDLED_OLLAMA_BASE_URL,
      headers: { Authorization: `Bearer ${BUNDLED_OLLAMA_API_KEY}` },
    }),
    modelOverride: modelOverride ?? BUNDLED_OLLAMA_MODEL,
  };
}

