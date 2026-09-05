/**
 * Step 3 of a mirror run — Bitwarden to FarmOps.
 *
 * The bridge sends the plaintext of items it was told to pull. FarmOps re-seals
 * each one with the current vault key and stores it. Values are never logged.
 * Only entries the plan marked as "copy to FarmOps" are accepted, so a stale
 * bridge cannot overwrite a conflicted or unreadable entry.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/vault-bridge/pull-batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeBridge, jsonResponse, mirrorFingerprint } = await import(
          "@/lib/vault-bitwarden.server"
        );
        const auth = await authorizeBridge(request);
        if (!auth.ok) return jsonResponse({ error: auth.message }, auth.status);
        const { config, admin } = auth;

        let body: {
          runId?: string;
          items?: Array<{
            linkId?: string;
            bwItemId?: string;
            name?: string;
            value?: string;
            notes?: string | null;
            revisionDate?: string;
          }>;
        };
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "Body must be JSON" }, 400);
        }

        const { clampBatch, farmOpsTitleFromItemName } = await import("@/lib/vault-bitwarden");
        const { seal } = await import("@/lib/vault-crypto.server");

        const incoming = (body.items ?? []).slice(0, clampBatch(undefined));
        let pulled = 0;
        const rejected: Array<{ linkId: string; reason: string }> = [];

        for (const item of incoming) {
          const linkId = String(item?.linkId ?? "");
          const value = typeof item?.value === "string" ? item.value : null;
          if (!linkId || value === null) {
            if (linkId) rejected.push({ linkId, reason: "No value supplied" });
            continue;
          }

          const { data: linkRow } = await admin
            .from("vault_bitwarden_links")
            .select("id, vault_secret_id, scope, status, bw_item_id")
            .eq("id", linkId)
            .eq("owner_user_id", config.owner_user_id)
            .maybeSingle();
          const link = linkRow as unknown as {
            id: string;
            vault_secret_id: string | null;
            scope: string;
            status: string;
            bw_item_id: string | null;
          } | null;

          if (!link) {
            rejected.push({ linkId, reason: "Unknown link" });
            continue;
          }
          if (link.status !== "pull_pending") {
            rejected.push({ linkId, reason: `Not queued for FarmOps (${link.status})` });
            continue;
          }
          if (link.scope === "personal" && !config.mirror_personal) {
            rejected.push({ linkId, reason: "Personal entries are not mirrored" });
            continue;
          }
          if (link.scope === "shared" && !config.mirror_shared) {
            rejected.push({ linkId, reason: "Shared entries are not mirrored" });
            continue;
          }

          const notes = typeof item?.notes === "string" && item.notes.length > 0 ? item.notes : null;
          const sealedValue = await seal(value);
          const sealedNotes = notes === null ? null : await seal(notes);
          const fingerprint = await mirrorFingerprint(value, notes);
          const title = farmOpsTitleFromItemName(String(item?.name ?? "")) || "Bitwarden item";

          let secretId = link.vault_secret_id;
          if (secretId) {
            const { error } = await admin
              .from("vault_secrets")
              .update({
                value_ciphertext: sealedValue.ciphertext,
                value_iv: sealedValue.iv,
                value_tag: sealedValue.tag,
                notes_ciphertext: sealedNotes?.ciphertext ?? null,
                notes_iv: sealedNotes?.iv ?? null,
                notes_tag: sealedNotes?.tag ?? null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", secretId);
            if (error) {
              rejected.push({ linkId, reason: "Could not update the vault entry" });
              continue;
            }
          } else {
            const { data: inserted, error } = await admin
              .from("vault_secrets")
              .insert({
                scope: link.scope,
                title,
                created_by: config.owner_user_id,
                owner_user_id: link.scope === "personal" ? config.owner_user_id : null,
                value_ciphertext: sealedValue.ciphertext,
                value_iv: sealedValue.iv,
                value_tag: sealedValue.tag,
                notes_ciphertext: sealedNotes?.ciphertext ?? null,
                notes_iv: sealedNotes?.iv ?? null,
                notes_tag: sealedNotes?.tag ?? null,
              })
              .select("id")
              .single();
            if (error || !inserted) {
              rejected.push({ linkId, reason: "Could not create the vault entry" });
              continue;
            }
            secretId = (inserted as unknown as { id: string }).id;
          }

          await admin
            .from("vault_bitwarden_links")
            .update({
              vault_secret_id: secretId,
              title,
              last_pulled_fingerprint: fingerprint,
              last_pushed_fingerprint: fingerprint,
              last_bw_revision: item?.revisionDate ? String(item.revisionDate) : null,
              last_synced_at: new Date().toISOString(),
              status: "in_sync",
              conflict_detail: null,
            })
            .eq("id", linkId);

          pulled += 1;
        }

        if (pulled > 0 && body.runId) {
          const { data: run } = await admin
            .from("vault_bitwarden_runs")
            .select("pulled_count")
            .eq("id", String(body.runId))
            .eq("owner_user_id", config.owner_user_id)
            .maybeSingle();
          const previous = (run as unknown as { pulled_count?: number } | null)?.pulled_count ?? 0;
          await admin
            .from("vault_bitwarden_runs")
            .update({ pulled_count: previous + pulled })
            .eq("id", String(body.runId))
            .eq("owner_user_id", config.owner_user_id);
        }

        return jsonResponse({ pulled, rejected });
      },
    },
  },
});
