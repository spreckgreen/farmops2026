// Pure helpers for auto-repairing broken task references in daily-note markdown.
//
// A reference like `#task/replace-hydralic-filter` (typo) or a slug from a
// deleted/renamed row no longer resolves. The activity log still remembers
// which task a note line belonged to (activity_log.task_id), and tasks keep a
// stable title, so we can usually recover the correct canonical slug:
//
//   1. activity-log: an activity entry whose raw text contains the same token
//      points at a real task_id -> use that task's slug.
//   2. title: the reference text (`[[Replace hydraulic filter]]`, or the broken
//      slug read as words) matches a task title exactly once (normalized).
//   3. closest: high-confidence fuzzy match on title/slug.
//
// Everything here is dependency-free so it can be unit tested and previewed.
import { similarity, type TaskLookup, type UnresolvedRef } from "./note-refs";

export type RepairSource = "activity-log" | "title" | "closest";

export type RepairCandidate = {
  /** Canonical slug to write. */
  slug: string;
  title: string;
  source: RepairSource;
  /** 0..1 confidence; exact matches are 1. */
  score: number;
};

export type RepairEdit = {
  line: number;
  token: string;
  replacement: string;
  before: string;
  after: string;
  candidate: RepairCandidate;
};

/** `token` -> canonical slug, derived from activity-log rows. */
export type ActivityTokenIndex = Map<string, { slug: string; title: string }>;

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Words behind a slug, e.g. `replace-oil_filter` -> "replace oil filter". */
export function slugToWords(slug: string): string {
  return slug.replace(/[-_]+/g, " ").trim();
}

/**
 * Builds a lookup of reference tokens seen in the activity log to the task the
 * entry was actually attached to. Rows without a resolvable task are ignored.
 */
export function buildActivityTokenIndex(
  rows: Array<{ raw_content: string | null; task_id: string | null }>,
  tasksById: Map<string, TaskLookup>,
): ActivityTokenIndex {
  const index: ActivityTokenIndex = new Map();
  for (const row of rows) {
    if (!row.task_id || !row.raw_content) continue;
    const task = tasksById.get(row.task_id);
    if (!task) continue;
    for (const m of row.raw_content.matchAll(/#task\/([a-z0-9][a-z0-9-_]*)/gi)) {
      const key = m[0].toLowerCase();
      if (!index.has(key)) index.set(key, { slug: task.slug, title: task.title });
    }
    for (const m of row.raw_content.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const key = `[[${m[1].trim().toLowerCase()}]]`;
      if (!index.has(key)) index.set(key, { slug: task.slug, title: task.title });
    }
  }
  return index;
}

/** Picks the best recovery target for one unresolved reference. */
export function pickCandidate(
  ref: UnresolvedRef,
  tasks: TaskLookup[],
  activityIndex: ActivityTokenIndex,
  minScore = 0.72,
): RepairCandidate | undefined {
  const viaLog = activityIndex.get(ref.token.toLowerCase());
  if (viaLog) {
    return { slug: viaLog.slug, title: viaLog.title, source: "activity-log", score: 1 };
  }

  const needleText = ref.title ?? slugToWords(ref.slug);
  const normalized = normalizeTitle(needleText);
  const titleHits = tasks.filter((t) => normalizeTitle(t.title) === normalized);
  if (titleHits.length === 1) {
    return {
      slug: titleHits[0].slug,
      title: titleHits[0].title,
      source: "title",
      score: 1,
    };
  }

  let best: RepairCandidate | undefined;
  for (const t of tasks) {
    const score = Math.max(similarity(needleText, t.title), similarity(ref.slug, t.slug));
    if (!best || score > best.score) {
      best = { slug: t.slug, title: t.title, source: "closest", score };
    }
  }
  return best && best.score >= minScore ? best : undefined;
}

/**
 * Rewrites broken tokens in `markdown` to the canonical `#task/<slug>` form.
 * `[[Title]]` refs are preserved as titles (rewritten to the task's real title)
 * so note prose keeps reading naturally.
 */
export function planRepairs(
  markdown: string,
  refs: UnresolvedRef[],
  tasks: TaskLookup[],
  activityIndex: ActivityTokenIndex,
  opts: { minScore?: number; allowFuzzy?: boolean } = {},
): { markdown: string; edits: RepairEdit[]; skipped: UnresolvedRef[] } {
  const allowFuzzy = opts.allowFuzzy ?? false;
  const lines = markdown.split(/\r?\n/);
  const edits: RepairEdit[] = [];
  const skipped: UnresolvedRef[] = [];

  for (const ref of refs) {
    const candidate = pickCandidate(ref, tasks, activityIndex, opts.minScore);
    if (!candidate || (candidate.source === "closest" && !allowFuzzy)) {
      skipped.push(ref);
      continue;
    }
    const idx = ref.line - 1;
    const before = lines[idx];
    if (before === undefined || !before.includes(ref.token)) {
      skipped.push(ref);
      continue;
    }
    const replacement =
      ref.kind === "title" ? `[[${candidate.title}]]` : `#task/${candidate.slug}`;
    if (replacement === ref.token) {
      skipped.push(ref);
      continue;
    }
    const after = before.split(ref.token).join(replacement);
    lines[idx] = after;
    edits.push({ line: ref.line, token: ref.token, replacement, before, after, candidate });
  }

  return { markdown: lines.join("\n"), edits, skipped };
}
