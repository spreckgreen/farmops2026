import { supabase } from "@/integrations/supabase/client";
import type { Asset } from "@/components/dashboard/types";

/** Columns that must never be written back during a rollback. */
const IMMUTABLE_COLUMNS = ["created_at", "updated_at"] as const;

export interface ImportSnapshot {
  id: string;
  file_name: string;
  delete_missing: boolean;
  created_ids: string[];
  updated_before: Array<Record<string, unknown>>;
  deleted_rows: Array<Record<string, unknown>>;
  stats: { created?: number; updated?: number; deleted?: number };
  reverted_at: string | null;
  created_at: string;
}

export interface SnapshotInput {
  fileName: string;
  deleteMissing: boolean;
  createdIds: string[];
  updatedBefore: Asset[];
  deletedRows: Asset[];
}

/** Persist the pre-import state of everything an import touched. */
export async function recordImportSnapshot(userId: string, input: SnapshotInput) {
  const { error } = await supabase.from("inventory_import_snapshots").insert({
    user_id: userId,
    file_name: input.fileName,
    delete_missing: input.deleteMissing,
    created_ids: input.createdIds,
    updated_before: input.updatedBefore as unknown as never,
    deleted_rows: input.deletedRows as unknown as never,
    stats: {
      created: input.createdIds.length,
      updated: input.updatedBefore.length,
      deleted: input.deletedRows.length,
    } as unknown as never,
  });
  if (error) throw new Error(error.message);
}

export async function listImportSnapshots(limit = 20): Promise<ImportSnapshot[]> {
  const { data, error } = await supabase
    .from("inventory_import_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ImportSnapshot[];
}

function restorableRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const key of IMMUTABLE_COLUMNS) delete out[key];
  return out;
}

/**
 * Revert an import: delete rows it created, restore previous values of rows it
 * updated, and re-insert rows it deleted. Safe to run once; the snapshot is
 * stamped as reverted afterwards.
 */
export async function revertImportSnapshot(snapshot: ImportSnapshot): Promise<{
  removed: number;
  restored: number;
  reinserted: number;
}> {
  let removed = 0;
  if (snapshot.created_ids.length) {
    const { error } = await supabase
      .from("inventory_items")
      .delete()
      .in("id", snapshot.created_ids);
    if (error) throw new Error(`Removing imported rows failed: ${error.message}`);
    removed = snapshot.created_ids.length;
  }

  let restored = 0;
  for (const before of snapshot.updated_before) {
    const row = restorableRow(before);
    const id = row["id"] as string | undefined;
    if (!id) continue;
    delete row["id"];
    const { error } = await supabase
      .from("inventory_items")
      .update(row as never)
      .eq("id", id);
    if (error) throw new Error(`Restoring item ${id} failed: ${error.message}`);
    restored += 1;
  }

  let reinserted = 0;
  if (snapshot.deleted_rows.length) {
    const rows = snapshot.deleted_rows.map((r) => restorableRow(r));
    const { error } = await supabase.from("inventory_items").insert(rows as never);
    if (error) throw new Error(`Re-inserting deleted rows failed: ${error.message}`);
    reinserted = rows.length;
  }

  const { error: stampError } = await supabase
    .from("inventory_import_snapshots")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", snapshot.id);
  if (stampError) throw new Error(stampError.message);

  return { removed, restored, reinserted };
}
