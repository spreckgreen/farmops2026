import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { slugify } from "./slug";

// Rebuild a clean markdown body from activity_log raw lines, preserving
// chronological order and dropping duplicate lines.
function rebuildMarkdownFromEntries(entries: { raw_content: string; created_at: string }[]) {
  const seen = new Set<string>();
  const lines: string[] = [];
  const sorted = [...entries].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const e of sorted) {
    const raw = (e.raw_content ?? "").trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    lines.push(raw);
  }
  return lines.join("\n");
}

// Rebuild today's note markdown from existing activity_log entries.
// Used by the "Refresh from log" button when the textarea was cleared but
// the underlying log still holds the data.
export const refreshDailyNoteFromLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ noteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: entries, error } = await supabase
      .from("activity_log")
      .select("id, raw_content, created_at")
      .eq("daily_note_id", data.noteId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Dedupe activity_log rows: identical raw_content (trimmed) within the
    // same note collapses to the earliest entry. Removes duplicate IDs from
    // the database so subsequent refresh/commit cycles stay clean.
    const seen = new Map<string, string>(); // raw -> kept id
    const duplicateIds: string[] = [];
    for (const e of entries ?? []) {
      const raw = (e.raw_content ?? "").trim();
      if (!raw) {
        duplicateIds.push(e.id);
        continue;
      }
      if (seen.has(raw)) {
        duplicateIds.push(e.id);
      } else {
        seen.set(raw, e.id);
      }
    }
    if (duplicateIds.length > 0) {
      const { error: delErr } = await supabase
        .from("activity_log")
        .delete()
        .in("id", duplicateIds);
      if (delErr) throw new Error(delErr.message);
    }

    const markdown = rebuildMarkdownFromEntries(entries ?? []);
    const { error: updErr } = await supabase
      .from("daily_notes")
      .update({ markdown_content: markdown })
      .eq("id", data.noteId);
    if (updErr) throw new Error(updErr.message);
    return {
      markdown,
      restored: (entries ?? []).length - duplicateIds.length,
      deduped: duplicateIds.length,
    };
  });


// ---- Get or create today's daily note + return parsed activity for the day ----

export const getDailyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ date: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("daily_notes")
      .select("*")
      .eq("date", data.date)
      .maybeSingle();

    let note = existing;
    if (!note) {
      // Seed a new note with the most recent previous day's content so the
      // user can pick up where they left off.
      const { data: prior } = await supabase
        .from("daily_notes")
        .select("markdown_content")
        .lt("date", data.date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const seed = prior?.markdown_content ?? "";
      const { data: created, error } = await supabase
        .from("daily_notes")
        .insert({ date: data.date, user_id: userId, markdown_content: seed })
        .select()
        .single();
      if (error) throw new Error(error.message);
      note = created;
    }

    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, slug, title, status")
      .order("created_at", { ascending: false });

    const { data: entries } = await supabase
      .from("activity_log")
      .select("id, entry_type, raw_content, ai_summary, created_at, task_id, tasks(slug, title)")
      .eq("daily_note_id", note!.id)
      .order("created_at", { ascending: true });

    return { note: note!, tasks: tasks ?? [], entries: entries ?? [] };
  });

// ---- Save daily note + parse entries into activity_log ----

const ENTRY_TYPE_PREFIXES: Record<string, "blocker" | "decision" | "commit" | "meeting"> = {
  "!blocker": "blocker",
  "!decision": "decision",
  "!commit": "commit",
  "!meeting": "meeting",
};

type ParsedLine = {
  raw: string;
  taskRef?: { kind: "slug" | "title"; value: string };
  newTask?: { title: string; done: boolean };
  entryType: "status" | "blocker" | "decision" | "commit" | "meeting" | "note";
  projectTags: string[];
  startAt: string | null;
  percent: number | null;
};

const PROJECT_TAG_RE = /#project\/([a-z0-9][a-z0-9-_]*)/gi;
const START_AT_RE =
  /@start:(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})?/i;
const PROGRESS_RE = /@progress:(\d{1,3})%?/i;

function extractMeta(text: string): {
  tags: string[];
  startAt: string | null;
  percent: number | null;
  stripped: string;
} {
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

function parseMarkdown(md: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const taskMatch = trimmed.match(/^-\s*\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const done = taskMatch[1].toLowerCase() === "x";
      const meta = extractMeta(taskMatch[2].trim());
      out.push({
        raw: trimmed,
        newTask: { title: meta.stripped, done },
        entryType: "status",
        projectTags: meta.tags,
        startAt: meta.startAt,
        percent: meta.percent,
      });
      continue;
    }

    let entryType: ParsedLine["entryType"] = "note";
    let body = trimmed;
    for (const [prefix, type] of Object.entries(ENTRY_TYPE_PREFIXES)) {
      if (body.toLowerCase().startsWith(prefix)) {
        entryType = type;
        body = body.slice(prefix.length).trim();
        break;
      }
    }

    const tagMatch = body.match(/^#task\/([a-z0-9-]+)\s+(.+)$/i);
    if (tagMatch) {
      const meta = extractMeta(tagMatch[2]);
      out.push({
        raw: trimmed,
        taskRef: { kind: "slug", value: tagMatch[1].toLowerCase() },
        entryType,
        projectTags: meta.tags,
        startAt: meta.startAt,
        percent: meta.percent,
      });
      continue;
    }

    const linkMatch = body.match(/^\[\[([^\]]+)\]\]\s+(.+)$/);
    if (linkMatch) {
      const meta = extractMeta(linkMatch[2]);
      out.push({
        raw: trimmed,
        taskRef: { kind: "title", value: linkMatch[1].trim() },
        entryType,
        projectTags: meta.tags,
        startAt: meta.startAt,
        percent: meta.percent,
      });
      continue;
    }
  }
  return out;
}

// Any mutation to projects, tasks, or daily-note-driven entries invalidates
// the cached summaries: nuke them so the Reports page regenerates from scratch
// Reports and Summaries are NOT auto-invalidated when projects, tasks, or
// daily notes change. They only refresh when the user explicitly triggers a
// regenerate from the Reports or Summaries pages (which deletes prior
// summaries for that scope and inserts a fresh one). This keeps the cached
// rollups stable until the user asks for an updated take.
async function invalidateSummaries(_supabase: any, _userId: string) {
  // intentional no-op — see comment above
}

// Draft save: only persist the markdown. Parsing into tasks/activity_log is
// deferred until commitDailyNote() so that mid-typing autosaves don't churn
// the activity log with corrective intermediate entries.
export const saveDailyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ noteId: z.string().uuid(), date: z.string(), markdown: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error: updErr } = await supabase
      .from("daily_notes")
      .update({ markdown_content: data.markdown })
      .eq("id", data.noteId);
    if (updErr) throw new Error(updErr.message);
    return { saved: true, newEntries: 0 };
  });

// Commit: persist markdown AND parse it into tasks + activity_log.
// Called when the user leaves Today (unmount / navigation / tab close) or
// presses "Commit" so intermediate edits don't generate noisy log churn.
export const commitDailyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ noteId: z.string().uuid(), date: z.string(), markdown: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { error: updErr } = await supabase
      .from("daily_notes")
      .update({ markdown_content: data.markdown })
      .eq("id", data.noteId);
    if (updErr) throw new Error(updErr.message);

    const parsed = parseMarkdown(data.markdown);

    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, slug, title, status, project_tags, start_at, percent_complete, created_at");
    const tasksBySlug = new Map((existingTasks ?? []).map((t) => [t.slug, t]));
    const tasksByTitle = new Map(
      (existingTasks ?? []).map((t) => [t.title.toLowerCase(), t]),
    );

    // Dedupe window: any task created in the last 24h whose title is a
    // prefix of (or extended by) a new task is treated as the same task.
    // This kills typing-cascade duplicates ("Follow" → "Follow-up" → ...).
    const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const recentTasks = (existingTasks ?? []).filter(
      (t) => now - new Date(t.created_at).getTime() < DEDUPE_WINDOW_MS,
    );
    const findPrefixMatch = (newTitle: string) => {
      const n = newTitle.toLowerCase().trim();
      if (n.length < 2) return null;
      const candidates = recentTasks
        .filter((t) => {
          const e = t.title.toLowerCase().trim();
          if (!e) return false;
          if (e === n) return true;
          const short = e.length < n.length ? e : n;
          if (short.length < 3) return false;
          return n.startsWith(e) || e.startsWith(n);
        })
        .sort((a, b) => b.title.length - a.title.length);
      return candidates[0] ?? null;
    };

    for (const p of parsed) {
      if (!p.newTask) continue;
      const slug = slugify(p.newTask.title);
      if (!slug || tasksBySlug.has(slug)) continue;

      const match = findPrefixMatch(p.newTask.title);
      if (match) {
        if (p.newTask.title.length > match.title.length && !tasksBySlug.has(slug)) {
          // Upgrade the existing task to the longer/more complete title.
          await supabase
            .from("tasks")
            .update({ title: p.newTask.title, slug })
            .eq("id", match.id);
          tasksBySlug.delete(match.slug);
          tasksByTitle.delete(match.title.toLowerCase());
          const upgraded = { ...match, title: p.newTask.title, slug };
          tasksBySlug.set(slug, upgraded);
          tasksByTitle.set(p.newTask.title.toLowerCase(), upgraded);
          const idx = recentTasks.findIndex((t) => t.id === match.id);
          if (idx >= 0) recentTasks[idx] = upgraded;
        } else {
          // Existing one is already the longer/canonical form — reuse it.
          tasksBySlug.set(slug, match);
          tasksByTitle.set(p.newTask.title.toLowerCase(), match);
        }
        continue;
      }

      const { data: created } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          slug,
          title: p.newTask.title,
          status: p.newTask.done ? "done" : "open",
          closed_at: p.newTask.done ? new Date().toISOString() : null,
          project_tags: p.projectTags,
          start_at: p.startAt,
          percent_complete: p.newTask.done ? 100 : (p.percent ?? 0),
        })
        .select("id, slug, title, status, project_tags, start_at, percent_complete, created_at")
        .single();
      if (created) {
        tasksBySlug.set(created.slug, created);
        tasksByTitle.set(created.title.toLowerCase(), created);
        recentTasks.push(created);
      }
    }

    const resolveTask = (p: ParsedLine) => {
      if (p.newTask) return tasksBySlug.get(slugify(p.newTask.title));
      if (p.taskRef)
        return p.taskRef.kind === "slug"
          ? tasksBySlug.get(p.taskRef.value)
          : tasksByTitle.get(p.taskRef.value.toLowerCase());
      return undefined;
    };
    for (const p of parsed) {
      const existing = resolveTask(p);
      if (!existing) continue;
      const upd: {
        status?: "done";
        closed_at?: string;
        project_tags?: string[];
        start_at?: string;
        percent_complete?: number;
      } = {};
      if (p.newTask?.done && existing.status !== "done") {
        upd.status = "done";
        upd.closed_at = new Date().toISOString();
        upd.percent_complete = 100;
      }
      if (p.projectTags.length > 0) {
        const merged = Array.from(
          new Set([...(existing.project_tags ?? []), ...p.projectTags]),
        );
        if (merged.length !== (existing.project_tags ?? []).length) {
          upd.project_tags = merged;
        }
      }
      if (p.startAt && p.startAt !== existing.start_at) {
        upd.start_at = p.startAt;
      }
      if (p.percent !== null && p.percent !== existing.percent_complete) {
        upd.percent_complete = p.percent;
      }
      if (Object.keys(upd).length > 0) {
        await supabase.from("tasks").update(upd).eq("id", existing.id);
      }
    }

    type EntryInsert = {
      user_id: string;
      task_id: string | null;
      daily_note_id: string;
      entry_type: ParsedLine["entryType"];
      raw_content: string;
    };
    const entries: EntryInsert[] = [];
    for (const p of parsed) {
      let taskId: string | null = null;
      if (p.newTask) {
        const slug = slugify(p.newTask.title);
        taskId = tasksBySlug.get(slug)?.id ?? null;
      } else if (p.taskRef) {
        const found =
          p.taskRef.kind === "slug"
            ? tasksBySlug.get(p.taskRef.value)
            : tasksByTitle.get(p.taskRef.value.toLowerCase());
        if (!found) continue;
        taskId = found.id;
      } else {
        continue;
      }
      entries.push({
        user_id: userId,
        task_id: taskId,
        daily_note_id: data.noteId,
        entry_type: p.entryType,
        raw_content: p.raw,
      });
    }

    // Safety: never wipe existing log entries when commit produced nothing
    // (e.g. user accidentally cleared the textarea). Preserves prior commits
    // so the "Refresh from log" button can rebuild the note.
    if (entries.length > 0) {
      const { error: delErr } = await supabase
        .from("activity_log")
        .delete()
        .eq("daily_note_id", data.noteId);
      if (delErr) throw new Error(delErr.message);
      const { error: insErr } = await supabase.from("activity_log").insert(entries);
      if (insErr) throw new Error(insErr.message);
    }

    await invalidateSummaries(supabase, userId);
    return { committed: true, newEntries: entries.length };
  });

// ---- Tasks ----

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getTaskBySlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: task } = await supabase
      .from("tasks")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!task) return null;
    const { data: entries } = await supabase
      .from("activity_log")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false });
    return { task, entries: entries ?? [] };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "blocked", "done"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("tasks")
      .update({
        status: data.status,
        closed_at: data.status === "done" ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await invalidateSummaries(supabase, userId);
    return { ok: true };
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tasks")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await invalidateSummaries(context.supabase, context.userId);
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await invalidateSummaries(context.supabase, context.userId);
    return { ok: true };
  });

// ---- Scheduled tasks report ----

export const listProjectTags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tasks")
      .select("project_tags");
    if (error) throw new Error(error.message);
    const tags = new Set<string>();
    for (const row of data ?? []) {
      for (const t of (row.project_tags ?? []) as string[]) tags.add(t);
    }
    return Array.from(tags).sort();
  });

export const listScheduledTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tag: z.string().trim().min(1).max(64).nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("tasks")
      .select(
        "id, slug, title, status, project_tags, start_at, percent_complete, closed_at, updated_at",
      )
      .not("start_at", "is", null)
      .order("start_at", { ascending: true });
    if (data.tag) q = q.contains("project_tags", [data.tag]);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---- Summaries ----


export const listSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("summaries")
      .select("*, scope_task:tasks(slug, title)")
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });

export const updateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        edited_summary: z.any().optional(),
        status: z.enum(["draft", "reviewed", "published"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const update: {
      edited_summary?: unknown;
      status?: "draft" | "reviewed" | "published";
    } = {};
    if (data.edited_summary !== undefined) update.edited_summary = data.edited_summary;
    if (data.status !== undefined) update.status = data.status;
    const { error } = await context.supabase
      .from("summaries")
      .update(update as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Projects (hashtag lookup) ----

const slugRe = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        slug: z.string().trim().min(1).max(64).regex(slugRe, "lowercase, numbers, dashes"),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      start_date: data.start_date ?? null,
    };
    if (data.id) {
      const { error } = await supabase.from("projects").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      await invalidateSummaries(supabase, userId);
      return { ok: true as const, id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("projects")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await invalidateSummaries(supabase, userId);
    return { ok: true as const, id: inserted.id };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await invalidateSummaries(context.supabase, context.userId);
    return { ok: true };
  });

// ---- TiddlyWiki import upserts ----

const TaskImportSchema = z.object({
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?$/),
  title: z.string().trim().min(1).max(500),
  status: z.enum(["open", "blocked", "done"]),
  project_tags: z.array(z.string().trim().min(1).max(64)).max(20),
  start_at: z.string().nullable(),
  percent_complete: z.number().int().min(0).max(100),
  closed_at: z.string().nullable(),
});

export const importTasksFromTiddlers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tasks: z.array(TaskImportSchema).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let inserted = 0;
    let updated = 0;
    for (const t of data.tasks) {
      const { data: existing } = await supabase
        .from("tasks")
        .select("id")
        .eq("slug", t.slug)
        .maybeSingle();
      const payload = {
        user_id: userId,
        slug: t.slug,
        title: t.title,
        status: t.status,
        project_tags: t.project_tags,
        start_at: t.start_at,
        percent_complete: t.percent_complete,
        closed_at: t.closed_at,
      };
      if (existing) {
        const { error } = await supabase.from("tasks").update(payload).eq("id", existing.id);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await supabase.from("tasks").insert(payload);
        if (error) throw new Error(error.message);
        inserted++;
      }
    }
    return { ok: true as const, inserted, updated };
  });

const SummaryImportSchema = z.object({
  id: z.string().uuid().nullable(),
  mode: z.enum(["weekly_report", "project_rollup", "task_update"]),
  scope_project: z.string().trim().min(1).max(64).nullable(),
  scope_task_slug: z.string().trim().min(1).max(120).nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  status: z.enum(["draft", "reviewed", "published"]).nullable(),
  created_at: z.string().nullable(),
  body: z.any(),
});

export const importSummariesFromTiddlers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ summaries: z.array(SummaryImportSchema).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let inserted = 0;
    let updated = 0;
    for (const s of data.summaries) {
      // Resolve optional scope_task_id by slug.
      let scope_task_id: string | null = null;
      if (s.scope_task_slug) {
        const { data: t } = await supabase
          .from("tasks")
          .select("id")
          .eq("slug", s.scope_task_slug)
          .maybeSingle();
        scope_task_id = t?.id ?? null;
      }
      // Match existing row by id, or by (mode, scope, period) signature.
      let existingId: string | null = null;
      if (s.id) {
        const { data: byId } = await supabase
          .from("summaries")
          .select("id")
          .eq("id", s.id)
          .maybeSingle();
        existingId = byId?.id ?? null;
      }
      if (!existingId && s.period_start && s.period_end) {
        const { data: bySig } = await supabase
          .from("summaries")
          .select("id")
          .eq("mode", s.mode)
          .eq("period_start", s.period_start)
          .eq("period_end", s.period_end)
          .maybeSingle();
        existingId = bySig?.id ?? null;
      }
      const payload = {
        user_id: userId,
        mode: s.mode,
        scope_project: s.scope_project,
        scope_task_id,
        period_start: s.period_start ?? new Date().toISOString(),
        period_end: s.period_end ?? new Date().toISOString(),
        edited_summary: s.body ?? null,
        status: s.status ?? "draft",
      };
      if (existingId) {
        const { error } = await supabase
          .from("summaries")
          .update(payload)
          .eq("id", existingId);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        // generated_summary is NOT NULL — seed with the same body if we have nothing else.
        const { error } = await supabase.from("summaries").insert({
          ...payload,
          generated_summary: s.body ?? {},
        });
        if (error) throw new Error(error.message);
        inserted++;
      }
    }
    return { ok: true as const, inserted, updated };
  });
