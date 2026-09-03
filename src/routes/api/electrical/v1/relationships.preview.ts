/**
 * POST /api/electrical/v1/relationships/preview — Phase 3, NOT ACTIVATED.
 *
 * Read-only in intent, but it belongs to an unaccepted phase, so it is gated with
 * the apply surface rather than shipped half-specified.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/relationships/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          requireActivatedSurface,
          ELECTRICAL_WRITE_PATHS,
          authorizeApiRequest,
          handleRelationshipPreview,
          readJsonArray,
        } = await import("@/lib/electrical-api.server");
        const gate = requireActivatedSurface(
          request,
          "POST",
          ELECTRICAL_WRITE_PATHS.relationshipsPreview,
        );
        if (gate) return gate;
        const caller = await authorizeApiRequest(request, "field_write", {
          scope: "electrical:relationships:write",
          bucket: "write",
        });
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "proposals", caller);
        if (parsed instanceof Response) return parsed;
        return handleRelationshipPreview(caller, parsed.items);
      },
    },
  },
});
