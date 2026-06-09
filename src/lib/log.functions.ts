import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { slugify } from "./slug";

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
      const { data: created, error } = await supabase
        .from("daily_notes")
        .insert({ date: data.date, user_id: userId, markdown_content: "" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      note = created;
    }

    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, slug, title, status")
      .order("created_at", { ascending: false });

    return { note: note!, tasks: tasks ?? [] };
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

export const saveDailyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ noteId: z.string().uuid(), date: z.string(), markdown: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Save markdown
    const { error: updErr } = await supabase
      .from("daily_notes")
      .update({ markdown_content: data.markdown })
      .eq("id", data.noteId);
    if (updErr) throw new Error(updErr.message);

    // 2. Parse
    const parsed = parseMarkdown(data.markdown);

    // 3. Existing tasks (for resolve + create check)
    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, slug, title, status, project_tags, start_at, percent_complete");
    const tasksBySlug = new Map((existingTasks ?? []).map((t) => [t.slug, t]));
    const tasksByTitle = new Map(
      (existingTasks ?? []).map((t) => [t.title.toLowerCase(), t]),
    );

    // 4. Create new tasks from `- [ ]` lines that don't exist yet
    for (const p of parsed) {
      if (!p.newTask) continue;
      const slug = slugify(p.newTask.title);
      if (!slug || tasksBySlug.has(slug)) continue;
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
        .select("id, slug, title, status, project_tags, start_at, percent_complete")
        .single();
      if (created) {
        tasksBySlug.set(created.slug, created);
        tasksByTitle.set(created.title.toLowerCase(), created);
      }
    }

    // 5. Update status / tags / start_at / percent for resolved tasks
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

    // 6. Build entries; resolve task refs
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
        if (!found) continue; // skip unresolved
        taskId = found.id;
      } else {
        continue; // untagged → stays in daily note only
      }
      entries.push({
        user_id: userId,
        task_id: taskId,
        daily_note_id: data.noteId,
        entry_type: p.entryType,
        raw_content: p.raw,
      });
    }

    // 7. Deduplicate against entries already logged for this daily_note_id
    const { data: existingEntries } = await supabase
      .from("activity_log")
      .select("raw_content")
      .eq("daily_note_id", data.noteId);
    const seen = new Set((existingEntries ?? []).map((e) => e.raw_content));
    const fresh = entries.filter((e) => !seen.has(e.raw_content));

    if (fresh.length > 0) {
      const { error: insErr } = await supabase.from("activity_log").insert(fresh);
      if (insErr) throw new Error(insErr.message);
    }

    return { saved: true, newEntries: fresh.length };
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
    const { supabase } = context;
    const { error } = await supabase
      .from("tasks")
      .update({
        status: data.status,
        closed_at: data.status === "done" ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
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
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
      return { ok: true as const, id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("projects")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: inserted.id };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
