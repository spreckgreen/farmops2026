export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Today in the farm's timezone — must match what server functions use. */
export function todayDateString(): string {
  return appDateString();
}

/**
 * Fields written to `tasks` when a task title changes.
 *
 * INVARIANT — a task slug is immutable for the life of the task. It is the
 * stable reference used by `#task/<slug>` lines in daily notes and by
 * `/tasks/<slug>` URLs, so renaming "Fix gate" to "Fix north pasture gate"
 * must keep the slug `fix-gate`. Every code path that renames a task must
 * build its patch here so no `slug` key can leak into the update.
 *
 * Example:
 *   taskRenamePatch("Fix north pasture gate") // => { title: "Fix north pasture gate" }
 */
export function taskRenamePatch(nextTitle: string): { title: string } {
  return { title: nextTitle };
}

/** True when a `tasks` update payload would mutate the immutable slug. */
export function patchMutatesSlug(patch: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, "slug");
}
