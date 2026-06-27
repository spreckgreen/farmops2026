// Server function to invalidate the vault-backed env cache after a vault edit.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const invalidateServerEnvCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name?: string }) => ({
    name: d?.name ? String(d.name) : undefined,
  }))
  .handler(async ({ data }) => {
    const { invalidateServerEnv } = await import("./server-env.server");
    invalidateServerEnv(data.name);
    return { ok: true as const };
  });
