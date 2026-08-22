/**
 * Pure helper used by `addTaskToToday`, `addMaintenanceToToday`, and
 * `addReorderToToday` to decide what today's daily-note markdown should look
 * like after a Backlog → Today move.
 *
 * Rules:
 *  - Always append `refLine` as a new line at the end of today's markdown,
 *    EVEN IF the same `#task/<slug>` substring is already present somewhere
 *    in the note. Today's note is seeded from the prior day's markdown
 *    (see `getDailyNote`), so the slug is often carried over from yesterday
 *    and we still want a fresh entry for today.
 *  - The ONLY suppression is when the exact `refLine` (after trimming) is
 *    already present as its own line — that means we already appended it
 *    earlier this same day and shouldn't duplicate it.
 *  - Empty/whitespace-only markdown becomes `refLine\n` (no leading blank).
 *  - Existing trailing whitespace/newlines are normalized via `trimEnd()`
 *    before appending so we don't accumulate blank lines.
 */
export function appendTaskRefLine(currentMarkdown: string, refLine: string): string {
  const md = currentMarkdown ?? "";
  const trimmedRef = refLine.trim();
  const lines = md.split("\n");
  const alreadyAppendedToday = lines.some((l) => l.trim() === trimmedRef);
  if (alreadyAppendedToday) return md;
  if (md.trim().length === 0) return `${refLine}\n`;
  return `${md.trimEnd()}\n${refLine}\n`;
}

/**
 * Inverse of `appendTaskRefLine`: strip every line that references
 * `#task/<slug>` (plus any indented child lines that belong to it) from a
 * daily note's markdown. Used when a task is moved back to the Backlog.
 */
export function removeTaskRefLines(currentMarkdown: string, slug: string): string {
  const md = currentMarkdown ?? "";
  if (!md) return md;
  const marker = `#task/${slug}`;
  const lines = md.split("\n");
  const out: string[] = [];
  let dropping = false;
  for (const line of lines) {
    const isChild = /^\s+\S/.test(line);
    if (dropping && isChild) continue;
    dropping = false;
    // Match the slug only when followed by a non-slug character, so
    // `#task/foo` does not also strip `#task/foo-bar`.
    const idx = line.indexOf(marker);
    if (idx !== -1) {
      const next = line[idx + marker.length];
      if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) {
        dropping = true;
        continue;
      }
    }
    out.push(line);
  }
  const result = out.join("\n");
  return result.trim().length === 0 ? "" : `${result.trimEnd()}\n`;
}

/**
 * Like `removeTaskRefLines`, but also hands back what was removed so the lines
 * can be re-homed in another day's note (the "move back to previous day"
 * action). Child lines travel with their parent.
 *
 * Example:
 *   extractTaskRefLines("# Note\n#task/fix-gate Welded hinge\n  - notes\n", "fix-gate")
 *   // => { remaining: "# Note\n", extracted: ["#task/fix-gate Welded hinge", "  - notes"] }
 */
export function extractTaskRefLines(
  currentMarkdown: string,
  slug: string,
): { remaining: string; extracted: string[] } {
  const md = currentMarkdown ?? "";
  if (!md) return { remaining: md, extracted: [] };
  const marker = `#task/${slug}`;
  const kept: string[] = [];
  const extracted: string[] = [];
  let dropping = false;
  for (const line of md.split("\n")) {
    const isChild = /^\s+\S/.test(line);
    if (dropping && isChild) {
      extracted.push(line);
      continue;
    }
    dropping = false;
    const idx = line.indexOf(marker);
    if (idx !== -1) {
      const next = line[idx + marker.length];
      if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) {
        dropping = true;
        extracted.push(line);
        continue;
      }
    }
    kept.push(line);
  }
  const joined = kept.join("\n");
  return {
    remaining: joined.trim().length === 0 ? "" : `${joined.trimEnd()}\n`,
    extracted,
  };
}

/** Append already-formatted lines to a note, skipping exact duplicates. */
export function appendLines(currentMarkdown: string, lines: string[]): string {
  let md = currentMarkdown ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const present = md.split("\n").some((l) => l.trim() === trimmed);
    if (present) continue;
    md = md.trim().length === 0 ? `${line}\n` : `${md.trimEnd()}\n${line}\n`;
  }
  return md;
}
