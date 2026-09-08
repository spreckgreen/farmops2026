/**
 * GET /api/v1/electrical/location-bundle
 *
 * Read-only cross-deployment bundle: applied field-audit batches (with their
 * manifests) plus every field-verified canonical location. Another FarmOps
 * deployment pulls this to share verified locations across sites.
 *
 * Requires `Authorization: Bearer <user access token | farmops_sk_ key>` with
 * `electrical:sor:read`. Performs no writes.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/electrical/location-bundle")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeApiRequest, apiJson, apiError } = await import(
          "@/lib/electrical-api.server"
        );
        const caller = await authorizeApiRequest(request, "read", {
          scope: "electrical:sor:read",
          bucket: "read",
        });
        if (caller instanceof Response) return caller;
        try {
          const { collectPeerBundle } = await import("@/lib/electrical-peer-bundle.server");
          const origin = new URL(request.url).origin;
          const bundle = await collectPeerBundle(caller.supabase as never, { origin });
          return apiJson(bundle as unknown as Record<string, unknown>, 200, caller);
        } catch (e) {
          return apiError(
            "backend_query_failed",
            e instanceof Error ? e.message : "The location bundle could not be built.",
            { caller },
          );
        }
      },
    },
  },
});
