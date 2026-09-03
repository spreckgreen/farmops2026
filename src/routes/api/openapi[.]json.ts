/**
 * GET /api/openapi.json — public OpenAPI 3.1 specification.
 *
 * Unauthenticated on purpose: it documents the contract, contains no records,
 * and lets a consumer generate a client before it holds a credential.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/openapi.json")({
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
