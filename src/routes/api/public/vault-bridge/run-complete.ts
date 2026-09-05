/**
 * Step 4 of a mirror run: close out the run record so the admin page can show
 * when the bridge last completed and whether anything needs attention.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/vault-bridge/run-complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeBridge, jsonResponse } = await import("@/lib/vault-bitwarden.server");
        const auth = await authorizeBridge(request);
        if (!auth.ok) return jsonResponse({ error: auth.message }, auth.status);
        const { config, admin } = auth;

        let body: { runId?: string; status?: string; error?: string };
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "Body must be JSON" }, 400);
        }

        const runId = String(body.runId ?? "");
        if (!runId) return jsonResponse({ error: "runId is required" }, 400);

        const allowed = new Set(["ok", "partial", "failed"]);
        const status = allowed.has(String(body.status)) ? String(body.status) : "ok";

        const { error } = await admin
          .from("vault_bitwarden_runs")
          .update({
            status,
            finished_at: new Date().toISOString(),
            error_text: body.error ? String(body.error).slice(0, 1000) : null,
          })
          .eq("id", runId)
          .eq("owner_user_id", config.owner_user_id);
        if (error) return jsonResponse({ error: error.message }, 500);

        return jsonResponse({ ok: true, runId, status });
      },
    },
  },
});
