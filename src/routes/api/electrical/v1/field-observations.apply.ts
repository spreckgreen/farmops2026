/**
 * POST /api/electrical/v1/field-observations/apply — Phase 2, NOT ACTIVATED.
 *
 * Phase 1 acceptance gates activation of production write scopes, so this surface
 * refuses every request with 503 `write_scopes_not_activated` before it looks at
 * a credential.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/field-observations/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          requireActivatedSurface,
          ELECTRICAL_WRITE_PATHS,
          authorizeApiRequest,
          handleObservationApply,
          readJsonArray,
        } = await import("@/lib/electrical-api.server");
        const gate = requireActivatedSurface(
          request,
          "POST",
          ELECTRICAL_WRITE_PATHS.observationsApply,
        );
        if (gate) return gate;
        const caller = await authorizeApiRequest(request, "field_write", {
          scope: "electrical:observations:write",
          bucket: "write",
        });
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "observations", caller);
        if (parsed instanceof Response) return parsed;
        return handleObservationApply(caller, parsed.items);
      },
    },
  },
});
