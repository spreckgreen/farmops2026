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
import {
  EMPTY_CAPABILITY,
  OLLAMA_DEFAULT_NUM_CTX,
  parseOllamaShow,
  type OllamaCapability,
  type OllamaShowResponse,
} from "@/lib/ollama-capability";
import { z } from "zod";


const MODEL_ENV_KEY = "CUSTOM_AI_MODEL";

// Bundled self-hosted defaults — MUST match src/lib/ai-gateway.server.ts and
// the `ollama` service in docker-compose.yml. Duplicated (not imported) so the
// picker doesn't drag the AI-SDK provider factory into its module graph.
const BUNDLED_OLLAMA_BASE_URL = "http://ollama:11434/v1";
const BUNDLED_OLLAMA_MODEL = "llama3.2:3b";

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
  /** Effective request context in tokens (num_ctx, or runtime-clamped). */
  contextLength?: number | null;
  /** Context the weights were trained with (often far above the effective). */
  trainedContextLength?: number | null;
  /** Baked-in num_ctx from the Modelfile, when present. */
  numCtx?: number | null;
  /** Baked-in num_predict (max output tokens), when present. */
  numPredict?: number | null;
  /** Where contextLength came from: num_ctx | runtime-default | trained. */
  contextSource?: OllamaCapability["contextSource"];
  /** Parameter count in billions. */
  paramsB?: number | null;
  /** "count" = exact from provider, "label" = rounded label, "tag" = inferred. */
  paramsSource?: "count" | "label" | "tag" | null;
  /** Provider capabilities, e.g. ["completion","tools","vision"]. */
  capabilities?: string[];
}

// Ask Ollama's /api/show for real capability numbers instead of guessing from
// the tag. Best-effort: any failure leaves the fields null (UI shows
// "Unverified"). Older Ollama builds want {name}, newer ones {model} — send
// both keys so one request covers every version.
async function fetchOllamaCapability(root: string, name: string): Promise<OllamaCapability> {
  try {
    const res = await fetch(`${root}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, model: name, verbose: false }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return EMPTY_CAPABILITY;
    const body = (await res.json()) as OllamaShowResponse;
    return parseOllamaShow(body, ollamaRuntimeDefaultNumCtx());
  } catch {
    return EMPTY_CAPABILITY;
  }
}

// Ollama clamps requests to OLLAMA_CONTEXT_LENGTH (default 4096) unless the
// model bakes in num_ctx. Self-hosters who raised it can tell us here.
function ollamaRuntimeDefaultNumCtx(): number {
  const raw = process.env["OLLAMA_CONTEXT_LENGTH"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : OLLAMA_DEFAULT_NUM_CTX;
}



export interface AiModelPickerState {
  /** Provider base URL currently in effect. Falls back to the bundled self-hosted Ollama endpoint when nothing is configured. */
  baseUrl: string | null;
  /** Effective model id (vault override wins over env, then bundled default). */
  currentModel: string | null;
  /** True when the provider looks like Ollama (base URL contains :11434 or /ollama). */
  isOllama: boolean;
  /** True when we fell back to the bundled self-hosted Ollama defaults (no CUSTOM_AI_BASE_URL set). */
  isBundledDefault: boolean;
  /** The self-hosted default model the UI should pre-select if nothing else is chosen. */
  defaultModel: string;
  /** Discovered models. Empty array = the provider is reachable but returned none. */
  models: AiModelInfo[];
  /** Non-fatal reason models could not be listed (network error, non-JSON, etc.). */
  error: string | null;
}

// Verify the caller has the `admin` role by reading `user_roles` directly
// under RLS. Do NOT call the `has_role()` RPC here — it lives in the
// `private` schema (moved there by the security hardening pass) and is
// not exposed through PostgREST, so `supabase.rpc("has_role", ...)` fails
// with "Could not find the function public.has_role(...) in the schema cache".
async function requireAdmin(supabase: {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
}, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export const getAiModelPickerState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<AiModelPickerState> => {
    // Always default to the bundled self-hosted Ollama endpoint when the
    // operator hasn't set CUSTOM_AI_BASE_URL. This makes "self-hosted AI"
    // the out-of-the-box behavior — the picker still shows real models and
    // the effective model still resolves to a working default.
    const configuredBase = process.env.CUSTOM_AI_BASE_URL || null;
    const isBundledDefault = !configuredBase;
    const baseUrl = configuredBase ?? BUNDLED_OLLAMA_BASE_URL;
    const { getServerEnv } = await import("./server-env.server");
    const savedModel = (await getServerEnv(MODEL_ENV_KEY)) || null;
    const currentModel = savedModel ?? (isBundledDefault ? BUNDLED_OLLAMA_MODEL : null);
    const isOllama = /:11434(\/|$)/.test(baseUrl) || /\/ollama(\/|$)/i.test(baseUrl);
    const common = {
      currentModel,
      isBundledDefault,
      defaultModel: BUNDLED_OLLAMA_MODEL,
    } as const;

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
        const base: AiModelInfo[] = (body.models ?? [])
          .filter((m) => typeof m.name === "string" && m.name)
          .map((m) => ({
            id: m.name as string,
            size: typeof m.size === "number" ? m.size : null,
            detail: m.details?.quantization_level ?? null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        // Enrich with context length / parameter size. Capped at 16 models so
        // a large local library can't stall the settings page.
        const root = nativeRoot(baseUrl);
        const models: AiModelInfo[] = await Promise.all(
          base.map(async (m, i) => {
            if (i >= 16) return m;
            const cap = await fetchOllamaCapability(root, m.id);
            return {
              ...m,
              detail: m.detail ?? cap.quantization,
              contextLength: cap.contextLength,
              trainedContextLength: cap.trainedContextLength,
              numCtx: cap.numCtx,
              numPredict: cap.numPredict,
              contextSource: cap.contextSource,
              paramsB: cap.paramsB,
              paramsSource: cap.paramsSource,
              capabilities: cap.capabilities,
            } satisfies AiModelInfo;
          }),
        );
        return { ...common, baseUrl, isOllama: true, models, error: null };
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
          ...common,
          baseUrl,
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
      return { ...common, baseUrl, isOllama, models, error: null };
    } catch (e) {
      return {
        ...common,
        baseUrl,
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

// -----------------------------------------------------------------------------
// One-click remediation: bake a bigger num_ctx into a derived Ollama model and
// activate it, or pull + activate a larger suggested model. Both return the new
// active model id so the UI can immediately rerun the AI test.
// -----------------------------------------------------------------------------
const ApplyContextInput = z.object({
  baseModel: z.string().trim().min(1).max(200),
  numCtx: z.number().int().min(2048).max(1_000_000),
});

export const applyRecommendedContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyContextInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase as never, context.userId);
    const tuning = await import("./ai-model-tuning.server");
    if (!tuning.isOllamaEndpoint()) {
      throw new Error(
        "Setting num_ctx automatically is only supported for Ollama endpoints. " +
          "Hosted providers manage the context window themselves.",
      );
    }
    const derived = await tuning.createDerivedContextModel(data.baseModel, data.numCtx);
    await tuning.persistActiveModel(derived, context.userId);
    return { ok: true as const, model: derived, numCtx: data.numCtx };
  });

const SwitchModelInput = z.object({
  model: z.string().trim().min(1).max(200),
});

export const switchToSuggestedModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SwitchModelInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase as never, context.userId);
    const tuning = await import("./ai-model-tuning.server");

    let pulled = false;
    if (tuning.isOllamaEndpoint() && !(await tuning.ollamaHasModel(data.model))) {
      const res = await fetch(`${tuning.ollamaRoot()}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: data.model, stream: false }),
        signal: AbortSignal.timeout(20 * 60_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama /api/pull failed [${res.status}]: ${text.slice(0, 300)}`);
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error) throw new Error(body.error);
      pulled = true;
    }

    await tuning.persistActiveModel(data.model, context.userId);
    return { ok: true as const, model: data.model, pulled };
  });

// -----------------------------------------------------------------------------
// Run AI test — sends a workflow-representative prompt through the currently
// configured provider and reports which endpoint answered, how long it took,
// what came back, and whether the reply actually has the shape that workflow
// needs.
//
// There are three runs, each judged on its own (see ai-workflow-tests.ts):
//   - "smoke"          short probe: is the endpoint wired up at all
//   - "weekly_report"  a week of task lines in, structured rollup out
//   - "manual"         a full procedure with numbered steps out
//
// A model can pass the smoke test and still fail weekly_report because its
// effective context truncated the task list — which is exactly the "there was
// nothing for the week" failure this splits apart.
// -----------------------------------------------------------------------------
import type { AiWorkflowCheck, AiWorkflowKey } from "./ai-workflow-tests";
import type { TruncationSignal } from "./ai-truncation";
import type { SuitabilityLevel } from "./ai-model-suitability";

export interface AiTestResult {
  ok: boolean;
  /** Which workflow this run exercised. */
  workflow: AiWorkflowKey;
  workflowLabel: string;
  provider: "custom" | "lovable" | "bundled-ollama";
  baseUrl: string;
  model: string;
  latencyMs: number;
  httpStatus: number;
  reply: string | null;
  error: string | null;
  /** Per-workflow output checks. Empty when the request itself failed. */
  checks: AiWorkflowCheck[];
  /** True when every check passed — the workflow is usable on this model. */
  passed: boolean;
  /** Suitability level for this workflow, from the model's real capabilities. */
  suitability: SuitabilityLevel | null;
  suitabilityReasons: string[];
  suitabilityFix: string | null;
  /** Set when the reply looks cut off (output cap or context overflow). */
  truncation: TruncationSignal | null;
  contextLimit: number | null;
  ranAt: string;
}

const RunAiTestInput = z.object({
  workflow: z.enum(["smoke", "weekly_report", "manual"]).default("smoke"),
});

export const runAiTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunAiTestInput.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<AiTestResult> => {
    await requireAdmin(context.supabase as never, context.userId);

    const { getWorkflow, gradeWorkflow, workflowPromptChars } = await import(
      "./ai-workflow-tests"
    );
    const def = getWorkflow(data.workflow);

    const { getServerEnv } = await import("./server-env.server");
    const customBase = process.env.CUSTOM_AI_BASE_URL;
    const customKey = process.env.CUSTOM_AI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    const modelOverride = (await getServerEnv("CUSTOM_AI_MODEL")) || null;

    let provider: AiTestResult["provider"];
    let baseUrl: string;
    let authHeader: Record<string, string>;
    let model: string;

    if (customBase && customKey) {
      provider = "custom";
      baseUrl = customBase;
      authHeader = { Authorization: `Bearer ${customKey}` };
      model = modelOverride ?? "llama3.2:3b";
    } else if (lovableKey) {
      provider = "lovable";
      baseUrl = "https://ai.gateway.lovable.dev/v1";
      authHeader = { "Lovable-API-Key": lovableKey };
      model = modelOverride ?? "google/gemini-3-flash-preview";
    } else {
      provider = "bundled-ollama";
      baseUrl = "http://ollama:11434/v1";
      authHeader = { Authorization: "Bearer ollama" };
      model = modelOverride ?? "llama3.2:3b";
    }

    // Static verdict for THIS workflow only, from the model's real capabilities.
    let suitability: SuitabilityLevel | null = null;
    let suitabilityReasons: string[] = [];
    let suitabilityFix: string | null = null;
    let contextLimit: number | null = null;
    try {
      const { getActiveContextLimit } = await import("./ai-context-limit.server");
      const limit = await getActiveContextLimit(model);
      contextLimit = limit.contextLength;
      if (def.requirementKey) {
        const { TASK_REQUIREMENTS, evaluateTask } = await import("./ai-model-suitability");
        const req = TASK_REQUIREMENTS.find((t) => t.key === def.requirementKey);
        if (req) {
          const verdict = evaluateTask(
            {
              id: model,
              contextLength: limit.contextLength,
              trainedContextLength: limit.trainedContextLength,
              contextSource: limit.source === "ollama" ? "num_ctx" : null,
            },
            req,
          );
          suitability = verdict.level;
          suitabilityReasons = verdict.reasons;
          suitabilityFix = verdict.fix;
        }
      }
    } catch (e) {
      console.error("[ai-test] capability lookup failed", e);
    }

    const ranAt = new Date().toISOString();
    const base = {
      workflow: def.key,
      workflowLabel: def.label,
      provider,
      baseUrl,
      model,
      suitability,
      suitabilityReasons,
      suitabilityFix,
      contextLimit,
      ranAt,
    };

    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const started = Date.now();
    let httpStatus = 0;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: def.system },
            { role: "user", content: def.user },
          ],
          max_tokens: def.maxTokens,
          temperature: 0,
          stream: false,
        }),
        // Long-form manual generation on a local model can take minutes.
        signal: AbortSignal.timeout(def.key === "smoke" ? 30_000 : 8 * 60_000),
      });
      httpStatus = res.status;
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ...base,
          ok: false,
          latencyMs,
          httpStatus,
          reply: null,
          error: text.slice(0, 500) || `HTTP ${res.status}`,
          checks: [],
          passed: false,
          truncation: null,
        };
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const reply = body.choices?.[0]?.message?.content?.trim() ?? "";
      const { checks, passed } = gradeWorkflow(def.key, reply);

      const { truncationOrNull } = await import("./ai-truncation");
      const truncation = truncationOrNull({
        finishReason: body.choices?.[0]?.finish_reason ?? null,
        usage: {
          promptTokens: body.usage?.prompt_tokens ?? null,
          completionTokens: body.usage?.completion_tokens ?? null,
          totalTokens: body.usage?.total_tokens ?? null,
        },
        promptChars: workflowPromptChars(def),
        outputText: reply,
        contextLimit,
        model,
      });

      return {
        ...base,
        ok: true,
        latencyMs,
        httpStatus,
        // Manuals are long; keep enough to eyeball the shape.
        reply: reply.slice(0, 4000),
        error: null,
        checks,
        passed,
        truncation,
      };
    } catch (e) {
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - started,
        httpStatus,
        reply: null,
        error: (e as Error).message,
        checks: [],
        passed: false,
        truncation: null,
      };
    }
  });


