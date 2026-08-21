/**
 * Pure helpers for reconciling duplicate tasks that were created by the old
 * daily-note checkbox parser.
 *
 * The old bug: a line like `- [x] Grease loader pins #task/grease-loader-pins`
 * was treated as "create a new task" instead of "close the referenced task", so
 * the database ended up with a stray task whose title still carried the raw
 * `#task/<slug>` text (or an exact title twin), while the canonical task stayed
 * open.
 */

export type DedupeTask = {
  id: string;
  slug: string;
  title: string;
  status: "open" | "blocked" | "done" | string;
  closed_at: string | null;
  percent_complete: number | null;
  created_at: string;
};

export type TaskMerge = {
  duplicateId: string;
  duplicateTitle: string;
  duplicateSlug: string;
  canonicalId: string;
  canonicalSlug: string;
  canonicalTitle: string;
  /** how the duplicate was tied back to the canonical task */
  reason: "slug-ref-in-title" | "identical-title";
  /** the duplicate is done and the canonical is not → carry the done state over */
  carriesDone: boolean;
  closedAt: string | null;
  percentComplete: number | null;
};

const TASK_REF_RE = /#task\/([a-z0-9][a-z0-9-]*)/gi;
const PROJECT_TAG_RE = /#project\/[a-z0-9][a-z0-9-]*/gi;

/** Every `#task/<slug>` token found in a title, lowercased, in order. */
export function slugRefsInTitle(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(TASK_REF_RE)) out.push(m[1].toLowerCase());
  return out;
}

/** Title with `#task/…` and `#project/…` tokens stripped, collapsed + trimmed. */
export function cleanTitle(title: string): string {
  return title
    .replace(TASK_REF_RE, " ")
    .replace(PROJECT_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(title: string): string {
  return cleanTitle(title).toLowerCase().replace(/[.,:;!?]+$/g, "").trim();
}

function isDone(t: DedupeTask): boolean {
  return t.status === "done";
}

/**
 * Plan the merges. A task is a duplicate only when a distinct canonical task
 * exists; canonical selection is deterministic (slug reference wins, otherwise
 * the oldest `created_at`, ties broken by id) so repeated runs are stable.
 */
export function planTaskMerges(tasks: DedupeTask[]): TaskMerge[] {
  const bySlug = new Map<string, DedupeTask>();
  for (const t of tasks) bySlug.set(t.slug.toLowerCase(), t);

  const merges: TaskMerge[] = [];
  const consumed = new Set<string>();

  const push = (
    duplicate: DedupeTask,
    canonical: DedupeTask,
    reason: TaskMerge["reason"],
  ) => {
    if (duplicate.id === canonical.id) return;
    if (consumed.has(duplicate.id) || consumed.has(canonical.id)) return;
    consumed.add(duplicate.id);
    merges.push({
      duplicateId: duplicate.id,
      duplicateTitle: duplicate.title,
      duplicateSlug: duplicate.slug,
      canonicalId: canonical.id,
      canonicalSlug: canonical.slug,
      canonicalTitle: canonical.title,
      reason,
      carriesDone: isDone(duplicate) && !isDone(canonical),
      closedAt: duplicate.closed_at,
      percentComplete: duplicate.percent_complete,
    });
  };

  // 1. Titles that still carry a raw `#task/<slug>` pointing at another task.
  for (const t of tasks) {
    const refs = slugRefsInTitle(t.title);
    if (refs.length === 0) continue;
    for (const ref of refs) {
      const canonical = bySlug.get(ref);
      if (canonical && canonical.id !== t.id) {
        push(t, canonical, "slug-ref-in-title");
        break;
      }
    }
  }

  // 2. Exact title twins: keep the oldest, merge the newer ones into it.
  const groups = new Map<string, DedupeTask[]>();
  for (const t of tasks) {
    if (consumed.has(t.id)) continue;
    const key = normalizeTitle(t.title);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    const canonical = sorted[0];
    for (const dup of sorted.slice(1)) push(dup, canonical, "identical-title");
  }

  return merges;
}

/**
 * Fields to write on the canonical task for the merges that carry a done state.
 * Returns `null` when nothing needs to change.
 */
export function canonicalDoneUpdate(merge: TaskMerge): {
  status: "done";
  closed_at: string;
  percent_complete: number;
} | null {
  if (!merge.carriesDone) return null;
  return {
    status: "done",
    closed_at: merge.closedAt ?? new Date().toISOString(),
    percent_complete: 100,
  };
}

/** Titles that only need the stray `#task/<slug>` text scrubbed (no canonical twin). */
export function planTitleCleanups(
  tasks: DedupeTask[],
  merges: TaskMerge[],
): Array<{ id: string; from: string; to: string }> {
  const merged = new Set(merges.map((m) => m.duplicateId));
  const out: Array<{ id: string; from: string; to: string }> = [];
  for (const t of tasks) {
    if (merged.has(t.id)) continue;
    if (slugRefsInTitle(t.title).length === 0) continue;
    const to = cleanTitle(t.title);
    if (to && to !== t.title) out.push({ id: t.id, from: t.title, to });
  }
  return out;
}
