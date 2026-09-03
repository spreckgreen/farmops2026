/**
 * POST /api/electrical/v1/relationships/apply — Phase 3, NOT ACTIVATED.
 *
 * Phase 1 acceptance gates activation of production write scopes, so this surface
 * refuses every request with 503 `write_scopes_not_activated` before it looks at
 * a credential. The outstanding protocol (expected record version, idempotency
 * key, preview binding, transactional audit) is reported in the response.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/relationships/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireActivatedSurface, ELECTRICAL_WRITE_PATHS } = await import(
          "@/lib/electrical-api.server"
        );
        const gate = requireActivatedSurface(request, "POST", ELECTRICAL_WRITE_PATHS.relationshipsApply);
        if (gate) return gate;
        const { authorizeApiRequest, handleRelationshipApply, readJsonArray } = await import(
          "@/lib/electrical-api.server"
        );
        const caller = await authorizeApiRequest(request, "field_write", {
          scope: "electrical:relationships:write",
          bucket: "write",
        });
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "proposals", caller);
        if (parsed instanceof Response) return parsed;
        return handleRelationshipApply(caller, parsed.items);
      },
    },
  },
});
