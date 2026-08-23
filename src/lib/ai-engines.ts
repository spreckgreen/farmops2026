// Four runtime AI engines that every AI feature area can pick from:
//
//   local        — self-hosted OpenAI-compatible endpoint (bundled Ollama)
//   ollama_cloud — Ollama Cloud (hosted Ollama models, OpenAI-compatible API)
//   lovable      — Lovable AI Gateway (default cloud engine, key from env)
//   other_cloud  — any other cloud provider (OpenAI, OpenRouter, Groq, …)
//
// Pure + dependency-free: the server resolves providers from this in
// ai-engines.server.ts, and the admin UI edits the same shape.
//
// The whole config is stored as one JSON blob in the shared vault under
// env_key AI_ENGINE_CONFIG, so it changes at runtime with no redeploy.

export const ENGINE_ENV_KEY = "AI_ENGINE_CONFIG";

export const BUNDLED_OLLAMA_BASE_URL = "http://ollama:11434/v1";
export const BUNDLED_OLLAMA_API_KEY = "ollama";
export const BUNDLED_OLLAMA_MODEL = "llama3.2:3b";

export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";
export const OLLAMA_CLOUD_DEFAULT_MODEL = "gpt-oss:120b";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const LOVABLE_GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
/** Default hosted chat model on the Lovable AI Gateway. */
export const LOVABLE_DEFAULT_MODEL = "openai/gpt-5.6-sol";

export type AiEngineId = "local" | "ollama_cloud" | "lovable" | "other_cloud";

/** Legacy alias kept so older stored blobs / call sites still typecheck. */
export type HostedProviderKind = "lovable" | "custom";

export interface AiEngineDef {
  id: AiEngineId;
  label: string;
  description: string;
  /** "local" runs on your own hardware; "cloud" leaves the property. */
  placement: "local" | "cloud";
  /** How the API key is sent. */
  auth: "bearer" | "lovable-header";
  defaultBaseUrl: string | null;
  defaultModel: string | null;
  /** Key comes from LOVABLE_API_KEY on the server, not from this config. */
  keyFromEnv: boolean;
}

export const AI_ENGINE_DEFS: readonly AiEngineDef[] = [
  {
    id: "local",
    label: "Self-hosted (local)",
    description: "Ollama or any OpenAI-compatible endpoint running on your own hardware.",
    placement: "local",
    auth: "bearer",
    defaultBaseUrl: BUNDLED_OLLAMA_BASE_URL,
    defaultModel: BUNDLED_OLLAMA_MODEL,
    keyFromEnv: false,
  },
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    description: "Ollama's hosted models — same tags as local Ollama, bigger hardware.",
    placement: "cloud",
    auth: "bearer",
    defaultBaseUrl: OLLAMA_CLOUD_BASE_URL,
    defaultModel: OLLAMA_CLOUD_DEFAULT_MODEL,
    keyFromEnv: false,
  },
  {
    id: "lovable",
    label: "Lovable AI",
    description: "Lovable AI Gateway — no key to manage, billed from workspace credits.",
    placement: "cloud",
    auth: "lovable-header",
    defaultBaseUrl: LOVABLE_GATEWAY_BASE_URL,
    defaultModel: LOVABLE_DEFAULT_MODEL,
    keyFromEnv: true,
  },
  {
    id: "other_cloud",
    label: "Other cloud",
    description: "Any other OpenAI-compatible cloud provider (OpenAI, OpenRouter, Groq…).",
    placement: "cloud",
    auth: "bearer",
    defaultBaseUrl: OPENAI_BASE_URL,
    defaultModel: null,
    keyFromEnv: false,
  },
] as const;

export const AI_ENGINE_IDS = AI_ENGINE_DEFS.map((e) => e.id) as [AiEngineId, ...AiEngineId[]];

export function isAiEngineId(value: unknown): value is AiEngineId {
  return typeof value === "string" && AI_ENGINE_IDS.includes(value as AiEngineId);
}

export function getAiEngineDef(id: AiEngineId): AiEngineDef {
  const found = AI_ENGINE_DEFS.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown AI engine: ${id}`);
  return found;
}

/** One engine endpoint. `null` means "fall back to env / built-in default". */
export interface AiEngineTarget {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

export interface AiEnginesConfig {
  engines: Record<AiEngineId, AiEngineTarget>;
  /** Engine used by areas set to the cloud default (legacy "hosted"). */
  cloudDefault: AiEngineId;
}

/** Client-safe view: secrets replaced with a boolean. */
export interface AiEngineTargetView {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string | null;
}

export interface AiEnginesView {
  engines: Record<AiEngineId, AiEngineTargetView>;
  cloudDefault: AiEngineId;
}

const EMPTY_TARGET: AiEngineTarget = { baseUrl: null, apiKey: null, model: null };

function emptyEngines(): Record<AiEngineId, AiEngineTarget> {
  return {
    local: { ...EMPTY_TARGET },
    ollama_cloud: { ...EMPTY_TARGET },
    lovable: { ...EMPTY_TARGET },
    other_cloud: { ...EMPTY_TARGET },
  };
}

export function defaultEnginesConfig(): AiEnginesConfig {
  return { engines: emptyEngines(), cloudDefault: "lovable" };
}

export const DEFAULT_ENGINES: AiEnginesConfig = defaultEnginesConfig();

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTarget(value: unknown): AiEngineTarget {
  if (!value || typeof value !== "object") return { ...EMPTY_TARGET };
  const obj = value as Record<string, unknown>;
  return {
    baseUrl: str(obj.baseUrl),
    apiKey: str(obj.apiKey),
    model: str(obj.model),
  };
}

/**
 * Parse the stored blob. Understands both the current 4-engine shape and the
 * older { local, hosted: { provider, lovableModel, custom } } shape, which is
 * migrated: a "custom" hosted provider becomes the `other_cloud` engine.
 */
export function parseEnginesConfig(raw: string | null | undefined): AiEnginesConfig | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const engines = emptyEngines();

  // Current shape.
  if (obj.engines && typeof obj.engines === "object") {
    const raw2 = obj.engines as Record<string, unknown>;
    for (const id of AI_ENGINE_IDS) engines[id] = parseTarget(raw2[id]);
    return {
      engines,
      cloudDefault: isAiEngineId(obj.cloudDefault) ? obj.cloudDefault : "lovable",
    };
  }

  // Legacy shape → migrate.
  engines.local = parseTarget(obj.local);
  const hosted = (obj.hosted ?? {}) as Record<string, unknown>;
  engines.lovable = { baseUrl: null, apiKey: null, model: str(hosted.lovableModel) };
  engines.other_cloud = parseTarget(hosted.custom);
  return {
    engines,
    cloudDefault: hosted.provider === "custom" ? "other_cloud" : "lovable",
  };
}

export function serializeEnginesConfig(config: AiEnginesConfig): string {
  return JSON.stringify({ engines: config.engines, cloudDefault: config.cloudDefault });
}

export function resolveEnginesConfig(raw: string | null | undefined): AiEnginesConfig {
  return parseEnginesConfig(raw) ?? defaultEnginesConfig();
}

export function toEngineView(config: AiEnginesConfig): AiEnginesView {
  const view = (t: AiEngineTarget): AiEngineTargetView => ({
    baseUrl: t.baseUrl,
    hasApiKey: Boolean(t.apiKey),
    model: t.model,
  });
  return {
    engines: {
      local: view(config.engines.local),
      ollama_cloud: view(config.engines.ollama_cloud),
      lovable: view(config.engines.lovable),
      other_cloud: view(config.engines.other_cloud),
    },
    cloudDefault: config.cloudDefault,
  };
}

/**
 * Reset the cloud default back to Lovable AI, dropping the other-cloud
 * overrides. Local and Ollama Cloud engines are untouched.
 */
export function switchHostedToLovable(config: AiEnginesConfig): AiEnginesConfig {
  return {
    engines: {
      ...config.engines,
      lovable: { baseUrl: null, apiKey: null, model: null },
      other_cloud: { ...EMPTY_TARGET },
    },
    cloudDefault: "lovable",
  };
}

/** True when an engine is missing something it needs to run. */
export function engineIncomplete(config: AiEnginesConfig, id: AiEngineId): boolean {
  const def = getAiEngineDef(id);
  const target = config.engines[id];
  if (def.keyFromEnv) return false; // key comes from the server env
  const baseUrl = target.baseUrl ?? def.defaultBaseUrl;
  if (!baseUrl) return true;
  // A key is required for every cloud engine; local Ollama accepts a dummy key.
  if (def.placement === "cloud" && !target.apiKey) return true;
  return !(target.model ?? def.defaultModel);
}

/** Legacy helper: is the selected cloud-default engine unusable as configured? */
export function hostedCustomIncomplete(config: AiEnginesConfig): boolean {
  return config.cloudDefault !== "lovable" && engineIncomplete(config, config.cloudDefault);
}
