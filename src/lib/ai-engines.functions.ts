// Server functions behind the Admin → AI engines page.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  BUNDLED_OLLAMA_BASE_URL,
  LOVABLE_DEFAULT_MODEL,
  LOVABLE_GATEWAY_BASE_URL,
  type AiEnginesConfig,
} from "@/lib/ai-engines";

const TargetInput = z.object({
  baseUrl: z.string().trim().max(500).nullable(),
  /** null = leave the stored key untouched; "" = clear it. */
  apiKey: z.string().max(500).nullable(),
  model: z.string().trim().max(200).nullable(),
});

const EnginesInput = z.object({
  local: TargetInput,
  hosted: z.object({
    provider: z.enum(["lovable", "custom"]),
    lovableModel: z.string().trim().max(200).nullable(),
    custom: TargetInput,
  }),
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
function mergeTarget(
  incoming: TargetIn,
  stored: { baseUrl: string | null; apiKey: string | null; model: string | null },
) {
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
    const { loadEnginesConfig, resolveLocalEngine, resolveHostedEngine } = await import(
      "./ai-engines.server"
    );
    const { toEngineView, hostedCustomIncomplete } = await import("@/lib/ai-engines");
    const config = await loadEnginesConfig();
    const local = await resolveLocalEngine(config);
    const hosted = await resolveHostedEngine(config);

    return {
      config: toEngineView(config),
      effective: {
        local: { baseUrl: local.baseUrl, model: local.model },
        hosted: hosted
          ? { kind: hosted.kind, baseUrl: hosted.baseUrl, model: hosted.model }
          : null,
      },
      hostedIncomplete: hostedCustomIncomplete(config),
      hasLovableApiKey: Boolean(process.env.LOVABLE_API_KEY),
      /** Deploy-level custom AI env vars that still force local routing. */
      envCustomAi: {
        baseUrl: process.env.CUSTOM_AI_BASE_URL ?? null,
        hasApiKey: Boolean(process.env.CUSTOM_AI_API_KEY),
        model: process.env.CUSTOM_AI_MODEL ?? null,
      },
      defaults: {
        localBaseUrl: BUNDLED_OLLAMA_BASE_URL,
        hostedBaseUrl: LOVABLE_GATEWAY_BASE_URL,
        hostedModel: LOVABLE_DEFAULT_MODEL,
      },
    };
  });

export const setAiEngines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EnginesInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase, context.userId);
    const { loadEnginesConfig, saveEnginesConfig } = await import("./ai-engines.server");
    const stored = await loadEnginesConfig();

    const next: AiEnginesConfig = {
      local: mergeTarget(data.local, stored.local),
      hosted: {
        provider: data.hosted.provider,
        lovableModel: data.hosted.lovableModel?.trim() || null,
        custom: mergeTarget(data.hosted.custom, stored.hosted.custom),
      },
    };
    if (next.hosted.provider === "custom") {
      if (!next.hosted.custom.baseUrl) throw new Error("Alternative hosted provider needs a base URL");
      if (!next.hosted.custom.apiKey) throw new Error("Alternative hosted provider needs an API key");
    }
    await saveEnginesConfig(next, context.userId);
    const { toEngineView } = await import("@/lib/ai-engines");
    return { ok: true as const, config: toEngineView(next) };
  });

/**
 * One-click "Switch to Lovable AI": point the hosted engine back at the Lovable
 * AI Gateway, drop alternative-provider overrides, remove the runtime custom-AI
 * vault overrides that force local routing, and route every hosted-recommended
 * feature area to hosted.
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

    // Send every area whose recommendation is hosted back to hosted.
    const { loadRoutingConfig, saveRoutingConfig } = await import("./ai-routing.server");
    const { AI_FEATURE_AREAS } = await import("@/lib/ai-feature-areas");
    const routing = await loadRoutingConfig();
    const areas = { ...routing.areas };
    const switched: string[] = [];
    for (const area of AI_FEATURE_AREAS) {
      if (area.recommended !== "hosted") continue;
      const current = areas[area.id];
      const model = current?.model && current.model.includes("/") ? current.model : null;
      if (current?.backend !== "hosted" || current.model !== model) switched.push(area.label);
      areas[area.id] = { backend: "hosted", model };
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
