// Server-side resolution + persistence for the four AI engines
// (local / ollama_cloud / lovable / other_cloud).
// Server-only: reads process.env and the shared vault.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  BUNDLED_OLLAMA_API_KEY,
  ENGINE_ENV_KEY,
  LOVABLE_DEFAULT_MODEL,
  getAiEngineDef,
  resolveEnginesConfig,
  serializeEnginesConfig,
  type AiEngineId,
  type AiEnginesConfig,
} from "./ai-engines";

type Provider = ReturnType<typeof createOpenAICompatible>;

export interface ResolvedEngine {
  id: AiEngineId;
  label: string;
  placement: "local" | "cloud";
  auth: "bearer" | "lovable-header";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function loadEnginesConfig(): Promise<AiEnginesConfig> {
  const { getServerEnv } = await import("./server-env.server");
  return resolveEnginesConfig(await getServerEnv(ENGINE_ENV_KEY));
}

export async function saveEnginesConfig(config: AiEnginesConfig, userId: string) {
  const { persistSharedEnvValue } = await import("./shared-env-store.server");
  await persistSharedEnvValue(
    ENGINE_ENV_KEY,
    serializeEnginesConfig(config),
    "AI engines (local, Ollama Cloud, Lovable, other cloud)",
    userId,
  );
  return config;
}

/**
 * Effective endpoint for one engine, or null when it has no usable
 * credentials. `defaultModel` is the call site's model when neither the engine
 * config nor the engine default names one.
 */
export async function resolveEngine(
  id: AiEngineId,
  config?: AiEnginesConfig,
  opts?: { defaultModel?: string },
): Promise<ResolvedEngine | null> {
  const cfg = config ?? (await loadEnginesConfig());
  const def = getAiEngineDef(id);
  const target = cfg.engines[id];
  const { getServerEnv } = await import("./server-env.server");

  let baseUrl = target.baseUrl ?? def.defaultBaseUrl;
  let apiKey = target.apiKey;
  let model = target.model ?? def.defaultModel ?? opts?.defaultModel ?? null;

  if (id === "local") {
    // Deploy-level CUSTOM_AI_* still configures the local engine.
    baseUrl = target.baseUrl ?? (await getServerEnv("CUSTOM_AI_BASE_URL")) ?? def.defaultBaseUrl;
    apiKey = target.apiKey ?? (await getServerEnv("CUSTOM_AI_API_KEY")) ?? BUNDLED_OLLAMA_API_KEY;
    model = target.model ?? (await getServerEnv("CUSTOM_AI_MODEL")) ?? def.defaultModel!;
  } else if (def.keyFromEnv) {
    apiKey = process.env.LOVABLE_API_KEY ?? null;
    model = target.model ?? opts?.defaultModel ?? def.defaultModel ?? LOVABLE_DEFAULT_MODEL;
  }

  if (!baseUrl || !apiKey || !model) return null;
  return {
    id,
    label: def.label,
    placement: def.placement,
    auth: def.auth,
    baseUrl,
    apiKey,
    model,
  };
}

/** Which engines are usable right now — drives the pickers in the UI. */
export async function engineAvailability(
  config?: AiEnginesConfig,
): Promise<Record<AiEngineId, { available: boolean; baseUrl: string | null; model: string | null }>> {
  const cfg = config ?? (await loadEnginesConfig());
  const out = {} as Record<
    AiEngineId,
    { available: boolean; baseUrl: string | null; model: string | null }
  >;
  for (const id of ["local", "ollama_cloud", "lovable", "other_cloud"] as AiEngineId[]) {
    const resolved = await resolveEngine(id, cfg);
    out[id] = {
      available: Boolean(resolved),
      baseUrl: resolved?.baseUrl ?? null,
      model: resolved?.model ?? null,
    };
  }
  return out;
}

/** Effective local endpoint: vault config → CUSTOM_AI_* env → bundled Ollama. */
export async function resolveLocalEngine(config?: AiEnginesConfig) {
  const cfg = config ?? (await loadEnginesConfig());
  const resolved = await resolveEngine("local", cfg);
  const def = getAiEngineDef("local");
  return {
    baseUrl: resolved?.baseUrl ?? def.defaultBaseUrl!,
    apiKey: resolved?.apiKey ?? BUNDLED_OLLAMA_API_KEY,
    model: resolved?.model ?? def.defaultModel!,
  };
}

/**
 * Effective cloud-default endpoint (legacy "hosted"). Returns null when the
 * selected cloud engine has no usable credentials.
 */
export async function resolveHostedEngine(
  config?: AiEnginesConfig,
  opts?: { defaultModel?: string },
) {
  const cfg = config ?? (await loadEnginesConfig());
  const resolved = await resolveEngine(cfg.cloudDefault, cfg, opts);
  if (!resolved) return null;
  return {
    ...resolved,
    kind: (resolved.id === "lovable" ? "lovable" : "custom") as "lovable" | "custom",
  };
}

export function buildEngineProvider(endpoint: {
  auth: "bearer" | "lovable-header";
  baseUrl: string;
  apiKey: string;
}): Provider {
  return createOpenAICompatible({
    name: endpoint.auth === "lovable-header" ? "lovable-ai-gateway" : "custom-ai",
    baseURL: endpoint.baseUrl,
    headers:
      endpoint.auth === "lovable-header"
        ? { "Lovable-API-Key": endpoint.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }
        : { Authorization: `Bearer ${endpoint.apiKey}` },
  });
}

export function buildLocalProvider(endpoint: { baseUrl: string; apiKey: string }): Provider {
  return buildEngineProvider({ ...endpoint, auth: "bearer" });
}

export function buildHostedProvider(endpoint: {
  kind: "lovable" | "custom";
  baseUrl: string;
  apiKey: string;
}): Provider {
  return buildEngineProvider({
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    auth: endpoint.kind === "lovable" ? "lovable-header" : "bearer",
  });
}
