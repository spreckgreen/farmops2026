// Server-only executor registry. Each entry turns a typed Action into DB writes.
// Executors are ordinary code, not AI. Called from apply.functions.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action, ActionResult } from "./types";

export interface ExecCtx {
  supabase: SupabaseClient;
  userId: string;
}

type CreateIntervalAction = Extract<Action, { type: "maintenance.create_interval" }>;

async function execCreateInterval(
  action: CreateIntervalAction,
  ctx: ExecCtx,
): Promise<ActionResult> {
  const label = `${action.asset_name} — ${action.title}`;
  try {
    let scheduledDate =
      action.first_due_date && /^\d{4}-\d{2}-\d{2}$/.test(action.first_due_date)
        ? new Date(action.first_due_date + "T12:00:00Z").toISOString()
        : null;
    let dueAt = action.first_due_date ?? null;
    let inferredRaw: Record<string, unknown> | null = null;

    // Usage-based interval with no AI-provided date: project one from the
    // asset's usage rate so the record shows up in calendar/date views.
    if (!scheduledDate && action.asset_id) {
      const { inferUsageScheduledDate } = await import("@/lib/usage-due-status");
      const [assetRes, snapsRes] = await Promise.all([
        ctx.supabase
          .from("inventory_items")
          .select("id, name, current_hours, current_miles, usage_tracking")
          .eq("id", action.asset_id)
          .maybeSingle(),
        ctx.supabase
          .from("asset_usage_snapshots")
          .select("recorded_at, hours, miles")
          .eq("user_id", ctx.userId)
          .eq("inventory_item_id", action.asset_id)
          .order("recorded_at", { ascending: true }),
      ]);
      const snapshots = (snapsRes.data ?? []).map((s: { recorded_at: string; hours: number | null; miles: number | null }) => ({
        recorded_at: s.recorded_at,
        hours: s.hours == null ? null : Number(s.hours),
        miles: s.miles == null ? null : Number(s.miles),
      }));
      const inferred = inferUsageScheduledDate(
        { recurrence: action.recurrence, scheduled_date: null } as never,
        (assetRes.data ?? undefined) as never,
        snapshots,
      );
      if (inferred) {
        scheduledDate = inferred.iso;
        dueAt = inferred.date;
        inferredRaw = {
          scheduled_date_inferred: true,
          scheduled_date_source: inferred.source,
          scheduled_date_rate_per_day: inferred.ratePerDay,
          scheduled_date_inferred_at: new Date().toISOString(),
        };
      }
    }

    const { data: rec, error } = await ctx.supabase
      .from("maintenance_records")
      .insert({
        user_id: ctx.userId,
        title: action.title.slice(0, 200),
        asset_id: action.asset_id,
        asset_name: action.asset_name.slice(0, 200),
        service_type: action.service_type.slice(0, 100),
        description: action.description.slice(0, 2000),
        status: "scheduled",
        scheduled_date: scheduledDate,
        due_at: dueAt,
        recurrence: action.recurrence.slice(0, 200),
        consumables_used: [] as never,
        ...(inferredRaw ? { raw: inferredRaw as never } : {}),
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(error.message);
    const recordId = rec?.id as string | undefined;
    if (!recordId) throw new Error("Insert returned no id");

    // Link parts to the record via procedure_links (inventory side only).
    const partsWithInv = action.parts.filter((p) => p.inventory_item_id);
    if (partsWithInv.length > 0) {
      // procedure_links requires a procedure_id — skip if none. We use a
      // sentinel: skip the link when procedure_id is absent. Parts are still
      // captured in description above.
    }

    return { ok: true, type: action.type, id: recordId, label };
  } catch (e) {
    return {
      ok: false,
      type: action.type,
      label,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function executeAction(
  action: Action,
  ctx: ExecCtx,
): Promise<ActionResult> {
  if (action.type === "maintenance.create_interval") {
    return execCreateInterval(action, ctx);
  }
  const unknown = action as Action;
  return {
    ok: false,
    type: unknown.type,
    label: "unknown",
    error: `No executor for action type: ${unknown.type}`,
  };
}
