import { describe, expect, it } from "vitest";
import { extractTaskRefs, unresolvedRefs, closestMatch } from "@/lib/note-refs";

const tasks = [
  { slug: "replace-hydraulic-filter", title: "Replace hydraulic filter" },
  { slug: "seal-barn-roof", title: "Seal barn roof" },
];

describe("extractTaskRefs", () => {
  it("finds slug and title references with line numbers", () => {
    const md = ["- [ ] #task/seal-barn-roof tarped the north side", "", "note: [[Replace hydraulic filter]] done"].join(
      "\n",
    );
    const refs = extractTaskRefs(md);
    expect(refs.map((r) => [r.kind, r.slug, r.line])).toEqual([
      ["slug", "seal-barn-roof", 1],
      ["title", "replace-hydraulic-filter", 3],
    ]);
  });

  it("ignores empty wiki links", () => {
    expect(extractTaskRefs("[[]] nothing here")).toEqual([]);
  });
});

describe("unresolvedRefs", () => {
  it("returns nothing when every reference resolves", () => {
    expect(unresolvedRefs("#task/seal-barn-roof patched", tasks)).toEqual([]);
  });

  it("flags a slug that no longer exists and suggests the closest task", () => {
    const out = unresolvedRefs("#task/seal-barn-rooof patched", tasks);
    expect(out).toHaveLength(1);
    expect(out[0].token).toBe("#task/seal-barn-rooof");
    expect(out[0].suggestion?.slug).toBe("seal-barn-roof");
  });

  it("flags a renamed title reference", () => {
    const out = unresolvedRefs("[[Seal the barn roof]]", tasks);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("title");
    expect(out[0].suggestion?.slug).toBe("seal-barn-roof");
  });

  it("omits a suggestion when nothing is close", () => {
    const out = unresolvedRefs("#task/zzzzzzzz", tasks);
    expect(out[0].suggestion).toBeUndefined();
  });

  it("dedupes repeated tokens on the same line", () => {
    const out = unresolvedRefs("#task/ghost and again #task/ghost", tasks);
    expect(out).toHaveLength(1);
  });

  it("resolves title refs by exact title even when slugify differs", () => {
    const out = unresolvedRefs("[[Replace hydraulic filter]]", tasks);
    expect(out).toEqual([]);
  });
});

describe("closestMatch", () => {
  it("respects the minimum score", () => {
    expect(closestMatch("qqqq", tasks, 0.9)).toBeUndefined();
    expect(closestMatch("seal barn roof", tasks)?.slug).toBe("seal-barn-roof");
  });
});
