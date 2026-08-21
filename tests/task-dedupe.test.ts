import { describe, expect, it } from "vitest";
import {
  canonicalDoneUpdate,
  cleanTitle,
  planTaskMerges,
  planTitleCleanups,
  slugRefsInTitle,
  type DedupeTask,
} from "../src/lib/task-dedupe";

const task = (p: Partial<DedupeTask> & { id: string; slug: string; title: string }): DedupeTask => ({
  status: "open",
  closed_at: null,
  percent_complete: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  ...p,
});

describe("slug ref parsing", () => {
  it("extracts refs and cleans titles", () => {
    expect(slugRefsInTitle("Grease loader pins #task/grease-loader-pins")).toEqual([
      "grease-loader-pins",
    ]);
    expect(cleanTitle("Grease loader pins #task/grease-loader-pins #project/barn")).toBe(
      "Grease loader pins",
    );
  });
});

describe("planTaskMerges", () => {
  const canonical = task({
    id: "c1",
    slug: "grease-loader-pins",
    title: "Grease loader pins",
  });

  it("merges a duplicate whose title carries the canonical slug", () => {
    const dup = task({
      id: "d1",
      slug: "grease-loader-pins-task-grease-loader-pins",
      title: "Grease loader pins #task/grease-loader-pins",
      status: "done",
      closed_at: "2026-08-20T18:00:00.000Z",
      percent_complete: 100,
      created_at: "2026-08-20T18:00:00.000Z",
    });

    const merges = planTaskMerges([canonical, dup]);
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({
      duplicateId: "d1",
      canonicalId: "c1",
      reason: "slug-ref-in-title",
      carriesDone: true,
    });
    expect(canonicalDoneUpdate(merges[0])).toEqual({
      status: "done",
      closed_at: "2026-08-20T18:00:00.000Z",
      percent_complete: 100,
    });
  });

  it("does not carry done when the duplicate is still open", () => {
    const dup = task({
      id: "d2",
      slug: "dup",
      title: "Grease loader pins #task/grease-loader-pins",
      created_at: "2026-08-20T18:00:00.000Z",
    });
    const merges = planTaskMerges([canonical, dup]);
    expect(merges[0].carriesDone).toBe(false);
    expect(canonicalDoneUpdate(merges[0])).toBeNull();
  });

  it("keeps the oldest task when titles are identical twins", () => {
    const older = task({ id: "a", slug: "mow-pasture", title: "Mow pasture" });
    const newer = task({
      id: "b",
      slug: "mow-pasture-2",
      title: "Mow pasture",
      status: "done",
      created_at: "2026-08-20T00:00:00.000Z",
    });
    const merges = planTaskMerges([newer, older]);
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({
      duplicateId: "b",
      canonicalId: "a",
      reason: "identical-title",
      carriesDone: true,
    });
  });

  it("leaves unique tasks alone and is idempotent", () => {
    const tasks = [canonical, task({ id: "x", slug: "fix-gate", title: "Fix gate" })];
    expect(planTaskMerges(tasks)).toEqual([]);

    const dup = task({
      id: "d3",
      slug: "dup3",
      title: "Grease loader pins #task/grease-loader-pins",
      status: "done",
      created_at: "2026-08-20T18:00:00.000Z",
    });
    const after = [...tasks];
    expect(planTaskMerges([...after, dup])).toHaveLength(1);
    // after the duplicate is deleted, a second run finds nothing
    expect(planTaskMerges(after)).toEqual([]);
  });

  it("never picks a task as both canonical and duplicate", () => {
    const chain = [
      task({ id: "1", slug: "a", title: "A #task/b" }),
      task({ id: "2", slug: "b", title: "B #task/a" }),
    ];
    const merges = planTaskMerges(chain);
    const dups = new Set(merges.map((m) => m.duplicateId));
    for (const m of merges) expect(dups.has(m.canonicalId)).toBe(false);
  });
});

describe("planTitleCleanups", () => {
  it("scrubs stray slug text when there is no canonical target", () => {
    const orphan = task({
      id: "o1",
      slug: "haul-gravel",
      title: "Haul gravel #task/haul-gravel-missing",
    });
    const cleanups = planTitleCleanups([orphan], []);
    expect(cleanups).toEqual([
      { id: "o1", from: orphan.title, to: "Haul gravel" },
    ]);
  });

  it("skips tasks already covered by a merge", () => {
    const canonical = task({ id: "c", slug: "s", title: "S" });
    const dup = task({ id: "d", slug: "d", title: "S #task/s", created_at: "2026-08-20T00:00:00.000Z" });
    const merges = planTaskMerges([canonical, dup]);
    expect(planTitleCleanups([canonical, dup], merges)).toEqual([]);
  });
});
