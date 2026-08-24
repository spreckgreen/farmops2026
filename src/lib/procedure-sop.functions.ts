// Standard Operating Procedure (SOP) drafting for inventory items.
//
// Flow: pick an inventory item -> draftInventorySop() writes a TiddlyWiki-markup
// SOP from the item's own record (type, vendor, usage tracking, notes) plus its
// maintenance history and any already-linked procedures -> saveInventorySop()
// stores it in public.procedures and links it back to the item so it appears
// under that item's procedures.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateWikiName } from "@/lib/tinywiki";
import type { AiEscalation } from "@/lib/ai-feature-areas";
import type { TruncationSignal } from "@/lib/ai-truncation";
import type { SopHistoryRow, SopItemRecord } from "@/lib/procedure-sop";

export interface SopInventoryTarget {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  itemType: string | null;
  usageTracking: string;
  hasSop: boolean;
}

export interface SopDraft {
  inventoryItemId: string;
  suggestedName: string;
  body: string;
  model: string;
  latencyMs: number;
  contextUsed: { maintenanceRecords: number; linkedProcedures: number };
  truncation: TruncationSignal | null;
  escalation: AiEscalation | null;
}

/** Inventory items available as SOP subjects, ordered by name. */
export const listSopInventoryTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SopInventoryTarget[]> => {
    const { data: rows, error } = await context.supabase
      .from("inventory_items")
      .select("id, name, sku, category, item_type, usage_tracking")
      .eq("user_id", context.userId)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const { data: links } = await context.supabase
      .from("procedure_links")
      .select("inventory_item_id")
      .eq("user_id", context.userId)
      .not("inventory_item_id", "is", null);
    const linked = new Set(
      ((links ?? []) as Array<{ inventory_item_id: string | null }>)
        .map((l) => l.inventory_item_id)
        .filter((v): v is string => Boolean(v)),
    );

    return (
      (rows ?? []) as Array<{
        id: string;
        name: string | null;
        sku: string | null;
        category: string | null;
        item_type: string | null;
        usage_tracking: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      name: r.name || r.sku || "(unnamed item)",
      sku: r.sku ?? null,
      category: r.category ?? null,
      itemType: r.item_type ?? null,
      usageTracking: r.usage_tracking ?? "none",
      hasSop: linked.has(r.id),
    }));
  });

export const draftInventorySop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inventoryItemId: string; focus?: string }) => {
    const inventoryItemId = String(d?.inventoryItemId ?? "").trim();
    if (!inventoryItemId) throw new Error("inventoryItemId required");
    return { inventoryItemId, focus: String(d?.focus ?? "").trim().slice(0, 1000) };
  })
  .handler(async ({ context, data }): Promise<SopDraft> => {
    const { buildSopPrompt, sopItemLabel, stripHtml, unfence, SOP_SYSTEM_PROMPT } = await import(
      "@/lib/procedure-sop"
    );

    const { data: item, error } = await context.supabase
      .from("inventory_items")
      .select(
        "id, name, sku, category, item_type, vendor, location, unit, quantity, " +
          "usage_tracking, current_hours, current_miles, description, notes, tags, status",
      )
      .eq("user_id", context.userId)
      .eq("id", data.inventoryItemId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Inventory item not found.");
    const it = item as unknown as SopItemRecord & { id: string };
    const itemLabel = sopItemLabel(it);

    // Maintenance history gives the model real intervals and failure modes.
    const { data: records } = await context.supabase
      .from("maintenance_records")
      .select("title, service_type, description, performed_at, status")
      .eq("user_id", context.userId)
      .eq("asset_id", it.id)
      .order("performed_at", { ascending: false })
      .limit(15);
    const history = (records ?? []) as SopHistoryRow[];

    // Already-linked procedures: reuse the user's own wording and conventions.
    const { data: linkRows } = await context.supabase
      .from("procedure_links")
      .select("procedures(name, content)")
      .eq("user_id", context.userId)
      .eq("inventory_item_id", it.id)
      .limit(5);
    const linkedProcedures = (
      (linkRows ?? []) as Array<{ procedures: { name: string | null; content: string | null } | null }>
    )
      .map((r) => r.procedures)
      .filter((p): p is { name: string; content: string | null } => Boolean(p?.name))
      .map((p) => ({ name: p.name, text: stripHtml(p.content).slice(0, 1500) }));

    const system = SOP_SYSTEM_PROMPT;
    const prompt = buildSopPrompt({ item: it, history, linkedProcedures, focus: data.focus });

    // Per-feature routing: long-form prose, so it uses the "procedures" area
    // and escalates to hosted AI when a local run fails or truncates.
    const { resolveAreaAi, hostedHandle } = await import("@/lib/ai-routing.server");
    const ai = await resolveAreaAi("procedures", {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });
    let provider = ai.provider;
    let modelId = ai.modelId;
    let escalation: AiEscalation | null = null;

    const { generateText } = await import("ai");
    const started = Date.now();

    let result;
    try {
      result = await generateText({ model: provider(modelId), system, prompt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hosted = hostedHandle(
        ai,
        "error",
        `${modelId} failed (${message.slice(0, 200)}), so the SOP was written on hosted AI.`,
      );
      if (!hosted) throw err;
      provider = hosted.provider;
      modelId = hosted.modelId;
      escalation = hosted.escalation;
      result = await generateText({ model: provider(modelId), system, prompt });
    }

    if (!result.text.trim() || result.finishReason === "length") {
      const hosted = hostedHandle(
        ai,
        "truncated",
        `${modelId} returned a truncated or empty SOP, so it was rewritten on hosted AI.`,
      );
      if (hosted) {
        provider = hosted.provider;
        modelId = hosted.modelId;
        escalation = hosted.escalation;
        result = await generateText({ model: provider(modelId), system, prompt });
      }
    }

    const { getActiveContextLimit } = await import("@/lib/ai-context-limit.server");
    const { truncationOrNull } = await import("@/lib/ai-truncation");
    const { contextLength } = await getActiveContextLimit(modelId);
    const truncation = truncationOrNull({
      finishReason: result.finishReason,
      usage: result.usage,
      promptChars: system.length + prompt.length,
      outputText: result.text,
      contextLimit: contextLength,
      model: modelId,
    });

    const body = unfence(result.text);
    if (!body) throw new Error("The model returned an empty SOP. Try again or switch models.");

    return {
      inventoryItemId: it.id,
      suggestedName: `SOP — ${itemLabel}`.slice(0, 120),
      body,
      model: modelId,
      latencyMs: Date.now() - started,
      contextUsed: {
        maintenanceRecords: history.length,
        linkedProcedures: linkedProcedures.length,
      },
      truncation,
      escalation,
    };
  });

/** Save an approved draft as a procedure and link it to the inventory item. */
export const saveInventorySop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      inventoryItemId: string;
      name: string;
      body: string;
      mode?: "create" | "replace" | "append";
    }) => {
      const inventoryItemId = String(d?.inventoryItemId ?? "").trim();
      if (!inventoryItemId) throw new Error("inventoryItemId required");
      const name = validateWikiName(String(d?.name ?? ""));
      const body = String(d?.body ?? "").trim();
      if (!body) throw new Error("body required");
      const mode = d?.mode ?? "create";
      return { inventoryItemId, name, body, mode };
    },
  )
  .handler(async ({ context, data }) => {
    const { tidyProcedure } = await import("@/lib/tidy-tinywiki");
    const { buildTinyWikiHtml, extractBodyWiki } = await import("@/lib/tinywiki");
    const { appendProcedureBody } = await import("@/lib/procedure-append");

    const { data: existing } = await context.supabase
      .from("procedures")
      .select("name, content")
      .eq("user_id", context.userId)
      .eq("name", data.name)
      .maybeSingle();
    if (existing && data.mode === "create") {
      throw new Error(
        `A procedure named "${data.name}" already exists — rename the SOP, or choose to append to / replace the existing page.`,
      );
    }

    const merged =
      existing && data.mode === "append"
        ? appendProcedureBody(
            extractBodyWiki(String(existing.content ?? ""), data.name),
            data.body,
            "Generated SOP",
          )
        : data.body;
    const cleanBody = tidyProcedure(data.name, merged).body;
    const html = buildTinyWikiHtml(data.name, cleanBody);
    const { data: row, error } = await context.supabase
      .from("procedures")
      .upsert(
        { user_id: context.userId, name: data.name, content: html },
        { onConflict: "user_id,name" },
      )
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    const proc = row as { id: string; name: string };

    const { error: linkError } = await context.supabase.from("procedure_links").insert({
      user_id: context.userId,
      procedure_id: proc.id,
      inventory_item_id: data.inventoryItemId,
      notes: "Generated SOP",
    });
    // A duplicate link is harmless — the procedure itself saved fine.
    if (linkError && !/duplicate|unique/i.test(linkError.message)) {
      throw new Error(`Saved the procedure, but linking it failed: ${linkError.message}`);
    }

    return {
      ok: true as const,
      name: proc.name,
      linked: !linkError,
      mode: data.mode,
      appended: Boolean(existing) && data.mode === "append",
    };
  });
