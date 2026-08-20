import { describe, expect, it } from "vitest";
import { unresolvedRefs, type TaskLookup } from "@/lib/note-refs";
import {
  buildActivityTokenIndex,
  pickCandidate,
  planRepairs,
  slugToWords,
} from "@/lib/note-ref-repair";

const tasks: TaskLookup[] = [
  { slug: "replace-hydraulic-filter", title: "Replace hydraulic filter" },
  { slug: "grease-loader-pins", title: "Grease loader pins" },
];

const tasksById = new Map([
  ["t1", tasks[0]],
  ["t2", tasks[1]],
]);

describe("slugToWords", () => {
  it("turns slugs into words", () => {
    expect(slugToWords("replace-oil_filter")).toBe("replace oil filter");
  });
});

describe("buildActivityTokenIndex", () => {
  it("maps historical tokens to the task the entry was attached to", () => {
    const index = buildActivityTokenIndex(
      [{ raw_content: "did #task/old-filter-slug today", task_id: "t1" }],
      tasksById,
    );
    expect(index.get("#task/old-filter-slug")?.slug).toBe("replace-hydraulic-filter");
  });

  it("ignores rows without a resolvable task", () => {
    const index = buildActivityTokenIndex(
      [{ raw_content: "#task/x", task_id: null }, { raw_content: null, task_id: "t1" }],
      tasksById,
    );
    expect(index.size).toBe(0);
  });
});

describe("pickCandidate", () => {
  it("prefers the activity log", () => {
    const md = "- [ ] #task/old-filter-slug swap it";
    const refs = unresolvedRefs(md, tasks);
    const index = buildActivityTokenIndex(
      [{ raw_content: "#task/old-filter-slug", task_id: "t1" }],
      tasksById,
    );
    const c = pickCandidate(refs[0], tasks, index);
    expect(c).toMatchObject({ slug: "replace-hydraulic-filter", source: "activity-log" });
  });

  it("falls back to an exact title match", () => {
    const refs = unresolvedRefs("see [[Grease loader pins!]]", tasks);
    const c = pickCandidate(refs[0], tasks, new Map());
    expect(c).toMatchObject({ slug: "grease-loader-pins", source: "title" });
  });

  it("returns no candidate when nothing is close", () => {
    const refs = unresolvedRefs("#task/zzzzzzzz", tasks);
    expect(pickCandidate(refs[0], tasks, new Map())).toBeUndefined();
  });
});

describe("planRepairs", () => {
  it("rewrites slug refs from the activity log and leaves the rest alone", () => {
    const md = ["- [ ] #task/old-filter-slug swap it", "- [ ] #task/zzzzzzzz mystery"].join("\n");
    const refs = unresolvedRefs(md, tasks);
    const index = buildActivityTokenIndex(
      [{ raw_content: "#task/old-filter-slug", task_id: "t1" }],
      tasksById,
    );
    const plan = planRepairs(md, refs, tasks, index);
    expect(plan.edits).toHaveLength(1);
    expect(plan.markdown).toContain("#task/replace-hydraulic-filter");
    expect(plan.markdown).toContain("#task/zzzzzzzz");
    expect(plan.skipped).toHaveLength(1);
  });

  it("normalizes title refs to the canonical task title", () => {
    const md = "worked on [[Grease loader pins!]]";
    const plan = planRepairs(md, unresolvedRefs(md, tasks), tasks, new Map());
    expect(plan.markdown).toBe("worked on [[Grease loader pins]]");
  });

  it("skips fuzzy matches unless allowFuzzy is set", () => {
    const md = "- [ ] #task/replace-hydralic-filter";
    const refs = unresolvedRefs(md, tasks);
    expect(planRepairs(md, refs, tasks, new Map()).edits).toHaveLength(0);
    const loose = planRepairs(md, refs, tasks, new Map(), { allowFuzzy: true });
    expect(loose.edits[0]?.replacement).toBe("#task/replace-hydraulic-filter");
  });

  it("is idempotent once repaired", () => {
    const md = "- [ ] #task/old-filter-slug";
    const index = buildActivityTokenIndex(
      [{ raw_content: "#task/old-filter-slug", task_id: "t1" }],
      tasksById,
    );
    const first = planRepairs(md, unresolvedRefs(md, tasks), tasks, index);
    const second = planRepairs(
      first.markdown,
      unresolvedRefs(first.markdown, tasks),
      tasks,
      index,
    );
    expect(second.edits).toHaveLength(0);
  });
});
