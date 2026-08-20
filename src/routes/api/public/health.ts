import { createFileRoute } from "@tanstack/react-router";
import { buildHealthPayload, HEALTH_HEADERS } from "@/lib/health-payload";

/**
 * GET /api/public/health — same payload as /health.
 *
 * Exists because the /api/public/* prefix bypasses published-site auth, so
 * external uptime monitors can poll it even when the site is password-gated.
 * Returns no PII and touches no database.
 */
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(buildHealthPayload()), {
          status: 200,
          headers: HEALTH_HEADERS,
        }),
      HEAD: async () => new Response(null, { status: 200, headers: HEALTH_HEADERS }),
    },
  },
});
