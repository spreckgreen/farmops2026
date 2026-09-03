/**
 * POST /api/electrical/v1/field-observations/apply — scoped write.
 *
 * Appends approved field observations to `electrical_field_observations`. It
 * never modifies an engineering record, never writes the canonical ODS, and
 * requires `approved: true` on each observation. Every insert is audited.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/field-observations/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeApiRequest, handleObservationApply, readJsonArray } = await import(
          "@/lib/electrical-api.server"
        );
        const caller = await authorizeApiRequest(request, "field_write");
        if (caller instanceof Response) return caller;
        const parsed = await readJsonArray(request, "observations");
        if (parsed instanceof Response) return parsed;
        return handleObservationApply(caller, parsed.items);
      },
    },
  },
});
