import { createFileRoute } from "@tanstack/react-router";
import { HEALTH_HEADERS } from "@/lib/health-payload";

/**
 * GET /ready — readiness probe.
 *
 * Unlike /health (server booted), this verifies the app can actually serve:
 * required env vars are present and the backend answers over the network.
 *
 * 200 { ok: true,  status: "ready",     checks: [...] }
 * 503 { ok: false, status: "not_ready", checks: [...] }  <- at least one check failed
 *
 * Returns no secret values — only check names, statuses, and short reasons.
 */
export const Route = createFileRoute("/ready")({
  server: {
    handlers: {
      GET: async () => {
        const { runReadinessChecks } = await import("@/lib/readiness.server");
        const report = await runReadinessChecks();
        return new Response(JSON.stringify(report), {
          status: report.ok ? 200 : 503,
          headers: HEALTH_HEADERS,
        });
      },
      HEAD: async () => {
        const { runReadinessChecks } = await import("@/lib/readiness.server");
        const report = await runReadinessChecks();
        return new Response(null, {
          status: report.ok ? 200 : 503,
          headers: HEALTH_HEADERS,
        });
      },
    },
  },
});
