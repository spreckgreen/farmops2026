// Authenticated admin server functions for the Bitwarden mirror.
// The bridge itself talks to the /api/public/vault-bridge/* routes; everything
// here is for the human operator on /admin/vault-bitwarden.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MirrorLinkView {
  id: string;
  title: string;
  scope: string;
  status: string;
  bwItemId: string | null;
  lastSyncedAt: string | null;
  conflictReason: string | null;
}

export interface MirrorRunView {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  skipped: number;
  error: string | null;
}

export interface MirrorStatusView {
  configured: boolean;
  paused: boolean;
  pausedReason: string | null;
  folderName: string;
  mirrorPersonal: boolean;
  mirrorShared: boolean;
  tokenFingerprint: string | null;
  tokenRotatedAt: string | null;
  lastSeenAt: string | null;
  links: MirrorLinkView[];
  runs: MirrorRunView[];
  counts: Record<string, number>;
}

export const getMirrorStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MirrorStatusView> => {
    const { supabase, userId } = context;
    const { requireVaultAdmin } = await import("./vault-recovery.server");
    await requireVaultAdmin(supabase, userId);

    const { data: configRow } = await supabase
      .from("vault_bitwarden_config")
      .select("*")
      .eq("owner_user_id", userId)
      .maybeSingle();
    const config = configRow as unknown as Record<string, string | boolean | null> | null;

    const { data: linkRows } = await supabase
      .from("vault_bitwarden_links")
      .select("id, title, scope, status, bw_item_id, last_synced_at, conflict_detail")
      .eq("owner_user_id", userId)
      .order("title", { ascending: true });

    const links: MirrorLinkView[] = (
      (linkRows ?? []) as unknown as Array<{
        id: string;
        title: string | null;
        scope: string;
        status: string;
        bw_item_id: string | null;
        last_synced_at: string | null;
        conflict_detail: { reason?: string } | null;
      }>
    ).map((row) => ({
      id: row.id,
      title: row.title ?? "Untitled",
      scope: row.scope,
      status: row.status,
      bwItemId: row.bw_item_id,
      lastSyncedAt: row.last_synced_at,
      conflictReason: row.conflict_detail?.reason ?? null,
    }));

    const counts: Record<string, number> = {};
    for (const link of links) counts[link.status] = (counts[link.status] ?? 0) + 1;

    const { data: runRows } = await supabase
      .from("vault_bitwarden_runs")
      .select("*")
      .eq("owner_user_id", userId)
      .order("started_at", { ascending: false })
      .limit(10);

    const runs: MirrorRunView[] = (
      (runRows ?? []) as unknown as Array<Record<string, string | number | null>>
    ).map((row) => ({
      id: String(row["id"]),
      startedAt: String(row["started_at"]),
      finishedAt: (row["finished_at"] as string | null) ?? null,
      status: String(row["status"]),
      pushed: Number(row["pushed_count"] ?? 0),
      pulled: Number(row["pulled_count"] ?? 0),
      conflicts: Number(row["conflict_count"] ?? 0),
      skipped: Number(row["skipped_count"] ?? 0),
      error: (row["error_text"] as string | null) ?? null,
    }));

    return {
      configured: Boolean(config),
      paused: Boolean(config?.["paused"]),
      pausedReason: (config?.["paused_reason"] as string | null) ?? null,
      folderName: (config?.["folder_name"] as string) ?? "FarmOps",
      mirrorPersonal: config ? Boolean(config["mirror_personal"]) : true,
      mirrorShared: config ? Boolean(config["mirror_shared"]) : false,
      tokenFingerprint: (config?.["bridge_token_fingerprint"] as string | null) ?? null,
      tokenRotatedAt: (config?.["bridge_token_rotated_at"] as string | null) ?? null,
      lastSeenAt: (config?.["last_seen_at"] as string | null) ?? null,
      links,
      runs,
      counts,
    };
  });

export const saveMirrorSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    mirrorPersonal: boolean;
    mirrorShared: boolean;
    folderName: string;
    paused: boolean;
  }) => ({
    mirrorPersonal: Boolean(input.mirrorPersonal),
    mirrorShared: Boolean(input.mirrorShared),
    folderName: String(input.folderName ?? "FarmOps").trim().slice(0, 120) || "FarmOps",
    paused: Boolean(input.paused),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireVaultAdmin } = await import("./vault-recovery.server");
    await requireVaultAdmin(supabase, userId);

    const patch = {
      owner_user_id: userId,
      mirror_personal: data.mirrorPersonal,
      mirror_shared: data.mirrorShared,
      folder_name: data.folderName,
      paused: data.paused,
      paused_reason: data.paused ? "Paused by an administrator" : null,
    };

    const { error } = await supabase
      .from("vault_bitwarden_config")
      .upsert(patch, { onConflict: "owner_user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Mint a new bridge token. The plaintext token is returned exactly once and
 * only the hash is stored, so it can never be read back later.
 */
export const rotateBridgeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ token: string; fingerprint: string }> => {
    const { supabase, userId } = context;
    const { requireVaultAdmin } = await import("./vault-recovery.server");
    await requireVaultAdmin(supabase, userId);

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { hashBridgeToken, tokenFingerprint } = await import("./vault-bitwarden.server");
    const hash = await hashBridgeToken(token);
    const fingerprint = tokenFingerprint(hash);

    const { error } = await supabase.from("vault_bitwarden_config").upsert(
      {
        owner_user_id: userId,
        bridge_token_hash: hash,
        bridge_token_fingerprint: fingerprint,
        bridge_token_rotated_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id" },
    );
    if (error) throw new Error(error.message);

    return { token, fingerprint };
  });

/**
 * Resolve a conflict by declaring a winner. Nothing is copied here — the link is
 * simply queued in one direction, and the next bridge run carries the value.
 */
export const resolveMirrorConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { linkId: string; winner: "keep_farmops" | "keep_bitwarden" }) => {
    const linkId = String(input?.linkId ?? "");
    if (!linkId) throw new Error("linkId is required");
    if (input?.winner !== "keep_farmops" && input?.winner !== "keep_bitwarden") {
      throw new Error("winner must be keep_farmops or keep_bitwarden");
    }
    return { linkId, winner: input.winner };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireVaultAdmin } = await import("./vault-recovery.server");
    await requireVaultAdmin(supabase, userId);

    const { error } = await supabase
      .from("vault_bitwarden_links")
      .update({
        status: data.winner === "keep_farmops" ? "push_pending" : "pull_pending",
        conflict_detail: null,
      })
      .eq("id", data.linkId)
      .eq("owner_user_id", userId)
      .eq("status", "conflict");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Acknowledge a one-sided removal. Deletions never propagate automatically, so
 * this only forgets the pairing — neither vault entry nor Bitwarden item is
 * deleted by FarmOps.
 */
export const forgetMirrorLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => {
    const linkId = String(input?.linkId ?? "");
    if (!linkId) throw new Error("linkId is required");
    return { linkId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { requireVaultAdmin } = await import("./vault-recovery.server");
    await requireVaultAdmin(supabase, userId);

    const { error } = await supabase
      .from("vault_bitwarden_links")
      .delete()
      .eq("id", data.linkId)
      .eq("owner_user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
