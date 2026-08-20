// Pure helpers for auditing #task/<slug> and [[Title]] references inside
// daily-note markdown. Kept dependency-free so it can be unit tested and
// reused by both the server scan and any client-side preview.
import { slugify } from "./slug";

const TASK_REF_RE = /#task\/([a-z0-9][a-z0-9-_]*)/gi;
const TITLE_REF_RE = /\[\[([^\]]+)\]\]/g;

export type NoteRef = {
  kind: "slug" | "title";
  /** Raw token as written, e.g. `#task/replace-filter` or `[[Replace filter]]`. */
  token: string;
  /** Normalized slug (for `title` refs this is the slugified title). */
  slug: string;
  /** Original title text for `[[Title]]` refs. */
  title?: string;
  line: number;
  lineText: string;
};

export type TaskLookup = { slug: string; title: string };

export type UnresolvedRef = NoteRef & {
  /** Closest existing task by simple similarity, when one is close enough. */
  suggestion?: { slug: string; title: string; score: number };
};

export type NoteRefScan = {
  date: string;
  noteId: string;
  unresolved: UnresolvedRef[];
  refCount: number;
};

/** Extracts every task reference in a markdown document, with line numbers. */
export function extractTaskRefs(markdown: string): NoteRef[] {
  const refs: NoteRef[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((lineText, i) => {
    const line = i + 1;
    for (const m of lineText.matchAll(TASK_REF_RE)) {
      refs.push({
        kind: "slug",
        token: m[0],
        slug: m[1].toLowerCase(),
        line,
        lineText,
      });
    }
    for (const m of lineText.matchAll(TITLE_REF_RE)) {
      const title = m[1].trim();
      if (!title) continue;
      refs.push({
        kind: "title",
        token: m[0],
        slug: slugify(title),
        title,
        line,
        lineText,
      });
    }
  });
  return refs;
}

function bigrams(value: string): Set<string> {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams; 0..1. */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

export function closestMatch(
  needle: string,
  tasks: TaskLookup[],
  minScore = 0.45,
): { slug: string; title: string; score: number } | undefined {
  let best: { slug: string; title: string; score: number } | undefined;
  for (const t of tasks) {
    const score = Math.max(similarity(needle, t.slug), similarity(needle, t.title));
    if (!best || score > best.score) best = { slug: t.slug, title: t.title, score };
  }
  return best && best.score >= minScore ? best : undefined;
}

/**
 * Returns the references in `markdown` that no longer resolve to a task,
 * with a suggested replacement where one is close enough.
 */
export function unresolvedRefs(markdown: string, tasks: TaskLookup[]): UnresolvedRef[] {
  const bySlug = new Map(tasks.map((t) => [t.slug.toLowerCase(), t]));
  const byTitle = new Map(tasks.map((t) => [t.title.trim().toLowerCase(), t]));
  const out: UnresolvedRef[] = [];
  const seen = new Set<string>();

  for (const ref of extractTaskRefs(markdown)) {
    const resolved =
      bySlug.has(ref.slug) ||
      (ref.kind === "title" && byTitle.has((ref.title ?? "").toLowerCase()));
    if (resolved) continue;
    const key = `${ref.line}:${ref.token.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...ref, suggestion: closestMatch(ref.title ?? ref.slug, tasks) });
  }
  return out;
}
