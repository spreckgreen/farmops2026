// Server-side resolution + persistence for the two AI engines (local / hosted).
// Server-only: reads process.env and the shared vault.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  BUNDLED_OLLAMA_API_KEY,
  BUNDLED_OLLAMA_BASE_URL,
  BUNDLED_OLLAMA_MODEL,
  ENGINE_ENV_KEY,
  LOVABLE_DEFAULT_MODEL,
  LOVABLE_GATEWAY_BASE_URL,
  resolveEnginesConfig,
  serializeEnginesConfig,
  type AiEnginesConfig,
} from "./ai-engines";

type Provider = ReturnType<typeof createOpenAICompatible>;

export async function loadEnginesConfig(): Promise<AiEnginesConfig> {
  const { getServerEnv } = await import("./server-env.server");
  return resolveEnginesConfig(await getServerEnv(ENGINE_ENV_KEY));
}

export async function saveEnginesConfig(config: AiEnginesConfig, userId: string) {
  const { persistSharedEnvValue } = await import("./shared-env-store.server");
  await persistSharedEnvValue(
    ENGINE_ENV_KEY,
    serializeEnginesConfig(config),
    "AI engines (local + hosted)",
    userId,
  );
  return config;
}

/** Effective local endpoint: vault config → CUSTOM_AI_* env → bundled Ollama. */
export async function resolveLocalEngine(config?: AiEnginesConfig) {
  const cfg = config ?? (await loadEnginesConfig());
  const { getServerEnv } = await import("./server-env.server");
  const baseUrl =
    cfg.local.baseUrl ?? (await getServerEnv("CUSTOM_AI_BASE_URL")) ?? BUNDLED_OLLAMA_BASE_URL;
  const apiKey =
    cfg.local.apiKey ?? (await getServerEnv("CUSTOM_AI_API_KEY")) ?? BUNDLED_OLLAMA_API_KEY;
  const model =
    cfg.local.model ?? (await getServerEnv("CUSTOM_AI_MODEL")) ?? BUNDLED_OLLAMA_MODEL;
  return { baseUrl, apiKey, model };
}

/**
 * Effective hosted endpoint. Defaults to the Lovable AI Gateway; returns null
 * when the selected hosted engine has no usable credentials.
 */
export async function resolveHostedEngine(
  config?: AiEnginesConfig,
  opts?: { defaultModel?: string },
) {
  const cfg = config ?? (await loadEnginesConfig());
  if (cfg.hosted.provider === "custom") {
    const { baseUrl, apiKey, model } = cfg.hosted.custom;
    if (!baseUrl || !apiKey) return null;
    return {
      kind: "custom" as const,
      baseUrl,
      apiKey,
      model: model ?? opts?.defaultModel ?? LOVABLE_DEFAULT_MODEL,
    };
  }
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  return {
    kind: "lovable" as const,
    baseUrl: LOVABLE_GATEWAY_BASE_URL,
    apiKey,
    model: cfg.hosted.lovableModel ?? opts?.defaultModel ?? LOVABLE_DEFAULT_MODEL,
  };
}

export function buildLocalProvider(endpoint: { baseUrl: string; apiKey: string }): Provider {
  return createOpenAICompatible({
    name: "custom-ai",
    baseURL: endpoint.baseUrl,
    headers: { Authorization: `Bearer ${endpoint.apiKey}` },
  });
}

export function buildHostedProvider(endpoint: {
  kind: "lovable" | "custom";
  baseUrl: string;
  apiKey: string;
}): Provider {
  return createOpenAICompatible({
    name: "lovable-ai-gateway",
    baseURL: endpoint.baseUrl,
    headers:
      endpoint.kind === "lovable"
        ? { "Lovable-API-Key": endpoint.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }
        : { Authorization: `Bearer ${endpoint.apiKey}` },
  });
}
