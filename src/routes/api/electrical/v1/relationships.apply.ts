/**
 * POST /api/electrical/v1/relationships/apply — scoped write.
 *
 * Writes only the allow-listed FK column and its derived mirror columns, one
 * approved proposal at a time (`approved: true` plus a `reason`). Every write is
 * recorded in the electrical change audit. No canonical ODS write-back, no
 * system-of-record administration, no generic column mutation.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/relationships/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeApiRequest, handleRelationshipApply, readJsonArray } = await import(
          "@/lib/electrical-api.server"
        );
        const caller = await authorizeApiRequest(request, "field_write");
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "proposals");
        if (parsed instanceof Response) return parsed;
        return handleRelationshipApply(caller, parsed.items);
      },
    },
  },
});
