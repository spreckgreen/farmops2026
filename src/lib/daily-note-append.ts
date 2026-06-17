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
