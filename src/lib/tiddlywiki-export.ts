// Bostead Farms → TiddlyWiki 5 exporter.
//
// Reverse-engineered from the empty TW5 file in public/tiddlywiki-template.html:
//   * TW5 boots from one or more <script class="tiddlywiki-tiddler-store"
//     type="application/json">[ {tiddler}, ... ]</script> blocks.
//   * Each tiddler is a flat JSON object. Required: `title`, `text`.
//     Conventional fields: `tags` (space-separated; multi-word tags wrapped
//     in [[double brackets]]), `type` ("text/vnd.tiddlywiki" for wikitext —
//     the default — or "text/markdown"), `created`, `modified` (UTC stamp
//     YYYYMMDDhhmmssXXX), plus any custom fields.
//   * To control which tiddlers open at startup we ship the system tiddler
//     $:/DefaultTiddlers with a list of titles.
//
// We append a fresh tiddler-store script right before the empty
// <div id="storeArea"> in the template; TW concatenates all matching scripts
// so the existing core/UI tiddlers stay intact.

export type Tiddler = {
  title: string;
  text: string;
  tags?: string;
  type?: string;
  created?: string;
  modified?: string;
  [field: string]: string | undefined;
};

const TEMPLATE_URL = "/tiddlywiki-template.html";
const STORE_MARKER = '<div id="storeArea" style="display:none;"></div>';

// --- Helpers --------------------------------------------------------------

export function tiddlyDate(d: Date | string | null | undefined): string {
  const dt = d ? new Date(d) : new Date();
  if (Number.isNaN(dt.getTime())) return tiddlyDate(new Date());
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}` +
    pad(dt.getUTCMilliseconds(), 3)
  );
}

export function formatTags(tags: string[]): string {
  return tags
    .filter(Boolean)
    .map((t) => (/\s/.test(t) ? `[[${t}]]` : t))
    .join(" ");
}

// Escape a title for use inside a wikitext [[link]]. TW doesn't allow `]]`
// inside link targets; strip the closing brackets defensively.
function safeTitle(t: string): string {
  return t.replace(/\]\]/g, "] ]");
}

// --- Assembly -------------------------------------------------------------

export function assembleTiddlyWiki(
  templateHtml: string,
  tiddlers: Tiddler[],
  options: { siteTitle?: string; subtitle?: string; defaultTiddlers?: string[] } = {},
): string {
  const sys: Tiddler[] = [];
  if (options.siteTitle) {
    sys.push({ title: "$:/SiteTitle", text: options.siteTitle });
  }
  if (options.subtitle) {
    sys.push({ title: "$:/SiteSubtitle", text: options.subtitle });
  }
  if (options.defaultTiddlers?.length) {
    sys.push({
      title: "$:/DefaultTiddlers",
      text: options.defaultTiddlers.map((t) => `[[${safeTitle(t)}]]`).join("\n"),
    });
  }
  const all = [...sys, ...tiddlers];
  const json = JSON.stringify(all);
  // </script> inside a JSON string would prematurely close the script tag.
  const safe = json.replace(/<\/script>/gi, "<\\/script>");
  const inject =
    `<script class="tiddlywiki-tiddler-store" type="application/json">${safe}</script>` +
    STORE_MARKER;
  if (!templateHtml.includes(STORE_MARKER)) {
    throw new Error("TiddlyWiki template missing storeArea marker — cannot inject tiddlers");
  }
  return templateHtml.replace(STORE_MARKER, inject);
}

let cachedTemplate: Promise<string> | null = null;
export function loadTemplate(): Promise<string> {
  if (!cachedTemplate) {
    cachedTemplate = fetch(TEMPLATE_URL).then((r) => {
      if (!r.ok) throw new Error(`Template fetch failed: ${r.status}`);
      return r.text();
    });
  }
  return cachedTemplate;
}

export function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Domain → tiddlers ----------------------------------------------------

export type ScheduledTaskRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  project_tags: string[] | null;
  start_at: string | null;
  percent_complete: number | null;
  closed_at: string | null;
  updated_at: string | null;
};

export function tiddlersFromScheduledTasks(
  rows: ScheduledTaskRow[],
  filterTag: string | null,
): Tiddler[] {
  const now = tiddlyDate(new Date());
  const tiddlers: Tiddler[] = [];

  // Per-task tiddler.
  for (const r of rows) {
    const tagList = ["Task", `status/${r.status}`, ...(r.project_tags ?? []).map((t) => `project/${t}`)];
    const lines: string[] = [];
    lines.push(`! ${r.title}`, "");
    lines.push(`|!Field |!Value |`);
    lines.push(`|status |${r.status} |`);
    lines.push(`|slug |\`${r.slug}\` |`);
    if (r.start_at) lines.push(`|start |${r.start_at} |`);
    if (r.closed_at) lines.push(`|closed |${r.closed_at} |`);
    lines.push(`|progress |${r.percent_complete ?? 0}% |`);
    if (r.project_tags?.length) lines.push(`|projects |${r.project_tags.join(", ")} |`);
    tiddlers.push({
      title: `Task: ${r.title}`,
      text: lines.join("\n"),
      tags: formatTags(tagList),
      type: "text/vnd.tiddlywiki",
      created: tiddlyDate(r.start_at ?? r.updated_at ?? new Date()),
      modified: tiddlyDate(r.updated_at ?? new Date()),
      "task-slug": r.slug,
      "task-status": r.status,
      "task-progress": String(r.percent_complete ?? 0),
      "task-start": r.start_at ?? "",
      "bostead-kind": "task",
      "bostead-payload": JSON.stringify({
        slug: r.slug,
        title: r.title,
        status: r.status,
        project_tags: r.project_tags ?? [],
        start_at: r.start_at,
        percent_complete: r.percent_complete ?? 0,
        closed_at: r.closed_at,
      }),
    });
  }

  // Index tiddler.
  const indexTitle = filterTag
    ? `Scheduled Tasks — #project/${filterTag}`
    : "Scheduled Tasks";
  const indexLines: string[] = [];
  indexLines.push(`! ${indexTitle}`);
  indexLines.push("");
  indexLines.push(`Exported ${new Date().toISOString()} from Bostead Farms.`);
  indexLines.push("");
  if (rows.length === 0) {
    indexLines.push("//No scheduled tasks.//");
  } else {
    indexLines.push(`|!Start |!Task |!Status |!Progress |!Projects |`);
    for (const r of rows) {
      const link = `[[${safeTitle(r.title)}|Task: ${safeTitle(r.title)}]]`;
      const projects = (r.project_tags ?? []).join(", ");
      indexLines.push(
        `|${r.start_at ?? "—"} |${link} |${r.status} |${r.percent_complete ?? 0}% |${projects} |`,
      );
    }
  }
  tiddlers.push({
    title: indexTitle,
    text: indexLines.join("\n"),
    tags: formatTags(["Report", "Index"]),
    type: "text/vnd.tiddlywiki",
    created: now,
    modified: now,
  });

  return tiddlers;
}

export type SummaryRow = {
  id: string;
  mode: string;
  scope_project?: string | null;
  period_start: string | null;
  period_end: string | null;
  generated_summary: unknown;
  edited_summary: unknown;
  status: string | null;
  created_at: string;
  display_title?: string | null;
  scope_task?: { slug: string; title: string } | null;
};

type SummaryShape = {
  summary?: string;
  key_decisions?: string[];
  blockers?: string[];
  next_steps?: string[];
  by_project?: { project: string; summary: string; highlights: string[] }[];
};

function pickShape(row: SummaryRow): SummaryShape {
  const edited = row.edited_summary as SummaryShape | null;
  if (edited && typeof edited === "object") return edited;
  return (row.generated_summary as SummaryShape | null) ?? {};
}

export function tiddlersFromSummaries(rows: SummaryRow[]): Tiddler[] {
  const now = tiddlyDate(new Date());
  const tiddlers: Tiddler[] = [];
  const seenTitles = new Set<string>();
  const pushUnique = (t: Tiddler) => {
    let title = t.title;
    let n = 2;
    while (seenTitles.has(title)) title = `${t.title} (${n++})`;
    seenTitles.add(title);
    tiddlers.push({ ...t, title });
  };

  for (const r of rows) {
    const shape = pickShape(r);
    const baseTitle = summaryTitle(r);
    const baseTags = [
      "Summary",
      `mode/${r.mode}`,
      ...(r.status ? [`status/${r.status}`] : []),
      ...(r.scope_task ? [`task/${r.scope_task.slug}`] : []),
    ];

    // Per-project child tiddlers (one per project in by_project).
    const projectTitles: string[] = [];
    if (shape.by_project?.length) {
      for (const p of shape.by_project) {
        const pTitle = `${r.created_at.slice(0, 10)} — #project/${p.project}`;
        const pLines: string[] = [];
        pLines.push(`! ${pTitle}`, "");
        if (r.period_start || r.period_end) {
          pLines.push(`//Period: ${r.period_start ?? "?"} → ${r.period_end ?? "?"}//`, "");
        }
        if (p.summary) pLines.push(p.summary, "");
        if (p.highlights?.length) {
          pLines.push("!! Highlights");
          for (const h of p.highlights) pLines.push(`* ${h}`);
          pLines.push("");
        }
        pLines.push(`//From: [[${safeTitle(baseTitle)}]]//`);
        pushUnique({
          title: pTitle,
          text: pLines.join("\n"),
          tags: formatTags([...baseTags, `project/${p.project}`]),
          type: "text/vnd.tiddlywiki",
          created: tiddlyDate(r.created_at),
          modified: tiddlyDate(r.created_at),
          "summary-mode": r.mode,
          "summary-status": r.status ?? "",
          "period-start": r.period_start ?? "",
          "period-end": r.period_end ?? "",
          "scope-project": p.project,
          "bostead-kind": "summary-project",
          "bostead-payload": JSON.stringify({
            parent_id: r.id,
            mode: r.mode,
            scope_project: p.project,
            period_start: r.period_start,
            period_end: r.period_end,
            status: r.status,
            created_at: r.created_at,
            body: { project: p.project, summary: p.summary, highlights: p.highlights ?? [] },
          }),
        });
        projectTitles.push(pTitle);
      }
    }

    // Parent summary tiddler — overview only, links to per-project tiddlers.
    const lines: string[] = [];
    lines.push(`! ${baseTitle}`, "");
    if (r.period_start || r.period_end) {
      lines.push(`//Period: ${r.period_start ?? "?"} → ${r.period_end ?? "?"}//`, "");
    }
    if (shape.summary) lines.push(shape.summary, "");
    if (shape.key_decisions?.length) {
      lines.push("!! Key decisions");
      for (const d of shape.key_decisions) lines.push(`* ${d}`);
      lines.push("");
    }
    if (shape.blockers?.length) {
      lines.push("!! Blockers");
      for (const b of shape.blockers) lines.push(`* ${b}`);
      lines.push("");
    }
    if (shape.next_steps?.length) {
      lines.push("!! Next steps");
      for (const n of shape.next_steps) lines.push(`* ${n}`);
      lines.push("");
    }
    if (projectTitles.length) {
      lines.push("!! Projects");
      for (const pt of projectTitles) lines.push(`* [[${safeTitle(pt)}]]`);
      lines.push("");
    }
    pushUnique({
      title: baseTitle,
      text: lines.join("\n"),
      tags: formatTags(baseTags),
      type: "text/vnd.tiddlywiki",
      created: tiddlyDate(r.created_at),
      modified: tiddlyDate(r.created_at),
      "summary-mode": r.mode,
      "summary-status": r.status ?? "",
      "period-start": r.period_start ?? "",
      "period-end": r.period_end ?? "",
      "bostead-kind": "summary",
      "bostead-payload": JSON.stringify({
        id: r.id,
        mode: r.mode,
        scope_project: r.scope_project ?? null,
        scope_task_slug: r.scope_task?.slug ?? null,
        period_start: r.period_start,
        period_end: r.period_end,
        status: r.status,
        created_at: r.created_at,
        body: shape,
      }),
    });
  }

  const indexLines: string[] = [];
  indexLines.push("! Summaries", "");
  indexLines.push(`Exported ${new Date().toISOString()} from Bostead Farms.`, "");
  if (rows.length === 0) {
    indexLines.push("//No summaries yet.//");
  } else {
    indexLines.push(`|!Date |!Mode |!Scope |!Status |`);
    for (const r of rows) {
      const t = summaryTitle(r);
      indexLines.push(
        `|${r.created_at.slice(0, 10)} |${r.mode} |[[${safeTitle(t)}]] |${r.status ?? "—"} |`,
      );
    }
  }
  tiddlers.push({
    title: "Summaries",
    text: indexLines.join("\n"),
    tags: formatTags(["Report", "Index"]),
    type: "text/vnd.tiddlywiki",
    created: now,
    modified: now,
  });

  return tiddlers;
}

function summaryTitle(r: SummaryRow): string {
  if (r.display_title && r.display_title.trim()) return r.display_title;
  const date = r.created_at.slice(0, 10);
  const scope = r.scope_task ? ` · ${r.scope_task.title}` : "";
  return `${date} — ${r.mode}${scope}`;
}
