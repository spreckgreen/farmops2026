// Suggest procedure documents that look like they belong to a kit, so they can
// be attached with one click from the kit panel.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { suggestKitProcedures, type KitProcedureSuggestion } from "@/lib/kit-procedure-match";

export interface KitSuggestionResult {
  kitName: string;
  suggestions: KitProcedureSuggestion[];
}

export const listKitProcedureSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kitItemId: string }) => {
    if (!d?.kitItemId) throw new Error("kitItemId required");
    return { kitItemId: String(d.kitItemId) };
  })
  .handler(async ({ context, data }): Promise<KitSuggestionResult> => {
    const { data: item, error: itemErr } = await context.supabase
      .from("inventory_items")
      .select("id, name")
      .eq("user_id", context.userId)
      .eq("id", data.kitItemId)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    const kitName = ((item as { name: string | null } | null)?.name ?? "").trim();
    if (!kitName) return { kitName: "", suggestions: [] };

    const [{ data: procs, error: procErr }, { data: links, error: linkErr }] = await Promise.all([
      context.supabase
        .from("procedures")
        .select("id, name, content")
        .eq("user_id", context.userId)
        .order("name", { ascending: true })
        .limit(500),
      context.supabase
        .from("procedure_links")
        .select("procedure_id")
        .eq("user_id", context.userId)
        .eq("inventory_item_id", data.kitItemId),
    ]);
    if (procErr) throw new Error(procErr.message);
    if (linkErr) throw new Error(linkErr.message);

    const linked = new Set(
      ((links ?? []) as Array<{ procedure_id: string }>).map((l) => l.procedure_id),
    );
    const candidates = ((procs ?? []) as Array<{ id: string; name: string | null; content: string | null }>)
      .filter((p) => p.name && !linked.has(p.id))
      .map((p) => ({ name: p.name as string, content: p.content ?? "" }));

    return { kitName, suggestions: suggestKitProcedures(kitName, candidates) };
  });
