import { createFileRoute } from "@tanstack/react-router";
import { HEALTH_HEADERS } from "@/lib/health-payload";

/**
 * GET /api/public/ready — same report as /ready.
 *
 * The /api/public/* prefix bypasses published-site auth so external uptime
 * monitors can poll readiness even when the site is password-gated.
 * Contains no secret values and no user data.
 */
export const Route = createFileRoute("/api/public/ready")({
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
