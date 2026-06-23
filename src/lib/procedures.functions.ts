// Server functions backing the Procedures pane.
// Each procedure is a self-contained TinyWiki HTML document stored per-user
// in public.procedures (RLS scoped to auth.uid()).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTinyWikiHtml, validateWikiName } from "@/lib/tinywiki";

export interface ProcedureRow {
  name: string;
  content: string;
  updated_at: string;
}

export const listProcedures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProcedureRow[]> => {
    const { data, error } = await context.supabase
      .from("procedures")
      .select("name, content, updated_at")
      .eq("user_id", context.userId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ProcedureRow[];
  });

export const getProcedure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) => {
    if (!d?.name) throw new Error("name required");
    return { name: String(d.name) };
  })
  .handler(async ({ context, data }): Promise<ProcedureRow | null> => {
    const { data: row, error } = await context.supabase
      .from("procedures")
      .select("name, content, updated_at")
      .eq("user_id", context.userId)
      .eq("name", data.name)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as ProcedureRow) ?? null;
  });

/** Save with wiki-markup body; persisted as full TinyWiki HTML. */
export const saveProcedureBody = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; body: string }) => {
    const name = validateWikiName(String(d?.name ?? ""));
    return { name, body: String(d?.body ?? "") };
  })
  .handler(async ({ context, data }): Promise<ProcedureRow> => {
    const html = buildTinyWikiHtml(data.name, data.body);
    const { data: row, error } = await context.supabase
      .from("procedures")
      .upsert(
        { user_id: context.userId, name: data.name, content: html },
        { onConflict: "user_id,name" },
      )
      .select("name, content, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as ProcedureRow;
  });

/** Save an already-built HTML doc verbatim (used by import). */
export const saveProcedureHtml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; html: string }) => {
    const name = validateWikiName(String(d?.name ?? ""));
    const html = String(d?.html ?? "");
    if (!/<div\s+id=["']storeArea["']/i.test(html)) {
      throw new Error('Not a TinyWiki file: missing <div id="storeArea">.');
    }
    return { name, html };
  })
  .handler(async ({ context, data }): Promise<ProcedureRow> => {
    const { data: row, error } = await context.supabase
      .from("procedures")
      .upsert(
        { user_id: context.userId, name: data.name, content: data.html },
        { onConflict: "user_id,name" },
      )
      .select("name, content, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as ProcedureRow;
  });

export const renameProcedure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { oldName: string; newName: string }) => {
    const oldName = String(d?.oldName ?? "");
    const newName = validateWikiName(String(d?.newName ?? ""));
    if (!oldName) throw new Error("oldName required");
    return { oldName, newName };
  })
  .handler(async ({ context, data }): Promise<ProcedureRow> => {
    if (data.oldName === data.newName) {
      const { data: row } = await context.supabase
        .from("procedures")
        .select("name, content, updated_at")
        .eq("user_id", context.userId)
        .eq("name", data.oldName)
        .single();
      return row as ProcedureRow;
    }
    const dup = await context.supabase
      .from("procedures")
      .select("name")
      .eq("user_id", context.userId)
      .eq("name", data.newName)
      .maybeSingle();
    if (dup.data) throw new Error(`A procedure named "${data.newName}" already exists.`);
    const { data: existing, error: readErr } = await context.supabase
      .from("procedures")
      .select("content")
      .eq("user_id", context.userId)
      .eq("name", data.oldName)
      .single();
    if (readErr || !existing) throw new Error("Procedure not found.");
    // Rebuild HTML under the new name so the embedded tiddler title matches.
    const { extractBodyWiki } = await import("@/lib/tinywiki");
    const body = extractBodyWiki(existing.content, data.oldName);
    const html = buildTinyWikiHtml(data.newName, body || `! ${data.newName}\n`);
    const { error: upErr } = await context.supabase
      .from("procedures")
      .update({ name: data.newName, content: html })
      .eq("user_id", context.userId)
      .eq("name", data.oldName);
    if (upErr) throw new Error(upErr.message);
    const { data: row } = await context.supabase
      .from("procedures")
      .select("name, content, updated_at")
      .eq("user_id", context.userId)
      .eq("name", data.newName)
      .single();
    return row as ProcedureRow;
  });

export const deleteProcedure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) => {
    if (!d?.name) throw new Error("name required");
    return { name: String(d.name) };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("procedures")
      .delete()
      .eq("user_id", context.userId)
      .eq("name", data.name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
