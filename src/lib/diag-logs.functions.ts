import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LogTailResult } from "@/lib/diag-logs.server";

export const getRecentServerLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ windowSeconds: z.number().int().min(15).max(1800).default(120) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<LogTailResult> => {
    // Log tails can echo request paths and errors — admins only.
    const { data: role, error } = await context.supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (error) throw new Error(`role lookup failed: ${error.message}`);
    if (!role) throw new Error("Admin role required to read server logs.");

    const { collectRecentLogs } = await import("@/lib/diag-logs.server");
    return collectRecentLogs(data.windowSeconds);
  });
