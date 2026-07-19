// Server functions backing the Procedures pane.
// Each procedure is a self-contained TinyWiki HTML document stored per-user
// in public.procedures (RLS scoped to auth.uid()).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTinyWikiHtml, validateWikiName } from "@/lib/tinywiki";
import { tidyProcedure } from "@/lib/tidy-tinywiki";


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
  .inputValidator((d: { name: string; body: string; tidy?: boolean }) => {
    const name = validateWikiName(String(d?.name ?? ""));
    return { name, body: String(d?.body ?? ""), tidy: d?.tidy !== false };
  })
  .handler(async ({ context, data }): Promise<ProcedureRow> => {
    // Tidy the body server-side so stored content stays normalized regardless
    // of which client wrote it (UI, API call, future import path).
    const cleanBody = data.tidy
      ? tidyProcedure(data.name, data.body).body
      : data.body;
    const html = buildTinyWikiHtml(data.name, cleanBody);
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

// -----------------------------------------------------------------------------
// Ask AI about your procedures — sends a user prompt plus a compact digest
// of the caller's own procedures (title + text-only excerpt) to the configured
// AI endpoint via createAiProvider, so the same self-host/Lovable/Ollama
// routing applies. Returns the model's answer + which sources it saw.
// -----------------------------------------------------------------------------
export interface ProceduresAiAnswer {
  answer: string;
  model: string;
  sources: string[];
  latencyMs: number;
}

export const askProceduresAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { prompt: string }) => {
    const prompt = String(d?.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt required");
    if (prompt.length > 2000) throw new Error("prompt too long (2000 char max)");
    return { prompt };
  })
  .handler(async ({ context, data }): Promise<ProceduresAiAnswer> => {
    const { data: rows, error } = await context.supabase
      .from("procedures")
      .select("name, content")
      .eq("user_id", context.userId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    // Strip HTML/wiki markup and cap each doc so we don't blow the context
    // window; naive but effective — the model just needs prose.
    const stripped = (rows ?? []).map((r) => {
      const text = String(r.content ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
      return { name: String(r.name), text };
    });

    // Build a compact context block; hard-cap total size around ~40 KB.
    const MAX_TOTAL = 40_000;
    const blocks: string[] = [];
    const used: string[] = [];
    let size = 0;
    for (const p of stripped) {
      const block = `### ${p.name}\n${p.text}\n`;
      if (size + block.length > MAX_TOTAL) break;
      blocks.push(block);
      used.push(p.name);
      size += block.length;
    }

    const { createAiProvider } = await import("./ai-gateway.server");
    const { provider, modelOverride } = await createAiProvider();
    // Default chat model for Lovable AI Gateway; ignored by custom/Ollama
    // when a modelOverride is set (which is the usual self-host case).
    const modelId = modelOverride ?? "google/gemini-3-flash-preview";

    const { generateText } = await import("ai");
    const started = Date.now();
    const result = await generateText({
      model: provider(modelId),
      system:
        "You are an assistant for a farm operations app. Answer the user's " +
        "question using ONLY the provided procedure documents. Cite the " +
        "procedure names you used inline like [Procedure Name]. If the " +
        "answer isn't in the procedures, say so plainly.",
      prompt:
        blocks.length === 0
          ? `The user has no procedures yet.\n\nQuestion: ${data.prompt}`
          : `Procedures:\n\n${blocks.join("\n")}\n\nQuestion: ${data.prompt}`,
    });

    return {
      answer: result.text.trim(),
      model: modelId,
      sources: used,
      latencyMs: Date.now() - started,
    };
  });
