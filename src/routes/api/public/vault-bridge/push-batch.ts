/**
 * Step 2 of a mirror run — FarmOps to Bitwarden.
 *
 * Called twice by the bridge:
 *  1. with `linkIds`, to fetch the decrypted values it should write into
 *     Bitwarden (bounded batch, response only — nothing is stored),
 *  2. with `acks`, to report the Bitwarden item id and revision it ended up
 *     writing, which is what marks the pair as in sync.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/vault-bridge/push-batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeBridge, loadMirrorableRows, scopesFor, jsonResponse } = await import(
          "@/lib/vault-bitwarden.server"
        );
        const auth = await authorizeBridge(request);
        if (!auth.ok) return jsonResponse({ error: auth.message }, auth.status);
        const { config, admin } = auth;

        let body: {
          runId?: string;
          linkIds?: string[];
          acks?: Array<{ linkId?: string; bwItemId?: string; fingerprint?: string; revisionDate?: string }>;
        };
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "Body must be JSON" }, 400);
        }

        const { bitwardenItemName, clampBatch } = await import("@/lib/vault-bitwarden");

        // --- acknowledgements ------------------------------------------------
        let acked = 0;
        for (const ack of (body.acks ?? []).slice(0, clampBatch(undefined))) {
          const linkId = String(ack?.linkId ?? "");
          const bwItemId = String(ack?.bwItemId ?? "");
          const fingerprint = String(ack?.fingerprint ?? "");
          if (!linkId || !bwItemId || !/^[0-9a-f]{64}$/.test(fingerprint)) continue;
          const { error } = await admin
            .from("vault_bitwarden_links")
            .update({
              bw_item_id: bwItemId,
              last_pushed_fingerprint: fingerprint,
              last_pulled_fingerprint: fingerprint,
              last_bw_revision: ack?.revisionDate ? String(ack.revisionDate) : null,
              last_synced_at: new Date().toISOString(),
              status: "in_sync",
              conflict_detail: null,
            })
            .eq("id", linkId)
            .eq("owner_user_id", config.owner_user_id);
          if (!error) acked += 1;
        }

        if (acked > 0 && body.runId) {
          const { data: run } = await admin
            .from("vault_bitwarden_runs")
            .select("pushed_count")
            .eq("id", String(body.runId))
            .eq("owner_user_id", config.owner_user_id)
            .maybeSingle();
          const previous = (run as unknown as { pushed_count?: number } | null)?.pushed_count ?? 0;
          await admin
            .from("vault_bitwarden_runs")
            .update({ pushed_count: previous + acked })
            .eq("id", String(body.runId))
            .eq("owner_user_id", config.owner_user_id);
        }

        // --- payloads for the bridge to write -------------------------------
        const wanted = (body.linkIds ?? []).map((s) => String(s)).filter(Boolean).slice(0, clampBatch(undefined));
        if (wanted.length === 0) {
          return jsonResponse({ acked, items: [], folderName: config.folder_name });
        }

        const { data: linkRows, error: linkError } = await admin
          .from("vault_bitwarden_links")
          .select("id, vault_secret_id, bw_item_id, status")
          .eq("owner_user_id", config.owner_user_id)
          .in("id", wanted);
        if (linkError) return jsonResponse({ error: linkError.message }, 500);

        const links = (linkRows ?? []) as unknown as Array<{
          id: string;
          vault_secret_id: string | null;
          bw_item_id: string | null;
          status: string;
        }>;

        const rows = await loadMirrorableRows(config.owner_user_id, scopesFor(config));
        const byId = new Map(rows.map((r) => [r.id, r]));

        const items: Array<{
          linkId: string;
          bwItemId: string | null;
          name: string;
          value: string;
          notes: string | null;
          fingerprint: string;
        }> = [];

        for (const link of links) {
          // Only entries the plan marked as "copy to Bitwarden" are handed over.
          if (link.status !== "push_pending") continue;
          if (!link.vault_secret_id) continue;
          const row = byId.get(link.vault_secret_id);
          if (!row || row.value === null || row.fingerprint === null) continue;
          items.push({
            linkId: link.id,
            bwItemId: link.bw_item_id,
            name: bitwardenItemName(row.title, row.env_key),
            value: row.value,
            notes: row.notes,
            fingerprint: row.fingerprint,
          });
        }

        return jsonResponse({ acked, items, folderName: config.folder_name, folderId: config.bw_folder_id });
      },
    },
  },
});
