// Renders the markdown produced by food-reports.ts into a well-formatted
// document for both screen and print. Supports a small subset of markdown
// (headings, bold, lists, tables, blockquote/italic line) which is all the
// report builders emit.

import { useMemo } from "react";

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "hr" };

function parseInline(s: string): string {
  // bold then italic — escape minimal HTML
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/\\\|/g, "|");
}

function parseMarkdown(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.startsWith("# ")) { blocks.push({ kind: "h1", text: line.slice(2).trim() }); i++; continue; }
    if (line.startsWith("## ")) { blocks.push({ kind: "h2", text: line.slice(3).trim() }); i++; continue; }
    if (line.startsWith("### ")) { blocks.push({ kind: "h3", text: line.slice(4).trim() }); i++; continue; }

    // Table: header row starts with `|` and next line is the separator `| --- |`
    if (line.startsWith("|") && i + 1 < lines.length && /^\|\s*-{3,}/.test(lines[i + 1])) {
      const split = (l: string) =>
        l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = split(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(split(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^---+\s*$/.test(line)) { blocks.push({ kind: "hr" }); i++; continue; }

    // paragraph (collect adjacent non-empty lines)
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith("|") && !/^\s*[-*]\s+/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

export function ReportView({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <article className="report-doc max-w-none">
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "h1":
            return (
              <h1 key={idx} className="text-3xl font-semibold tracking-tight border-b border-border pb-2 mb-4 print:text-2xl">
                {b.text}
              </h1>
            );
          case "h2":
            return (
              <h2 key={idx} className="text-xl font-semibold mt-8 mb-3 text-foreground print:text-lg print:mt-6">
                {b.text}
              </h2>
            );
          case "h3":
            return <h3 key={idx} className="text-base font-semibold mt-4 mb-2">{b.text}</h3>;
          case "p": {
            const isMeta = /^\*.+\*$/.test(b.text.trim());
            return (
              <p
                key={idx}
                className={isMeta ? "text-sm italic text-muted-foreground mb-4" : "text-sm leading-relaxed mb-3"}
                dangerouslySetInnerHTML={{ __html: parseInline(b.text) }}
              />
            );
          }
          case "ul":
            return (
              <ul key={idx} className="list-disc pl-6 mb-4 space-y-1 text-sm">
                {b.items.map((it, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: parseInline(it) }} />
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={idx} className="my-4 overflow-x-auto print:overflow-visible">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/60">
                      {b.headers.map((h, j) => (
                        <th key={j} className="border border-border px-3 py-2 text-left font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="odd:bg-background even:bg-muted/20 print:even:bg-transparent">
                        {r.map((c, k) => (
                          <td
                            key={k}
                            className="border border-border px-3 py-1.5 align-top"
                            dangerouslySetInnerHTML={{ __html: parseInline(c) }}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={idx} className="my-6 border-border" />;
        }
      })}
    </article>
  );
}
