/**
 * GET /api/electrical/v1/openapi.json — the published contract.
 *
 * The specification describes the interface only; it contains no farm data, so
 * it is served without a bearer token to allow client/SDK generation.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/openapi.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { buildOpenApiDocument } = await import("@/lib/electrical-api");
        const origin = new URL(request.url).origin;
        return new Response(JSON.stringify(buildOpenApiDocument(origin), null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
