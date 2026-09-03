/**
 * Read-only FarmOps Electrical API v1.
 *
 * GET /api/electrical/v1                        API index
 * GET /api/electrical/v1/snapshot               full reconciliation snapshot
 * GET /api/electrical/v1/resources/{collection} one collection
 * GET /api/electrical/v1/records/{stable_id}    every record for a stable ID
 * GET /api/electrical/v1/qa                     QA findings
 * GET /api/electrical/v1/documents/bundle       document-generation bundle
 *
 * Requires `Authorization: Bearer <access_token>` and an electrical read
 * entitlement; RLS scopes rows to that user. Performs no writes and never
 * touches the canonical PremoFarmElectrical.ods workbook.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorizeApiRequest, handleApiRead } = await import("@/lib/electrical-api.server");
        const caller = await authorizeApiRequest(request, "read");
        if (caller instanceof Response) return caller;
        const splat = (params as { _splat?: string })._splat ?? "";
        const segments = splat.split("/").filter(Boolean);
        return handleApiRead(caller, segments);
      },
    },
  },
});
