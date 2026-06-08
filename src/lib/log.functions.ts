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
};

function parseMarkdown(md: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // - [ ] / - [x] task line
    const taskMatch = trimmed.match(/^-\s*\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const done = taskMatch[1].toLowerCase() === "x";
      const title = taskMatch[2].trim();
      out.push({
        raw: trimmed,
        newTask: { title, done },
        entryType: "status",
      });
      continue;
    }

    // entry type prefix
    let entryType: ParsedLine["entryType"] = "note";
    let body = trimmed;
    for (const [prefix, type] of Object.entries(ENTRY_TYPE_PREFIXES)) {
      if (body.toLowerCase().startsWith(prefix)) {
        entryType = type;
        body = body.slice(prefix.length).trim();
        break;
      }
    }

    // #task/<slug> ...
    const tagMatch = body.match(/^#task\/([a-z0-9-]+)\s+(.+)$/i);
    if (tagMatch) {
      out.push({
        raw: trimmed,
        taskRef: { kind: "slug", value: tagMatch[1].toLowerCase() },
        entryType,
      });
      continue;
    }

    // [[Task Name]] ...
    const linkMatch = body.match(/^\[\[([^\]]+)\]\]\s+(.+)$/);
    if (linkMatch) {
      out.push({
        raw: trimmed,
        taskRef: { kind: "title", value: linkMatch[1].trim() },
        entryType,
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
      .select("id, slug, title, status");
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
        })
        .select("id, slug, title, status")
        .single();
      if (created) {
        tasksBySlug.set(created.slug, created);
        tasksByTitle.set(created.title.toLowerCase(), created);
      }
    }

    // 5. Update status for existing tasks where checkbox toggled to done
    for (const p of parsed) {
      if (!p.newTask) continue;
      const slug = slugify(p.newTask.title);
      const existing = tasksBySlug.get(slug);
      if (!existing) continue;
      if (p.newTask.done && existing.status !== "done") {
        await supabase
          .from("tasks")
          .update({ status: "done", closed_at: new Date().toISOString() })
          .eq("id", existing.id);
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
