/**
 * Read-only FarmOps Electrical API v1 — published base path.
 *
 * GET /api/v1/electrical                        API index (scopes, limits, endpoints)
 * GET /api/v1/electrical/sor/status             system-of-record status and hashes
 * GET /api/v1/electrical/snapshot               full snapshot envelope
 * GET /api/v1/electrical/resources/{collection} one collection
 * GET /api/v1/electrical/records/{stable_id}    every record for a stable ID
 * GET /api/v1/electrical/qa                     QA findings
 * GET /api/v1/electrical/documents/bundle       document-generation bundle
 *
 * Requires `Authorization: Bearer <user access token | farmops_sk_ key>` with the
 * scope the endpoint declares. Performs no writes and never touches the canonical
 * PremoFarmElectrical.ods workbook.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/electrical/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorizeApiRequest, handleApiRead, scopeForReadPath } = await import(
          "@/lib/electrical-api.server"
        );
        const splat = (params as { _splat?: string })._splat ?? "";
        const segments = splat.split("/").filter(Boolean);
        const caller = await authorizeApiRequest(request, "read", {
          scope: scopeForReadPath(segments),
          bucket: "read",
        });
        if (caller instanceof Response) return caller;
        return handleApiRead(caller, segments);
      },
    },
  },
});
