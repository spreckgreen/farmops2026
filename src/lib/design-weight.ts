/**
 * Default weight (percent of a project's total design value) given to a task
 * that gets attached to a project automatically — e.g. when a daily-note line
 * carries a `#project/<slug>` tag matching a real project's slug.
 *
 * Example: committing `- [ ] Boiler pipe test ends #project/boiler-swap`
 * creates a design element on the "boiler-swap" project worth 10 points out of
 * the project's 100. Editable afterwards from the task page or /projects.
 */
export const DEFAULT_DESIGN_ELEMENT_WEIGHT = 10;

/** Clamp a user-entered weight into the valid 0–100 range. */
export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
