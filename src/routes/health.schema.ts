import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { buildSchemaHealth } from "@/lib/day-colour-health";
import { HEALTH_HEADERS } from "@/lib/health-payload";

/**
 * GET /health/schema — verifies the day-colour columns exist.
 *
 * 200 { ok: true,  status: "ok" }
 * 503 { ok: false, status: "missing" | "unknown", remediation: [ "...", ... ] }
 *
 * Reports schema shape only — no note data is returned. Useful right after a
 * deploy: curl -s http://localhost:3000/health/schema | jq
 */
async function probe(): Promise<unknown> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) {
    return { message: "SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set for this server" };
  }

  const sb = createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  // Column existence is validated before RLS filtering, so an empty result
  // (0 rows for anon) still proves the columns are there.
  const { error } = await sb
    .from("daily_notes")
    .select("energy_level, productivity_level")
    .limit(1);
  return error ?? undefined;
}

export const Route = createFileRoute("/health/schema")({
  server: {
    handlers: {
      GET: async () => {
        let payload;
        try {
          payload = buildSchemaHealth({ error: await probe() });
        } catch (e) {
          payload = buildSchemaHealth({ error: e });
        }
        return new Response(JSON.stringify(payload), {
          status: payload.ok ? 200 : 503,
          headers: HEALTH_HEADERS,
        });
      },
      HEAD: async () => {
        const payload = buildSchemaHealth({ error: await probe().catch((e) => e) });
        return new Response(null, { status: payload.ok ? 200 : 503, headers: HEALTH_HEADERS });
      },
    },
  },
});
