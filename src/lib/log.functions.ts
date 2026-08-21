import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { slugify, taskRenamePatch, patchMutatesSlug } from "./slug";
import { appendTaskRefLine } from "./daily-note-append";
import { DEFAULT_DESIGN_ELEMENT_WEIGHT } from "./design-weight";
import { closedStampFor, isTaskInDayView } from "./task-status-window";


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
  // Additional user-supplied regex patterns were intentionally removed to
  // eliminate ReDoS risk; only the safe built-in normalizations run below.
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
    // extraStripPatterns removed: user-supplied regexes can cause ReDoS server-side.
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
      // Seed a new note with the most recent previous day's UNFINISHED content
      // so the user can pick up where they left off. Lines already checked off
      // stay on the day they were checked — copying them forward made a task
      // finished yesterday look like it was completed today.
      const { data: prior } = await supabase
        .from("daily_notes")
        .select("markdown_content")
        .lt("date", data.date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { seedFromPreviousNote } = await import("@/lib/note-seed");
      let seed = seedFromPreviousNote(prior?.markdown_content);


      // Auto-prepend Tempest weather block for the day on first creation.
      try {
        const { fetchAndCacheForecast, formatWeatherMarkdown } = await import("@/lib/weather.functions");
        const w = await fetchAndCacheForecast(supabase, userId, data.date);
        if (w && !/^##\s+Weather\b/m.test(seed)) {
          seed = `${formatWeatherMarkdown(w)}\n${seed}`;
        }
      } catch (e) {
        console.error("[daily-note] weather seed failed", e);
      }

      const { data: created, error } = await supabase
        .from("daily_notes")
        .insert({ date: data.date, user_id: userId, markdown_content: seed })
        .select()
        .single();
      if (error) throw new Error(error.message);
      note = created;
    } else {
      // On every open: check the note's "## Weather" block for the newer
      // fields (humidity, feels-like). If either is absent, force a fresh
      // forecast fetch and re-render the block in place.
      try {
        const { fetchAndCacheForecast, formatWeatherMarkdown } = await import("@/lib/weather.functions");
        const { findWeatherBlock, weatherBlockMissingExtras, replaceWeatherBlock } = await import(
          "@/lib/weather-block"
        );
        const current = note!.markdown_content ?? "";
        // The weather block is exactly the heading line plus (optionally) the
        // single summary line right after it. It must NEVER swallow following
        // note lines like "- [ ] #task/foo" — that wiped real entries before.
        const block = findWeatherBlock(current);

        // e.g. "Sunny · High 92 / Low 68 · Feels like 96°F / 70°F · 71% humidity"
        const missingExtras = weatherBlockMissingExtras(block);

        const w = await fetchAndCacheForecast(supabase, userId, data.date, {
          refresh: missingExtras,
        });
        if (w) {
          const fresh = formatWeatherMarkdown(w);
          const next = replaceWeatherBlock(current, fresh);

          if (next !== current) {
            const { data: updated } = await supabase
              .from("daily_notes")
              .update({ markdown_content: next })
              .eq("id", note!.id)
              .select()
              .single();
            if (updated) note = updated;
          }
        }
      } catch (e) {
        console.error("[daily-note] weather refresh failed", e);
      }
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

// ---- Daily energy / productivity ratings (1-5, null clears) ----

export const setDailyNoteRatings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        noteId: z.string().uuid(),
        energy_level: z.number().int().min(1).max(5).nullable().optional(),
        productivity_level: z.number().int().min(1).max(5).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: { energy_level?: number | null; productivity_level?: number | null } = {};
    if (data.energy_level !== undefined) patch.energy_level = data.energy_level;
    if (data.productivity_level !== undefined) patch.productivity_level = data.productivity_level;

    const { data: row, error } = await context.supabase
      .from("daily_notes")
      .update(patch)
      .eq("id", data.noteId)
      .select("id, energy_level, productivity_level")
      .single();
    if (error) throw new Error(error.message);
    return row;
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
  /** Checkbox state when the line was a `- [ ] ` / `- [x] ` item. */
  done: boolean;
  /** True only for `- [ ]` / `- [x]` lines — those own the task's done state. */
  checkbox?: boolean;

  entryType: "status" | "blocker" | "decision" | "commit" | "meeting" | "note";
  projectTags: string[];
  startAt: string | null;
  percent: number | null;
};

const PROJECT_TAG_RE = /#project\/([a-z0-9][a-z0-9-_]*)/gi;
// Inline reference inside a checkbox line, e.g. "- [x] Grease pins #task/grease-pins"
const INLINE_TASK_REF_RE = /#task\/([a-z0-9-]+)/i;
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
      // A checkbox line may also carry an inline `#task/<slug>` reference:
      //   "- [x] Grease loader pins #task/grease-loader-pins"
      // In that case the line targets the EXISTING task — it must not be
      // parsed as a brand-new task (the slug text would end up in the title
      // and spawn a duplicate, leaving the real task stuck in Open).
      const refMatch = taskMatch[2].match(INLINE_TASK_REF_RE);
      const withoutRef = refMatch
        ? taskMatch[2].replace(INLINE_TASK_REF_RE, " ")
        : taskMatch[2];
      const meta = extractMeta(withoutRef.trim());
      out.push({
        raw: trimmed,
        ...(refMatch
          ? { taskRef: { kind: "slug" as const, value: refMatch[1].toLowerCase() } }
          : { newTask: { title: meta.stripped, done } }),
        done,
        checkbox: true,

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
        done: false,
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
        done: false,
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

    // Timestamp used for every checkbox closed by this commit. Clamped to the
    // note's own day so an evening commit (which is "tomorrow" in UTC) can't
    // stamp closed_at outside the day the Done column windows on.
    const closedStamp = closedStampFor(data.date);

    // Scope to this user explicitly: slugs are unique per user, so the
    // slug -> task maps below must never be able to pick up another owner's row.
    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, slug, title, status, closed_at, project_tags, start_at, percent_complete, created_at")
      .eq("user_id", userId);

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
          // INVARIANT: the slug is immutable — a title change must never
          // rewrite it, or existing `#task/<slug>` references in older notes
          // would silently stop resolving. See taskRenamePatch().
          await supabase
            .from("tasks")
            .update(taskRenamePatch(p.newTask.title) as never)
            .eq("id", match.id);
          tasksByTitle.delete(match.title.toLowerCase());
          const upgraded = { ...match, title: p.newTask.title };
          // Keep the canonical (original) slug reachable, and also index the
          // new title's slug so later lines in this note resolve either way.
          tasksBySlug.set(match.slug, upgraded);
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
          closed_at: p.newTask.done ? closedStamp : null,
          project_tags: p.projectTags,
          start_at: p.startAt,
          percent_complete: p.newTask.done ? 100 : (p.percent ?? 0),
        })
        .select("id, slug, title, status, closed_at, project_tags, start_at, percent_complete, created_at")
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
        status?: "done" | "open";
        closed_at?: string | null;
        project_tags?: string[];
        start_at?: string;
        percent_complete?: number;
      } = {};
      // The checkbox owns the task's done state in BOTH directions, so the
      // Open/Done columns can never drift from what the note actually says.
      // Applies to both "- [x] New thing" and "- [x] Thing #task/<slug>".
      if (p.checkbox && p.done && existing.status !== "done") {
        upd.status = "done";
        upd.closed_at = closedStamp;
        upd.percent_complete = 100;
      } else if (p.checkbox && !p.done && existing.status === "done") {
        // Re-opened by unchecking the box: clear closed_at too, otherwise the
        // task would linger in "done today" windows while showing as open.
        upd.status = "open";
        upd.closed_at = null;
        if (p.percent === null) upd.percent_complete = 0;
      } else if (p.done && existing.status === "done" && !existing.closed_at) {
        // Repair drift: done rows must always carry a closed_at.
        upd.closed_at = closedStamp;
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
        await supabase
          .from("tasks")
          .update(upd as never)
          .eq("id", existing.id)
          .eq("user_id", userId);
      }

    }

    // ---- Auto-link #project/<slug> tags to real project design elements ----
    // A `#project/<tag>` token is only a label on tasks.project_tags. When the
    // tag matches an actual project's slug, also attach the task to that
    // project as a design element so it contributes to project progress.
    // Non-matching tags stay plain labels. Never duplicates an existing link,
    // and never pushes a project's total weight past 100%.
    let linkedElements = 0;
    const wanted = new Map<string, Set<string>>(); // taskId -> project slugs
    for (const p of parsed) {
      if (p.projectTags.length === 0) continue;
      const task = resolveTask(p);
      if (!task) continue;
      const set = wanted.get(task.id) ?? new Set<string>();
      for (const tag of p.projectTags) set.add(tag.toLowerCase());
      wanted.set(task.id, set);
    }

    if (wanted.size > 0) {
      const allTags = Array.from(new Set(Array.from(wanted.values()).flatMap((s) => Array.from(s))));
      const { data: projects } = await supabase
        .from("projects")
        .select("id, slug")
        .in("slug", allTags);
      const projectBySlug = new Map((projects ?? []).map((p) => [p.slug.toLowerCase(), p]));

      if (projectBySlug.size > 0) {
        const projectIds = Array.from(projectBySlug.values()).map((p) => p.id);
        const { data: elements } = await supabase
          .from("project_design_elements")
          .select("id, project_id, task_id, weight, sort_order")
          .in("project_id", projectIds);
        const existingPairs = new Set(
          (elements ?? [])
            .filter((e) => e.task_id)
            .map((e) => `${e.project_id}:${e.task_id}`),
        );
        // Running per-project weight totals and next sort_order.
        const weightTotals = new Map<string, number>();
        const nextOrder = new Map<string, number>();
        for (const id of projectIds) {
          const mine = (elements ?? []).filter((e) => e.project_id === id);
          weightTotals.set(
            id,
            mine.reduce((acc, e) => acc + Number(e.weight ?? 0), 0),
          );
          nextOrder.set(
            id,
            mine.reduce((acc, e) => Math.max(acc, Number(e.sort_order ?? 0) + 1), 0),
          );
        }

        for (const [taskId, slugs] of wanted) {
          for (const slug of slugs) {
            const project = projectBySlug.get(slug);
            if (!project) continue;
            if (existingPairs.has(`${project.id}:${taskId}`)) continue;

            const used = weightTotals.get(project.id) ?? 0;
            const remaining = Math.max(0, 100 - used);
            if (remaining <= 0) continue; // project is fully weighted already
            const weight = Math.min(DEFAULT_DESIGN_ELEMENT_WEIGHT, remaining);

            const task = (existingTasks ?? []).find((t) => t.id === taskId)
              ?? Array.from(tasksBySlug.values()).find((t) => t.id === taskId);
            const order = nextOrder.get(project.id) ?? 0;

            const { error: elErr } = await supabase
              .from("project_design_elements")
              .insert({
                user_id: userId,
                project_id: project.id,
                task_id: taskId,
                title: task?.title ?? "Untitled",
                weight,
                completed: task?.status === "done",
                sort_order: order,
              });
            if (!elErr) {
              existingPairs.add(`${project.id}:${taskId}`);
              weightTotals.set(project.id, used + weight);
              nextOrder.set(project.id, order + 1);
              linkedElements += 1;
            }
          }
        }
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
    return { committed: true, newEntries: entries.length, linkedElements };
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
      .eq("user_id", userId)
      .or(conditions.join(","))
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // The activity log is authoritative for "touched on this day": every task
    // in the result is the canonical row the note's `#task/<slug>` resolved to
    // (commitDailyNote never creates a second row for a referenced slug).
    //
    // A done task shows when the day's log references it — even if closed_at
    // drifted (evening commit lands in tomorrow's UTC day) — or when closed_at
    // itself falls inside the day. Stale done rows with neither are excluded.
    const todaySet = new Set(todayTaskIds);
    const filtered = (tasks ?? []).filter((t) =>
      isTaskInDayView(t as { id: string; status: string; closed_at: string | null }, date, todaySet),
    );
    return filtered;
  });

export const getTaskBySlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Slugs are unique per user: scope the canonical lookup explicitly so the
    // task detail page always resolves the same row the board links to.
    const { data: task } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
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

// Log a task modification (status / recurrence / title change) plus optional
// user-supplied note into activity_log. The entry is linked to the task so it
// shows in the task's activity history AND is picked up by AI summary
// generation (weekly_report, project_rollup, etc.). When today's daily note
// exists it's also linked there so the change appears in the day's recap.
async function logTaskChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: {
    userId: string;
    taskId: string;
    summary: string;
    note?: string | null;
    entryType?: "status" | "decision" | "note" | "blocker";
  },
) {
  const trimmed = (args.note ?? "").trim();
  const raw = trimmed ? `${args.summary} — ${trimmed}` : args.summary;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
  const { data: note } = await supabase
    .from("daily_notes")
    .select("id")
    .eq("user_id", args.userId)
    .eq("date", today)
    .maybeSingle();
  await supabase.from("activity_log").insert({
    user_id: args.userId,
    task_id: args.taskId,
    daily_note_id: note?.id ?? null,
    entry_type: args.entryType ?? "status",
    raw_content: raw,
  });
}

export const addTaskNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        note: z.string().trim().min(1).max(4000),
        entry_type: z.enum(["note", "decision", "blocker"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await logTaskChange(supabase, {
      userId,
      taskId: data.id,
      summary: "Note",
      note: data.note,
      entryType: data.entry_type ?? "note",
    });
    await invalidateSummaries(supabase, userId);
    return { ok: true };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "blocked", "done"]),
        note: z.string().trim().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date();

    const { data: existing } = await supabase
      .from("tasks")
      .select("status, recurrence, recurrence_next_at, start_at")
      .eq("id", data.id)
      .maybeSingle();

    const prevStatus = (existing as { status?: string } | null)?.status ?? "open";
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

    if (prevStatus !== data.status || (data.note ?? "").trim()) {
      await logTaskChange(supabase, {
        userId,
        taskId: data.id,
        summary: `Status: ${prevStatus} → ${data.status}${isRepeating ? " (repeats; rescheduled)" : ""}`,
        note: data.note,
      });
    }

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
        note: z.string().trim().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("tasks")
      .select("title, recurrence")
      .eq("id", data.id)
      .maybeSingle();
    const prev = (existing ?? {}) as { title?: string | null; recurrence?: string | null };

    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    if (data.title !== undefined && data.title !== prev.title) {
      // Title-only patch: the slug stays as-is so `#task/<slug>` refs survive.
      Object.assign(patch, taskRenamePatch(data.title));
      changes.push(`Title: "${prev.title ?? ""}" → "${data.title}"`);
    }
    if (data.recurrence !== undefined && data.recurrence !== (prev.recurrence ?? "none")) {
      patch.recurrence = data.recurrence;
      if (data.recurrence === "none") {
        patch.recurrence_next_at = null;
      } else {
        const next = advanceRecurrence(new Date(), data.recurrence);
        if (next) patch.recurrence_next_at = next.toISOString();
      }
      changes.push(`Recurrence: ${prev.recurrence ?? "none"} → ${data.recurrence}`);
    }

    if (patchMutatesSlug(patch)) {
      // Defence in depth: task slugs are permanent references.
      throw new Error("Task slugs are immutable — refusing to rewrite slug on rename");
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("tasks").update(patch as never).eq("id", data.id);
      if (error) throw new Error(error.message);
    }


    if (changes.length > 0 || (data.note ?? "").trim()) {
      await logTaskChange(supabase, {
        userId,
        taskId: data.id,
        summary: changes.length > 0 ? changes.join("; ") : "Note",
        note: data.note,
      });
    }

    await invalidateSummaries(supabase, userId);
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
      // Detect slug change so we can cascade-rename references everywhere
      // the slug is used as a tag (#project/<slug>) or denormalized value.
      const { data: prev, error: prevErr } = await supabase
        .from("projects")
        .select("slug")
        .eq("id", data.id)
        .maybeSingle();
      if (prevErr) throw new Error(prevErr.message);
      const oldSlug = prev?.slug ?? null;
      const newSlug = data.slug;
      const slugChanged = !!oldSlug && oldSlug !== newSlug;

      if (slugChanged) {
        // Reject if the target slug is already taken by another project
        // owned by this user (Data API has no unique constraint on slug).
        const { data: clash } = await supabase
          .from("projects")
          .select("id")
          .eq("user_id", userId)
          .eq("slug", newSlug)
          .neq("id", data.id)
          .maybeSingle();
        if (clash) {
          throw new Error(
            `Slug "${newSlug}" is already used by another project.`,
          );
        }
      }

      const { error } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);

      if (slugChanged && oldSlug) {
        await cascadeRenameProjectSlug(supabase, userId, oldSlug, newSlug);
      }

      await invalidateSummaries(supabase, userId);
      return { ok: true as const, id: data.id, slugChanged };
    }
    const { data: inserted, error } = await supabase
      .from("projects")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await invalidateSummaries(supabase, userId);
    return { ok: true as const, id: inserted.id, slugChanged: false };
  });

// Cascade-rename a project slug across every place it is used as a value or
// as a `#project/<slug>` tag. Scoped to a single user via RLS + explicit
// user_id filters. Idempotent — safe to re-run.
async function cascadeRenameProjectSlug(
  // Supabase client type is large/generated; using `any` here keeps this
  // helper portable without importing the generated DB types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `(?![a-z0-9_-])` ensures we only match the whole tag, not a prefix of a
  // longer slug (e.g. renaming `garden` must not touch `#project/garden-2026`).
  const tagRe = new RegExp(`#project/${escapeRegex(oldSlug)}(?![a-z0-9_-])`, "g");
  const newTag = `#project/${newSlug}`;

  // 1. tasks.project_tags — array column, replace old slug with new.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, project_tags")
    .eq("user_id", userId)
    .contains("project_tags", [oldSlug]);
  for (const t of tasks ?? []) {
    const tags = (t.project_tags ?? []) as string[];
    const next = Array.from(
      new Set(tags.map((x) => (x === oldSlug ? newSlug : x))),
    );
    await supabase.from("tasks").update({ project_tags: next }).eq("id", t.id);
  }

  // 2. daily_notes.markdown_content — rewrite #project/<old> tokens.
  const { data: notes } = await supabase
    .from("daily_notes")
    .select("id, markdown_content")
    .eq("user_id", userId)
    .ilike("markdown_content", `%#project/${oldSlug}%`);
  for (const n of notes ?? []) {
    const current = (n.markdown_content ?? "") as string;
    const next = current.replace(tagRe, newTag);
    if (next !== current) {
      await supabase
        .from("daily_notes")
        .update({ markdown_content: next })
        .eq("id", n.id);
    }
  }

  // 3. activity_log.raw_content — same token rewrite.
  const { data: logs } = await supabase
    .from("activity_log")
    .select("id, raw_content")
    .eq("user_id", userId)
    .ilike("raw_content", `%#project/${oldSlug}%`);
  for (const l of logs ?? []) {
    const current = (l.raw_content ?? "") as string;
    const next = current.replace(tagRe, newTag);
    if (next !== current) {
      await supabase
        .from("activity_log")
        .update({ raw_content: next })
        .eq("id", l.id);
    }
  }

  // 4. summaries.scope_project — denormalized slug column on AI reports.
  await supabase
    .from("summaries")
    .update({ scope_project: newSlug })
    .eq("user_id", userId)
    .eq("scope_project", oldSlug);
}


export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await invalidateSummaries(context.supabase, context.userId);
    return { ok: true };
  });

// ---- Project design elements (key attributes of project design) ----
//
// Each project can have a list of design elements that capture the project's
// intent (features, deliverables, success criteria). Each element carries a
// `weight` representing its share of the design value (typically 0-100). The
// project's overall completeness = sum(weight where completed) / sum(weight).
// Elements can be promoted into the backlog: a `tasks` row is created (no
// start_at, status=open) tagged with the project's slug, and `task_id` is
// linked so future completion of the task can flip the element.

export const listProjectDesignElements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("project_design_elements")
      .select("*, task:tasks!project_design_elements_task_id_fkey(id, slug, status, percent_complete)")
      .eq("project_id", data.project_id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertProjectDesignElement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        project_id: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
        weight: z.number().min(0).max(100),
        completed: z.boolean().optional(),
        sort_order: z.number().int().min(0).max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Enforce: sum of weights for this project must not exceed 100%.
    const { data: siblings, error: sumErr } = await supabase
      .from("project_design_elements")
      .select("id, weight")
      .eq("project_id", data.project_id);
    if (sumErr) throw new Error(sumErr.message);
    const otherTotal = (siblings ?? [])
      .filter((s) => s.id !== data.id)
      .reduce((acc, s) => acc + Number(s.weight ?? 0), 0);
    const remaining = Math.max(0, 100 - otherTotal);
    if (otherTotal + data.weight > 100) {
      throw new Error(
        `Weight would exceed 100% (other elements use ${otherTotal.toFixed(0)}%, ${remaining.toFixed(0)}% remaining).`,
      );
    }

    const payload = {
      user_id: userId,
      project_id: data.project_id,
      title: data.title,
      description: data.description ?? null,
      weight: data.weight,
      completed: data.completed ?? false,
      sort_order: data.sort_order ?? 0,
    };
    if (data.id) {
      const { error } = await supabase
        .from("project_design_elements")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true as const, id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("project_design_elements")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: inserted.id };
  });


export const setProjectDesignElementCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_design_elements")
      .update({ completed: data.completed })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Projects a task is attached to as a design element, with each link's weight
// so the task page can show and edit it (e.g. bump 10% -> 25%).
export const listTaskProjectLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("project_design_elements")
      .select("id, project_id, title, weight, completed, project:projects!project_design_elements_project_id_fkey(id, slug, name)")
      .eq("task_id", data.task_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const links = rows ?? [];
    // Report each project's total allocation so the UI can show headroom.
    const totals = new Map<string, number>();
    for (const l of links) {
      if (totals.has(l.project_id)) continue;
      const { data: sib } = await context.supabase
        .from("project_design_elements")
        .select("weight")
        .eq("project_id", l.project_id);
      totals.set(
        l.project_id,
        (sib ?? []).reduce((acc, s) => acc + Number(s.weight ?? 0), 0),
      );
    }
    return links.map((l) => ({
      ...l,
      project_total_weight: totals.get(l.project_id) ?? Number(l.weight ?? 0),
    }));
  });

// Detach an auto-linked task from a project: deletes the design element and,
// when remove_tag is true, also drops the project's slug from the task's
// #project/<slug> labels (e.g. removes "boiler-swap" from tasks.project_tags).
export const unlinkTaskFromProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ element_id: z.string().uuid(), remove_tag: z.boolean().default(false) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: element, error: getErr } = await supabase
      .from("project_design_elements")
      .select("id, task_id, project_id, project:projects!project_design_elements_project_id_fkey(slug)")
      .eq("id", data.element_id)
      .single();
    if (getErr) throw new Error(getErr.message);

    const projectSlug = (element as { project?: { slug: string } | null }).project?.slug ?? null;

    const { error: delErr } = await supabase
      .from("project_design_elements")
      .delete()
      .eq("id", data.element_id);
    if (delErr) throw new Error(delErr.message);

    let tagRemoved = false;
    if (data.remove_tag && element.task_id && projectSlug) {
      const { data: task } = await supabase
        .from("tasks")
        .select("id, project_tags")
        .eq("id", element.task_id)
        .single();
      const tags = ((task?.project_tags ?? []) as string[]).filter(
        (t) => t.toLowerCase() !== projectSlug.toLowerCase(),
      );
      if (task && tags.length !== (task.project_tags ?? []).length) {
        const { error: updErr } = await supabase
          .from("tasks")
          .update({ project_tags: tags })
          .eq("id", task.id);
        if (updErr) throw new Error(updErr.message);
        tagRemoved = true;
      }
    }

    return { ok: true as const, project_slug: projectSlug, tag_removed: tagRemoved };
  });

// Change just the weight of one design element (used from the task page and
// the project design list) while keeping the project total <= 100%.
export const setProjectDesignElementWeight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), weight: z.number().min(0).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: element, error: getErr } = await supabase
      .from("project_design_elements")
      .select("id, project_id")
      .eq("id", data.id)
      .single();
    if (getErr) throw new Error(getErr.message);

    const { data: siblings, error: sumErr } = await supabase
      .from("project_design_elements")
      .select("id, weight")
      .eq("project_id", element.project_id);
    if (sumErr) throw new Error(sumErr.message);
    const otherTotal = (siblings ?? [])
      .filter((s) => s.id !== data.id)
      .reduce((acc, s) => acc + Number(s.weight ?? 0), 0);
    if (otherTotal + data.weight > 100) {
      throw new Error(
        `Weight would exceed 100% (other elements use ${otherTotal.toFixed(0)}%, ${Math.max(0, 100 - otherTotal).toFixed(0)}% remaining).`,
      );
    }

    const { error } = await supabase
      .from("project_design_elements")
      .update({ weight: data.weight })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, weight: data.weight, project_total_weight: otherTotal + data.weight };
  });

export const deleteProjectDesignElement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_design_elements")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Promote a design element into the backlog by creating an open task (no
// start_at) tagged with the project slug. If the element already has a linked
// task, this is a no-op and returns the existing task slug.
export const promoteDesignElementToBacklog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: element, error: getErr } = await supabase
      .from("project_design_elements")
      .select("id, title, description, project_id, task_id, projects(slug)")
      .eq("id", data.id)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    if (!element) throw new Error("Design element not found");
    const el = element as unknown as {
      id: string;
      title: string;
      description: string | null;
      project_id: string;
      task_id: string | null;
      projects: { slug: string } | { slug: string }[] | null;
    };
    if (el.task_id) {
      const { data: existing } = await supabase
        .from("tasks")
        .select("slug")
        .eq("id", el.task_id)
        .maybeSingle();
      return { ok: true as const, already: true, slug: existing?.slug ?? null };
    }
    const projectSlug = Array.isArray(el.projects) ? el.projects[0]?.slug : el.projects?.slug;
    const baseSlug = slugify(el.title);
    let candidate = baseSlug;
    let n = 2;
    // Ensure unique slug
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: clash } = await supabase
        .from("tasks")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!clash) break;
      candidate = `${baseSlug}-${n++}`;
      if (n > 50) throw new Error("Could not allocate a unique task slug");
    }
    const { data: created, error: insErr } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        slug: candidate,
        title: el.title,
        status: "open",
        project_tags: projectSlug ? [projectSlug] : [],
        percent_complete: 0,
      })
      .select("id, slug")
      .single();
    if (insErr) throw new Error(insErr.message);
    const { error: linkErr } = await supabase
      .from("project_design_elements")
      .update({ task_id: created.id })
      .eq("id", el.id);
    if (linkErr) throw new Error(linkErr.message);
    await invalidateSummaries(supabase, userId);
    return { ok: true as const, already: false, slug: created.slug };
  });

// Attach an existing task (e.g. from the backlog) to a project as a design
// element. Creates a `project_design_elements` row pointing at the task, and
// ensures the project's slug is present in `tasks.project_tags` so summaries
// and groupings stay consistent. If the task is already linked to an element
// for that project, returns it without creating a duplicate.
export const assignTaskToProjectAsDesignElement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        task_id: z.string().uuid(),
        project_id: z.string().uuid(),
        weight: z.number().min(0).max(100).default(DEFAULT_DESIGN_ELEMENT_WEIGHT),
        description: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, title, status, project_tags")
      .eq("id", data.task_id)
      .maybeSingle();
    if (taskErr) throw new Error(taskErr.message);
    if (!task) throw new Error("Task not found");

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, slug")
      .eq("id", data.project_id)
      .maybeSingle();
    if (projErr) throw new Error(projErr.message);
    if (!project) throw new Error("Project not found");

    // Reuse an existing element if this task is already assigned to this project.
    const { data: existing } = await supabase
      .from("project_design_elements")
      .select("id")
      .eq("project_id", data.project_id)
      .eq("task_id", data.task_id)
      .maybeSingle();
    if (existing) {
      return { ok: true as const, already: true, id: existing.id };
    }

    // Enforce: sum of weights for this project must not exceed 100%.
    const { data: siblings, error: sumErr } = await supabase
      .from("project_design_elements")
      .select("weight")
      .eq("project_id", data.project_id);
    if (sumErr) throw new Error(sumErr.message);
    const otherTotal = (siblings ?? []).reduce(
      (acc, s) => acc + Number(s.weight ?? 0),
      0,
    );
    if (otherTotal + data.weight > 100) {
      const remaining = Math.max(0, 100 - otherTotal);
      throw new Error(
        `Weight would exceed 100% (other elements use ${otherTotal.toFixed(0)}%, ${remaining.toFixed(0)}% remaining).`,
      );
    }

    const { data: inserted, error: insErr } = await supabase
      .from("project_design_elements")
      .insert({
        user_id: userId,
        project_id: data.project_id,
        task_id: data.task_id,
        title: task.title ?? "Untitled",
        description: data.description ?? null,
        weight: data.weight,
        completed: task.status === "done",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);


    // Ensure the project slug is tagged on the task so it appears in the
    // project's activity rollups going forward.
    const tags = (task.project_tags ?? []) as string[];
    if (!tags.includes(project.slug)) {
      const { error: tagErr } = await supabase
        .from("tasks")
        .update({ project_tags: [...tags, project.slug] })
        .eq("id", data.task_id);
      if (tagErr) throw new Error(tagErr.message);
    }

    await invalidateSummaries(supabase, userId);
    return { ok: true as const, already: false, id: inserted.id };
  });


// ============================================================
// Execution tasks for a design element
// ------------------------------------------------------------
// A design element can have many small "execution" tasks under it. They are
// regular tasks (so they flow through the daily-note / today pipeline like
// any other), linked back to the parent element via tasks.design_element_id.
// ============================================================

export const listDesignElementTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ design_element_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("tasks")
      .select("id, slug, title, status, start_at, percent_complete, project_tags")
      .eq("user_id", userId)
      .eq("design_element_id", data.design_element_id)
      .order("status", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createDesignElementTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        design_element_id: z.string().uuid(),
        title: z.string().trim().min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load the parent element so we can inherit its project slug onto the
    // child task and surface it in project rollups.
    const { data: element, error: elErr } = await supabase
      .from("project_design_elements")
      .select("id, project_id, projects(slug)")
      .eq("id", data.design_element_id)
      .maybeSingle();
    if (elErr) throw new Error(elErr.message);
    if (!element) throw new Error("Design element not found");
    const projectSlug =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray((element as any).projects)
        ? (element as any).projects[0]?.slug
        : (element as any).projects?.slug) ?? null;

    const base = slugify(data.title).slice(0, 80) || "task";
    let slug = base;
    for (let i = 0; i < 50; i++) {
      const { data: clash } = await supabase
        .from("tasks")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const { data: row, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        slug,
        title: data.title.trim(),
        status: "open",
        project_tags: projectSlug ? [projectSlug] : [],
        design_element_id: data.design_element_id,
      })
      .select("id, slug, title, status, start_at, percent_complete, project_tags")
      .single();
    if (error) throw new Error(error.message);
    return row;
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
    z
      .object({
        taskId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const date = data.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });

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

    // Append a reference line for today. We intentionally do NOT skip when
    // the slug already appears in the markdown — today's note is seeded from
    // the prior day, so `#task/<slug>` may be carried over from yesterday's
    // entries. Dedupe instead against today's activity_log so repeated
    // "Add to today" clicks don't append twice.
    const refLine = buildTaskRefLine(task);

    const { data: existing } = await supabase
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("daily_note_id", note.id)
      .eq("task_id", task.id)
      .limit(1);
    const alreadyOnToday = !!existing && existing.length > 0;

    if (!alreadyOnToday) {
      const current = note.markdown_content ?? "";
      const next = appendTaskRefLine(current, refLine);
      if (next !== current) {
        await supabase
          .from("daily_notes")
          .update({ markdown_content: next })
          .eq("id", note.id);
      }

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
    z
      .object({
        maintenanceId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(d),
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
    const date = data.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
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

    const refLine = buildTaskRefLine(task);

    const { data: existing } = await supabase
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("daily_note_id", note.id)
      .eq("task_id", task.id)
      .limit(1);
    const alreadyOnToday = !!existing && existing.length > 0;

    if (!alreadyOnToday) {
      const current = note.markdown_content ?? "";
      const next = appendTaskRefLine(current, refLine);
      if (next !== current) {
        await supabase.from("daily_notes").update({ markdown_content: next }).eq("id", note.id);
      }

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
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
          project_tags: ["inventory", "reorder"],
        })
        .select("id, slug, title, project_tags, start_at, percent_complete")
        .single();
      if (insErr) throw new Error(insErr.message);
      task = created;
    }
    if (!task) throw new Error("Failed to resolve reorder task");


    const date = data.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
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

    const refLine = buildTaskRefLine(task);

    const { data: existing } = await supabase
      .from("activity_log")
      .select("id")
      .eq("user_id", userId)
      .eq("daily_note_id", note.id)
      .eq("task_id", task.id)
      .limit(1);
    const alreadyOnToday = !!existing && existing.length > 0;

    if (!alreadyOnToday) {
      const current = note.markdown_content ?? "";
      const next = appendTaskRefLine(current, refLine);
      if (next !== current) {
        await supabase.from("daily_notes").update({ markdown_content: next }).eq("id", note.id);
      }

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
