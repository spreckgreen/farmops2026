// Three runtime AI engines that every AI feature area can pick from:
//
//   local        — self-hosted OpenAI-compatible endpoint (bundled Ollama)
//   ollama_cloud — Ollama Cloud (hosted Ollama models, OpenAI-compatible API)
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

export type AiEngineId = "local" | "ollama_cloud" | "other_cloud";

/** Legacy alias kept so older stored blobs / call sites still typecheck. */
export type HostedProviderKind = "custom";

export interface AiEngineDef {
  id: AiEngineId;
  label: string;
  description: string;
  /** "local" runs on your own hardware; "cloud" leaves the property. */
  placement: "local" | "cloud";
  /** How the API key is sent. */
  auth: "bearer";
  defaultBaseUrl: string | null;
  defaultModel: string | null;
  /** Whether an API key must be supplied for this engine to work. */
  apiKeyRequirement: "required" | "optional" | "not-needed";
  /** Plain-language reason the key is or isn't needed. */
  apiKeyReason: string;
  /** Where to get the key (omitted when no key is needed). */
  apiKeyWhere: string | null;
  /** Whether the base URL must be typed, or the default is fine. */
  baseUrlRequirement: "required" | "optional";
  /** Plain-language note about the base URL default. */
  baseUrlReason: string;
  /** Whether the model name must be typed. */
  modelRequirement: "required" | "optional";
  modelReason: string;
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
    apiKeyRequirement: "not-needed",
    apiKeyReason:
      "Local Ollama has no accounts and no billing, so it accepts any token. Bostead sends the placeholder \"ollama\" for you — leave this blank.",
    apiKeyWhere: null,
    baseUrlRequirement: "optional",
    baseUrlReason:
      "Pre-filled with the bundled Ollama container address. Change it only if Ollama runs on another host or port (e.g. http://192.168.1.20:11434/v1).",
    modelRequirement: "optional",
    modelReason:
      "Any tag you have pulled locally, e.g. llama3.2:3b or qwen2.5:7b. Leave as-is to use the bundled default.",
  },
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    description: "Ollama's hosted models — same tags as local Ollama, bigger hardware.",
    placement: "cloud",
    auth: "bearer",
    defaultBaseUrl: OLLAMA_CLOUD_BASE_URL,
    defaultModel: OLLAMA_CLOUD_DEFAULT_MODEL,
    apiKeyRequirement: "required",
    apiKeyReason:
      "Ollama Cloud bills your account, so every request must be signed with your own key. These are not OpenAI sk-… keys.",
    apiKeyWhere: "ollama.com → Settings → Keys → Create key",
    baseUrlRequirement: "optional",
    baseUrlReason:
      "Pre-filled with Ollama Cloud's endpoint (https://ollama.com/v1). Leave it unless Ollama publishes a new host.",
    modelRequirement: "optional",
    modelReason:
      "Pre-filled with gpt-oss:120b. Any Ollama Cloud tag works, e.g. deepseek-v3.1:671b.",
  },
  {
    id: "other_cloud",
    label: "Other cloud",
    description: "Any other OpenAI-compatible cloud provider (OpenAI, OpenRouter, Groq…).",
    placement: "cloud",
    auth: "bearer",
    defaultBaseUrl: OPENAI_BASE_URL,
    defaultModel: null,
    apiKeyRequirement: "required",
    apiKeyReason:
      "Your provider bills per request and rejects anonymous calls, so a key is mandatory (OpenAI sk-…, OpenRouter sk-or-…, Groq gsk_…).",
    apiKeyWhere: "your provider's dashboard → API keys",
    baseUrlRequirement: "optional",
    baseUrlReason:
      "Pre-filled with OpenAI (https://api.openai.com/v1). Replace it for another provider, e.g. https://openrouter.ai/api/v1 or https://api.groq.com/openai/v1.",
    modelRequirement: "required",
    modelReason:
      "There is no safe default here — type the exact model id your provider expects, e.g. gpt-4.1-mini or meta-llama/llama-3.3-70b-instruct.",
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
  /**
   * Turned off engines keep every saved value but are skipped by all routing
   * and reported as "off" instead of "ready". Connection tests still run, so an
   * operator can verify credentials before switching an engine back on.
   */
  enabled: boolean;
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
  enabled: boolean;
}

export interface AiEnginesView {
  engines: Record<AiEngineId, AiEngineTargetView>;
  cloudDefault: AiEngineId;
}

const EMPTY_TARGET: AiEngineTarget = {
  baseUrl: null,
  apiKey: null,
  model: null,
  enabled: true,
};

function emptyEngines(): Record<AiEngineId, AiEngineTarget> {
  return {
    local: { ...EMPTY_TARGET },
    ollama_cloud: { ...EMPTY_TARGET },
    other_cloud: { ...EMPTY_TARGET },
  };
}

export function defaultEnginesConfig(): AiEnginesConfig {
  return { engines: emptyEngines(), cloudDefault: "other_cloud" };
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
    // Older blobs have no flag — treat them as on.
    enabled: obj.enabled !== false,
  };
}

/**
 * Parse the stored blob. Existing four-engine configs that selected Lovable
 * migrate to `other_cloud`; legacy custom-hosted settings migrate there too.
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
      cloudDefault: isAiEngineId(obj.cloudDefault) ? obj.cloudDefault : "other_cloud",
    };
  }

  // Legacy shape → migrate.
  engines.local = parseTarget(obj.local);
  const hosted = (obj.hosted ?? {}) as Record<string, unknown>;
  engines.other_cloud = parseTarget(hosted.custom);
  return {
    engines,
    cloudDefault: "other_cloud",
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
    enabled: t.enabled,
  });
  return {
    engines: {
      local: view(config.engines.local),
      ollama_cloud: view(config.engines.ollama_cloud),
      other_cloud: view(config.engines.other_cloud),
    },
    cloudDefault: config.cloudDefault,
  };
}

/**
 * True when an engine is missing something it needs to run.
 */
/** Is this engine switched on? Saved-but-off engines return false. */
export function isEngineEnabled(config: AiEnginesConfig, id: AiEngineId): boolean {
  return config.engines[id].enabled !== false;
}

export function engineIncomplete(
  config: AiEnginesConfig,
  id: AiEngineId,
): boolean {
  const def = getAiEngineDef(id);
  const target = config.engines[id];
  const baseUrl = target.baseUrl ?? def.defaultBaseUrl;
  if (!baseUrl) return true;
  if (def.placement === "cloud" && !target.apiKey) {
    // A key is required for every cloud engine; local Ollama accepts a dummy key.
    return true;
  }
  return !(target.model ?? def.defaultModel);
}

/** Legacy helper: is the selected cloud-default engine unusable as configured? */
export function hostedCustomIncomplete(config: AiEnginesConfig): boolean {
  return engineIncomplete(config, config.cloudDefault);
}
