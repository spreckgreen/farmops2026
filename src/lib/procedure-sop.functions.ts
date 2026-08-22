// Standard Operating Procedure (SOP) drafting for inventory items.
//
// Flow: pick an inventory item -> draftInventorySop() writes a TiddlyWiki-markup
// SOP using the item's own record (type, vendor, usage tracking, notes) plus its
// maintenance history and any already-linked procedures -> saveInventorySop()
// stores it in public.procedures and links it back to the item so it shows up
// under the item's "Procedures" section.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateWikiName } from "@/lib/tinywiki";

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
  contextUsed: {
    maintenanceRecords: number;
    linkedProcedures: number;
  };
  truncation: import("./ai-truncation").TruncationSignal | null;
  escalation?: import("./ai-feature-areas").AiEscalation | null;
}

/** Inventory items available as SOP subjects, newest-first by name. */
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
      ((links ?? []) as { inventory_item_id: string | null }[])
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

function stripHtml(html: string): string {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip markdown/code fences the model sometimes wraps output in. */
function unfence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

const SOP_SECTIONS = [
  "Purpose",
  "Scope",
  "Safety",
  "Required tools and parts",
  "Pre-use checks",
  "Operating steps",
  "Shutdown and storage",
  "Routine maintenance",
  "Troubleshooting",
  "Records",
];

export const draftInventorySop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inventoryItemId: string; focus?: string }) => {
    const inventoryItemId = String(d?.inventoryItemId ?? "").trim();
    if (!inventoryItemId) throw new Error("inventoryItemId required");
    const focus = String(d?.focus ?? "").trim().slice(0, 1000);
    return { inventoryItemId, focus };
  })
  .handler(async ({ context, data }): Promise<SopDraft> => {
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
    const it = item as {
      id: string;
      name: string | null;
      sku: string | null;
      category: string | null;
      item_type: string | null;
      vendor: string | null;
      location: string | null;
      unit: string | null;
      quantity: number | null;
      usage_tracking: string | null;
      current_hours: number | null;
      current_miles: number | null;
      description: string | null;
      notes: string | null;
      tags: string[] | null;
      status: string | null;
    };
    const itemLabel = it.name || it.sku || "Inventory item";

    // Maintenance history gives the model real intervals and failure modes.
    const { data: records } = await context.supabase
      .from("maintenance_records")
      .select("title, service_type, description, performed_at, status")
      .eq("user_id", context.userId)
      .eq("asset_id", it.id)
      .order("performed_at", { ascending: false })
      .limit(15);
    const recordRows = (records ?? []) as Array<{
      title: string | null;
      service_type: string | null;
      description: string | null;
      performed_at: string | null;
      status: string | null;
    }>;

    // Already-linked procedures: reuse the user's own wording and conventions.
    const { data: linkRows } = await context.supabase
      .from("procedure_links")
      .select("procedures(name, content)")
      .eq("user_id", context.userId)
      .eq("inventory_item_id", it.id)
      .limit(5);
    const linkedProcs = ((linkRows ?? []) as Array<{
      procedures: { name: string | null; content: string | null } | null;
    }>)
      .map((r) => r.procedures)
      .filter((p): p is { name: string | null; content: string | null } => Boolean(p?.name))
      .map((p) => ({ name: String(p.name), text: stripHtml(p.content ?? "").slice(0, 1500) }));

    const itemBlock =
      `NAME: ${itemLabel}\n` +
      `SKU: ${it.sku ?? "(none)"}\n` +
      `CATEGORY: ${it.category ?? "(none)"}\n` +
      `TYPE: ${it.item_type ?? "(none)"}\n` +
      `VENDOR: ${it.vendor ?? "(none)"}\n` +
      `LOCATION: ${it.location ?? "(none)"}\n` +
      `ON HAND: ${it.quantity ?? 0} ${it.unit ?? ""}\n`.trimEnd() + "\n" +
      `STATUS: ${it.status ?? "(none)"}\n` +
      `USAGE TRACKING: ${it.usage_tracking ?? "none"} ` +
      `(hours: ${it.current_hours ?? 0}, miles: ${it.current_miles ?? 0})\n` +
      `TAGS: ${(it.tags ?? []).join(", ") || "(none)"}\n` +
      `DESCRIPTION: ${it.description ?? "(none)"}\n` +
      `NOTES: ${it.notes ?? "(none)"}`;

    const historyBlock =
      recordRows.length === 0
        ? "(no maintenance history)"
        : recordRows
            .map(
              (r) =>
                `- ${r.performed_at?.slice(0, 10) ?? "undated"} | ${r.service_type ?? "service"} | ` +
                `${r.title ?? "(untitled)"} | ${r.status ?? ""} | ` +
                `${String(r.description ?? "").slice(0, 200)}`,
            )
            .join("\n");

    const existingBlock =
      linkedProcs.length === 0
        ? "(none)"
        : linkedProcs.map((p) => `### ${p.name}\n${p.text}`).join("\n\n");

    // Per-feature routing: SOP drafting is long-form prose, so it uses the
    // "procedures" area (hosted by default) and escalates if a local run fails.
    const { resolveAreaAi, hostedHandle } = await import("./ai-routing.server");
    const ai = await resolveAreaAi("procedures", {
      hostedDefaultModel: "google/gemini-3-flash-preview",
    });
    let provider = ai.provider;
    let modelId = ai.modelId;
    let escalation: import("./ai-feature-areas").AiEscalation | null = null;

    const { generateText } = await import("ai");
    const started = Date.now();

    const system =
      "You write Standard Operating Procedures for a small farm's equipment and supplies. " +
      "Output TiddlyWiki markup ONLY — no HTML, no markdown fences, no preamble. " +
      "Markup rules: `!! Section` for section headings, `# step` for numbered steps, " +
      "`* point` for bullets, `''bold''` for emphasis. " +
      `Use exactly these sections, in order, each as a '!!' heading: ${SOP_SECTIONS.join(", ")}. ` +
      "Ground every specific (intervals, parts, capacities) in the provided item record, " +
      "maintenance history, or existing procedures. When a detail is unknown, write a " +
      "bracketed placeholder like [confirm from manufacturer manual] instead of inventing it. " +
      "Keep it practical and checkable: short imperative steps a helper could follow. " +
      "Safety must call out real hazards for this kind of item (fuel, PTO, blades, chemicals, " +
      "pressure, electricity) when they apply. Aim for 400-900 words.";

    const prompt =
      `ITEM RECORD:\n${itemBlock}\n\n` +
      `MAINTENANCE HISTORY:\n${historyBlock}\n\n` +
      `EXISTING LINKED PROCEDURES (match their conventions, do not duplicate them):\n${existingBlock}\n\n` +
      (data.focus ? `USER FOCUS / EXTRA CONTEXT:\n${data.focus}\n\n` : "") +
      `Write the SOP for: ${itemLabel}`;

    let result;
    try {
      result = await generateText({ model: provider(modelId), system, prompt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hosted = hostedHandle(
        ai,
        "error",
        `${modelId} failed (${message.slice(0, 200)}), so the SOP was rewritten on hosted AI.`,
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

    const { getActiveContextLimit } = await import("./ai-context-limit.server");
    const { truncationOrNull } = await import("./ai-truncation");
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
        maintenanceRecords: recordRows.length,
        linkedProcedures: linkedProcs.length,
      },
      truncation,
      escalation,
    };
  });

/** Save an approved draft as a procedure and link it to the inventory item. */
export const saveInventorySop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inventoryItemId: string; name: string; body: string }) => {
    const inventoryItemId = String(d?.inventoryItemId ?? "").trim();
    if (!inventoryItemId) throw new Error("inventoryItemId required");
    const name = validateWikiName(String(d?.name ?? ""));
    const body = String(d?.body ?? "").trim();
    if (!body) throw new Error("body required");
    return { inventoryItemId, name, body };
  })
  .handler(async ({ context, data }) => {
    const { tidyProcedure } = await import("@/lib/tidy-tinywiki");
    const { buildTinyWikiHtml } = await import("@/lib/tinywiki");

    const { data: existing } = await context.supabase
      .from("procedures")
      .select("name")
      .eq("user_id", context.userId)
      .eq("name", data.name)
      .maybeSingle();
    if (existing) {
      throw new Error(
        `A procedure named "${data.name}" already exists — rename the SOP before saving.`,
      );
    }

    const cleanBody = tidyProcedure(data.name, data.body).body;
    const html = buildTinyWikiHtml(data.name, cleanBody);
    const { data: row, error } = await context.supabase
      .from("procedures")
      .insert({ user_id: context.userId, name: data.name, content: html })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    const proc = row as { id: string; name: string };

    const { error: linkError } = await context.supabase.from("procedure_links").insert({
      user_id: context.userId,
      procedure_id: proc.id,
      inventory_item_id: data.inventoryItemId,
      maintenance_record_id: null,
      notes: "Generated SOP",
    });
    // A duplicate link is harmless — the procedure itself saved fine.
    if (linkError && !/duplicate|unique/i.test(linkError.message)) {
      throw new Error(`Saved the procedure, but linking it failed: ${linkError.message}`);
    }

    return { ok: true as const, name: proc.name, linked: !linkError };
  });
