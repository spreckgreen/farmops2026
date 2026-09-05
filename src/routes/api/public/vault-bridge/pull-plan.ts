/**
 * Step 1 of a mirror run.
 *
 * The bridge sends a digest of every Bitwarden item in the FarmOps folder
 * (id, name, revision date, and a SHA-256 fingerprint of value+notes). It never
 * sends secret values here. FarmOps compares that against its own vault rows
 * and answers with what to push, what it wants pulled, and what is conflicted.
 *
 * This route sits under /api/public/* so an external caller can reach it, and
 * authenticates the caller itself with the owner's bridge token.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/vault-bridge/pull-plan")({
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
          items?: Array<{ id?: string; name?: string; fingerprint?: string; revisionDate?: string }>;
          folderId?: string;
        };
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "Body must be JSON" }, 400);
        }

        const remote = new Map<
          string,
          { id: string; name: string; fingerprint: string; revisionDate: string | null }
        >();
        for (const raw of body.items ?? []) {
          const id = String(raw?.id ?? "").trim();
          const fingerprint = String(raw?.fingerprint ?? "").trim();
          if (!id || !/^[0-9a-f]{64}$/.test(fingerprint)) continue;
          remote.set(id, {
            id,
            name: String(raw?.name ?? "").trim(),
            fingerprint,
            revisionDate: raw?.revisionDate ? String(raw.revisionDate) : null,
          });
        }

        if (body.folderId && body.folderId !== config.bw_folder_id) {
          await admin
            .from("vault_bitwarden_config")
            .update({ bw_folder_id: String(body.folderId) })
            .eq("id", config.id);
        }

        const { decideMirrorAction, MIRROR_BATCH_LIMIT } = await import("@/lib/vault-bitwarden");

        const localRows = await loadMirrorableRows(config.owner_user_id, scopesFor(config));

        const { data: linkRows, error: linkError } = await admin
          .from("vault_bitwarden_links")
          .select("*")
          .eq("owner_user_id", config.owner_user_id);
        if (linkError) return jsonResponse({ error: linkError.message }, 500);

        type LinkRow = {
          id: string;
          vault_secret_id: string | null;
          bw_item_id: string | null;
          status: string;
          last_pushed_fingerprint: string | null;
          last_pulled_fingerprint: string | null;
          title: string | null;
          scope: string;
        };
        const links = (linkRows ?? []) as unknown as LinkRow[];
        const bySecret = new Map(links.filter((l) => l.vault_secret_id).map((l) => [l.vault_secret_id!, l]));
        const byItem = new Map(links.filter((l) => l.bw_item_id).map((l) => [l.bw_item_id!, l]));

        const { data: runRow, error: runError } = await admin
          .from("vault_bitwarden_runs")
          .insert({ owner_user_id: config.owner_user_id, status: "running" })
          .select("id")
          .single();
        if (runError) return jsonResponse({ error: runError.message }, 500);
        const runId = (runRow as unknown as { id: string }).id;

        const toPush: Array<{ linkId: string; title: string }> = [];
        const toPull: Array<{ linkId: string; bwItemId: string }> = [];
        const conflicts: Array<{ linkId: string; title: string }> = [];
        let skipped = 0;

        const seenItemIds = new Set<string>();

        // FarmOps-side entries first: existing pairings and brand-new entries.
        for (const row of localRows) {
          const link = bySecret.get(row.id);
          const remoteItem = link?.bw_item_id ? remote.get(link.bw_item_id) : undefined;
          if (remoteItem) seenItemIds.add(remoteItem.id);

          const decision = decideMirrorAction({
            localFingerprint: row.fingerprint,
            remoteFingerprint: remoteItem?.fingerprint ?? null,
            lastPushedFingerprint: link?.last_pushed_fingerprint ?? null,
            lastPulledFingerprint: link?.last_pulled_fingerprint ?? null,
            localExists: true,
            remoteExists: Boolean(remoteItem),
            everSynced: Boolean(link?.last_pushed_fingerprint || link?.last_pulled_fingerprint),
          });

          const patch = {
            owner_user_id: config.owner_user_id,
            vault_secret_id: row.id,
            bw_item_id: link?.bw_item_id ?? null,
            bw_folder_id: config.bw_folder_id,
            scope: row.scope,
            title: row.title,
            status: decision.status,
            conflict_detail:
              decision.status === "conflict"
                ? { reason: decision.reason, farmops_updated_at: row.updated_at, bitwarden_revision: remoteItem?.revisionDate ?? null }
                : null,
          };

          let linkId = link?.id ?? null;
          if (linkId) {
            await admin.from("vault_bitwarden_links").update(patch).eq("id", linkId);
          } else {
            const { data: inserted, error: insertError } = await admin
              .from("vault_bitwarden_links")
              .insert(patch)
              .select("id")
              .single();
            if (insertError) return jsonResponse({ error: insertError.message }, 500);
            linkId = (inserted as unknown as { id: string }).id;
          }

          if (decision.status === "push_pending" && toPush.length < MIRROR_BATCH_LIMIT) {
            toPush.push({ linkId, title: row.title });
          } else if (decision.status === "pull_pending" && remoteItem && toPull.length < MIRROR_BATCH_LIMIT) {
            toPull.push({ linkId, bwItemId: remoteItem.id });
          } else if (decision.status === "conflict") {
            conflicts.push({ linkId, title: row.title });
          } else if (decision.status !== "in_sync") {
            skipped += 1;
          }
        }

        // Bitwarden-side items with no FarmOps counterpart.
        for (const item of remote.values()) {
          if (seenItemIds.has(item.id)) continue;
          const link = byItem.get(item.id);
          if (link?.vault_secret_id) continue;

          const decision = decideMirrorAction({
            localFingerprint: null,
            remoteFingerprint: item.fingerprint,
            lastPushedFingerprint: link?.last_pushed_fingerprint ?? null,
            lastPulledFingerprint: link?.last_pulled_fingerprint ?? null,
            localExists: false,
            remoteExists: true,
            everSynced: Boolean(link?.last_pushed_fingerprint || link?.last_pulled_fingerprint),
          });

          const patch = {
            owner_user_id: config.owner_user_id,
            vault_secret_id: null,
            bw_item_id: item.id,
            bw_folder_id: config.bw_folder_id,
            scope: (link?.scope as "personal" | "shared") ?? (config.mirror_personal ? "personal" : "shared"),
            title: item.name || link?.title || "Bitwarden item",
            status: decision.status,
            conflict_detail:
              decision.status === "deleted_local"
                ? { reason: decision.reason, bitwarden_revision: item.revisionDate }
                : null,
          };

          let linkId = link?.id ?? null;
          if (linkId) {
            await admin.from("vault_bitwarden_links").update(patch).eq("id", linkId);
          } else {
            const { data: inserted, error: insertError } = await admin
              .from("vault_bitwarden_links")
              .insert(patch)
              .select("id")
              .single();
            if (insertError) return jsonResponse({ error: insertError.message }, 500);
            linkId = (inserted as unknown as { id: string }).id;
          }

          if (decision.status === "pull_pending" && toPull.length < MIRROR_BATCH_LIMIT) {
            toPull.push({ linkId, bwItemId: item.id });
          } else {
            skipped += 1;
          }
        }

        await admin
          .from("vault_bitwarden_runs")
          .update({ conflict_count: conflicts.length, skipped_count: skipped })
          .eq("id", runId);

        return jsonResponse({
          runId,
          folderName: config.folder_name,
          folderId: config.bw_folder_id,
          toPush,
          toPull,
          conflicts,
          skipped,
        });
      },
    },
  },
});
