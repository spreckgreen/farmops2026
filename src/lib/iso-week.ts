// Shared ISO-week helpers used by every exporter (Obsidian, TiddlyWiki, …).
//
// Weekly status reports are deduped by `isoWeekKey(period_start) + scope`.
// Keeping a single implementation guarantees Obsidian and TiddlyWiki always
// agree on which rows collapse together — otherwise tiny timezone differences
// (e.g. one exporter using local time, the other UTC) produce off-by-one weeks
// and the "one report per week" invariant silently breaks for users near
// week boundaries.
//
// Rules:
//   * Always interpret the input instant in UTC. `period_start` is stored as
//     an ISO timestamp; reading it in local time would shift the week for
//     users east of UTC late on Sunday or west of UTC early on Monday.
//   * ISO weeks start on Monday. We snap to the Monday of the week the
//     instant falls in, then format `YYYY-MM-DD` (UTC) as the stable key.
//   * Invalid / empty inputs return a stable sentinel (`""` for empty,
//     the raw string for unparseable) so callers can still group them
//     deterministically without throwing.

export function isoWeekMondayUTC(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff),
  );
  return monday;
}

export function isoWeekKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const monday = isoWeekMondayUTC(iso);
  if (!monday) return iso ?? "";
  return monday.toISOString().slice(0, 10);
}

export type WeeklyDedupeRow = {
  mode: string;
  period_start: string | null;
  scope_project?: string | null;
  created_at: string;
};

// Collapse multiple `weekly_report` rows that share an ISO week + scope to
// the most recently created row. Non-weekly rows pass through unchanged and
// keep their original order.
export function dedupeWeeklyReports<T extends WeeklyDedupeRow>(rows: T[]): T[] {
  const winners = new Map<string, T>();
  const passthrough: T[] = [];
  for (const r of rows) {
    if (r.mode !== "weekly_report") {
      passthrough.push(r);
      continue;
    }
    const key = `${isoWeekKey(r.period_start)}|${r.scope_project ?? ""}`;
    const prev = winners.get(key);
    if (!prev || (r.created_at ?? "") > (prev.created_at ?? "")) {
      winners.set(key, r);
    }
  }
  return [...passthrough, ...winners.values()];
}
