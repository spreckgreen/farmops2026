// Two runtime AI engines: LOCAL (self-hosted / Ollama / any OpenAI-compatible
// endpoint) and HOSTED (Lovable AI Gateway by default, switchable to an
// alternative hosted provider such as OpenRouter or OpenAI).
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

export const LOVABLE_GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
/** Default hosted chat model on the Lovable AI Gateway. */
export const LOVABLE_DEFAULT_MODEL = "openai/gpt-5.6-sol";

export type HostedProviderKind = "lovable" | "custom";

/** One engine endpoint. `null` means "fall back to env / built-in default". */
export interface AiEngineTarget {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

export interface AiEnginesConfig {
  /** Self-hosted engine — used by every area routed to "local". */
  local: AiEngineTarget;
  hosted: {
    /** "lovable" = Lovable AI Gateway (default); "custom" = alternative provider. */
    provider: HostedProviderKind;
    /** Model used when provider is "lovable" (per-area overrides still win). */
    lovableModel: string | null;
    /** Alternative hosted provider, used when provider is "custom". */
    custom: AiEngineTarget;
  };
}

/** Client-safe view: secrets replaced with a boolean. */
export interface AiEngineTargetView {
  baseUrl: string | null;
  hasApiKey: boolean;
  model: string | null;
}

export interface AiEnginesView {
  local: AiEngineTargetView;
  hosted: {
    provider: HostedProviderKind;
    lovableModel: string | null;
    custom: AiEngineTargetView;
  };
}

const EMPTY_TARGET: AiEngineTarget = { baseUrl: null, apiKey: null, model: null };

export const DEFAULT_ENGINES: AiEnginesConfig = {
  local: { ...EMPTY_TARGET },
  hosted: {
    provider: "lovable",
    lovableModel: null,
    custom: { ...EMPTY_TARGET },
  },
};

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
  const hostedRaw = (obj.hosted ?? {}) as Record<string, unknown>;
  return {
    local: parseTarget(obj.local),
    hosted: {
      provider: hostedRaw.provider === "custom" ? "custom" : "lovable",
      lovableModel: str(hostedRaw.lovableModel),
      custom: parseTarget(hostedRaw.custom),
    },
  };
}

export function serializeEnginesConfig(config: AiEnginesConfig): string {
  return JSON.stringify(config);
}

export function resolveEnginesConfig(raw: string | null | undefined): AiEnginesConfig {
  return parseEnginesConfig(raw) ?? { ...DEFAULT_ENGINES, hosted: { ...DEFAULT_ENGINES.hosted } };
}

export function toEngineView(config: AiEnginesConfig): AiEnginesView {
  const view = (t: AiEngineTarget): AiEngineTargetView => ({
    baseUrl: t.baseUrl,
    hasApiKey: Boolean(t.apiKey),
    model: t.model,
  });
  return {
    local: view(config.local),
    hosted: {
      provider: config.hosted.provider,
      lovableModel: config.hosted.lovableModel,
      custom: view(config.hosted.custom),
    },
  };
}

/**
 * Reset the hosted engine back to the Lovable AI Gateway, dropping any
 * alternative-provider overrides. Local engine is untouched.
 */
export function switchHostedToLovable(config: AiEnginesConfig): AiEnginesConfig {
  return {
    local: { ...config.local },
    hosted: {
      provider: "lovable",
      lovableModel: null,
      custom: { ...EMPTY_TARGET },
    },
  };
}

/** True when a "custom" hosted engine is missing what it needs to run. */
export function hostedCustomIncomplete(config: AiEnginesConfig): boolean {
  if (config.hosted.provider !== "custom") return false;
  const { baseUrl, apiKey, model } = config.hosted.custom;
  return !baseUrl || !apiKey || !model;
}
