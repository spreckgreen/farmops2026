import { slugify } from "./slug";

/**
 * Client-side dry run of the daily-note parser in `log.functions.ts`.
 *
 * Mirrors `parseMarkdown` / `extractMeta` exactly so the editor can show the
 * user, line by line, what pressing "Commit to log" will actually do — before
 * anything is written. Keep the regexes in sync with the server parser.
 */

const ENTRY_TYPE_PREFIXES: Record<string, "blocker" | "decision" | "commit" | "meeting"> = {
  "!blocker": "blocker",
  "!decision": "decision",
  "!commit": "commit",
  "!meeting": "meeting",
};

const PROJECT_TAG_RE = /#project\/([a-z0-9][a-z0-9-_]*)/gi;
const START_AT_RE =
  /@start:(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})?/i;
const PROGRESS_RE = /@progress:(\d{1,3})%?/i;

export type InterpretedAction =
  | "create-task"
  | "complete-task"
  | "log-entry"
  | "ignored"
  | "warning";

export type InterpretedLine = {
  lineNumber: number;
  raw: string;
  action: InterpretedAction;
  /** Short verb shown as the row badge, e.g. "new task", "log entry". */
  label: string;
  /** One-sentence plain-language explanation of the effect. */
  summary: string;
  /** Extra notes: project tags, schedule, percent, problems. */
  details: string[];
  entryType: "status" | "blocker" | "decision" | "commit" | "meeting" | "note";
  taskTitle?: string;
  taskSlug?: string;
  /** True when the referenced task does not exist yet. */
  unresolvedRef?: boolean;
  projectTags: string[];
  unknownProjects: string[];
  startAt: string | null;
  percent: number | null;
};

export type NoteInterpretation = {
  lines: InterpretedLine[];
  counts: {
    createTasks: number;
    completeTasks: number;
    logEntries: number;
    ignored: number;
    warnings: number;
  };
};

type TaskLite = { slug: string; title: string; status?: string };
type ProjectLite = { slug: string; name?: string };

function extractMeta(text: string) {
  const tags: string[] = [];
  let stripped = text.replace(PROJECT_TAG_RE, (_m, t: string) => {
    tags.push(t.toLowerCase());
    return "";
  });
  let startAt: string | null = null;
  const m = stripped.match(START_AT_RE);
  if (m) {
    const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
    const d = new Date(`${m[1]}T${time}${m[3] ?? ""}`);
    if (!isNaN(d.getTime())) startAt = d.toISOString();
    stripped = stripped.replace(START_AT_RE, "");
  }
  let percent: number | null = null;
  const pm = stripped.match(PROGRESS_RE);
  if (pm) {
    const n = Math.max(0, Math.min(100, parseInt(pm[1], 10)));
    if (!isNaN(n)) percent = n;
    stripped = stripped.replace(PROGRESS_RE, "");
  }
  return {
    tags: Array.from(new Set(tags)),
    startAt,
    percent,
    stripped: stripped.replace(/\s+/g, " ").trim(),
  };
}

function formatStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function metaDetails(
  meta: { tags: string[]; startAt: string | null; percent: number | null },
  knownProjects: Set<string>,
): { details: string[]; unknownProjects: string[] } {
  const details: string[] = [];
  const unknownProjects: string[] = [];
  for (const tag of meta.tags) {
    if (knownProjects.has(tag)) {
      details.push(`Tagged to project "${tag}"`);
    } else {
      unknownProjects.push(tag);
      details.push(`Project "${tag}" doesn't exist yet — tag is stored but won't link anywhere`);
    }
  }
  if (meta.startAt) details.push(`Scheduled for ${formatStart(meta.startAt)}`);
  if (meta.percent != null) details.push(`Progress set to ${meta.percent}%`);
  return { details, unknownProjects };
}

export function interpretNote(
  markdown: string,
  opts: { tasks?: TaskLite[]; projects?: ProjectLite[] } = {},
): NoteInterpretation {
  const tasks = opts.tasks ?? [];
  const knownProjects = new Set((opts.projects ?? []).map((p) => p.slug.toLowerCase()));
  const bySlug = new Map(tasks.map((t) => [t.slug, t]));
  const byTitle = new Map(tasks.map((t) => [t.title.toLowerCase(), t]));
  // Tasks created earlier in this same note are resolvable by later lines.
  const pendingSlugs = new Set<string>();
  const pendingTitles = new Set<string>();

  const lines: InterpretedLine[] = [];

  markdown.split("\n").forEach((rawLine, idx) => {
    const lineNumber = idx + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    // ---- checkbox line: creates or completes a task ----
    const taskMatch = trimmed.match(/^-\s*\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const done = taskMatch[1].toLowerCase() === "x";
      const meta = extractMeta(taskMatch[2].trim());
      const title = meta.stripped;
      const slug = slugify(title);
      const { details, unknownProjects } = metaDetails(meta, knownProjects);

      if (!title || !slug) {
        lines.push({
          lineNumber,
          raw: trimmed,
          action: "warning",
          label: "no title",
          summary: "Checkbox with no usable title — nothing will be created.",
          details: ["Add text after the checkbox, e.g. `- [ ] Grease the loader pins`"],
          entryType: "status",
          projectTags: meta.tags,
          unknownProjects,
          startAt: meta.startAt,
          percent: meta.percent,
        });
        return;
      }

      const existing = bySlug.get(slug) ?? byTitle.get(title.toLowerCase());
      const alreadyPending = pendingSlugs.has(slug);
      pendingSlugs.add(slug);
      pendingTitles.add(title.toLowerCase());

      if (done) {
        lines.push({
          lineNumber,
          raw: trimmed,
          action: "complete-task",
          label: "mark done",
          summary: existing
            ? `Marks task "${existing.title}" as done.`
            : `Creates "${title}" and immediately marks it done.`,
          details: [
            `Slug: ${slug}`,
            "Logs a status entry on today's note",
            ...details,
          ],
          entryType: "status",
          taskTitle: existing?.title ?? title,
          taskSlug: slug,
          projectTags: meta.tags,
          unknownProjects,
          startAt: meta.startAt,
          percent: meta.percent,
        });
        return;
      }

      lines.push({
        lineNumber,
        raw: trimmed,
        action: existing || alreadyPending ? "log-entry" : "create-task",
        label: existing || alreadyPending ? "existing task" : "new task",
        summary:
          existing || alreadyPending
            ? `Task "${existing?.title ?? title}" already exists — reused, not duplicated.`
            : `Creates a new open task "${title}".`,
        details: [`Slug: ${slug}`, "Logs a status entry on today's note", ...details],
        entryType: "status",
        taskTitle: existing?.title ?? title,
        taskSlug: slug,
        projectTags: meta.tags,
        unknownProjects,
        startAt: meta.startAt,
        percent: meta.percent,
      });
      return;
    }

    // ---- entry-type prefix ----
    let entryType: InterpretedLine["entryType"] = "note";
    let body = trimmed;
    let usedPrefix: string | null = null;
    for (const [prefix, type] of Object.entries(ENTRY_TYPE_PREFIXES)) {
      if (body.toLowerCase().startsWith(prefix)) {
        entryType = type;
        usedPrefix = prefix;
        body = body.slice(prefix.length).trim();
        break;
      }
    }

    // ---- #task/<slug> entry text ----
    const tagMatch = body.match(/^#task\/([a-z0-9-]+)\s+(.+)$/i);
    if (tagMatch) {
      const slug = tagMatch[1].toLowerCase();
      const meta = extractMeta(tagMatch[2]);
      const { details, unknownProjects } = metaDetails(meta, knownProjects);
      const task = bySlug.get(slug);
      const resolvable = !!task || pendingSlugs.has(slug);
      lines.push({
        lineNumber,
        raw: trimmed,
        action: resolvable ? "log-entry" : "warning",
        label: resolvable ? `${entryType} entry` : "unknown task",
        summary: resolvable
          ? `Adds a ${entryType} entry to "${task?.title ?? slug}": “${meta.stripped}”`
          : `No task with slug "${slug}" — this line will not be logged.`,
        details: resolvable
          ? [
              `Attached to #task/${slug}`,
              usedPrefix ? `Entry type from "${usedPrefix}" prefix` : "Entry type: note (no ! prefix)",
              ...details,
            ]
          : [
              "Check the slug on the task page, or use [[Task Title]] instead",
              ...details,
            ],
        entryType,
        taskTitle: task?.title,
        taskSlug: slug,
        unresolvedRef: !resolvable,
        projectTags: meta.tags,
        unknownProjects,
        startAt: meta.startAt,
        percent: meta.percent,
      });
      return;
    }

    // ---- [[Task Title]] entry text ----
    const linkMatch = body.match(/^\[\[([^\]]+)\]\]\s+(.+)$/);
    if (linkMatch) {
      const title = linkMatch[1].trim();
      const meta = extractMeta(linkMatch[2]);
      const { details, unknownProjects } = metaDetails(meta, knownProjects);
      const task = byTitle.get(title.toLowerCase());
      const resolvable = !!task || pendingTitles.has(title.toLowerCase());
      lines.push({
        lineNumber,
        raw: trimmed,
        action: resolvable ? "log-entry" : "warning",
        label: resolvable ? `${entryType} entry` : "no title match",
        summary: resolvable
          ? `Adds a ${entryType} entry to "${task?.title ?? title}": “${meta.stripped}”`
          : `No task titled "${title}" — this line will not be logged.`,
        details: resolvable
          ? [
              `Matched by title → #task/${task?.slug ?? slugify(title)}`,
              usedPrefix ? `Entry type from "${usedPrefix}" prefix` : "Entry type: note (no ! prefix)",
              ...details,
            ]
          : [
              "Titles must match exactly. Create it first with `- [ ] " + title + "`",
              ...details,
            ],
        entryType,
        taskTitle: task?.title,
        taskSlug: task?.slug,
        unresolvedRef: !resolvable,
        projectTags: meta.tags,
        unknownProjects,
        startAt: meta.startAt,
        percent: meta.percent,
      });
      return;
    }

    // ---- bare #task/slug with no text ----
    const bareTask = body.match(/^#task\/([a-z0-9-]+)\s*$/i);
    if (bareTask) {
      lines.push({
        lineNumber,
        raw: trimmed,
        action: "warning",
        label: "missing text",
        summary: `A #task/${bareTask[1]} reference alone is skipped — add the entry text after the slug.`,
        details: [`Example: #task/${bareTask[1]} waiting on parts from the dealer`],
        entryType,
        taskSlug: bareTask[1].toLowerCase(),
        projectTags: [],
        unknownProjects: [],
        startAt: null,
        percent: null,
      });
      return;
    }

    // ---- bare [[Title]] with no text ----
    const bareLink = body.match(/^\[\[([^\]]+)\]\]\s*$/);
    if (bareLink) {
      lines.push({
        lineNumber,
        raw: trimmed,
        action: "warning",
        label: "missing text",
        summary: `A [[${bareLink[1]}]] link alone is skipped — add the entry text after the link.`,
        details: [`Example: [[${bareLink[1]}]] dealer says Tuesday`],
        entryType,
        projectTags: [],
        unknownProjects: [],
        startAt: null,
        percent: null,
      });
      return;
    }

    // ---- prefix used but no task reference ----
    if (usedPrefix) {
      lines.push({
        lineNumber,
        raw: trimmed,
        action: "warning",
        label: "no task ref",
        summary: `"${usedPrefix}" needs a task reference to attach to, so this line stays in the note only.`,
        details: [
          `Example: ${usedPrefix} #task/<slug> ${body || "what happened"}`,
          `Or: ${usedPrefix} [[Task Title]] ${body || "what happened"}`,
        ],
        entryType,
        projectTags: [],
        unknownProjects: [],
        startAt: null,
        percent: null,
      });
      return;
    }

    // ---- untagged prose ----
    const meta = extractMeta(trimmed);
    const { details, unknownProjects } = metaDetails(meta, knownProjects);
    lines.push({
      lineNumber,
      raw: trimmed,
      action: "ignored",
      label: "note only",
      summary: "Kept in this note's text. No task, no activity-log entry.",
      details: [
        "Add `- [ ] ` to make it a task, or `#task/<slug> ` to log it against one",
        ...details,
      ],
      entryType: "note",
      projectTags: meta.tags,
      unknownProjects,
      startAt: meta.startAt,
      percent: meta.percent,
    });
  });

  const counts = {
    createTasks: lines.filter((l) => l.action === "create-task").length,
    completeTasks: lines.filter((l) => l.action === "complete-task").length,
    logEntries: lines.filter((l) => l.action === "log-entry" || l.action === "complete-task" || l.action === "create-task").length,
    ignored: lines.filter((l) => l.action === "ignored").length,
    warnings: lines.filter((l) => l.action === "warning").length,
  };

  return { lines, counts };
}

/** One-line summary suitable for a button tooltip or toast. */
export function summarizeInterpretation(counts: NoteInterpretation["counts"]): string {
  const parts: string[] = [];
  if (counts.createTasks) parts.push(`${counts.createTasks} new task${counts.createTasks === 1 ? "" : "s"}`);
  if (counts.completeTasks) parts.push(`${counts.completeTasks} marked done`);
  if (counts.logEntries) parts.push(`${counts.logEntries} log entr${counts.logEntries === 1 ? "y" : "ies"}`);
  if (counts.ignored) parts.push(`${counts.ignored} note-only line${counts.ignored === 1 ? "" : "s"}`);
  if (counts.warnings) parts.push(`${counts.warnings} need${counts.warnings === 1 ? "s" : ""} attention`);
  return parts.length ? parts.join(" · ") : "Nothing to commit yet";
}
