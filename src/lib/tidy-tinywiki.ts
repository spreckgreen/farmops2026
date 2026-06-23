// Tidy formatter for TinyWiki procedure bodies.
//
// Normalizes a procedure on save so stored content stays consistent:
//   * Headings (`!`..`!!!!!!`) — exactly one space after the bangs, trimmed text,
//     trailing `#` stripped, blank line above & below.
//   * Internal links `[[Target]]` and `[[Label|Target]]` — both label and target
//     trimmed, internal whitespace collapsed; target normalized to a slug.
//   * Bullet/numbered list markers — exactly one space after `*` / `#` runs.
//   * Trailing whitespace stripped from every line; tabs → 2 spaces.
//   * Collapses 3+ blank lines to 2; ensures a single trailing newline.
//
// Code fences (`{{{` … `}}}`) and pre-formatted blocks are passed through
// unchanged so embedded snippets are never rewritten.

export interface TidyOptions {
  /** Normalize the page name itself into a safe slug. Default false (caller
   *  decides whether to rename the row). */
  slugifyName?: boolean;
}

export interface TidyResult {
  /** Cleaned body (TinyWiki markup). */
  body: string;
  /** Slugified version of the supplied name (always populated). */
  nameSlug: string;
  /** Count of edits applied, useful for UX feedback. */
  changes: number;
}

/** Turn an arbitrary string into a wiki-safe slug:
 *  ASCII letters/digits/dot/dash/underscore only; spaces & runs → single `_`. */
export function slugifyWikiName(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .replace(/[^A-Za-z0-9._\- ]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned || "Untitled";
}

/** Tidy a TinyWiki procedure body. Pure function, no I/O. */
export function tidyProcedure(name: string, raw: string, opts: TidyOptions = {}): TidyResult {
  const nameSlug = slugifyWikiName(name);
  const original = raw ?? "";

  // 1) Normalize line endings; expand tabs.
  let src = original.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ");

  // 2) Protect code blocks {{{ ... }}} so we don't touch their contents.
  const fences: string[] = [];
  src = src.replace(/^\{\{\{\n([\s\S]*?)\n\}\}\}$/gm, (_m, body: string) => {
    fences.push(body);
    return `\u0000FENCE${fences.length - 1}\u0000`;
  });

  const lines = src.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/[ \t]+$/g, ""); // trim trailing whitespace

    // Heading: 1-6 bangs, single space after, no trailing #.
    const h = line.match(/^(!{1,6})\s*(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const text = tidyInline(h[2].trim().replace(/\s+/g, " "));
      // Ensure a blank line above (unless first line / already blank / previous was heading separator).
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push("!".repeat(level) + " " + text);
      // Ensure blank line after by emitting one if the next non-fence line isn't blank.
      const next = lines[i + 1];
      if (next !== undefined && next.trim() !== "") out.push("");
      continue;
    }

    // List markers: collapse "  *  text" → "* text", same for "#".
    const li = line.match(/^(\s*)([*#]+)\s+(.*)$/);
    if (li) {
      out.push(li[1] + li[2] + " " + tidyInline(li[3].trim()));
      continue;
    }

    // Plain line — tidy inline links.
    out.push(tidyInline(line));
  }

  // 3) Restore code fences.
  let body = out.join("\n").replace(/\u0000FENCE(\d+)\u0000/g, (_m, idx) => {
    return "{{{\n" + fences[Number(idx)] + "\n}}}";
  });

  // 4) Collapse runs of 3+ blank lines; trim outer whitespace; one trailing newline.
  body = body.replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "") + "\n";

  // 5) If caller asked for slugified name, also rewrite a leading `! <oldName>`
  //    title to match the slug so the embedded heading stays in sync.
  if (opts.slugifyName && nameSlug !== name) {
    body = body.replace(/^!\s+.+$/m, `! ${nameSlug}`);
  }

  const changes = body === (original.endsWith("\n") ? original : original + (original ? "\n" : ""))
    ? 0
    : countChanges(original, body);

  return { body, nameSlug, changes };
}

/** Normalize inline wiki link syntax inside a single line.
 *  Touches only `[[…]]` constructs; everything else is passed through. */
function tidyInline(line: string): string {
  return line.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const parts = inner.split("|");
    if (parts.length === 1) {
      const target = parts[0].trim().replace(/\s+/g, " ");
      // Internal link with no label → slugify target.
      if (isExternalLink(target)) return `[[${target}]]`;
      return `[[${slugifyWikiName(target)}]]`;
    }
    const label = parts[0].trim().replace(/\s+/g, " ");
    const target = parts.slice(1).join("|").trim();
    if (isExternalLink(target)) return `[[${label}|${target}]]`;
    return `[[${label}|${slugifyWikiName(target)}]]`;
  });
}

function isExternalLink(s: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:)/i.test(s);
}

function countChanges(a: string, b: string): number {
  // Cheap diff signal — number of differing lines.
  const al = a.split("\n");
  const bl = b.split("\n");
  const max = Math.max(al.length, bl.length);
  let n = 0;
  for (let i = 0; i < max; i++) if ((al[i] ?? "") !== (bl[i] ?? "")) n++;
  return n;
}
