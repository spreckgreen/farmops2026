import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const KNOWN = [
  "sku",
  "name",
  "description",
  "category",
  "location",
  "quantity",
  "unit",
  "reorder_level",
  "min_quantity",
  "unit_cost",
  "vendor",
  "notes",
  "status",
  "tags",
  "barcode",
  "current_hours",
  "current_miles",
  "usage_tracking",
] as const;

const RecordSchema = z
  .object({
    sku: z.string().trim().max(200).nullable().optional(),
    name: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    category: z.string().trim().max(200).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    quantity: z.union([z.number(), z.string()]).nullable().optional(),
    unit: z.string().trim().max(50).nullable().optional(),
    reorder_level: z.union([z.number(), z.string()]).nullable().optional(),
    min_quantity: z.union([z.number(), z.string()]).nullable().optional(),
    unit_cost: z.union([z.number(), z.string()]).nullable().optional(),
    vendor: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    status: z.string().trim().max(50).nullable().optional(),
    tags: z.union([z.array(z.string()), z.string()]).nullable().optional(),
    barcode: z.string().trim().max(200).nullable().optional(),
    current_hours: z.union([z.number(), z.string()]).nullable().optional(),
    current_miles: z.union([z.number(), z.string()]).nullable().optional(),
    usage_tracking: z.string().trim().max(50).nullable().optional(),
    raw: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

const InputSchema = z.object({
  records: z.array(RecordSchema).min(1).max(5000),
  mode: z.enum(["append", "replace", "merge"]).optional(),
  mergeKey: z.enum(["sku", "name", "barcode"]).optional(),
  replace: z.boolean().optional(),
});

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

function toTags(v: unknown): string[] | null {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toStatus(v: unknown): string {
  const s = (v == null ? "" : String(v)).trim().toLowerCase().replace(/\s+/g, "_");
  return ["available", "in_use", "maintenance", "retired"].includes(s) ? s : "available";
}

function normKey(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  return s === "" ? null : s;
}

export const importInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const mode = data.mode ?? (data.replace ? "replace" : "append");
    const mergeKey = data.mergeKey ?? "sku";

    if (mode === "replace") {
      const { error: delErr } = await supabase
        .from("inventory_items")
        .delete()
        .eq("user_id", userId);
      if (delErr) throw new Error(delErr.message);
    }

    const rows = data.records.map((rec) => {
      const known: Record<string, unknown> = {};
      const extra: Record<string, unknown> = { ...(rec.raw ?? {}) };
      for (const [k, v] of Object.entries(rec)) {
        if (k === "raw") continue;
        if ((KNOWN as readonly string[]).includes(k)) known[k] = v;
        else extra[k] = v;
      }
      // Sync reorder_level <-> min_quantity (WP uses min_quantity)
      const reorder = toNumber(known.reorder_level);
      const minQty = toNumber(known.min_quantity);
      return {
        user_id: userId,
        sku: (known.sku as string | null | undefined) ?? null,
        name: (known.name as string | null | undefined) ?? null,
        description: (known.description as string | null | undefined) ?? null,
        category: (known.category as string | null | undefined) ?? null,
        location: (known.location as string | null | undefined) ?? null,
        quantity: toNumber(known.quantity),
        unit: (known.unit as string | null | undefined) ?? null,
        reorder_level: reorder ?? minQty,
        min_quantity: minQty ?? reorder,
        unit_cost: toNumber(known.unit_cost),
        vendor: (known.vendor as string | null | undefined) ?? null,
        notes: (known.notes as string | null | undefined) ?? null,
        status: toStatus(known.status),
        tags: toTags(known.tags) ?? [],
        barcode: (known.barcode as string | null | undefined) ?? null,
        current_hours: toNumber(known.current_hours) ?? 0,
        current_miles: toNumber(known.current_miles) ?? 0,
        usage_tracking:
          (known.usage_tracking as string | null | undefined) ?? "none",
        raw: extra,
      };
    });

    if (mode === "merge") {
      const { data: existing, error: exErr } = await supabase
        .from("inventory_items")
        .select("id, sku, name")
        .eq("user_id", userId);
      if (exErr) throw new Error(exErr.message);

      const index = new Map<string, string>();
      for (const row of existing ?? []) {
        const key = normKey(mergeKey === "sku" ? row.sku : row.name);
        if (key && !index.has(key)) index.set(key, row.id);
      }

      let updated = 0;
      let inserted = 0;
      const toInsert: typeof rows = [];
      for (const r of rows) {
        const key = normKey(mergeKey === "sku" ? r.sku : r.name);
        const id = key ? index.get(key) : undefined;
        if (id) {
          const { user_id: _u, ...patch } = r;
          const { error } = await supabase
            .from("inventory_items")
            .update(patch as never)
            .eq("id", id)
            .eq("user_id", userId);
          if (error) throw new Error(error.message);
          updated += 1;
        } else {
          toInsert.push(r);
        }
      }
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500);
        const { error } = await supabase
          .from("inventory_items")
          .insert(chunk as never);
        if (error) throw new Error(error.message);
        inserted += chunk.length;
      }
      return { inserted, updated, mode, mergeKey };
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("inventory_items")
        .insert(chunk as never);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }
    return { inserted, updated: 0, mode, mergeKey };
  });

export const listInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("inventory_items")
      .select("*")
      .order("name", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("inventory_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
