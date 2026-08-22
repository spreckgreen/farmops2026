/**
 * Keeps task `status` / `closed_at` from drifting away from the daily-note log
 * state that produced them.
 *
 * Two failure modes this guards against:
 *
 * 1. **Timezone drift.** Committing a note at 20:37 New York stamps
 *    `closed_at` at 00:37 UTC *the next day*. A Done filter that windows on the
 *    note's UTC date would then hide the task the user just checked off.
 * 2. **Filter drift.** The Done column is derived from `tasks.status`, but
 *    membership in "today" comes from `activity_log`. If those two disagree,
 *    the canonical task (the one the `#task/<slug>` points at) can vanish from
 *    every column.
 */
import { dayBoundsUtc } from "./app-timezone";

export type StatusWindowTask = {
  id: string;
  status: "open" | "blocked" | "done" | string;
  closed_at: string | null;
};

/**
 * UTC bounds of the farm-local day `date`. For America/New_York,
 * `dayWindow("2026-08-21")` spans 04:00Z Fri → 03:59:59.999Z Sat, so an 11pm
 * Friday commit lands inside Friday.
 */
export function dayWindow(date: string): { start: string; end: string } {
  return dayBoundsUtc(date);
}

/**
 * Timestamp to write when a checkbox on `noteDate` is checked.
 *
 * Uses the real clock when it already falls inside `noteDate` (UTC), otherwise
 * clamps to midday of `noteDate` so the stamp can never land outside the day
 * the note represents.
 */
export function closedStampFor(noteDate: string, now: Date = new Date()): string {
  const iso = now.toISOString();
  const { start, end } = dayWindow(noteDate);
  if (iso >= start && iso <= end) return iso;
  return `${noteDate}T12:00:00.000Z`;
}

/**
 * Should this task appear on `date`'s board?
 *
 * `loggedTaskIds` are the task ids referenced by that day's activity log —
 * the log is authoritative for "touched today". A done task qualifies when the
 * log references it (regardless of `closed_at` drift) or when `closed_at` lands
 * inside the day. Non-done tasks are never filtered out here.
 */
export function isTaskInDayView(
  task: StatusWindowTask,
  date: string,
  loggedTaskIds: Set<string>,
): boolean {
  if (task.status !== "done") return true;
  if (loggedTaskIds.has(task.id)) return true;
  if (!task.closed_at) return false;
  const { start, end } = dayWindow(date);
  return task.closed_at >= start && task.closed_at <= end;
}

export type StatusDrift = {
  taskId: string;
  kind: "done-without-closed-at" | "closed-at-without-done" | "closed-at-outside-day";
  detail: string;
};

/**
 * Reports tasks whose status/closed_at pair is internally inconsistent, so the
 * open-vs-done filters can be trusted. Pure — used by tests and diagnostics.
 */
export function findStatusDrift(
  tasks: StatusWindowTask[],
  date: string,
  loggedTaskIds: Set<string>,
): StatusDrift[] {
  const { start, end } = dayWindow(date);
  const out: StatusDrift[] = [];
  for (const t of tasks) {
    if (t.status === "done" && !t.closed_at) {
      out.push({
        taskId: t.id,
        kind: "done-without-closed-at",
        detail: "task is done but has no closed_at timestamp",
      });
      continue;
    }
    if (t.status !== "done" && t.closed_at) {
      out.push({
        taskId: t.id,
        kind: "closed-at-without-done",
        detail: `status is ${t.status} but closed_at is set`,
      });
      continue;
    }
    if (
      t.status === "done" &&
      t.closed_at &&
      loggedTaskIds.has(t.id) &&
      (t.closed_at < start || t.closed_at > end)
    ) {
      out.push({
        taskId: t.id,
        kind: "closed-at-outside-day",
        detail: `closed_at ${t.closed_at} is outside ${date} but the day's log references it`,
      });
    }
  }
  return out;
}
