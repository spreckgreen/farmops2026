/**
 * Shared payload for the lightweight health endpoints.
 *
 * Deliberately does NOT touch the database, the vault, or any external API:
 * a health check must answer in milliseconds and say "the HTTP server is up
 * and serving JS", nothing more. Readiness of downstream services is checked
 * on /admin/schema and /settings/troubleshooting instead.
 */

const BOOTED_AT = Date.now();

export type HealthPayload = {
  ok: true;
  service: "bostead";
  status: "ready";
  uptimeSeconds: number;
  checkedAt: string;
  /** Present only when the deploy injects it (docker build arg / CI). */
  commit?: string;
};

export function buildHealthPayload(): HealthPayload {
  const commit =
    process.env["GIT_COMMIT"] ?? process.env["SOURCE_COMMIT"] ?? undefined;

  return {
    ok: true,
    service: "bostead",
    status: "ready",
    uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
    checkedAt: new Date().toISOString(),
    ...(commit ? { commit } : {}),
  };
}

export const HEALTH_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "content-type": "application/json; charset=utf-8",
} as const;
