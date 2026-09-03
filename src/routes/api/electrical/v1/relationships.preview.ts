/**
 * POST /api/electrical/v1/relationships/preview — read-only.
 *
 * Shows, per proposal, the current and proposed value of the allow-listed FK
 * column and its derived mirror columns. Writes nothing.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/relationships/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeApiRequest, handleRelationshipPreview, readJsonArray } = await import(
          "@/lib/electrical-api.server"
        );
        const caller = await authorizeApiRequest(request, "read");
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "proposals");
        if (parsed instanceof Response) return parsed;
        return handleRelationshipPreview(caller, parsed.items);
      },
    },
  },
});
