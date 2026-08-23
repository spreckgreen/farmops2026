import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getServerEnv } from "./server-env.server";

/**
 * Returns the configured OpenAI-compatible provider, or bundled Ollama.
 *
 * CUSTOM_AI_MODEL is resolved via getServerEnv (vault-first, env fallback)
 * so it can be updated at runtime from the self-host settings UI without a
 * redeploy.
 */
// Bundled Ollama defaults — match docker-compose.yml's `ollama` service.
// Used as a last-resort fallback when no CUSTOM_AI_* env vars are set and no
// A fresh install still has a usable default endpoint instead of throwing.
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

