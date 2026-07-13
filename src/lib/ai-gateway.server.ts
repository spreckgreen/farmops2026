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
  if (!apiKey) {
    throw new Error(
      "Missing AI credentials: set CUSTOM_AI_BASE_URL + CUSTOM_AI_API_KEY, or LOVABLE_API_KEY",
    );
  }
  return {
    provider: createLovableAiGatewayProvider(apiKey),
    modelOverride,
  };
}
