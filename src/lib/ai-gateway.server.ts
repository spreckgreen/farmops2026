import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-ai-gateway",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

/**
 * Returns an OpenAI-compatible AI provider. If CUSTOM_AI_BASE_URL and
 * CUSTOM_AI_API_KEY are both set, requests are routed to that endpoint
 * (e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, or a
 * self-hosted OpenAI-compatible server). Otherwise falls back to the
 * Lovable AI Gateway using LOVABLE_API_KEY.
 *
 * Optional CUSTOM_AI_MODEL overrides the model id passed by callers,
 * useful when the custom endpoint doesn't recognize the default ids.
 */
export function createAiProvider(): {
  provider: ReturnType<typeof createOpenAICompatible>;
  modelOverride: string | undefined;
} {
  const customBase = process.env.CUSTOM_AI_BASE_URL;
  const customKey = process.env.CUSTOM_AI_API_KEY;
  if (customBase && customKey) {
    return {
      provider: createOpenAICompatible({
        name: "custom-ai",
        baseURL: customBase,
        headers: { Authorization: `Bearer ${customKey}` },
      }),
      modelOverride: process.env.CUSTOM_AI_MODEL || undefined,
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
    modelOverride: undefined,
  };
}
