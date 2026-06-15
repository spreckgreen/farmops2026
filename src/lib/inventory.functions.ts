import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const KNOWN = [
  "sku",
  "name",
  "category",
  "location",
  "quantity",
  "unit",
  "reorder_level",
  "unit_cost",
  "vendor",
  "notes",
] as const;

const RecordSchema = z
  .object({
    sku: z.string().trim().max(200).nullable().optional(),
    name: z.string().trim().max(500).nullable().optional(),
    category: z.string().trim().max(200).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    quantity: z.union([z.number(), z.string()]).nullable().optional(),
    unit: z.string().trim().max(50).nullable().optional(),
    reorder_level: z.union([z.number(), z.string()]).nullable().optional(),
    unit_cost: z.union([z.number(), z.string()]).nullable().optional(),
    vendor: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    raw: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

const InputSchema = z.object({
  records: z.array(RecordSchema).min(1).max(5000),
  replace: z.boolean().optional(),
});

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

export const importInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.replace) {
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
      return {
        user_id: userId,
        sku: (known.sku as string | null | undefined) ?? null,
        name: (known.name as string | null | undefined) ?? null,
        category: (known.category as string | null | undefined) ?? null,
        location: (known.location as string | null | undefined) ?? null,
        quantity: toNumber(known.quantity),
        unit: (known.unit as string | null | undefined) ?? null,
        reorder_level: toNumber(known.reorder_level),
        unit_cost: toNumber(known.unit_cost),
        vendor: (known.vendor as string | null | undefined) ?? null,
        notes: (known.notes as string | null | undefined) ?? null,
        raw: extra,
      };
    });

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("inventory_items")
        .insert(chunk as never);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }
    return { inserted };
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
