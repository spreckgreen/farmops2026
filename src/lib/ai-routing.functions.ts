// Server functions behind the per-feature AI routing UI.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  AI_FEATURE_AREAS,
  type AiAreaId,
  type AiRoutingConfig,
} from "@/lib/ai-feature-areas";

const AREA_IDS = AI_FEATURE_AREAS.map((a) => a.id) as [AiAreaId, ...AiAreaId[]];

const RoutingInput = z.object({
  autoFallback: z.boolean(),
  areas: z.record(
    z.enum(AREA_IDS),
    z.object({
      backend: z.enum(["local", "hosted", "default"]),
      model: z.string().trim().max(200).nullable(),
    }),
  ),
});

async function requireAdminRole(
  supabase: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
      };
    };
  },
  userId: string,
) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export const getAiRouting = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadRoutingConfig } = await import("./ai-routing.server");
    const config = await loadRoutingConfig();
    const { getServerEnv } = await import("./server-env.server");
    return {
      config,
      areas: AI_FEATURE_AREAS,
      activeLocalModel: (await getServerEnv("CUSTOM_AI_MODEL")) ?? null,
      localEndpoint: process.env.CUSTOM_AI_BASE_URL ?? null,
      hostedAvailable: Boolean(process.env.LOVABLE_API_KEY),
    };
  });

export const setAiRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RoutingInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminRole(context.supabase as never, context.userId);
    const { saveRoutingConfig } = await import("./ai-routing.server");
    const saved = await saveRoutingConfig(data as AiRoutingConfig, context.userId);
    return { ok: true as const, config: saved };
  });

export const resetAiRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminRole(context.supabase as never, context.userId);
    const { DEFAULT_ROUTING } = await import("@/lib/ai-feature-areas");
    const { saveRoutingConfig } = await import("./ai-routing.server");
    const saved = await saveRoutingConfig(DEFAULT_ROUTING, context.userId);
    return { ok: true as const, config: saved };
  });
