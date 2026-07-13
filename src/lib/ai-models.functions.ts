// Server functions for the self-host settings AI model picker.
// - listAiModels: queries the configured CUSTOM_AI_BASE_URL for available
//   models (Ollama /api/tags; falls back to OpenAI-style /models).
// - getCurrentAiModel: returns the effective CUSTOM_AI_MODEL, resolved
//   through the vault-first getServerEnv path so runtime overrides win.
// - setAiModel: persists CUSTOM_AI_MODEL as a shared vault_secrets row
//   keyed by env_key, then busts the server-env cache so the next AI call
//   picks it up without a redeploy.
// - pullAiModel: asks a bundled Ollama instance to download a model
//   (no-op / error for non-Ollama endpoints).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MODEL_ENV_KEY = "CUSTOM_AI_MODEL";

// Strip a trailing `/v1` (or `/v1/`) from an OpenAI-compatible base URL to
// reach the provider's native root (needed for Ollama's /api/tags path).
function nativeRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

export interface AiModelInfo {
  id: string;
  /** Bytes on disk when reported by the provider (Ollama). */
  size?: number | null;
  /** Free-form provider label (e.g. Ollama quantization). */
  detail?: string | null;
}

export interface AiModelPickerState {
  /** Provider base URL currently in effect, or null if unconfigured. */
  baseUrl: string | null;
  /** Effective model id (vault override wins over env). */
  currentModel: string | null;
  /** True when the provider looks like Ollama (base URL contains :11434 or /ollama). */
  isOllama: boolean;
  /** Discovered models. Empty array = the provider is reachable but returned none. */
  models: AiModelInfo[];
  /** Non-fatal reason models could not be listed (network error, non-JSON, etc.). */
  error: string | null;
}

async function requireAdmin(supabase: {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
}, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export const getAiModelPickerState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<AiModelPickerState> => {
    const baseUrl = process.env.CUSTOM_AI_BASE_URL || null;
    const { getServerEnv } = await import("./server-env.server");
    const currentModel = (await getServerEnv(MODEL_ENV_KEY)) || null;
    const isOllama = Boolean(
      baseUrl && (/:11434(\/|$)/.test(baseUrl) || /\/ollama(\/|$)/i.test(baseUrl)),
    );

    if (!baseUrl) {
      return { baseUrl: null, currentModel, isOllama: false, models: [], error: null };
    }

    // Try Ollama's native /api/tags first (returns richer metadata). Fall
    // back to the OpenAI-compatible /models list on any failure.
    try {
      const res = await fetch(`${nativeRoot(baseUrl)}/api/tags`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          models?: { name?: string; size?: number; details?: { quantization_level?: string } }[];
        };
        const models: AiModelInfo[] = (body.models ?? [])
          .filter((m) => typeof m.name === "string" && m.name)
          .map((m) => ({
            id: m.name as string,
            size: typeof m.size === "number" ? m.size : null,
            detail: m.details?.quantization_level ?? null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return { baseUrl, currentModel, isOllama: true, models, error: null };
      }
    } catch {
      /* fall through to OpenAI-style */
    }

    try {
      const apiKey = process.env.CUSTOM_AI_API_KEY || "";
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return {
          baseUrl,
          currentModel,
          isOllama,
          models: [],
          error: `Provider returned HTTP ${res.status} for /models`,
        };
      }
      const body = (await res.json()) as { data?: { id?: string }[] };
      const models: AiModelInfo[] = (body.data ?? [])
        .filter((m) => typeof m.id === "string" && m.id)
        .map((m) => ({ id: m.id as string, size: null, detail: null }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return { baseUrl, currentModel, isOllama, models, error: null };
    } catch (e) {
      return {
        baseUrl,
        currentModel,
        isOllama,
        models: [],
        error: (e as Error).message,
      };
    }
  });

const SetModelInput = z.object({
  model: z.string().trim().min(1).max(200),
});

export const setAiModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SetModelInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase as never, context.userId);

    const { seal } = await import("./vault-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sealed = await seal(data.model);

    // Upsert-by-env-key: find any existing shared row with this env_key.
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
        created_by: context.userId,
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
    return { ok: true as const, model: data.model };
  });

const PullModelInput = z.object({
  model: z.string().trim().min(1).max(200),
});

export const pullAiModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PullModelInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase as never, context.userId);

    const baseUrl = process.env.CUSTOM_AI_BASE_URL;
    if (!baseUrl) throw new Error("CUSTOM_AI_BASE_URL is not configured");
    const isOllama = /:11434(\/|$)/.test(baseUrl) || /\/ollama(\/|$)/i.test(baseUrl);
    if (!isOllama) {
      throw new Error(
        "Model pull is only supported for bundled Ollama endpoints. " +
          "For OpenAI/OpenRouter/etc, the model is pulled by the provider on first use.",
      );
    }

    // Ollama /api/pull streams NDJSON progress; we buffer it and wait for
    // completion. `stream: false` returns a single JSON object instead.
    const res = await fetch(`${nativeRoot(baseUrl)}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: data.model, stream: false }),
      // Model pulls can be large; give it 10 minutes.
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama /api/pull failed [${res.status}]: ${text.slice(0, 500)}`);
    }
    const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (body.error) throw new Error(body.error);
    return { ok: true as const, model: data.model, status: body.status ?? "success" };
  });
