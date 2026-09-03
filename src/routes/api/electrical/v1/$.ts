/**
 * DEPRECATED read path for the FarmOps Electrical API v1.
 *
 * The published base path is `/api/v1/electrical`. This alias keeps existing
 * callers working and answers with Deprecation/Link/Warning headers. It shares
 * the same handlers, scopes and rate limits.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/electrical/v1/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorizeApiRequest, handleApiRead, scopeForReadPath, DEPRECATION_HEADERS } =
          await import("@/lib/electrical-api.server");
        const splat = (params as { _splat?: string })._splat ?? "";
        const segments = splat.split("/").filter(Boolean);
        const caller = await authorizeApiRequest(request, "read", {
          scope: scopeForReadPath(segments),
          bucket: "read",
        });
        if (caller instanceof Response) return caller;
        const response = await handleApiRead(caller, segments);
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(DEPRECATION_HEADERS)) headers.set(key, value);
        return new Response(response.body, { status: response.status, headers });
      },
    },
  },
});
