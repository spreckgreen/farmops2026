import { createFileRoute } from "@tanstack/react-router";

/**
 * Production health check for the /procedures route.
 *
 * Performs a same-origin GET against /procedures and reports whether the
 * route is registered and returns HTTP 200. Intended to be polled by
 * uptime monitors / smoke tests after publish.
 *
 * Response shape:
 *   200 { ok: true,  route: "/procedures", status: 200, checkedAt }
 *   503 { ok: false, route: "/procedures", status, error?, checkedAt }
 */
export const Route = createFileRoute("/api/public/health/procedures")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const target = `${origin}/procedures`;
        const checkedAt = new Date().toISOString();

        try {
          const res = await fetch(target, {
            method: "GET",
            redirect: "manual",
            headers: { accept: "text/html" },
          });

          const ok = res.status === 200;
          return Response.json(
            {
              ok,
              route: "/procedures",
              status: res.status,
              checkedAt,
            },
            {
              status: ok ? 200 : 503,
              headers: { "cache-control": "no-store" },
            },
          );
        } catch (err) {
          return Response.json(
            {
              ok: false,
              route: "/procedures",
              status: 0,
              error: err instanceof Error ? err.message : String(err),
              checkedAt,
            },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
