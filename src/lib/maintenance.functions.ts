import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Known columns. Anything else in a row goes into `raw`.
const KNOWN = [
  "asset_name",
  "asset_id",
  "title",
  "description",
  "service_type",
  "status",
  "performed_at",
  "due_at",
  "scheduled_date",
  "completed_date",
  "recurrence",
  "consumables_used",
  "cost",
  "vendor",
  "notes",
] as const;

const RecordSchema = z
  .object({
    asset_name: z.string().trim().max(500).nullable().optional(),
    asset_id: z.string().uuid().nullable().optional(),
    title: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    service_type: z.string().trim().max(500).nullable().optional(),
    status: z.string().trim().max(100).nullable().optional(),
    performed_at: z.string().trim().max(64).nullable().optional(),
    due_at: z.string().trim().max(64).nullable().optional(),
    scheduled_date: z.string().trim().max(64).nullable().optional(),
    completed_date: z.string().trim().max(64).nullable().optional(),
    recurrence: z.string().trim().max(100).nullable().optional(),
    consumables_used: z.union([z.array(z.any()), z.string()]).nullable().optional(),
    cost: z.union([z.number(), z.string()]).nullable().optional(),
    vendor: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    raw: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

const InputSchema = z.object({
  records: z.array(RecordSchema).min(1).max(5000),
  replace: z.boolean().optional(),
});

function toDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  // Accept YYYY-MM-DD or anything Date can parse.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toISO(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toJsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

export const importMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.replace) {
      const { error: delErr } = await supabase
        .from("maintenance_records")
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
      // Cross-map WP service_schedules fields onto our date columns
      const performed = toDate(known.performed_at ?? known.completed_date);
      const due = toDate(known.due_at ?? known.scheduled_date);
      const scheduledISO = toISO(known.scheduled_date ?? known.due_at);
      const completedISO = toISO(known.completed_date ?? known.performed_at);
      return {
        user_id: userId,
        asset_name: (known.asset_name as string | null | undefined) ?? null,
        asset_id: (known.asset_id as string | null | undefined) ?? null,
        title: (known.title as string | null | undefined) ?? null,
        description: (known.description as string | null | undefined) ?? null,
        service_type: (known.service_type as string | null | undefined) ?? null,
        status: (known.status as string | null | undefined) ?? null,
        recurrence: (known.recurrence as string | null | undefined) ?? "none",
        consumables_used: toJsonArray(known.consumables_used) as never,
        performed_at: performed,
        due_at: due,
        scheduled_date: scheduledISO,
        completed_date: completedISO,
        cost: toNumber(known.cost),
        vendor: (known.vendor as string | null | undefined) ?? null,
        notes: (known.notes as string | null | undefined) ?? null,
        raw: extra,
      };
    });

    // Insert in chunks of 500 to keep request size reasonable.
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("maintenance_records")
        .insert(chunk as never);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }
    const { syncMaintenancePlanDocs } = await import("@/lib/maintenance-plan-sync.server");
    await syncMaintenancePlanDocs(
      supabase,
      userId,
      rows.map((r) => r.asset_name),
    );
    return { inserted };
  });

export const listMaintenance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("maintenance_records")
      .select("*")
      .order("performed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("maintenance_records")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CreateSchema = z.object({
  title: z.string().trim().max(500).optional().nullable(),
  asset_name: z.string().trim().min(1).max(500),
  asset_id: z.string().uuid().optional().nullable(),
  service_type: z.string().trim().max(500).optional().nullable(),
  status: z.string().trim().max(100).optional().nullable(),
  scheduled_date: z.string().trim().max(64).optional().nullable(),
  performed_at: z.string().trim().max(64).optional().nullable(),
  due_at: z.string().trim().max(64).optional().nullable(),
  cost: z.union([z.number(), z.string()]).optional().nullable(),
  vendor: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

/**
 * Resolve an inventory item id from a free-text asset name (case-insensitive).
 * Falls back to a contains match so stored names with stray whitespace or a
 * slightly different model suffix (e.g. "Mower Z421KWT " vs "Mower Z421KWT")
 * still link up instead of silently dropping the asset connection.
 */
async function resolveAssetId(
  supabase: { from: (t: string) => any },
  userId: string,
  assetName: string | null | undefined,
): Promise<string | null> {
  const name = (assetName ?? "").trim();
  if (!name) return null;
  const exact = await supabase
    .from("inventory_items")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  const hit = (exact.data as { id: string } | null)?.id;
  if (hit) return hit;
  const escaped = name.replace(/[%_]/g, (m: string) => `\\${m}`);
  const fuzzy = await supabase
    .from("inventory_items")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", `%${escaped}%`)
    .limit(1)
    .maybeSingle();
  return (fuzzy.data as { id: string } | null)?.id ?? null;
}

export const createMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const assetId =
      data.asset_id ??
      (await resolveAssetId(context.supabase, context.userId, data.asset_name));
    const row = {
      user_id: context.userId,
      title: data.title ?? null,
      asset_name: data.asset_name,
      asset_id: assetId,
      service_type: data.service_type ?? null,
      status: data.status ?? "scheduled",
      recurrence: "none",
      consumables_used: [] as never,
      performed_at: toDate(data.performed_at),
      due_at: toDate(data.due_at),
      scheduled_date: toISO(data.scheduled_date),
      cost: toNumber(data.cost),
      vendor: data.vendor ?? null,
      notes: data.notes ?? null,
    };
    const { data: inserted, error } = await context.supabase
      .from("maintenance_records")
      .insert(row as never)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const { syncMaintenancePlanDocs } = await import("@/lib/maintenance-plan-sync.server");
    await syncMaintenancePlanDocs(context.supabase, context.userId, [data.asset_name]);
    return inserted;
  });

const UpdateSchema = CreateSchema.partial()
  .extend({
    id: z.string().uuid(),
    description: z.string().trim().max(5000).optional().nullable(),
    completed_date: z.string().trim().max(64).optional().nullable(),
    recurrence: z.string().trim().max(100).optional().nullable(),
  });

export const updateMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    // Only write a field when the caller actually sent it; `?? null` inside the
    // call would turn "omitted" into an explicit wipe.
    if (data.title !== undefined) patch.title = data.title ?? null;
    if (data.asset_id !== undefined && data.asset_id !== null) {
      // Explicit pick from the asset dropdown always wins.
      patch.asset_id = data.asset_id;
    }
    if (data.asset_name !== undefined) {
      patch.asset_name = data.asset_name;
      if (patch.asset_id === undefined) {
        // Keep the link in sync, but never clear an existing link on a miss.
        const resolved = await resolveAssetId(
          context.supabase,
          context.userId,
          data.asset_name,
        );
        if (resolved) patch.asset_id = resolved;
      }
    }
    if (data.service_type !== undefined) patch.service_type = data.service_type ?? null;
    if (data.status !== undefined) patch.status = data.status ?? null;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.recurrence !== undefined) patch.recurrence = data.recurrence ?? "none";
    if (data.vendor !== undefined) patch.vendor = data.vendor ?? null;
    if (data.notes !== undefined) patch.notes = data.notes ?? null;
    if (data.cost !== undefined) patch.cost = toNumber(data.cost);
    if (data.performed_at !== undefined) patch.performed_at = toDate(data.performed_at);
    if (data.due_at !== undefined) patch.due_at = toDate(data.due_at);
    if (data.scheduled_date !== undefined) patch.scheduled_date = toISO(data.scheduled_date);
    if (data.completed_date !== undefined) patch.completed_date = toISO(data.completed_date);

    const { data: updated, error } = await context.supabase
      .from("maintenance_records")
      .update(patch as never)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const { syncMaintenancePlanDocs } = await import("@/lib/maintenance-plan-sync.server");
    await syncMaintenancePlanDocs(context.supabase, context.userId, [
      (updated as { asset_name?: string | null } | null)?.asset_name ?? data.asset_name,
    ]);
    return updated;
  });

/**
 * Log a usage reading (engine hours / odometer miles) against the equipment a
 * maintenance record points at. Writing `current_hours` / `current_miles` also
 * fires the `snapshot_asset_usage` trigger, which keeps the usage history that
 * the maintenance forecast reads.
 */
const UsageSchema = z
  .object({
    asset_id: z.string().uuid().optional().nullable(),
    asset_name: z.string().trim().max(500).optional().nullable(),
    hours: z.union([z.number(), z.string()]).optional().nullable(),
    miles: z.union([z.number(), z.string()]).optional().nullable(),
  })
  .refine((v) => !!(v.asset_id || v.asset_name), { message: "An asset is required" });

export const logAssetUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UsageSchema.parse(d))
  .handler(async ({ data, context }) => {
    const hours = toNumber(data.hours);
    const miles = toNumber(data.miles);
    if (hours === null && miles === null) throw new Error("Enter hours or miles to log");

    let assetId = data.asset_id ?? null;
    if (!assetId && data.asset_name) {
      const { data: match, error: findErr } = await context.supabase
        .from("inventory_items")
        .select("id")
        .eq("user_id", context.userId)
        .ilike("name", data.asset_name)
        .limit(1)
        .maybeSingle();
      if (findErr) throw new Error(findErr.message);
      if (!match) throw new Error(`No inventory item named "${data.asset_name}"`);
      assetId = (match as { id: string }).id;
    }

    const patch: Record<string, unknown> = {};
    if (hours !== null) patch.current_hours = hours;
    if (miles !== null) patch.current_miles = miles;

    const { data: updated, error } = await context.supabase
      .from("inventory_items")
      .update(patch as never)
      .eq("id", assetId!)
      .eq("user_id", context.userId)
      .select("id, name, current_hours, current_miles, usage_tracking")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });
