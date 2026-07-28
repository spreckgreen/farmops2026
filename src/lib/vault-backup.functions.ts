// Admin-only backup/restore for the encrypted secrets vault.
//
// The vault stores AES-256-GCM ciphertext plus IV/tag columns. Ciphertext is
// portable across instances as long as the *same* VAULT_ENCRYPTION_KEY (or a
// prior key wired up as VAULT_ENCRYPTION_KEY_OLD during rotation) is present
// on the target. Plaintext is NEVER exported — the backup is safe to store
// alongside app snapshots, but it is useless without the key.
//
// Import modes:
//   - "merge"   upsert by id; existing rows updated, new rows inserted
//   - "replace" wipe the vault first, then insert every row
//
// rewriteOwnership: when true, personal secrets get owner_user_id/created_by
// rewritten to the current admin — useful when restoring into a fresh
// database with different auth.users UUIDs. Shared secrets keep owner NULL
// but still get created_by rewritten so the FK to auth.users resolves.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const VAULT_COLUMNS = [
  "id",
  "scope",
  "owner_user_id",
  "created_by",
  "title",
  "value_ciphertext",
  "value_iv",
  "value_tag",
  "notes_ciphertext",
  "notes_iv",
  "notes_tag",
  "key_version",
  "created_at",
  "updated_at",
] as const;

export type VaultBackupRow = {
  id: string;
  scope: "personal" | "shared";
  owner_user_id: string | null;
  created_by: string;
  title: string;
  value_ciphertext: string;
  value_iv: string;
  value_tag: string;
  notes_ciphertext: string | null;
  notes_iv: string | null;
  notes_tag: string | null;
  key_version: number;
  created_at: string;
  updated_at: string;
};

export type VaultBackup = {
  app: "bostead";
  kind: "vault";
  version: 1;
  generated_at: string;
  generated_by: string;
  count: number;
  rows: VaultBackupRow[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

// ---- Export -------------------------------------------------------------

export const exportVaultBackup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VaultBackup> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = supabase as any;
    const PAGE_SIZE = 1000;
    const rows: VaultBackupRow[] = [];
    let from = 0;
    for (let page = 0; page < 1000; page++) {
      const { data, error } = await reader
        .from("vault_secrets")
        .select(VAULT_COLUMNS.join(","))
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Vault export failed: ${error.message}`);
      const batch = (data as VaultBackupRow[]) ?? [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return {
      app: "bostead",
      kind: "vault",
      version: 1,
      generated_at: new Date().toISOString(),
      generated_by: userId,
      count: rows.length,
      rows,
    };
  });

// ---- Import -------------------------------------------------------------

export type VaultImportMode = "merge" | "replace";

export type VaultImportResult = {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: { id?: string; message: string }[];
  dryRun: boolean;
  rewriteOwnership: boolean;
  mode: VaultImportMode;
};

export const importVaultBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      backup: VaultBackup;
      mode?: VaultImportMode;
      rewriteOwnership?: boolean;
      dryRun?: boolean;
    }) => {
      if (!d || typeof d !== "object") throw new Error("payload required");
      const b = d.backup;
      if (!b || b.app !== "bostead" || b.kind !== "vault" || b.version !== 1) {
        throw new Error("Not a valid Bostead vault backup (v1).");
      }
      if (!Array.isArray(b.rows)) throw new Error("backup.rows must be an array");
      return {
        backup: b,
        mode: d.mode ?? "merge",
        rewriteOwnership: d.rewriteOwnership ?? true,
        dryRun: d.dryRun ?? false,
      };
    },
  )
  .handler(async ({ context, data }): Promise<VaultImportResult> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = supabase as any;
    const { backup, mode, rewriteOwnership, dryRun } = data;

    const result: VaultImportResult = {
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [],
      dryRun,
      rewriteOwnership,
      mode,
    };

    // Normalise rows: strip unknown keys, optionally re-scope ownership so
    // FKs resolve against auth.users on the target database.
    const rows: VaultBackupRow[] = backup.rows.map((r) => {
      const scope = r.scope === "shared" ? "shared" : "personal";
      const owner =
        scope === "shared"
          ? null
          : rewriteOwnership
            ? userId
            : (r.owner_user_id ?? userId);
      const created_by = rewriteOwnership ? userId : (r.created_by ?? userId);
      return {
        id: r.id,
        scope,
        owner_user_id: owner,
        created_by,
        title: r.title,
        value_ciphertext: r.value_ciphertext,
        value_iv: r.value_iv,
        value_tag: r.value_tag,
        notes_ciphertext: r.notes_ciphertext ?? null,
        notes_iv: r.notes_iv ?? null,
        notes_tag: r.notes_tag ?? null,
        key_version: r.key_version ?? 1,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    // Dry-run: count how many rows already exist so the UI can show
    // inserted-vs-updated projections without touching the table.
    if (dryRun) {
      const ids = rows.map((r) => r.id);
      let existing = 0;
      if (ids.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const { count, error } = await writer
            .from("vault_secrets")
            .select("id", { count: "exact", head: true })
            .in("id", slice);
          if (error) {
            result.errors.push({ message: `dry-run lookup: ${error.message}` });
            break;
          }
          existing += count ?? 0;
        }
      }
      result.updated = existing;
      result.inserted = rows.length - existing;
      if (mode === "replace") {
        const { count, error } = await writer
          .from("vault_secrets")
          .select("id", { count: "exact", head: true });
        if (error) result.errors.push({ message: `dry-run count: ${error.message}` });
        else result.deleted = count ?? 0;
      }
      return result;
    }

    // Replace mode: wipe first.
    if (mode === "replace") {
      const { count: preCount } = await writer
        .from("vault_secrets")
        .select("id", { count: "exact", head: true });
      const { error: delErr } = await writer
        .from("vault_secrets")
        .delete()
        .not("id", "is", null);
      if (delErr) {
        result.errors.push({ message: `wipe failed: ${delErr.message}` });
        return result;
      }
      result.deleted = preCount ?? 0;
    }

    // Upsert in chunks so a single bad row doesn't nuke the whole batch.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const ids = slice.map((r) => r.id);

      // Count pre-existing ids to split inserted vs updated for the report.
      let preExisting = 0;
      if (mode === "merge") {
        const { count } = await writer
          .from("vault_secrets")
          .select("id", { count: "exact", head: true })
          .in("id", ids);
        preExisting = count ?? 0;
      }

      const { error } = await writer
        .from("vault_secrets")
        .upsert(slice, { onConflict: "id" });
      if (error) {
        result.errors.push({ message: `chunk ${i / CHUNK}: ${error.message}` });
        result.skipped += slice.length;
        continue;
      }
      result.updated += preExisting;
      result.inserted += slice.length - preExisting;
    }

    return result;
  });
