// Server-side resolution + persistence for the three AI engines.
// Server-only: reads process.env and the shared vault.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  BUNDLED_OLLAMA_API_KEY,
  ENGINE_ENV_KEY,
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
  auth: "bearer";
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
    "AI engines (local, Ollama Cloud, other cloud)",
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
  opts?: { defaultModel?: string; ignoreDisabled?: boolean },
): Promise<ResolvedEngine | null> {
  const cfg = config ?? (await loadEnginesConfig());
  const def = getAiEngineDef(id);
  const target = cfg.engines[id];
  // Switched off: keep the stored settings, but never route traffic here.
  if (target.enabled === false && !opts?.ignoreDisabled) return null;
  const { getServerEnv } = await import("./server-env.server");

  let baseUrl = target.baseUrl ?? def.defaultBaseUrl;
  let apiKey = target.apiKey;
  let model = target.model ?? def.defaultModel ?? opts?.defaultModel ?? null;

  if (id === "local") {
    // Local Ollama does not authenticate. Never inherit a legacy cloud key
    // from CUSTOM_AI_API_KEY or the saved local slot: an old Lovable/OpenAI
    // credential here can make an otherwise healthy local request fail with
    // "incorrect API key" after every cloud engine has been switched off.
    baseUrl = target.baseUrl ?? (await getServerEnv("CUSTOM_AI_BASE_URL")) ?? def.defaultBaseUrl;
    apiKey = BUNDLED_OLLAMA_API_KEY;
    model = target.model ?? (await getServerEnv("CUSTOM_AI_MODEL")) ?? def.defaultModel!;
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
): Promise<
  Record<
    AiEngineId,
    { available: boolean; enabled: boolean; baseUrl: string | null; model: string | null }
  >
> {
  const cfg = config ?? (await loadEnginesConfig());
  const out = {} as Record<
    AiEngineId,
    { available: boolean; enabled: boolean; baseUrl: string | null; model: string | null }
  >;
  for (const id of ["local", "ollama_cloud", "other_cloud"] as AiEngineId[]) {
    const resolved = await resolveEngine(id, cfg, { ignoreDisabled: true });
    const enabled = cfg.engines[id].enabled !== false;
    out[id] = {
      available: Boolean(resolved) && enabled,
      enabled,
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
    kind: "custom" as const,
  };
}

export function buildEngineProvider(endpoint: {
  auth: "bearer";
  baseUrl: string;
  apiKey: string;
}): Provider {
  return createOpenAICompatible({
    name: "custom-ai",
    baseURL: endpoint.baseUrl,
    headers: { Authorization: `Bearer ${endpoint.apiKey}` },
  });
}

export function buildLocalProvider(endpoint: { baseUrl: string; apiKey: string }): Provider {
  return buildEngineProvider({ ...endpoint, auth: "bearer" });
}

export function buildHostedProvider(endpoint: {
  kind: "custom";
  baseUrl: string;
  apiKey: string;
}): Provider {
  return buildEngineProvider({
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    auth: "bearer",
  });
}
