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

/** Persist a shared vault row keyed by env_key and bust the env cache. */
async function persistSharedEnv(envKey: string, value: string, title: string, userId: string) {
  const { seal } = await import("./vault-crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sealed = await seal(value);

  const { data: existing } = await supabaseAdmin
    .from("vault_secrets")
    .select("id")
    .eq("scope", "shared")
    .eq("env_key", envKey)
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
      title,
      value_ciphertext: sealed.ciphertext,
      value_iv: sealed.iv,
      value_tag: sealed.tag,
      env_key: envKey,
    });
    if (error) throw new Error(error.message);
  }

  const { invalidateServerEnv } = await import("./server-env.server");
  invalidateServerEnv(envKey);
}

/** Persist CUSTOM_AI_MODEL to the shared vault row and bust the env cache. */
export async function persistActiveModel(model: string, userId: string) {
  await persistSharedEnv(MODEL_ENV_KEY, model, "AI model (CUSTOM_AI_MODEL)", userId);
}

/** Currently effective model (vault override first, then env). */
export async function currentActiveModel(): Promise<string | null> {
  const { getServerEnv } = await import("./server-env.server");
  return (await getServerEnv(MODEL_ENV_KEY)) || process.env[MODEL_ENV_KEY] || null;
}

/**
 * Save a rollback point before/while changing the active model, so the picker
 * can offer a one-click undo (restore previous model, optionally delete the
 * derived/pulled tag we created).
 */
export async function recordRollbackPoint(
  point: Omit<ModelRollbackPoint, "changedAt"> & { changedAt?: string },
  userId: string,
) {
  const full: ModelRollbackPoint = {
    changedAt: point.changedAt ?? new Date().toISOString(),
    previousModel: point.previousModel,
    appliedModel: point.appliedModel,
    kind: point.kind,
    createdTag: point.createdTag,
  };
  await persistSharedEnv(
    ROLLBACK_ENV_KEY,
    serializeRollbackPoint(full),
    "AI model rollback point",
    userId,
  );
  return full;
}

export async function readRollbackPoint(): Promise<ModelRollbackPoint | null> {
  const { getServerEnv } = await import("./server-env.server");
  return parseRollbackPoint(await getServerEnv(ROLLBACK_ENV_KEY));
}

/** Drop the rollback point once it has been consumed. */
export async function clearRollbackPoint() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("vault_secrets")
    .delete()
    .eq("scope", "shared")
    .eq("env_key", ROLLBACK_ENV_KEY);
  if (error) throw new Error(error.message);
  const { invalidateServerEnv } = await import("./server-env.server");
  invalidateServerEnv(ROLLBACK_ENV_KEY);
}

/** Best-effort removal of a tag we created (derived or freshly pulled). */
export async function deleteOllamaModel(tag: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaRoot()}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: tag, model: tag }),
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
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
