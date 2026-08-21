/**
 * Shared task-health logic for the nightly job and the admin "run now" button.
 *
 * Two classes of problem are checked per user:
 *
 * 1. **Duplicate checkbox tasks** — strays created by the old daily-note parser
 *    (title still carries `#task/<slug>`, or an exact title twin). Planned by
 *    `planTaskMerges` / `planTitleCleanups` and merged into the canonical task.
 * 2. **Status drift** — `status`/`closed_at` pairs that contradict each other
 *    (`done` with no `closed_at`, or a `closed_at` on an open/blocked task).
 *    Reported by `findStatusDrift`; fixing is a single field write either way.
 *
 * Everything is idempotent: a second run over already-clean data plans nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  canonicalDoneUpdate,
  planTaskMerges,
  planTitleCleanups,
  type DedupeTask,
  type TaskMerge,
} from "./task-dedupe";
import { findStatusDrift, type StatusDrift } from "./task-status-window";

export type Db = SupabaseClient<Database>;

export type TaskHealthReport = {
  userId: string;
  applied: boolean;
  scannedTasks: number;
  merges: TaskMerge[];
  mergesApplied: number;
  titleCleanups: Array<{ id: string; from: string; to: string }>;
  drift: StatusDrift[];
  driftFixed: number;
  ranAt: string;
};

/** True when the report found something worth showing in the admin UI. */
export function hasFindings(r: TaskHealthReport): boolean {
  return r.merges.length + r.titleCleanups.length + r.drift.length > 0;
}

/**
 * Scan (and optionally repair) one user's tasks.
 *
 * `apply: false` is a pure read — safe to run on every schedule tick.
 * `bounded` caps how many merges a single run performs so a pathological
 * backlog can't turn one nightly invocation into an unbounded write storm.
 */
export async function scanTaskHealth(
  supabase: Db,
  userId: string,
  opts: { apply: boolean; maxMerges?: number } = { apply: false },
): Promise<TaskHealthReport> {
  const maxMerges = opts.maxMerges ?? 200;

  const { data: rows, error } = await supabase
    .from("tasks")
    .select("id, slug, title, status, closed_at, percent_complete, created_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const tasks = (rows ?? []) as DedupeTask[];
  const merges = planTaskMerges(tasks).slice(0, maxMerges);
  const titleCleanups = planTitleCleanups(tasks, merges);
  // Day-agnostic drift only: pass an empty log set so the "closed_at outside
  // the day" check (which needs a specific day's log) stays out of the job.
  const drift = findStatusDrift(tasks, new Date().toISOString().slice(0, 10), new Set());

  const report: TaskHealthReport = {
    userId,
    applied: opts.apply,
    scannedTasks: tasks.length,
    merges,
    mergesApplied: 0,
    titleCleanups,
    drift,
    driftFixed: 0,
    ranAt: new Date().toISOString(),
  };

  if (!opts.apply) return report;

  for (const merge of merges) {
    const update = canonicalDoneUpdate(merge);
    if (update) {
      const { error: upErr } = await supabase
        .from("tasks")
        .update(update)
        .eq("id", merge.canonicalId)
        .eq("user_id", userId);
      if (upErr) throw new Error(`canonical ${merge.canonicalSlug}: ${upErr.message}`);
    }

    for (const move of [
      { table: "activity_log" as const, column: "task_id" as const },
      { table: "project_design_elements" as const, column: "task_id" as const },
      { table: "summaries" as const, column: "scope_task_id" as const },
    ]) {
      const { error: mErr } = await supabase
        .from(move.table)
        .update({ [move.column]: merge.canonicalId } as never)
        .eq(move.column, merge.duplicateId)
        .eq("user_id", userId);
      if (mErr) throw new Error(`${move.table}: ${mErr.message}`);
    }

    const { error: delErr } = await supabase
      .from("tasks")
      .delete()
      .eq("id", merge.duplicateId)
      .eq("user_id", userId);
    if (delErr) throw new Error(`delete ${merge.duplicateSlug}: ${delErr.message}`);
    report.mergesApplied += 1;
  }

  for (const fix of titleCleanups) {
    const { error: tErr } = await supabase
      .from("tasks")
      .update({ title: fix.to })
      .eq("id", fix.id)
      .eq("user_id", userId);
    if (tErr) throw new Error(`title ${fix.id}: ${tErr.message}`);
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deleted = new Set(merges.map((m) => m.duplicateId));
  for (const d of drift) {
    if (deleted.has(d.taskId)) continue;
    const task = byId.get(d.taskId);
    if (!task) continue;
    const patch =
      d.kind === "done-without-closed-at"
        ? { closed_at: task.created_at, percent_complete: 100 }
        : d.kind === "closed-at-without-done"
          ? { closed_at: null }
          : null;
    if (!patch) continue;
    const { error: dErr } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", d.taskId)
      .eq("user_id", userId);
    if (dErr) throw new Error(`drift ${d.taskId}: ${dErr.message}`);
    report.driftFixed += 1;
  }

  return report;
}

/** Persist a report so the admin UI can show what the nightly job did. */
export async function recordTaskHealthRun(
  supabase: Db,
  report: TaskHealthReport,
  trigger: "scheduled" | "manual",
  error?: string,
): Promise<void> {
  const { error: insErr } = await supabase.from("task_health_runs").insert({
    user_id: report.userId,
    ran_at: report.ranAt,
    trigger,
    applied: report.applied,
    scanned_tasks: report.scannedTasks,
    merges: report.merges as never,
    merges_applied: report.mergesApplied,
    title_cleanups: report.titleCleanups as never,
    drift: report.drift as never,
    drift_fixed: report.driftFixed,
    status: error ? "error" : hasFindings(report) ? "findings" : "ok",
    error: error ?? null,
  });
  if (insErr) throw new Error(insErr.message);
}
