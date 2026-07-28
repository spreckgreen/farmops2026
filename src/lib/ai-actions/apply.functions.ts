// Server function that applies an approved ActionPlan.
// Idempotent per plan_id: re-submitting the same plan returns the prior result.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Action, ActionPlan, ActionResult, ActionStatus } from "./types";

const PartSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  inventory_item_id: z.string().uuid().nullable(),
});

const ActionSchema: z.ZodType<Action> = z.object({
  type: z.literal("maintenance.create_interval"),
  asset_id: z.string().uuid().nullable(),
  asset_name: z.string(),
  title: z.string(),
  service_type: z.string(),
  description: z.string(),
  trigger_type: z.enum(["hours", "miles", "months"]),
  interval_value: z.number(),
  first_due_date: z.string().nullable(),
  recurrence: z.string(),
  parts: z.array(PartSchema),
  notes: z.string().nullable(),
});

const PlanSchema = z.object({
  plan_id: z.string().uuid(),
  surface: z.string(),
  summary: z.string(),
  actions: z.array(ActionSchema),
  citations: z.array(z.string()),
  model: z.string(),
});

export const applyActionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlanSchema.parse(d))
  .handler(async ({ data, context }): Promise<{
    status: ActionStatus;
    results: ActionResult[];
    log_id: string;
    reused: boolean;
  }> => {
    const { supabase, userId } = context;
    const plan = data as ActionPlan;

    // Idempotency check — return prior result for the same plan_id.
    const existing = await supabase
      .from("ai_action_log")
      .select("id, status, result")
      .eq("user_id", userId)
      .eq("id", plan.plan_id)
      .maybeSingle();
    if (existing.data) {
      return {
        status: existing.data.status as ActionStatus,
        results: (existing.data.result as { results?: ActionResult[] } | null)
          ?.results ?? [],
        log_id: existing.data.id,
        reused: true,
      };
    }

    // Insert pending log row keyed by plan_id.
    const { error: insErr } = await supabase.from("ai_action_log").insert({
      id: plan.plan_id,
      user_id: userId,
      surface: plan.surface,
      plan: plan as unknown as never,
      status: "pending",
    } as never);
    if (insErr) throw new Error(`Failed to record plan: ${insErr.message}`);

    // Execute actions sequentially — small counts, easier to reason about.
    const { executeAction } = await import("./registry.server");
    const results: ActionResult[] = [];
    for (const action of plan.actions) {
      results.push(await executeAction(action, { supabase, userId }));
    }

    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    const status: ActionStatus =
      fail === 0 ? "applied" : ok === 0 ? "failed" : "partial";

    await supabase
      .from("ai_action_log")
      .update({
        result: { results } as unknown as never,
        status,
        applied_at: new Date().toISOString(),
      } as never)
      .eq("id", plan.plan_id)
      .eq("user_id", userId);

    return { status, results, log_id: plan.plan_id, reused: false };
  });
