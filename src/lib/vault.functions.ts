// Server functions backing the secrets vault.
// Values and notes are encrypted server-side with AES-256-GCM; the database
// only ever stores ciphertext + iv + auth tag.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VaultScope = "personal" | "shared";

export interface VaultItem {
  id: string;
  scope: VaultScope;
  title: string;
  has_notes: boolean;
  created_by: string;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultRevealed {
  id: string;
  value: string;
  notes: string | null;
}

function validateScope(s: unknown): VaultScope {
  if (s === "personal" || s === "shared") return s;
  throw new Error("scope must be 'personal' or 'shared'");
}

function validateTitle(t: unknown): string {
  const s = String(t ?? "").trim();
  if (!s) throw new Error("title is required");
  if (s.length > 200) throw new Error("title too long (max 200)");
  return s;
}

function validateValue(v: unknown): string {
  const s = String(v ?? "");
  if (!s) throw new Error("value is required");
  if (s.length > 24_000) throw new Error("value too long (max 24,000 chars)");
  return s;
}

function validateNotes(n: unknown): string | null {
  if (n == null || n === "") return null;
  const s = String(n);
  if (s.length > 24_000) throw new Error("notes too long (max 24,000 chars)");
  return s;
}

export const listVaultItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scope: VaultScope }) => ({ scope: validateScope(d?.scope) }))
  .handler(async ({ context, data }): Promise<VaultItem[]> => {
    let q = context.supabase
      .from("vault_secrets")
      .select("id, scope, title, notes_ciphertext, created_by, owner_user_id, created_at, updated_at")
      .eq("scope", data.scope)
      .order("title", { ascending: true });
    if (data.scope === "personal") q = q.eq("owner_user_id", context.userId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      scope: r.scope as VaultScope,
      title: r.title as string,
      has_notes: Boolean(r.notes_ciphertext),
      created_by: r.created_by as string,
      owner_user_id: (r.owner_user_id as string | null) ?? null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    }));
  });

export const createVaultItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scope: VaultScope; title: string; value: string; notes?: string | null }) => ({
    scope: validateScope(d?.scope),
    title: validateTitle(d?.title),
    value: validateValue(d?.value),
    notes: validateNotes(d?.notes),
  }))
  .handler(async ({ context, data }): Promise<VaultItem> => {
    const { seal } = await import("./vault-crypto.server");
    const v = await seal(data.value);
    const n = data.notes ? await seal(data.notes) : null;
    const { data: row, error } = await context.supabase
      .from("vault_secrets")
      .insert({
        scope: data.scope,
        owner_user_id: data.scope === "personal" ? context.userId : null,
        created_by: context.userId,
        title: data.title,
        value_ciphertext: v.ciphertext,
        value_iv: v.iv,
        value_tag: v.tag,
        notes_ciphertext: n?.ciphertext ?? null,
        notes_iv: n?.iv ?? null,
        notes_tag: n?.tag ?? null,
      })
      .select("id, scope, title, notes_ciphertext, created_by, owner_user_id, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id as string,
      scope: row.scope as VaultScope,
      title: row.title as string,
      has_notes: Boolean(row.notes_ciphertext),
      created_by: row.created_by as string,
      owner_user_id: (row.owner_user_id as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  });

export const updateVaultItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; title?: string; value?: string; notes?: string | null }) => {
    const id = String(d?.id ?? "");
    if (!id) throw new Error("id is required");
    const patch: { id: string; title?: string; value?: string; notes?: string | null } = { id };
    if (d?.title !== undefined) patch.title = validateTitle(d.title);
    if (d?.value !== undefined) patch.value = validateValue(d.value);
    if (d?.notes !== undefined) patch.notes = validateNotes(d.notes);
    return patch;
  })
  .handler(async ({ context, data }): Promise<VaultItem> => {
    const { seal } = await import("./vault-crypto.server");
    const update: {
      title?: string;
      value_ciphertext?: string;
      value_iv?: string;
      value_tag?: string;
      notes_ciphertext?: string | null;
      notes_iv?: string | null;
      notes_tag?: string | null;
    } = {};
    if (data.title !== undefined) update.title = data.title;
    if (data.value !== undefined) {
      const v = await seal(data.value);
      update.value_ciphertext = v.ciphertext;
      update.value_iv = v.iv;
      update.value_tag = v.tag;
    }
    if (data.notes !== undefined) {
      if (data.notes == null) {
        update.notes_ciphertext = null;
        update.notes_iv = null;
        update.notes_tag = null;
      } else {
        const n = await seal(data.notes);
        update.notes_ciphertext = n.ciphertext;
        update.notes_iv = n.iv;
        update.notes_tag = n.tag;
      }
    }
    const { data: row, error } = await context.supabase
      .from("vault_secrets")
      .update(update)
      .eq("id", data.id)
      .select("id, scope, title, notes_ciphertext, created_by, owner_user_id, created_at, updated_at")
      .single();

    if (error) throw new Error(error.message);
    return {
      id: row.id as string,
      scope: row.scope as VaultScope,
      title: row.title as string,
      has_notes: Boolean(row.notes_ciphertext),
      created_by: row.created_by as string,
      owner_user_id: (row.owner_user_id as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  });

export const deleteVaultItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "");
    if (!id) throw new Error("id is required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("vault_secrets")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Reveal: decrypts and returns the plaintext value (and notes) for a single item.
 * RLS scopes which rows the caller is allowed to read. */
export const revealVaultItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    const id = String(d?.id ?? "");
    if (!id) throw new Error("id is required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<VaultRevealed> => {
    const { data: row, error } = await context.supabase
      .from("vault_secrets")
      .select("id, value_ciphertext, value_iv, value_tag, notes_ciphertext, notes_iv, notes_tag")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const { open } = await import("./vault-crypto.server");
    const value = open({
      ciphertext: row.value_ciphertext as string,
      iv: row.value_iv as string,
      tag: row.value_tag as string,
    });
    let notes: string | null = null;
    if (row.notes_ciphertext && row.notes_iv && row.notes_tag) {
      notes = open({
        ciphertext: row.notes_ciphertext as string,
        iv: row.notes_iv as string,
        tag: row.notes_tag as string,
      });
    }
    return { id: row.id as string, value, notes };
  });
