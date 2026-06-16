// Pure, client-safe helpers for rendering Obsidian-flavored markdown for
// summaries. Shared between the server-side export (obsidian.functions.ts)
// and the Reports page live preview.

export type SummaryPayload = {
  summary?: string;
  key_decisions?: string[];
  blockers?: string[];
  next_steps?: string[];
  by_project?: { project: string; summary: string; highlights: string[] }[];
};

const MODE_HEADINGS: Record<string, string> = {
  daily_recap: "Daily Recap",
  weekly_report: "Weekly Status",
  monthly_rollup: "Monthly Rollup",
  quarter_review: "Quarterly Review",
  yearly_rollup: "Yearly Rollup",
  project_rollup: "Project Rollup",
  task_update: "Task Update",
};

export function renderSummaryMarkdown(
  raw: unknown,
  mode: string,
  periodStart: string,
  periodEnd: string,
  scopeProject: string | null,
): string {
  const p = (raw ?? {}) as SummaryPayload;
  const title = MODE_HEADINGS[mode] ?? "Summary";
  const range =
    periodStart && periodEnd
      ? `${periodStart.slice(0, 10)} → ${periodEnd.slice(0, 10)}`
      : "";
  const lines: string[] = [];
  lines.push(`# ${title}${scopeProject ? ` — #project/${scopeProject}` : ""}`);
  if (range) lines.push("", `*${range}*`);
  if (p.summary) lines.push("", "## Overview", "", p.summary);
  if (p.by_project?.length) {
    lines.push("", "## By Project");
    for (const proj of p.by_project) {
      lines.push("", `### #project/${proj.project}`);
      if (proj.summary) lines.push("", proj.summary);
      if (proj.highlights?.length) {
        lines.push("");
        for (const h of proj.highlights) lines.push(`- ${h}`);
      }
    }
  }
  if (p.key_decisions?.length) {
    lines.push("", "## Key Decisions", "");
    for (const d of p.key_decisions) lines.push(`- ${d}`);
  }
  if (p.blockers?.length) {
    lines.push("", "## Blockers", "");
    for (const b of p.blockers) lines.push(`- ${b}`);
  }
  if (p.next_steps?.length) {
    lines.push("", "## Next Steps", "");
    for (const n of p.next_steps) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

function escapeYaml(value: string): string {
  if (value === "") return '""';
  if (/[":#\n\-\[\]{}&*!|>'%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function toYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${escapeYaml(String(item))}`);
      }
    } else if (typeof v === "object") {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 === undefined || v2 === null) continue;
        lines.push(`  ${k2}: ${escapeYaml(String(v2))}`);
      }
    } else {
      lines.push(`${k}: ${escapeYaml(String(v))}`);
    }
  }
  return lines.join("\n");
}

export function buildMarkdownFile(meta: Record<string, unknown>, body: string): string {
  return `---\n${toYaml(meta)}\n---\n\n${body}`;
}

export function renderSummaryFile(s: {
  id: string;
  mode: string;
  status: string;
  period_start: string;
  period_end: string;
  scope_project: string | null;
  edited_summary: unknown;
  generated_summary: unknown;
}): string {
  const meta = {
    bostead: { kind: "summary", id: s.id },
    mode: s.mode,
    status: s.status,
    period_start: s.period_start,
    period_end: s.period_end,
    scope_project: s.scope_project ?? "",
  };
  const payload = s.edited_summary ?? s.generated_summary;
  const body =
    renderSummaryMarkdown(payload, s.mode, s.period_start, s.period_end, s.scope_project) +
    "\n\n<!-- structured payload below — used for round-trip import; safe to ignore -->\n" +
    "```json\n" +
    JSON.stringify(payload, null, 2) +
    "\n```\n";
  return buildMarkdownFile(meta, body);
}
