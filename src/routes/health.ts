import { createFileRoute } from "@tanstack/react-router";
import { buildHealthPayload, HEALTH_HEADERS } from "@/lib/health-payload";

/**
 * GET /health — liveness/readiness probe for Caddy, Docker, and uptime monitors.
 *
 * 200 { ok: true, service: "bostead", status: "ready", uptimeSeconds, checkedAt }
 *
 * No auth, no database, no external calls — if this answers 200 the Node server
 * booted and is routing requests. A 502 from Caddy while this returns 200 from
 * inside the app container means the proxy hop is broken, not the app.
 */
export const Route = createFileRoute("/health")({
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
