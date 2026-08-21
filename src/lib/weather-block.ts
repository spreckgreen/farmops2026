/**
 * Pure helpers for the "## Weather · …" block inside a daily note.
 *
 * The block is ONLY:
 *   1. the `## Weather …` heading line, and
 *   2. optionally the single summary line directly beneath it, and only when
 *      that line looks like a weather summary (contains "High ", "Low " or "·").
 *
 * It must never extend into note content. An earlier regex matched every
 * following non-blank line that didn't start with `#`, so task lines like
 * `- [ ] #task/order-steel-doors ...` were swallowed and replaced by the
 * refreshed weather text, wiping a day's entries.
 */

const WEATHER_BLOCK_RE =
  /^##[ \t]+Weather\b.*(?:\r?\n(?:[^\r\n#-][^\r\n]*)?(?=\r?\n|$))?\r?\n?/m;

const SUMMARY_LINE_RE = /High |Low |·/;

/** Returns the exact weather block substring, or "" when the note has none. */
export function findWeatherBlock(markdown: string): string {
  const raw = (markdown ?? "").match(WEATHER_BLOCK_RE)?.[0] ?? "";
  if (!raw) return "";
  const lines = raw.replace(/\r?\n$/, "").split(/\r?\n/);
  if (lines.length > 1 && !SUMMARY_LINE_RE.test(lines[1] ?? "")) {
    return `${lines[0]}\n`;
  }
  return raw;
}

/** True when the block is absent or missing the humidity / feels-like fields. */
export function weatherBlockMissingExtras(block: string): boolean {
  return !block || !/\bFeels like\b/i.test(block) || !/%\s*humidity\b/i.test(block);
}

/**
 * Replaces the weather block with `fresh` (which must end in a newline), or
 * prepends it when the note has no block yet. Everything else is preserved
 * byte-for-byte.
 */
export function replaceWeatherBlock(markdown: string, fresh: string): string {
  const current = markdown ?? "";
  const block = findWeatherBlock(current);
  if (!block) return `${fresh}\n${current}`;
  return current.replace(block, fresh);
}
