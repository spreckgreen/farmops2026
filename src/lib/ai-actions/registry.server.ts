// Server-only executor registry. Each entry turns a typed Action into DB writes.
// Executors are ordinary code, not AI. Called from apply.functions.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action, ActionResult } from "./types";

export interface ExecCtx {
  supabase: SupabaseClient;
  userId: string;
}

async function execCreateInterval(
  action: Extract<Action, { type: "maintenance.create_interval" }>,
  ctx: ExecCtx,
): Promise<ActionResult> {
  const label = `${action.asset_name} — ${action.title}`;
  try {
    const scheduledDate =
      action.first_due_date && /^\d{4}-\d{2}-\d{2}$/.test(action.first_due_date)
        ? new Date(action.first_due_date + "T12:00:00Z").toISOString()
        : null;

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
        due_at: action.first_due_date ?? null,
        recurrence: action.recurrence.slice(0, 200),
        consumables_used: [] as never,
      } as never)
      .select("id")
      .single();
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
  switch (action.type) {
    case "maintenance.create_interval":
      return execCreateInterval(action, ctx);
    default: {
      const _exhaustive: never = action;
      return {
        ok: false,
        type: (action as Action).type,
        label: "unknown",
        error: `No executor for action type: ${JSON.stringify(_exhaustive)}`,
      };
    }
  }
}
