import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canonicalDoneUpdate,
  planTaskMerges,
  planTitleCleanups,
  type DedupeTask,
  type TaskMerge,
} from "./task-dedupe";

export type ReconcileResult = {
  dryRun: boolean;
  scannedTasks: number;
  merges: TaskMerge[];
  doneCarried: number;
  titleCleanups: Array<{ id: string; from: string; to: string }>;
  repointed: { activityLog: number; designElements: number; summaries: number };
  deleted: number;
  ranAt: string;
};

/**
 * Scans for duplicate tasks created from parsed checkbox lines, merges their
 * done status into the canonical `#task/<slug>` entry, repoints references, and
 * deletes the strays. `dryRun: true` (default) only reports the plan.
 */
export const reconcileDuplicateTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dryRun?: boolean } | undefined) => ({
    dryRun: input?.dryRun ?? true,
  }))
  .handler(async ({ data, context }): Promise<ReconcileResult> => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("tasks")
      .select("id, slug, title, status, closed_at, percent_complete, created_at")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const tasks = (rows ?? []) as DedupeTask[];
    const merges = planTaskMerges(tasks);
    const titleCleanups = planTitleCleanups(tasks, merges);
    const doneCarried = merges.filter((m) => m.carriesDone).length;

    const result: ReconcileResult = {
      dryRun: data.dryRun,
      scannedTasks: tasks.length,
      merges,
      doneCarried,
      titleCleanups,
      repointed: { activityLog: 0, designElements: 0, summaries: 0 },
      deleted: 0,
      ranAt: new Date().toISOString(),
    };

    if (data.dryRun || merges.length + titleCleanups.length === 0) return result;

    for (const merge of merges) {
      // 1. carry the done state onto the canonical task
      const update = canonicalDoneUpdate(merge);
      if (update) {
        const { error: upErr } = await supabase
          .from("tasks")
          .update(update)
          .eq("id", merge.canonicalId)
          .eq("user_id", userId);
        if (upErr) throw new Error(`canonical ${merge.canonicalSlug}: ${upErr.message}`);
      }

      // 2. repoint everything that referenced the duplicate
      const logMove = await supabase
        .from("activity_log")
        .update({ task_id: merge.canonicalId })
        .eq("task_id", merge.duplicateId)
        .eq("user_id", userId)
        .select("id");
      if (logMove.error) throw new Error(`activity_log: ${logMove.error.message}`);
      result.repointed.activityLog += logMove.data?.length ?? 0;

      const deMove = await supabase
        .from("project_design_elements")
        .update({ task_id: merge.canonicalId })
        .eq("task_id", merge.duplicateId)
        .eq("user_id", userId)
        .select("id");
      if (deMove.error)
        throw new Error(`project_design_elements: ${deMove.error.message}`);
      result.repointed.designElements += deMove.data?.length ?? 0;

      const sumMove = await supabase
        .from("summaries")
        .update({ scope_task_id: merge.canonicalId })
        .eq("scope_task_id", merge.duplicateId)
        .eq("user_id", userId)
        .select("id");
      if (sumMove.error) throw new Error(`summaries: ${sumMove.error.message}`);
      result.repointed.summaries += sumMove.data?.length ?? 0;


      // 3. drop the duplicate
      const { error: delErr } = await supabase
        .from("tasks")
        .delete()
        .eq("id", merge.duplicateId)
        .eq("user_id", userId);
      if (delErr) throw new Error(`delete ${merge.duplicateSlug}: ${delErr.message}`);
      result.deleted += 1;
    }

    for (const fix of titleCleanups) {
      const { error: tErr } = await supabase
        .from("tasks")
        .update({ title: fix.to })
        .eq("id", fix.id)
        .eq("user_id", userId);
      if (tErr) throw new Error(`title ${fix.id}: ${tErr.message}`);
    }

    return result;
  });
