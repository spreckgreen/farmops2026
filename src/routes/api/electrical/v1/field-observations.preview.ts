/**
 * POST /api/electrical/v1/field-observations/preview — read-only.
 *
 * Validates each observation and echoes the exact append-only journal row that
 * would be written. Writes nothing.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/field-observations/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeApiRequest, handleObservationPreview, readJsonArray } = await import(
          "@/lib/electrical-api.server"
        );
        const caller = await authorizeApiRequest(request, "read");
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "observations");
        if (parsed instanceof Response) return parsed;
        return handleObservationPreview(caller, parsed.items);
      },
    },
  },
});
