import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { slugify } from "./slug";

type ActivityLogEntry = { id?: string; raw_content: string; created_at: string };

function normalizeLogLine(raw: string) {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

// Canonical markdown for a task pulled into a daily note. parseMarkdown
// requires `#task/<slug>` to come first to register as a ref (and not as a
// new task); after that we append the title and any metadata so the line
// renders cleanly when the note is rebuilt from the activity log.
function buildTaskRefLine(task: {
  slug: string;
  title: string | null;
  project_tags?: string[] | null;
  start_at?: string | null;
  percent_complete?: number | null;
}) {
  const parts: string[] = [`- #task/${task.slug}`, (task.title ?? "").trim() || task.slug];
  for (const tag of task.project_tags ?? []) {
    if (tag && tag !== "maintenance") parts.push(`#project/${tag}`);
  }
  if (task.start_at) {
    const iso = task.start_at.replace(/\.\d+/, "").replace(/Z$/, "");
    parts.push(`@start:${iso}`);
  }
  if (typeof task.percent_complete === "number" && task.percent_complete > 0) {
    parts.push(`@progress:${Math.round(task.percent_complete)}`);
  }
  return parts.join(" ");
}


// ---- Configurable dedupe normalization ----
//
// The signature used for clustering near-duplicate task lines is tunable so
// different vaults can opt into stricter or looser collapsing. Defaults are
// chosen to handle the common Obsidian-style noise: bracket prefixes like
// [WIP] / [URGENT], leading filler stop words, and arbitrary punctuation.

export type DedupeConfig = {
  /** Strip leading bracketed prefixes such as `[WIP]`, `[URGENT]`, `(draft)`. */
  stripBracketPrefixes: boolean;
  /** Lowercased tokens removed from the signature (the canonical line text is preserved). */
  stopWords: string[];
  /** Additional regex source strings stripped from the task body before tokenizing. */
  extraStripPatterns: string[];
  /** Number of leading words that make up the signature. */
  signatureWords: number;
  /** Minimum signature length before we fall back to the full normalized line. */
  signatureMinChars: number;
};

export const DEFAULT_DEDUPE_CONFIG: DedupeConfig = {
  stripBracketPrefixes: true,
  stopWords: [
    "the", "a", "an",
    "to", "for", "of", "on", "in", "at", "with", "by", "from",
    "and", "or",
    "my", "our", "your",
    "todo", "task",
  ],
  extraStripPatterns: [],
  signatureWords: 3,
  signatureMinChars: 6,
};

const BRACKET_PREFIX_RE = /^(?:[\[(][^\])]+[\])]\s*)+/;

function normalizeTaskForDedupe(raw: string, config: DedupeConfig = DEFAULT_DEDUPE_CONFIG) {
  const taskMatch = normalizeLogLine(raw).match(/^-\s*\[[ xX]\]\s+(.+)$/);
  if (!taskMatch) return null;
  let body = taskMatch[1];
  if (config.stripBracketPrefixes) {
    body = body.replace(BRACKET_PREFIX_RE, "");
  }
  for (const pattern of config.extraStripPatterns) {
    try {
      body = body.replace(new RegExp(pattern, "gi"), " ");
    } catch {
      // ignore invalid user-supplied patterns
    }
  }
  return body
    .replace(/#project\/[a-z0-9][a-z0-9-_]*/gi, " ")
    .replace(/@start:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?/gi, " ")
    .replace(/@progress:\d{1,3}%?/gi, " ")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Signature-based clustering: derivative typing chains (e.g. "Follow",
// "Follow-up", "Follow-up Bracket", "Follow-up Bracket/weld", …) all share
// the same opening tokens, so we cluster task lines by the first few
// normalized words and keep one canonical entry per cluster.
function taskSignature(raw: string, config: DedupeConfig = DEFAULT_DEDUPE_CONFIG): string | null {
  const normalized = normalizeTaskForDedupe(raw, config);
  if (!normalized) return null;
  const stop = new Set(config.stopWords.map((w) => w.toLowerCase()));
  const words = normalized.split(" ").filter((w) => w && !stop.has(w));
  if (words.length === 0) {
    // Everything was a stop word — fall back to the raw normalized line so
    // we don't collapse unrelated stop-word-only entries together.
    return normalized || null;
  }
  const head = words.slice(0, config.signatureWords).join(" ");
  if (head.length < config.signatureMinChars && words.length >= config.signatureWords) {
    return words.join(" ");
  }
  return head;
}

function isBetterCanonicalLine(
  candidate: string,
  current: string,
  config: DedupeConfig = DEFAULT_DEDUPE_CONFIG,
) {
  const candidateTask = normalizeTaskForDedupe(candidate, config);
  const currentTask = normalizeTaskForDedupe(current, config);
  if (candidateTask && currentTask && candidateTask.length !== currentTask.length) {
    return candidateTask.length > currentTask.length;
  }
  return normalizeLogLine(candidate).length > normalizeLogLine(current).length;
}

function dedupeLogEntries(
  entries: ActivityLogEntry[],
  config: DedupeConfig = DEFAULT_DEDUPE_CONFIG,
) {
  const kept: ActivityLogEntry[] = [];
  const duplicateIds: string[] = [];
  const taskClusters = new Map<string, number>();
  const nonTaskIndex = new Map<string, number>();

  const sorted = [...entries].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  for (const e of sorted) {
    const raw = normalizeLogLine(e.raw_content);
    if (!raw) {
      if (e.id) duplicateIds.push(e.id);
      continue;
    }

    const signature = taskSignature(raw, config);

    if (signature) {
      const existingIdx = taskClusters.get(signature);
      if (existingIdx === undefined) {
        taskClusters.set(signature, kept.length);
        kept.push({ ...e, raw_content: raw });
        continue;
      }
      const current = kept[existingIdx];
      if (isBetterCanonicalLine(raw, current.raw_content, config)) {
        if (current.id) duplicateIds.push(current.id);
        kept[existingIdx] = { ...e, raw_content: raw };
      } else if (e.id) {
        duplicateIds.push(e.id);
      }
      continue;
    }

    const existingIdx = nonTaskIndex.get(raw);
    if (existingIdx === undefined) {
      nonTaskIndex.set(raw, kept.length);
      kept.push({ ...e, raw_content: raw });
    } else if (e.id) {
      duplicateIds.push(e.id);
    }
  }
  return { kept, duplicateIds };
}

function lineMatchesAny(
  lines: string[],
  candidate: string,
  config: DedupeConfig = DEFAULT_DEDUPE_CONFIG,
) {
  const normalizedCandidate = normalizeLogLine(candidate);
  const signature = taskSignature(normalizedCandidate, config);
  if (signature) {
    return lines.some((line) => taskSignature(line, config) === signature);
  }
  return lines.some((line) => normalizeLogLine(line) === normalizedCandidate);
}

const dedupeConfigSchema = z
  .object({
    stripBracketPrefixes: z.boolean().optional(),
    stopWords: z.array(z.string().min(1).max(40)).max(200).optional(),
    extraStripPatterns: z.array(z.string().min(1).max(200)).max(50).optional(),
    signatureWords: z.number().int().min(1).max(10).optional(),
    signatureMinChars: z.number().int().min(1).max(40).optional(),
  })
  .optional();

function resolveDedupeConfig(
  override: z.infer<typeof dedupeConfigSchema>,
): DedupeConfig {
  if (!override) return DEFAULT_DEDUPE_CONFIG;
  return {
    stripBracketPrefixes: override.stripBracketPrefixes ?? DEFAULT_DEDUPE_CONFIG.stripBracketPrefixes,
    stopWords: override.stopWords
      ? override.stopWords.map((w) => w.toLowerCase())
      : DEFAULT_DEDUPE_CONFIG.stopWords,
    extraStripPatterns: override.extraStripPatterns ?? DEFAULT_DEDUPE_CONFIG.extraStripPatterns,
    signatureWords: override.signatureWords ?? DEFAULT_DEDUPE_CONFIG.signatureWords,
    signatureMinChars: override.signatureMinChars ?? DEFAULT_DEDUPE_CONFIG.signatureMinChars,
  };
}

// Rebuild today's note markdown from existing activity_log entries.
// Used by the "Refresh from log" button when the textarea was cleared but
// the underlying log still holds the data.
export const refreshDailyNoteFromLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        noteId: z.string().uuid(),
        currentMarkdown: z.string().optional(),
        dedupeConfig: dedupeConfigSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const config = resolveDedupeConfig(data.dedupeConfig);
    const { data: entries, error } = await supabase
      .from("activity_log")
      .select("id, raw_content, created_at")
      .eq("daily_note_id", data.noteId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Treat the current draft as authoritative for deletions: if the user
    // removed lines from the textarea, drop matching activity_log rows so
    // future refreshes don't resurrect them. Only do this when the draft is
    // non-empty, so an accidentally cleared textarea still restores from log.
    const draftLines = (data.currentMarkdown ?? "")
      .split("\n")
      .map(normalizeLogLine)
      .filter(Boolean);
    let workingEntries: ActivityLogEntry[] = entries ?? [];
    const explicitlyDeletedIds: string[] = [];
    if (draftLines.length > 0) {
      const draftSignatures = new Set<string>();
      const draftExact = new Set<string>();
      for (const line of draftLines) {
        const sig = taskSignature(line, config);
        if (sig) draftSignatures.add(sig);
        else draftExact.add(line);
      }
      const survivors: ActivityLogEntry[] = [];
      for (const e of workingEntries) {
        const raw = normalizeLogLine(e.raw_content);
        const sig = taskSignature(raw, config);
        const kept = sig ? draftSignatures.has(sig) : draftExact.has(raw);
        if (kept) survivors.push(e);
        else if (e.id) explicitlyDeletedIds.push(e.id);
      }
      workingEntries = survivors;
    }

    // Dedupe activity_log rows: exact duplicates and near-duplicate task
    // typing cascades collapse to the longest/canonical entry. Removes
    // duplicate IDs from the database so future refreshes stay clean.
    const { kept, duplicateIds } = dedupeLogEntries(workingEntries, config);
    const toDelete = [...explicitlyDeletedIds, ...duplicateIds];
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.from("activity_log").delete().in("id", toDelete);
      if (delErr) throw new Error(delErr.message);
    }

    const rebuilt = kept.map((entry) => entry.raw_content).join("\n");

    // Safe merge: preserve any lines the user typed in the editor since the
    // last commit. Lines from the current draft that are NOT already present
    // in the rebuilt-from-log markdown are appended at the bottom, in their
    // original order. Whitespace-only lines and exact duplicates are skipped.
    const rebuiltLines = rebuilt.split("\n").map(normalizeLogLine).filter(Boolean);
    const draftOnly: string[] = [];
    for (const rawLine of (data.currentMarkdown ?? "").split("\n")) {
      const trimmed = normalizeLogLine(rawLine);
      if (!trimmed) continue;
      if (lineMatchesAny(rebuiltLines, trimmed, config)) continue;
      if (lineMatchesAny(draftOnly, trimmed, config)) continue;
      draftOnly.push(trimmed);
    }
    const markdown =
      draftOnly.length > 0 ? (rebuilt ? rebuilt + "\n" : "") + draftOnly.join("\n") : rebuilt;

    const { error: updErr } = await supabase
      .from("daily_notes")
      .update({ markdown_content: markdown })
      .eq("id", data.noteId);
    if (updErr) throw new Error(updErr.message);
    return {
      markdown,
      restored: kept.length,
      deduped: duplicateIds.length + explicitlyDeletedIds.length,
      preserved: draftOnly.length,
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

// Returns tasks delivered/touched on a given day (defaults to today).
// "Touched today" = task has an activity_log entry linked to that day's
// daily note for the current user, OR the task was created today.
export const listTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const date =
      data?.date ??
      new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });

    // Today's daily note (may not exist yet).
    const { data: note } = await supabase
      .from("daily_notes")
      .select("id")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

    // Task ids referenced by today's activity log entries.
    let todayTaskIds: string[] = [];
    if (note?.id) {
      const { data: entries } = await supabase
        .from("activity_log")
        .select("task_id")
        .eq("user_id", userId)
        .eq("daily_note_id", note.id);
      todayTaskIds = Array.from(
        new Set((entries ?? []).map((e) => e.task_id).filter((x): x is string => !!x)),
      );
    }

    // Day window (UTC) for task created_at / closed_at fallback.
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const conditions = [
      `and(closed_at.gte.${dayStart},closed_at.lte.${dayEnd})`,
    ];
    if (todayTaskIds.length) {
      conditions.push(`id.in.(${todayTaskIds.join(",")})`);
    }
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("*")
      .or(conditions.join(","))
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Done tasks should only appear if they actually transitioned to done
    // today — i.e. closed_at falls within today AND the task is referenced
    // by an activity_log entry on today's daily note. This prevents stale
    // done items (carried over by recurrence resets, log refreshes that
    // re-stamp closed_at, etc.) from cluttering the Done section.
    const todaySet = new Set(todayTaskIds);
    const filtered = (tasks ?? []).filter((t) => {
      if (t.status !== "done") return true;
      if (!t.closed_at) return false;
      if (t.closed_at < dayStart || t.closed_at > dayEnd) return false;
      return todaySet.has(t.id);
    });
    return filtered;
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

export const RECURRENCE_VALUES = ["none", "daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCE_VALUES)[number];

function advanceRecurrence(from: Date, kind: Recurrence): Date | null {
  const d = new Date(from);
  switch (kind) {
    case "daily": d.setUTCDate(d.getUTCDate() + 1); return d;
    case "weekly": d.setUTCDate(d.getUTCDate() + 7); return d;
    case "monthly": d.setUTCMonth(d.getUTCMonth() + 1); return d;
    case "quarterly": d.setUTCMonth(d.getUTCMonth() + 3); return d;
    case "yearly": d.setUTCFullYear(d.getUTCFullYear() + 1); return d;
    default: return null;
  }
}

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "blocked", "done"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date();

    const { data: existing } = await supabase
      .from("tasks")
      .select("recurrence, recurrence_next_at, start_at")
      .eq("id", data.id)
      .maybeSingle();

    const recurrence = ((existing as { recurrence?: string } | null)?.recurrence ?? "none") as Recurrence;
    const isRepeating = data.status === "done" && recurrence !== "none";

    const update: Record<string, unknown> = {
      status: isRepeating ? "open" : data.status,
      closed_at: data.status === "done" && !isRepeating ? now.toISOString() : null,
    };
    if (isRepeating) {
      const ex = existing as { recurrence_next_at?: string | null; start_at?: string | null } | null;
      const base = ex?.recurrence_next_at
        ? new Date(ex.recurrence_next_at)
        : ex?.start_at
        ? new Date(ex.start_at)
        : now;
      const next = advanceRecurrence(base < now ? now : base, recurrence);
      if (next) {
        update.recurrence_next_at = next.toISOString();
        update.start_at = next.toISOString();
        update.percent_complete = 0;
      }
    }

    const { error } = await supabase.from("tasks").update(update as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    await invalidateSummaries(supabase, userId);
    return { ok: true, repeated: isRepeating };
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(500).optional(),
        recurrence: z.enum(RECURRENCE_VALUES).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.recurrence !== undefined) {
      patch.recurrence = data.recurrence;
      if (data.recurrence === "none") {
        patch.recurrence_next_at = null;
      } else {
        const next = advanceRecurrence(new Date(), data.recurrence);
        if (next) patch.recurrence_next_at = next.toISOString();
      }
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("tasks")
      .update(patch as never)
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
        "id, slug, title, status, project_tags, start_at, percent_complete, closed_at, updated_at, recurrence, recurrence_next_at",
      )
      .or("start_at.not.is.null,recurrence.neq.none")
      .order("start_at", { ascending: true, nullsFirst: false });
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
      .order("period_end", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);
    return data ?? [];
  });

// Latest mutation timestamp across the data sources that feed reports
// (activity log, tasks, projects). Used by the Reports tab to decide if a
// summary is stale and needs regeneration on tab switch.
export const getLatestDataChange = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [a, t, p] = await Promise.all([
      supabase
        .from("activity_log")
        .select("created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select("updated_at, created_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("projects")
        .select("updated_at, created_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const today_at = a.data?.created_at ?? null;
    const tasks_at = t.data?.updated_at ?? t.data?.created_at ?? null;
    const projects_at = p.data?.updated_at ?? p.data?.created_at ?? null;
    const candidates = [today_at, tasks_at, projects_at].filter(
      (s): s is string => typeof s === "string",
    );
    const latest = candidates
      .map((s) => new Date(s).getTime())
      .reduce((a, b) => (a > b ? a : b), 0);
    return {
      latest_at: latest > 0 ? new Date(latest).toISOString() : null,
      sources: { today_at, tasks_at, projects_at },
    };
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
  mode: z.enum([
    "weekly_report",
    "project_rollup",
    "task_update",
    "quarter_review",
    "daily_recap",
    "monthly_rollup",
    "yearly_rollup",
  ]),
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

// ============================================================
// Backlog: queued tasks not yet pulled into today's work.
// ============================================================

export const listBacklog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const date =
      data?.date ??
      new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });

    const { data: note } = await supabase
      .from("daily_notes")
      .select("id")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

    let todayTaskIds: string[] = [];
    if (note?.id) {
      const { data: entries } = await supabase
        .from("activity_log")
        .select("task_id")
        .eq("user_id", userId)
        .eq("daily_note_id", note.id);
      todayTaskIds = Array.from(
        new Set((entries ?? []).map((e) => e.task_id).filter((x): x is string => !!x)),
      );
    }

    let query = supabase
      .from("tasks")
      .select("*")
      .in("status", ["open", "blocked"])
      .order("created_at", { ascending: false });

    // Exclude tasks already pulled into today's activity log.
    const { data: tasks, error } = await query;
    if (error) throw new Error(error.message);
    const todaySet = new Set(todayTaskIds);
    const filtered = (tasks ?? []).filter((t) => !todaySet.has(t.id));
    return filtered;
  });

export const createBacklogTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(500),
        project_tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const base = slugify(data.title).slice(0, 80) || "task";
    let slug = base;
    for (let i = 0; i < 50; i++) {
      const { data: existing } = await supabase
        .from("tasks")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const { data: row, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        slug,
        title: data.title.trim(),
        status: "open",
        project_tags: data.project_tags ?? [],
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });



export const addTaskToToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ taskId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, slug, title, project_tags, start_at, percent_complete")

      .eq("id", data.taskId)
      .maybeSingle();
    if (taskErr) throw new Error(taskErr.message);
    if (!task) throw new Error("Task not found");

    // Ensure today's daily note exists.
    let { data: note } = await supabase
      .from("daily_notes")
      .select("id, markdown_content")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (!note) {
      const { data: created, error: insErr } = await supabase
        .from("daily_notes")
        .insert({ user_id: userId, date, markdown_content: "" })
        .select("id, markdown_content")
        .single();
      if (insErr) throw new Error(insErr.message);
      note = created;
    }

    // Append a reference line if not already present in the markdown.
    const refLine = buildTaskRefLine(task);

    const current = note.markdown_content ?? "";
    if (!current.includes(`#task/${task.slug}`)) {
      const next = current.trim().length ? `${current.trimEnd()}\n${refLine}\n` : `${refLine}\n`;
      await supabase
        .from("daily_notes")
        .update({ markdown_content: next })
        .eq("id", note.id);
    }

    // Insert activity log entry so listTasks picks it up immediately.
    const { data: existing } = await supabase
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("daily_note_id", note.id)
      .eq("task_id", task.id)
      .limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("activity_log").insert({
        user_id: userId,
        task_id: task.id,
        daily_note_id: note.id,
        entry_type: "note",
        raw_content: refLine,
      });
    }

    return { ok: true as const, taskId: task.id };
  });

// ============================================================
// Maintenance → Backlog: items due within the current month.
// ============================================================

export const listDueMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const today =
      data?.date ??
      new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
    const [y, m] = today.split("-").map(Number);
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data: records, error } = await supabase
      .from("maintenance_records")
      .select("id, title, asset_name, service_type, status, due_at, scheduled_date, completed_date")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const inMonth = (records ?? []).filter((r) => {
      if (r.completed_date) return false;
      if ((r.status ?? "").toLowerCase() === "completed" || (r.status ?? "").toLowerCase() === "done") return false;
      const due = r.due_at ?? (r.scheduled_date ? r.scheduled_date.slice(0, 10) : null);
      if (!due) return false;
      return due >= monthStart && due <= monthEnd;
    });

    // Hide ones that already have a matching task in the backlog or today.
    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("slug, status");
    const taskSlugs = new Set(
      (existingTasks ?? [])
        .filter((t) => t.status !== "done")
        .map((t) => t.slug),
    );

    return inMonth
      .map((r) => {
        const label =
          r.title ??
          [r.service_type, r.asset_name].filter(Boolean).join(" — ") ??
          "Maintenance";
        const slug = slugify(`maint ${label}`);
        return {
          id: r.id,
          title: label,
          due_at: r.due_at ?? (r.scheduled_date ? r.scheduled_date.slice(0, 10) : null),
          asset_name: r.asset_name,
          service_type: r.service_type,
          slug,
          alreadyQueued: taskSlugs.has(slug),
        };
      })
      .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  });

export const addMaintenanceToToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ maintenanceId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rec, error: recErr } = await supabase
      .from("maintenance_records")
      .select("id, title, asset_name, service_type")
      .eq("id", data.maintenanceId)
      .maybeSingle();
    if (recErr) throw new Error(recErr.message);
    if (!rec) throw new Error("Maintenance record not found");

    const label =
      rec.title ??
      [rec.service_type, rec.asset_name].filter(Boolean).join(" — ") ??
      "Maintenance";
    const slug = slugify(`maint ${label}`);

    // Find or create task.
    let { data: task } = await supabase
      .from("tasks")
      .select("id, slug, title, project_tags, start_at, percent_complete")

      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (!task) {
      const { data: created, error: insErr } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          slug,
          title: label,
          status: "open",
          project_tags: ["maintenance"],
        })
        .select("id, slug, title, project_tags, start_at, percent_complete")
        .single();
      if (insErr) throw new Error(insErr.message);
      task = created;
    }
    if (!task) throw new Error("Failed to resolve maintenance task");


    // Reuse the same today-attach flow.
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
    let { data: note } = await supabase
      .from("daily_notes")
      .select("id, markdown_content")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (!note) {
      const { data: created, error: nErr } = await supabase
        .from("daily_notes")
        .insert({ user_id: userId, date, markdown_content: "" })
        .select("id, markdown_content")
        .single();
      if (nErr) throw new Error(nErr.message);
      note = created;
    }

    const refLine = `- #task/${task.slug} ${task.title}`;
    const current = note.markdown_content ?? "";
    if (!current.includes(`#task/${task.slug}`)) {
      const next = current.trim().length ? `${current.trimEnd()}\n${refLine}\n` : `${refLine}\n`;
      await supabase.from("daily_notes").update({ markdown_content: next }).eq("id", note.id);
    }

    const { data: existing } = await supabase
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("daily_note_id", note.id)
      .eq("task_id", task.id)
      .limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("activity_log").insert({
        user_id: userId,
        task_id: task.id,
        daily_note_id: note.id,
        entry_type: "note",
        raw_content: refLine,
      });
    }

    return { ok: true as const, taskId: task.id, slug: task.slug };
  });

// ============================================================
// Inventory re-orders: items with quantity < 1 surface in backlog.
// ============================================================

export const listReorderInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [invRes, conRes, tasksRes] = await Promise.all([
      supabase
        .from("inventory_items")
        .select("id, name, sku, quantity, unit, vendor")
        .eq("user_id", userId),
      supabase
        .from("consumables")
        .select("id, name, unit, quantity_in_stock")
        .eq("user_id", userId),
      supabase.from("tasks").select("slug, status").eq("user_id", userId),
    ]);
    if (invRes.error) throw new Error(invRes.error.message);
    if (conRes.error) throw new Error(conRes.error.message);

    const openSlugs = new Set(
      (tasksRes.data ?? [])
        .filter((t) => t.status !== "done")
        .map((t) => t.slug),
    );

    type ReorderItem = {
      id: string;
      kind: "inventory" | "consumable";
      name: string;
      quantity: number;
      unit: string | null;
      vendor: string | null;
      slug: string;
      alreadyQueued: boolean;
    };

    const lowInv: ReorderItem[] = (invRes.data ?? [])
      .filter((i) => i.name && Number(i.quantity ?? 0) < 1)
      .map((i) => {
        const slug = slugify(`order ${i.name}`);
        return {
          id: i.id,
          kind: "inventory" as const,
          name: i.name as string,
          quantity: Number(i.quantity ?? 0),
          unit: i.unit ?? null,
          vendor: i.vendor ?? null,
          slug,
          alreadyQueued: openSlugs.has(slug),
        };
      });

    const lowCon: ReorderItem[] = (conRes.data ?? [])
      .filter((c) => c.name && Number(c.quantity_in_stock ?? 0) < 1)
      .map((c) => {
        const slug = slugify(`order ${c.name}`);
        return {
          id: c.id,
          kind: "consumable" as const,
          name: c.name as string,
          quantity: Number(c.quantity_in_stock ?? 0),
          unit: c.unit ?? null,
          vendor: null,
          slug,
          alreadyQueued: openSlugs.has(slug),
        };
      });

    return [...lowInv, ...lowCon].sort((a, b) => a.name.localeCompare(b.name));
  });

export const addReorderToToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["inventory", "consumable"]),
        itemId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let name: string | null = null;
    let vendor: string | null = null;
    if (data.kind === "inventory") {
      const { data: item, error: itemErr } = await supabase
        .from("inventory_items")
        .select("id, name, vendor")
        .eq("id", data.itemId)
        .maybeSingle();
      if (itemErr) throw new Error(itemErr.message);
      if (!item || !item.name) throw new Error("Item not found");
      name = item.name;
      vendor = item.vendor ?? null;
    } else {
      const { data: item, error: itemErr } = await supabase
        .from("consumables")
        .select("id, name")
        .eq("id", data.itemId)
        .maybeSingle();
      if (itemErr) throw new Error(itemErr.message);
      if (!item || !item.name) throw new Error("Item not found");
      name = item.name;
    }

    const label = `Order ${name}${vendor ? ` (${vendor})` : ""}`;
    const slug = slugify(`order ${name}`);

    let { data: task } = await supabase
      .from("tasks")
      .select("id, slug, title")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (!task) {
      const { data: created, error: insErr } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          slug,
          title: label,
          status: "open",
          project_tags: ["inventory", "reorder"],
        })
        .select("id, slug, title")
        .single();
      if (insErr) throw new Error(insErr.message);
      task = created;
    }

    const date = new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
    let { data: note } = await supabase
      .from("daily_notes")
      .select("id, markdown_content")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (!note) {
      const { data: created, error: nErr } = await supabase
        .from("daily_notes")
        .insert({ user_id: userId, date, markdown_content: "" })
        .select("id, markdown_content")
        .single();
      if (nErr) throw new Error(nErr.message);
      note = created;
    }

    const refLine = `- #task/${task.slug} ${task.title}`;
    const current = note.markdown_content ?? "";
    if (!current.includes(`#task/${task.slug}`)) {
      const next = current.trim().length ? `${current.trimEnd()}\n${refLine}\n` : `${refLine}\n`;
      await supabase.from("daily_notes").update({ markdown_content: next }).eq("id", note.id);
    }

    const { data: existing } = await supabase
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("daily_note_id", note.id)
      .eq("task_id", task.id)
      .limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("activity_log").insert({
        user_id: userId,
        task_id: task.id,
        daily_note_id: note.id,
        entry_type: "note",
        raw_content: refLine,
      });
    }

    return { ok: true as const, taskId: task.id, slug: task.slug };
  });
