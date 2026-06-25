// Builds Ghost-ready { title, html } payloads for each report surface.
// Centralised so every "Send to Ghost" button emits identical output.

type SummaryShape = {
  summary: string;
  key_decisions?: string[];
  blockers?: string[];
  next_steps?: string[];
  by_project?: { project: string; summary: string; highlights?: string[] }[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/\\\|/g, "|");
}

/** Minimal markdown → HTML matching the subset emitted by food-reports. */
export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("# ")) { out.push(`<h1>${inline(line.slice(2).trim())}</h1>`); i++; continue; }
    if (line.startsWith("## ")) { out.push(`<h2>${inline(line.slice(3).trim())}</h2>`); i++; continue; }
    if (line.startsWith("### ")) { out.push(`<h3>${inline(line.slice(4).trim())}</h3>`); i++; continue; }
    if (line.startsWith("|") && i + 1 < lines.length && /^\|\s*-{3,}/.test(lines[i + 1])) {
      const split = (l: string) =>
        l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = split(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(split(lines[i])); i++; }
      out.push(
        `<table><thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^---+\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith("#") && !lines[i].startsWith("|") && !/^\s*[-*]\s+/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    const text = buf.join(" ");
    const isMeta = /^\*.+\*$/.test(text.trim());
    out.push(isMeta ? `<p><em>${inline(text.replace(/^\*|\*$/g, ""))}</em></p>` : `<p>${inline(text)}</p>`);
  }
  return out.join("\n");
}

/** Activity-summary report (Daily, Weekly, Monthly, ...) → Ghost payload. */
export function activitySummaryToGhost(input: {
  modeLabel: string;
  body: SummaryShape;
  periodStart?: string | null;
  periodEnd?: string | null;
  displayTitle?: string | null;
  scopeProject?: string | null;
}): { title: string; html: string; tags: string[] } {
  const periodBits = [input.periodStart?.slice(0, 10), input.periodEnd?.slice(0, 10)]
    .filter(Boolean)
    .join(" → ");
  const title =
    input.displayTitle ||
    `${input.modeLabel}${periodBits ? ` — ${periodBits}` : ""}${input.scopeProject ? ` (${input.scopeProject})` : ""}`;

  const parts: string[] = [];
  if (input.body.summary) parts.push(`<p>${inline(input.body.summary)}</p>`);

  if (input.body.by_project?.length) {
    for (const p of input.body.by_project) {
      parts.push(`<h2>#project/${escapeHtml(p.project)}</h2>`);
      if (p.summary) parts.push(`<p>${inline(p.summary)}</p>`);
      if (p.highlights?.length) {
        parts.push(`<ul>${p.highlights.map((h) => `<li>${inline(h)}</li>`).join("")}</ul>`);
      }
    }
  }

  const sect = (label: string, items?: string[]) => {
    if (!items?.length) return;
    parts.push(`<h3>${label}</h3><ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`);
  };
  sect("Decisions", input.body.key_decisions);
  sect("Blockers", input.body.blockers);
  sect("Next", input.body.next_steps);

  const tags = ["bostead", "report", input.modeLabel.toLowerCase().replace(/\s+/g, "-")];
  if (input.scopeProject) tags.push(`project-${input.scopeProject}`);
  return { title, html: parts.join("\n"), tags };
}

/** Food / inventory report (markdown body) → Ghost payload. */
export function markdownReportToGhost(input: {
  title: string;
  markdown: string;
  extraTags?: string[];
}): { title: string; html: string; tags: string[] } {
  // Strip the leading H1 if it matches the title — Ghost renders the title itself.
  const md = input.markdown.replace(/^#\s+.+\n+/, "");
  return {
    title: input.title,
    html: markdownToHtml(md),
    tags: ["bostead", "report", ...(input.extraTags ?? [])],
  };
}
