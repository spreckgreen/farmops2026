/**
 * POST /api/electrical/v1/field-observations/preview — Phase 2, NOT ACTIVATED.
 *
 * Gated with the apply surface: the phase is not accepted, so nothing in it is
 * reachable.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/field-observations/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          requireActivatedSurface,
          ELECTRICAL_WRITE_PATHS,
          authorizeApiRequest,
          handleObservationPreview,
          readJsonArray,
        } = await import("@/lib/electrical-api.server");
        const gate = requireActivatedSurface(
          request,
          "POST",
          ELECTRICAL_WRITE_PATHS.observationsPreview,
        );
        if (gate) return gate;
        const caller = await authorizeApiRequest(request, "field_write", {
          scope: "electrical:observations:write",
          bucket: "write",
        });
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "observations", caller);
        if (parsed instanceof Response) return parsed;
        return handleObservationPreview(caller, parsed.items);
      },
    },
  },
});
