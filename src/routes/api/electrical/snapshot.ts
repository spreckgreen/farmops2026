/**
 * GET /api/electrical/snapshot — Phase 4.2 reconciliation snapshot.
 *
 * Read-only machine interface for BosteadFarmsBuildDocs. Requires a Supabase
 * user bearer token (`Authorization: Bearer <access_token>`) and an active
 * `electrical` entitlement; RLS scopes the rows to that user. It performs no
 * writes and never touches the canonical PremoFarmElectrical.ods workbook.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) {
          return new Response(JSON.stringify({ error: "Backend not configured" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (!token) {
          return new Response(
            JSON.stringify({ error: "Unauthorized: send Authorization: Bearer <access_token>" }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }

        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(url, key, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (userError || !userId) {
          return new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { hasAddon } = await import("@/lib/addons.server");
        if (!(await hasAddon(supabase, userId, "electrical"))) {
          return new Response(JSON.stringify({ error: "Electrical add-on is not enabled" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
        const { serializeSnapshot } = await import("@/lib/electrical-snapshot");
        const snapshot = await collectSnapshot(supabase);
        return new Response(serializeSnapshot(snapshot), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            // Session-scoped data: never shared-cacheable.
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
