// Parse a TiddlyWiki 5 HTML file (browser-side) and pick out tiddlers Bostead
// exported. We accept tiddlers with `bostead-kind` field for clean round-trip,
// and also fall back to heuristics on plain TW5 tiddlers (Task / Summary tags).

import type { Tiddler } from "./tiddlywiki-export";

export type TaskImport = {
  slug: string;
  title: string;
  status: "open" | "blocked" | "done";
  project_tags: string[];
  start_at: string | null;
  percent_complete: number;
  closed_at: string | null;
};

export type SummaryShape = {
  summary?: string;
  key_decisions?: string[];
  blockers?: string[];
  next_steps?: string[];
  by_project?: { project: string; summary: string; highlights: string[] }[];
};

export type SummaryImport = {
  id: string | null;
  mode: string;
  scope_project: string | null;
  scope_task_slug: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  created_at: string | null;
  body: SummaryShape;
};

export type TiddlyWikiImport = {
  tiddlers: Tiddler[];
  tasks: TaskImport[];
  summaries: SummaryImport[];
};

// --- HTML parse -----------------------------------------------------------

export function parseTiddlyWikiHtml(html: string): TiddlyWikiImport {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const raw: Tiddler[] = [];

  // TW5 format: <script class="tiddlywiki-tiddler-store" type="application/json">[...]</script>
  for (const node of Array.from(
    doc.querySelectorAll('script.tiddlywiki-tiddler-store[type="application/json"]'),
  )) {
    const txt = node.textContent ?? "";
    if (!txt.trim()) continue;
    try {
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) {
        for (const t of arr) if (t && typeof t === "object" && t.title) raw.push(t as Tiddler);
      }
    } catch {
      // Skip malformed store block; some embedded $:/core JSON-payload tiddlers
      // are valid even when other blocks aren't.
    }
  }

  // Legacy TW format: <div id="storeArea"><div title="..." ...><pre>text</pre></div>...</div>
  const store = doc.getElementById("storeArea");
  if (store) {
    for (const div of Array.from(store.querySelectorAll("div[title]"))) {
      const t: Tiddler = { title: div.getAttribute("title") ?? "", text: "" };
      for (const attr of Array.from(div.attributes)) {
        if (attr.name === "title") continue;
        t[attr.name] = attr.value;
      }
      const pre = div.querySelector("pre");
      t.text = pre?.textContent ?? "";
      if (t.title) raw.push(t);
    }
  }

  return {
    tiddlers: raw,
    tasks: extractTasks(raw),
    summaries: extractSummaries(raw),
  };
}

// --- Extraction -----------------------------------------------------------

function hasTag(t: Tiddler, tag: string): boolean {
  const tags = t.tags ?? "";
  // TW tag list: space-separated, multi-word in [[brackets]].
  const re = new RegExp(`(^|\\s)(${escapeRe(tag)}|\\[\\[${escapeRe(tag)}\\]\\])(\\s|$)`);
  return re.test(tags);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTasks(tiddlers: Tiddler[]): TaskImport[] {
  const out: TaskImport[] = [];
  for (const t of tiddlers) {
    const kind = t["bostead-kind"];
    if (kind === "task" && t["bostead-payload"]) {
      try {
        const p = JSON.parse(t["bostead-payload"]) as Partial<TaskImport>;
        if (p.slug && p.title) {
          out.push({
            slug: String(p.slug),
            title: String(p.title),
            status: normalizeStatus(p.status),
            project_tags: Array.isArray(p.project_tags) ? p.project_tags.map(String) : [],
            start_at: p.start_at ?? null,
            percent_complete: Number(p.percent_complete ?? 0),
            closed_at: p.closed_at ?? null,
          });
          continue;
        }
      } catch {
        /* fall through to heuristic */
      }
    }
    // Heuristic: any tiddler tagged "Task" with a task-slug field.
    if (hasTag(t, "Task") && t["task-slug"]) {
      const title = t.title.replace(/^Task:\s*/, "");
      out.push({
        slug: String(t["task-slug"]),
        title,
        status: normalizeStatus(t["task-status"]),
        project_tags: extractProjectTagsFromTags(t.tags ?? ""),
        start_at: t["task-start"] || null,
        percent_complete: Number(t["task-progress"] ?? 0),
        closed_at: null,
      });
    }
  }
  return out;
}

function normalizeStatus(s: unknown): "open" | "blocked" | "done" {
  const v = String(s ?? "").toLowerCase();
  if (v === "done" || v === "blocked" || v === "open") return v;
  return "open";
}

function extractProjectTagsFromTags(tagStr: string): string[] {
  const out: string[] = [];
  // Match `project/foo` or `[[project/foo]]`.
  const re = /(?:^|\s)\[?\[?project\/([a-z0-9-_]+)\]?\]?(?=\s|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagStr))) out.push(m[1].toLowerCase());
  return Array.from(new Set(out));
}

function extractSummaries(tiddlers: Tiddler[]): SummaryImport[] {
  const out: SummaryImport[] = [];
  for (const t of tiddlers) {
    if (t["bostead-kind"] !== "summary" || !t["bostead-payload"]) continue;
    try {
      const p = JSON.parse(t["bostead-payload"]) as Partial<SummaryImport>;
      if (!p.mode) continue;
      out.push({
        id: p.id ?? null,
        mode: String(p.mode),
        scope_project: p.scope_project ?? null,
        scope_task_slug: p.scope_task_slug ?? null,
        period_start: p.period_start ?? null,
        period_end: p.period_end ?? null,
        status: p.status ?? null,
        created_at: p.created_at ?? null,
        body: (p.body as SummaryShape) ?? {},
      });
    } catch {
      /* skip malformed payload */
    }
  }
  return out;
}
