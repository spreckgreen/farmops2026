import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TaskHealthReport } from "./task-health.server";
import type { TaskMerge } from "./task-dedupe";
import type { StatusDrift } from "./task-status-window";

// Admin gate reads `user_roles` under RLS — the `has_role()` helper lives in the
// private schema and is not exposed through PostgREST.
async function requireAdmin(
  supabase: { from: (t: "user_roles") => any },
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

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
  merges: TaskMerge[];
  title_cleanups: Array<{ id: string; from: string; to: string }>;
  drift: StatusDrift[];
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
    await requireAdmin(context.supabase as never, context.userId);
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
    await requireAdmin(context.supabase as never, context.userId);
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

export type DayStampRecomputeResult = {
  applied: boolean;
  scannedTasks: number;
  fixes: import("./task-day-stamps").DayStampFix[];
  updated: number;
};

/**
 * Bulk "recompute day stamps": compare every task's `closed_at`/`start_at`
 * against the daily notes its activity log lives in, and restamp the ones whose
 * farm-local day drifted (the old UTC-based bug). `apply: false` previews.
 */
export const recomputeTaskDayStamps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apply?: boolean } | undefined) => ({
    apply: input?.apply ?? false,
  }))
  .handler(async ({ data, context }): Promise<DayStampRecomputeResult> => {
    const { planDayStampFixes, dayStampUpdates } = await import("./task-day-stamps");

    const { data: tasks, error: taskErr } = await context.supabase
      .from("tasks")
      .select("id, slug, title, status, closed_at, start_at")
      .eq("user_id", context.userId);
    if (taskErr) throw new Error(taskErr.message);

    const { data: logRows, error: logErr } = await context.supabase
      .from("activity_log")
      .select("task_id, created_at, daily_notes(date)")
      .eq("user_id", context.userId)
      .not("task_id", "is", null);
    if (logErr) throw new Error(logErr.message);

    const entries = (logRows ?? []).map((r) => {
      const note = (r as { daily_notes?: { date?: string } | null }).daily_notes;
      return {
        task_id: r.task_id,
        note_date: note?.date ?? null,
        created_at: r.created_at,
      };
    });

    const fixes = planDayStampFixes(tasks ?? [], entries);
    let updated = 0;
    if (data.apply) {
      for (const { taskId, patch } of dayStampUpdates(fixes)) {
        const { error } = await context.supabase
          .from("tasks")
          .update(patch)
          .eq("id", taskId)
          .eq("user_id", context.userId);
        if (error) throw new Error(`task ${taskId}: ${error.message}`);
        updated += 1;
      }
    }

    return { applied: data.apply, scannedTasks: (tasks ?? []).length, fixes, updated };
  });
