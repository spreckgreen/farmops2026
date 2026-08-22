/**
 * Recompute task day stamps (`closed_at`, `start_at`) so they land on the farm
 * calendar day the work was actually logged on.
 *
 * Why: before the farm-timezone fix, a checkbox ticked at 23:10 Friday in New
 * York stamped `closed_at = 2026-08-22T03:10:00Z` — Saturday in UTC — so the
 * task reappeared on Saturday's board. The daily note it was logged in is the
 * authority: `daily_notes.date = "2026-08-21"`.
 *
 * Example:
 *   planDayStampFixes(
 *     [{ id: "t1", slug: "fix-gate", title: "Fix gate", status: "done",
 *        closed_at: "2026-08-22T03:10:00.000Z", start_at: null }],
 *     [{ task_id: "t1", note_date: "2026-08-21", created_at: "2026-08-22T03:10:00.000Z" }],
 *   )
 *   // => [{ taskId: "t1", field: "closed_at", fromDay: "2026-08-22",
 *   //       toDay: "2026-08-21", to: "2026-08-21T23:10:00.000Z", ... }]
 *
 * Pure: no database access, so the admin UI can preview before applying.
 */
import { appDateString } from "./app-timezone";
import { dayStartUtc } from "./app-timezone";
import { dayWindow } from "./task-status-window";

export type DayStampTask = {
  id: string;
  slug: string;
  title: string;
  status: string;
  closed_at: string | null;
  start_at: string | null;
};

/** One activity-log row, with the calendar date of the note it was written in. */
export type DayStampLogEntry = {
  task_id: string | null;
  /** `daily_notes.date` for the note that owns the entry, when it has one. */
  note_date: string | null;
  created_at: string;
};

export type DayStampFix = {
  taskId: string;
  slug: string;
  title: string;
  field: "closed_at" | "start_at";
  from: string;
  /** Farm-local day the stored stamp currently reads as. */
  fromDay: string;
  to: string;
  /** Farm-local day the log says the work belongs to. */
  toDay: string;
  reason: string;
};

/**
 * Farm-local day each task's log activity happened on.
 * `first` = earliest logged day (start), `last` = latest logged day (close).
 */
export function loggedDaysByTask(
  entries: DayStampLogEntry[],
): Map<string, { first: string; last: string }> {
  const out = new Map<string, { first: string; last: string }>();
  for (const e of entries) {
    if (!e.task_id) continue;
    const day = e.note_date ?? appDateString(new Date(e.created_at));
    const cur = out.get(e.task_id);
    if (!cur) {
      out.set(e.task_id, { first: day, last: day });
      continue;
    }
    if (day < cur.first) cur.first = day;
    if (day > cur.last) cur.last = day;
  }
  return out;
}

/**
 * Keep the local wall-clock time of `stamp` but move it onto `day`.
 * "2026-08-22T03:10Z" (23:10 Sat-eve local) onto "2026-08-21" =>
 * "2026-08-22T03:10Z" shifted back one day => "2026-08-21T03:10Z"? no —
 * the shift is by whole local days, so it becomes "2026-08-21T03:10Z"'s
 * equivalent: 23:10 on 2026-08-21 local = "2026-08-22T03:10Z" minus 24h.
 */
function restampOnto(day: string, stamp: string): string {
  const original = new Date(stamp).getTime();
  const fromDay = appDateString(new Date(stamp));
  const delta = dayStartUtc(day).getTime() - dayStartUtc(fromDay).getTime();
  const shifted = new Date(original + delta).toISOString();
  const { start, end } = dayWindow(day);
  if (shifted >= start && shifted <= end) return shifted;
  // DST edge or malformed stamp: fall back to midday of the target day.
  return new Date(dayStartUtc(day).getTime() + 12 * 3600 * 1000).toISOString();
}

/**
 * Timestamps whose farm-local day disagrees with the day their activity log
 * (i.e. the daily note they were written in) says they belong to.
 *
 * Only tasks that actually have log entries are touched — a task with no log
 * history has no independent authority to compare against.
 */
export function planDayStampFixes(
  tasks: DayStampTask[],
  entries: DayStampLogEntry[],
): DayStampFix[] {
  const logged = loggedDaysByTask(entries);
  const fixes: DayStampFix[] = [];

  for (const t of tasks) {
    const days = logged.get(t.id);
    if (!days) continue;

    if (t.status === "done" && t.closed_at) {
      const currentDay = appDateString(new Date(t.closed_at));
      if (currentDay !== days.last) {
        fixes.push({
          taskId: t.id,
          slug: t.slug,
          title: t.title,
          field: "closed_at",
          from: t.closed_at,
          fromDay: currentDay,
          to: restampOnto(days.last, t.closed_at),
          toDay: days.last,
          reason: `last logged on ${days.last} but closed_at reads ${currentDay}`,
        });
      }
    }

    if (t.start_at) {
      const currentDay = appDateString(new Date(t.start_at));
      // Only pull a start stamp back to the first logged day — never push it
      // forward, since a task can legitimately be started before it's logged.
      if (currentDay > days.first) {
        fixes.push({
          taskId: t.id,
          slug: t.slug,
          title: t.title,
          field: "start_at",
          from: t.start_at,
          fromDay: currentDay,
          to: restampOnto(days.first, t.start_at),
          toDay: days.first,
          reason: `first logged on ${days.first} but start_at reads ${currentDay}`,
        });
      }
    }
  }

  return fixes;
}

/** Per-task field updates, ready to write. One row per task. */
export function dayStampUpdates(
  fixes: DayStampFix[],
): Array<{ taskId: string; patch: { closed_at?: string; start_at?: string } }> {
  const byTask = new Map<string, { closed_at?: string; start_at?: string }>();
  for (const f of fixes) {
    const patch = byTask.get(f.taskId) ?? {};
    patch[f.field] = f.to;
    byTask.set(f.taskId, patch);
  }
  return [...byTask].map(([taskId, patch]) => ({ taskId, patch }));
}
