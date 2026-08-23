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
  };
}

export const getAiEngines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadEnginesConfig, engineAvailability, resolveEngine } = await import(
      "./ai-engines.server"
    );
    const { toEngineView, engineIncomplete } = await import("@/lib/ai-engines");
    const config = await loadEnginesConfig();
    const availability = await engineAvailability(config);
    const cloud = await resolveEngine(config.cloudDefault, config);

    const incomplete = {} as Record<AiEngineId, boolean>;
    for (const id of AI_ENGINE_IDS) incomplete[id] = engineIncomplete(config, id);

    return {
      config: toEngineView(config),
      engines: AI_ENGINE_DEFS,
      availability,
      incomplete,
      cloudDefaultEffective: cloud
        ? { id: cloud.id, baseUrl: cloud.baseUrl, model: cloud.model }
        : null,
      hasLovableApiKey: Boolean(process.env.LOVABLE_API_KEY),
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
    const stored = await loadEnginesConfig();

    const engines = {} as Record<AiEngineId, AiEngineTarget>;
    for (const id of AI_ENGINE_IDS) {
      engines[id] = mergeTarget(data.engines[id], stored.engines[id]);
    }
    const next: AiEnginesConfig = { engines, cloudDefault: data.cloudDefault };

    // Never refuse the save because one engine is unusable — an operator must
    // always be able to store working engines (local, Ollama Cloud, OpenAI)
    // even while Lovable AI is misconfigured or blocked. Report warnings.
    const envKeyPresent = Boolean(process.env.LOVABLE_API_KEY);
    const warnings: string[] = [];
    const label = getAiEngineDef(next.cloudDefault).label;

    if (getAiEngineDef(next.cloudDefault).placement === "local") {
      warnings.push(
        `${label} runs on your own hardware, so cloud-default feature areas will use it too.`,
      );
    }
    if (engineIncomplete(next, next.cloudDefault, { envKeyPresent })) {
      warnings.push(
        `${label} is missing a base URL, API key or model, so cloud-default features will fail until it is completed.`,
      );
    }
    if (next.cloudDefault === "lovable" && !envKeyPresent && !engines.lovable.apiKey) {
      warnings.push(
        "LOVABLE_API_KEY is not set on this server and no key was pasted into the Lovable engine, so Lovable AI calls will fail.",
      );
    }

    await saveEnginesConfig(next, context.userId);
    const { toEngineView } = await import("@/lib/ai-engines");
    return { ok: true as const, config: toEngineView(next), warnings };
  });

/**
 * One-click "Switch to Lovable AI": make Lovable AI the cloud default, drop the
 * other-cloud overrides, remove the runtime custom-AI vault overrides that
 * force local routing, and route every hosted-recommended feature area to the
 * cloud default.
 */
export const switchHostedToLovableAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    if (!process.env.LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not set on the server, so Lovable AI cannot be selected.");
    }

    const { loadEnginesConfig, saveEnginesConfig } = await import("./ai-engines.server");
    const { switchHostedToLovable, toEngineView } = await import("@/lib/ai-engines");
    const next = switchHostedToLovable(await loadEnginesConfig());
    await saveEnginesConfig(next, context.userId);

    // Runtime overrides that would otherwise keep AI calls on a custom endpoint.
    const { deleteSharedEnvValue } = await import("./shared-env-store.server");
    const clearedKeys: string[] = [];
    for (const key of ["CUSTOM_AI_BASE_URL", "CUSTOM_AI_API_KEY"]) {
      if (await deleteSharedEnvValue(key)) clearedKeys.push(key);
    }

    // Send every area whose recommendation is hosted to Lovable AI.
    const { loadRoutingConfig, saveRoutingConfig } = await import("./ai-routing.server");
    const { AI_FEATURE_AREAS } = await import("@/lib/ai-feature-areas");
    const routing = await loadRoutingConfig();
    const areas = { ...routing.areas };
    const switched: string[] = [];
    for (const area of AI_FEATURE_AREAS) {
      if (area.recommended !== "hosted") continue;
      const current = areas[area.id];
      const model = current?.model && current.model.includes("/") ? current.model : null;
      if (current?.backend !== "lovable" || current.model !== model) switched.push(area.label);
      areas[area.id] = { backend: "lovable", model };
    }
    await saveRoutingConfig({ ...routing, areas }, context.userId);

    return {
      ok: true as const,
      config: toEngineView(next),
      clearedKeys,
      switchedAreas: switched,
      /** Deploy-level env vars can only be removed by the operator. */
      envStillSet: Boolean(process.env.CUSTOM_AI_BASE_URL && process.env.CUSTOM_AI_API_KEY),
    };
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
