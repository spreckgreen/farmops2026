// Server functions behind the Admin → AI engines page.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  AI_ENGINE_DEFS,
  AI_ENGINE_IDS,
  type AiEngineId,
  type AiEngineTarget,
  type AiEnginesConfig,
} from "@/lib/ai-engines";

const TargetInput = z.object({
  baseUrl: z.string().trim().max(500).nullable(),
  /** null = leave the stored key untouched; "" = clear it. */
  apiKey: z.string().max(500).nullable(),
  model: z.string().trim().max(200).nullable(),
  /** Off keeps every stored value but removes the engine from all routing. */
  enabled: z.boolean().optional(),
});

const EnginesInput = z.object({
  engines: z.record(z.enum(AI_ENGINE_IDS), TargetInput),
  cloudDefault: z.enum(AI_ENGINE_IDS),
});

type TargetIn = z.infer<typeof TargetInput>;

async function requireAdmin(supabase: unknown, userId: string) {
  const client = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: string) => {
          eq: (a: string, b: string) => {
            maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

/** Merge an incoming target over the stored one, preserving an untouched key. */
function mergeTarget(incoming: TargetIn | undefined, stored: AiEngineTarget): AiEngineTarget {
  if (!incoming) return { ...stored };
  const apiKey =
    incoming.apiKey === null
      ? stored.apiKey
      : incoming.apiKey.trim()
        ? incoming.apiKey.trim()
        : null;
  return {
    baseUrl: incoming.baseUrl?.trim() || null,
    apiKey,
    model: incoming.model?.trim() || null,
    enabled: incoming.enabled ?? stored.enabled !== false,
  };
}

export const getAiEngines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadEnginesConfig, engineAvailability, resolveEngine } = await import(
      "./ai-engines.server"
    );
    const { toEngineView, engineIncomplete } = await import("@/lib/ai-engines");
    const config = await loadEnginesConfig(context.supabase);
    const availability = await engineAvailability(config);
    const cloud = await resolveEngine(config.cloudDefault, config);

    const incomplete = {} as Record<AiEngineId, boolean>;
    for (const id of AI_ENGINE_IDS)
      incomplete[id] = engineIncomplete(config, id);

    return {
      config: toEngineView(config),
      engines: AI_ENGINE_DEFS,
      availability,
      incomplete,
      cloudDefaultEffective: cloud
        ? { id: cloud.id, baseUrl: cloud.baseUrl, model: cloud.model }
        : null,
      /** Deploy-level custom AI env vars that still configure the local engine. */
      envCustomAi: {
        baseUrl: process.env.CUSTOM_AI_BASE_URL ?? null,
        hasApiKey: Boolean(process.env.CUSTOM_AI_API_KEY),
        model: process.env.CUSTOM_AI_MODEL ?? null,
      },
    };
  });

export const setAiEngines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnginesInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    const { loadEnginesConfig, saveEnginesConfig } = await import("./ai-engines.server");
    const { engineIncomplete, getAiEngineDef } = await import("@/lib/ai-engines");
    const stored = await loadEnginesConfig(context.supabase);

    const engines = {} as Record<AiEngineId, AiEngineTarget>;
    for (const id of AI_ENGINE_IDS) {
      engines[id] = mergeTarget(data.engines[id], stored.engines[id]);
    }
    const requestedDefault = data.cloudDefault;
    const next: AiEnginesConfig = { engines, cloudDefault: requestedDefault };

    const usable = (id: AiEngineId) =>
      next.engines[id].enabled !== false && !engineIncomplete(next, id);

    // The picked cloud default is empty or off (e.g. "Other cloud" left blank
    // because only self-hosted + Ollama Cloud are set up). Move the default to
    // an engine that actually works instead of nagging about a slot the
    // operator never intends to fill.
    if (!usable(requestedDefault)) {
      const fallback =
        (["ollama_cloud", "other_cloud"] as AiEngineId[]).find(
          (id) => getAiEngineDef(id).placement === "cloud" && usable(id),
        ) ?? (usable("local") ? ("local" as AiEngineId) : null);
      if (fallback) next.cloudDefault = fallback;
    }

    // Never refuse the save because one engine is unusable — an operator must
    // always be able to store one working engine while another is incomplete.
    const warnings: string[] = [];
    const label = getAiEngineDef(next.cloudDefault).label;

    for (const id of AI_ENGINE_IDS) {
      if (next.engines[id].enabled === false) {
        warnings.push(
          `${getAiEngineDef(id).label} is switched off — its settings are saved but no feature will use it.`,
        );
      }
    }

    if (next.cloudDefault !== requestedDefault) {
      warnings.push(
        `${getAiEngineDef(requestedDefault).label} is not set up, so ${label} is now the cloud default. Leaving that slot empty is fine.`,
      );
    } else if (getAiEngineDef(next.cloudDefault).placement === "local") {
      warnings.push(
        `${label} runs on your own hardware, so cloud-default feature areas will use it too.`,
      );
    } else if (!usable(next.cloudDefault)) {
      warnings.push(
        `${label} is the cloud default but has no usable base URL, API key and model yet, so cloud features will fail until it is completed or another engine is selected.`,
      );
    }

    await saveEnginesConfig(next, context.userId, context.supabase);
    const { toEngineView } = await import("@/lib/ai-engines");
    return { ok: true as const, config: toEngineView(next), warnings };
  });

const TestInput = z.object({
  id: z.enum(AI_ENGINE_IDS),
  /** Unsaved form values, so an admin can test before saving. */
  baseUrl: z.string().trim().max(500).nullable().optional(),
  apiKey: z.string().max(500).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
});

/** Verify one engine's base URL, API key and model, with actionable errors. */
export const testAiEngineConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TestInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    const { testAiEngine } = await import("./ai-engine-test.server");
    return testAiEngine(data.id, {
      baseUrl: data.baseUrl?.trim() || null,
      apiKey: data.apiKey?.trim() || null,
      model: data.model?.trim() || null,
    });
  });
