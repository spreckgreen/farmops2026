// Minimal Markdown → TinyWiki/TiddlyWiki markup converter.
// Handles the subset commonly found in project READMEs:
//   headings, paragraphs, bullet/numbered lists (incl. nesting),
//   fenced & indented code blocks, inline code, bold, italic,
//   links, images, blockquotes, horizontal rules, tables.

export function markdownToTinyWiki(md: string): string {
  let src = md.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  const codeBlocks: string[] = [];
  src = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(code.replace(/\s+$/, ""));
    return `\u0000CODE${idx}\u0000`;
  });

  const lines = src.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const cb = line.match(/^\u0000CODE(\d+)\u0000\s*$/);
    if (cb) {
      out.push("{{{");
      out.push(codeBlocks[Number(cb[1])]);
      out.push("}}}");
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("----"); continue; }

    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { out.push("!".repeat(h[1].length) + " " + inline(h[2])); continue; }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) { out.push("<<< " + inline(bq[1])); continue; }

    const li = line.match(/^(\s*)([*+-]|\d+\.)\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].replace(/\t/g, "  ").length / 2) + 1;
      const marker = /\d/.test(li[2]) ? "#" : "*";
      out.push(marker.repeat(depth) + " " + inline(li[3]));
      continue;
    }

    if (/^ {4}\S/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^ {4}/.test(lines[i])) { buf.push(lines[i].slice(4)); i++; }
      i--;
      out.push("{{{"); out.push(buf.join("\n")); out.push("}}}");
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /\|/.test(lines[i + 1] || "")) {
      const tbl: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { tbl.push(lines[i].trim()); i++; }
      i--;
      for (const row of tbl) {
        if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|$/.test(row)) continue;
        out.push(inline(row));
      }
      continue;
    }

    if (!line.trim()) { out.push(""); continue; }

    out.push(inline(line));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function inline(s: string): string {
  const spans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    const i = spans.length; spans.push(c); return `\u0001${i}\u0001`;
  });

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, url) =>
    `[img[${alt || "image"}|${url}]]`);

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text, url) =>
    `[[${text}|${url}]]`);

  s = s.replace(/\*\*([^*\n]+)\*\*/g, "''$1''")
       .replace(/__([^_\n]+)__/g, "''$1''");

  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1//$2//")
       .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1//$2//");

  s = s.replace(/~~([^~\n]+)~~/g, "--$1--");

  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => `{{{${spans[Number(i)]}}}}`);

  return s;
}
