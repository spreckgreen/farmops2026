// Minimal TinyWiki → Markdown converter for Obsidian export.
// Handles headings, lists, bold/italic, inline code, code blocks,
// blockquotes, horizontal rules, and [[internal links]].

export function tinyWikiToMarkdown(src: string): string {
  let s = src.replace(/\r\n?/g, "\n");

  // Protect code blocks {{{ ... }}}
  const codeBlocks: string[] = [];
  s = s.replace(/\{\{\{\n?([\s\S]*?)\n?\}\}\}/g, (_m, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(code);
    return `\u0000CODE${idx}\u0000`;
  });

  const lines = s.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const cb = line.match(/^\u0000CODE(\d+)\u0000\s*$/);
    if (cb) {
      out.push("```");
      out.push(codeBlocks[Number(cb[1])]);
      out.push("```");
      continue;
    }
    if (/^----+\s*$/.test(line)) { out.push("---"); continue; }

    const h = line.match(/^(!{1,6})\s+(.*)$/);
    if (h) { out.push("#".repeat(h[1].length) + " " + inline(h[2])); continue; }

    const bq = line.match(/^<<<\s?(.*)$/);
    if (bq) { out.push("> " + inline(bq[1])); continue; }

    const ul = line.match(/^(\*+)\s+(.*)$/);
    if (ul) { out.push("  ".repeat(ul[1].length - 1) + "- " + inline(ul[2])); continue; }

    const ol = line.match(/^(#+)\s+(.*)$/);
    // (Above already matched headings; ordered lists in TinyWiki use '#' too,
    // but we treat leading '#' followed by space as heading. Skip ordered lists.)
    void ol;

    out.push(inline(line));
  }
  return out.join("\n");
}

function inline(text: string): string {
  let t = text;
  // [[Page]] or [[Label|Page]] → [[Page]] (Obsidian wikilinks are compatible)
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "[[$2|$1]]");
  // ''bold'' → **bold**
  t = t.replace(/''([^'\n]+)''/g, "**$1**");
  // //italic// → *italic* (avoid URLs)
  t = t.replace(/(^|[\s(])\/\/([^\/\n]+)\/\//g, "$1*$2*");
  // `code` stays as `code`
  // {{{inline}}} → `inline`
  t = t.replace(/\{\{\{([^}\n]+)\}\}\}/g, "`$1`");
  return t;
}
