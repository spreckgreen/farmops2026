import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TaskHealthReport } from "./task-health.server";

export type TaskHealthRunRow = {
  id: string;
  ran_at: string;
  trigger: string;
  applied: boolean;
  scanned_tasks: number;
  merges_applied: number;
  drift_fixed: number;
  status: string;
  error: string | null;
  merges: unknown;
  title_cleanups: unknown;
  drift: unknown;
};

export type TaskHealthJobState = {
  paused: boolean;
  pausedReason: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
} | null;

/** Recent nightly/manual runs for the signed-in user, newest first. */
export const listTaskHealthRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskHealthRunRow[]> => {
    const { data, error } = await context.supabase
      .from("task_health_runs")
      .select(
        "id, ran_at, trigger, applied, scanned_tasks, merges_applied, drift_fixed, status, error, merges, title_cleanups, drift",
      )
      .eq("user_id", context.userId)
      .order("ran_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []) as TaskHealthRunRow[];
  });

/** Nightly job status (paused / last run) — admin-only, read via service role. */
export const getTaskHealthJobState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskHealthJobState> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("job_locks")
      .select("paused, paused_reason, last_run_at, consecutive_failures")
      .eq("name", "task-health-nightly")
      .maybeSingle();
    if (!data) return null;
    return {
      paused: data.paused,
      pausedReason: data.paused_reason,
      lastRunAt: data.last_run_at,
      consecutiveFailures: data.consecutive_failures,
    };
  });

/** Clear a paused nightly job so the next scheduled tick runs again. */
export const resumeTaskHealthJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ resumed: true }> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("job_locks")
      .update({ paused: false, paused_reason: null, consecutive_failures: 0, locked_until: null })
      .eq("name", "task-health-nightly");
    if (error) throw new Error(error.message);
    return { resumed: true };
  });

/** Run the same scan the nightly job runs, for the signed-in user only. */
export const runTaskHealthNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apply?: boolean } | undefined) => ({
    apply: input?.apply ?? false,
  }))
  .handler(async ({ data, context }): Promise<TaskHealthReport> => {
    const { scanTaskHealth, recordTaskHealthRun } = await import("./task-health.server");
    const report = await scanTaskHealth(context.supabase, context.userId, {
      apply: data.apply,
      maxMerges: 200,
    });
    // Run rows are service-role writable only; the scan itself already ran as
    // the user (RLS-scoped), so this insert just records the outcome.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await recordTaskHealthRun(supabaseAdmin, report, "manual");
    return report;
  });
