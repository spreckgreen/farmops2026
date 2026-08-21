/**
 * Seeding a brand-new daily note from the previous day.
 *
 * The old behaviour copied yesterday's markdown verbatim. That carried
 * finished work forward: a line checked off yesterday
 * (`- [x] Grease loader pins #task/grease-loader-pins`) reappeared on today's
 * note already checked, and committing today re-stamped `closed_at` to today —
 * so a task finished on the 20th looked like it was completed on the 21st.
 *
 * Carry forward only unfinished work. Completed checkbox lines stay on the day
 * they were checked; the finished task still lives in `tasks` with its original
 * `closed_at`, so nothing is lost.
 */

const DONE_CHECKBOX_RE = /^\s*[-*]\s*\[[xX]\]/;
const ANY_CHECKBOX_RE = /^\s*[-*]\s*\[[ xX]\]/;
const HEADING_RE = /^\s*#{1,6}\s+/;
const WEATHER_HEADING_RE = /^\s*##\s+Weather\b/i;

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

/** Lines nested under a dropped checkbox belong to it and go with it. */
function isChildOf(line: string, parentIndent: number): boolean {
  if (!line.trim()) return false;
  if (HEADING_RE.test(line)) return false;
  return indentOf(line) > parentIndent;
}

/**
 * Content to seed a new note for `date` with, given the previous note's
 * markdown. Drops completed checkbox lines (and their nested children), drops
 * the stale Weather block, and collapses the blank-line runs that leaves behind.
 */
export function seedFromPreviousNote(priorMarkdown: string | null | undefined): string {
  const src = (priorMarkdown ?? "").replace(/\r\n/g, "\n");
  if (!src.trim()) return "";

  const lines = src.split("\n");
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Yesterday's weather block: heading plus its single summary line.
    if (WEATHER_HEADING_RE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && !HEADING_RE.test(lines[j]) && !ANY_CHECKBOX_RE.test(lines[j])) {
        i = j; // also skip the summary line
      } else {
        i = j - 1;
      }
      continue;
    }

    if (DONE_CHECKBOX_RE.test(line)) {
      const parentIndent = indentOf(line);
      while (i + 1 < lines.length && isChildOf(lines[i + 1], parentIndent)) i++;
      continue;
    }

    kept.push(line);
  }

  return tidy(kept);
}

/** Collapse blank runs, drop leading/trailing blanks, drop now-empty headings. */
function tidy(lines: string[]): string {
  // Remove headings whose whole body was dropped.
  const pruned: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING_RE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const emptySection = j >= lines.length || HEADING_RE.test(lines[j]);
      if (emptySection) continue;
    }
    pruned.push(line);
  }

  const out: string[] = [];
  for (const line of pruned) {
    if (!line.trim()) {
      if (out.length === 0) continue;
      if (!out[out.length - 1].trim()) continue;
      out.push("");
      continue;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n");
}

/**
 * Removes `- [x]` lines that were carried over from an earlier day.
 *
 * `isStaleSlug("grease-loader-pins")` should answer "this task was closed
 * before the day this note represents". Only slug-referenced lines can be
 * judged, so lines like `- [x] Some free text` are always left alone.
 */
export function stripStaleDoneLines(
  markdown: string,
  isStaleSlug: (slug: string) => boolean,
): { markdown: string; removed: string[] } {
  const src = (markdown ?? "").replace(/\r\n/g, "\n");
  if (!src.trim()) return { markdown: src, removed: [] };

  const lines = src.split("\n");
  const kept: string[] = [];
  const removed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DONE_CHECKBOX_RE.test(line)) {
      const slug = line.match(/#task\/([a-z0-9-]+)/i)?.[1]?.toLowerCase();
      if (slug && isStaleSlug(slug)) {
        removed.push(line.trim());
        const parentIndent = indentOf(line);
        while (i + 1 < lines.length && isChildOf(lines[i + 1], parentIndent)) i++;
        continue;
      }
    }
    kept.push(line);
  }

  if (removed.length === 0) return { markdown: src, removed };
  return { markdown: tidy(kept), removed };
}
