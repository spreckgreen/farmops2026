// Server-only helpers behind the model picker's one-click remediation actions.
//
// Why a derived model: Ollama's OpenAI-compatible /v1/chat/completions endpoint
// ignores `num_ctx`, so the only way to make a bigger context window stick for
// every AI call in the app is to bake it into the model itself with
// `/api/create` (FROM <base> + PARAMETER num_ctx <n>). We then persist that
// derived tag as the active CUSTOM_AI_MODEL.
import { derivedContextModelId } from "./ai-model-suitability";

const BUNDLED_OLLAMA_BASE_URL = "http://ollama:11434/v1";
const MODEL_ENV_KEY = "CUSTOM_AI_MODEL";

export function ollamaRoot(): string {
  const baseUrl = process.env.CUSTOM_AI_BASE_URL || BUNDLED_OLLAMA_BASE_URL;
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

export function isOllamaEndpoint(): boolean {
  const baseUrl = process.env.CUSTOM_AI_BASE_URL || BUNDLED_OLLAMA_BASE_URL;
  return /:11434(\/|$)/.test(baseUrl) || /\/ollama(\/|$)/i.test(baseUrl);
}

/** Persist CUSTOM_AI_MODEL to the shared vault row and bust the env cache. */
export async function persistActiveModel(model: string, userId: string) {
  const { seal } = await import("./vault-crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sealed = await seal(model);

  const { data: existing } = await supabaseAdmin
    .from("vault_secrets")
    .select("id")
    .eq("scope", "shared")
    .eq("env_key", MODEL_ENV_KEY)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("vault_secrets")
      .update({
        value_ciphertext: sealed.ciphertext,
        value_iv: sealed.iv,
        value_tag: sealed.tag,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from("vault_secrets").insert({
      scope: "shared",
      owner_user_id: null,
      created_by: userId,
      title: "AI model (CUSTOM_AI_MODEL)",
      value_ciphertext: sealed.ciphertext,
      value_iv: sealed.iv,
      value_tag: sealed.tag,
      env_key: MODEL_ENV_KEY,
    });
    if (error) throw new Error(error.message);
  }

  const { invalidateServerEnv } = await import("./server-env.server");
  invalidateServerEnv(MODEL_ENV_KEY);
}

/** True when Ollama already has this exact tag locally. */
export async function ollamaHasModel(tag: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaRoot()}/api/tags`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).some((m) => m.name === tag);
  } catch {
    return false;
  }
}

/**
 * Create (or refresh) a derived model with the requested num_ctx.
 * e.g. base "llama3.2:3b" + 32768 -> "llama3.2-3b-ctx32k"
 * Tries the modern /api/create body first ({model, from, parameters}), then
 * falls back to the legacy Modelfile form for older Ollama builds.
 */
export async function createDerivedContextModel(
  baseModel: string,
  numCtx: number,
): Promise<string> {
  const target = derivedContextModelId(baseModel, numCtx);
  const root = ollamaRoot();

  const attempt = async (body: unknown) => {
    const res = await fetch(`${root}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    // /api/create streams NDJSON even with stream:false on some builds;
    // surface only an explicit error field.
    const errLine = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { error?: string };
        } catch {
          return {};
        }
      })
      .find((o) => o.error);
    if (errLine?.error) throw new Error(errLine.error);
  };

  try {
    await attempt({
      model: target,
      from: baseModel,
      parameters: { num_ctx: numCtx },
      stream: false,
    });
  } catch (modernErr) {
    try {
      await attempt({
        name: target,
        modelfile: `FROM ${baseModel}\nPARAMETER num_ctx ${numCtx}\n`,
        stream: false,
      });
    } catch (legacyErr) {
      throw new Error(
        `Ollama /api/create failed. ${(modernErr as Error).message} | legacy form: ${(legacyErr as Error).message}`,
      );
    }
  }

  return target;
}
