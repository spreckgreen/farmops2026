import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/admin/health/lovable — detailed Lovable Hosted AI health check.
 *
 * 200 { ok: true,  status: "healthy",   checks: [...] }
 * 503 { ok: false, status: "degraded" | "unhealthy", checks: [...] }
 *
 * Authorization (one of):
 *   - Authorization: Bearer <supabase access token>  from a signed-in admin
 *   - x-admin-health-token: <ADMIN_HEALTH_TOKEN>     for uptime monitors,
 *     only when that env var is set on the server
 *
 * Returns no key material — only the key's source and a last-4 fingerprint.
 */
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "content-type": "application/json; charset=utf-8",
} as const;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorize(request: Request): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const monitorToken = process.env["ADMIN_HEALTH_TOKEN"];
  const presented = request.headers.get("x-admin-health-token");
  if (monitorToken && presented) {
    return timingSafeEqual(presented, monitorToken)
      ? { ok: true }
      : { ok: false, status: 401, reason: "Invalid x-admin-health-token." };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      reason:
        "Sign in as an admin and send Authorization: Bearer <access token>, or set ADMIN_HEALTH_TOKEN and send x-admin-health-token.",
    };
  }

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    return { ok: false, status: 503, reason: "Backend env not configured on this server." };
  }

  const token = authHeader.slice("Bearer ".length);
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, status: 401, reason: "Access token is invalid or expired." };
  }

  const { isAdminRole } = await import("@/lib/admin-role.server");
  try {
    if (!(await isAdminRole(supabase, userData.user.id))) {
      return { ok: false, status: 403, reason: "Admin role required." };
    }
  } catch {
    return { ok: false, status: 403, reason: "Admin role could not be verified." };
  }
  return { ok: true };
}

async function respond(request: Request, withBody: boolean) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return new Response(
      withBody
        ? JSON.stringify({
            ok: false,
            target: "lovable_hosted",
            status: "unauthorized",
            reason: auth.reason,
            checkedAt: new Date().toISOString(),
          })
        : null,
      { status: auth.status, headers: NO_STORE },
    );
  }

  const { checkLovableHosted } = await import("@/lib/lovable-health.server");
  const report = await checkLovableHosted();
  return new Response(withBody ? JSON.stringify(report) : null, {
    status: report.ok ? 200 : 503,
    headers: NO_STORE,
  });
}

export const Route = createFileRoute("/api/admin/health/lovable")({
  server: {
    handlers: {
      GET: async ({ request }) => respond(request, true),
      HEAD: async ({ request }) => respond(request, false),
    },
  },
});
