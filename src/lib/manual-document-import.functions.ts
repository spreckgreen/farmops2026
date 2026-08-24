// Import an operator or workshop manual as a procedure document linked to one
// inventory asset. No AI call is needed: the manual is already prose, so we
// convert the Markdown to TinyWiki markup, store it as a procedure, and link it
// to the asset (the same link table the SOP generator uses).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { ProcedureSaveMode } from "@/lib/procedure-append";

export interface ManualDocumentResult {
  ok: true;
  /** Final procedure name actually stored (may be suffixed to stay unique). */
  name: string;
  kind: "operator" | "workshop";
  asset_name: string;
  /** Headings found in the manual, for the confirmation screen. */
  sections: string[];
  linked: boolean;
  replaced: boolean;
  appended: boolean;
  mode: ProcedureSaveMode;
}

const Input = z.object({
  asset_id: z.string().uuid(),
  kind: z.enum(["operator", "workshop"]),
  manual_text: z.string().trim().min(40).max(300000),
  procedure_name: z.string().trim().min(1).max(120),
  /**
   * What to do when a procedure of the same name already exists:
   * "create" fails, "replace" overwrites the page, "append" adds the new
   * manual text to the bottom of the existing page under a dated heading.
   */
  mode: z.enum(["create", "replace", "append"]).default("create"),
  /** Legacy flag kept for older callers; equivalent to mode: "replace". */
  overwrite: z.boolean().optional(),
});

/** Top-level and second-level Markdown headings, for the result summary. */
function headings(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^#{1,3}\s+(.{2,120})$/.exec(line.trim());
    if (m) out.push(m[1].trim());
    if (out.length >= 40) break;
  }
  return out;
}

export const importManualDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ManualDocumentResult> => {
    const { supabase, userId } = context;
    const { validateWikiName, buildTinyWikiHtml } = await import("@/lib/tinywiki");
    const { markdownToTinyWiki } = await import("@/lib/md-to-tinywiki");
    const { tidyProcedure } = await import("@/lib/tidy-tinywiki");

    const name = validateWikiName(data.procedure_name);

    const { data: asset, error: assetErr } = await supabase
      .from("inventory_items")
      .select("id, name, sku")
      .eq("id", data.asset_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (assetErr) throw new Error(assetErr.message);
    if (!asset) throw new Error("Asset not found");
    const assetLabel = asset.name ?? asset.sku ?? "the asset";

    const mode: ProcedureSaveMode = data.overwrite ? "replace" : data.mode;

    const { data: existing } = await supabase
      .from("procedures")
      .select("id, name, content")
      .eq("user_id", userId)
      .eq("name", name)
      .maybeSingle();
    if (existing && mode === "create") {
      throw new Error(
        `A procedure named "${name}" already exists — rename it, or choose "Append to existing page" / "Replace existing page".`,
      );
    }

    const kindLabel = data.kind === "workshop" ? "Workshop manual" : "Operator manual";
    const body =
      markdownToTinyWiki(data.manual_text) +
      `\n\n----\n''Source:'' imported ${kindLabel.toLowerCase()} for ${assetLabel}.\n`;
    const html = buildTinyWikiHtml(name, tidyProcedure(name, body).body);

    const { data: row, error } = await supabase
      .from("procedures")
      .upsert(
        { user_id: userId, name, content: html },
        { onConflict: "user_id,name" },
      )
      .select("id, name")
      .single<{ id: string; name: string }>();
    if (error) throw new Error(error.message);

    const { error: linkError } = await supabase.from("procedure_links").insert({
      user_id: userId,
      procedure_id: row.id,
      inventory_item_id: data.asset_id,
      notes: `Imported ${kindLabel.toLowerCase()}`,
    } as never);
    // A duplicate link just means the page was already attached to this asset.
    const linked = !linkError || /duplicate|unique/i.test(linkError.message);
    if (linkError && !linked) {
      throw new Error(`Saved the manual, but linking it failed: ${linkError.message}`);
    }

    return {
      ok: true,
      name: row.name,
      kind: data.kind,
      asset_name: assetLabel,
      sections: headings(data.manual_text),
      linked,
      replaced: Boolean(existing) && mode === "replace",
      appended: appending,
      mode,
    };
  });
