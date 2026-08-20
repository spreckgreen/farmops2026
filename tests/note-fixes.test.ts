import { describe, it, expect } from "vitest";
import {
  applyNoteFix,
  interpretNote,
  lineEndOffset,
  noteFixes,
  titleFromSlug,
} from "@/lib/note-syntax";

const tasks = [
  { slug: "grease-the-loader-pins", title: "Grease the loader pins", status: "open" },
  { slug: "order-cement-for-the-shop-slab", title: "Order cement for the shop slab", status: "open" },
];

function firstWarning(markdown: string) {
  const { lines } = interpretNote(markdown, { tasks });
  const line = lines.find((l) => l.action === "warning");
  if (!line) throw new Error("expected a warning line, got: " + JSON.stringify(lines));
  return line;
}

describe("titleFromSlug", () => {
  it("turns a slug back into a readable title", () => {
    expect(titleFromSlug("fix-north-pasture-gate")).toBe("Fix north pasture gate");
    expect(titleFromSlug("winterize")).toBe("Winterize");
  });
});

describe("unknown #task/<slug> reference", () => {
  const md = "#task/greese-loader-pins used two tubes of moly grease";

  it("offers to create the missing task above the line", () => {
    const fixes = noteFixes(firstWarning(md), tasks);
    const create = fixes.find((f) => f.kind === "create-missing-task")!;
    expect(create.op).toEqual({ type: "insert-before", text: "- [ ] Greese loader pins" });

    const { markdown } = applyNoteFix(md, 1, create);
    expect(markdown).toBe("- [ ] Greese loader pins\n" + md);
    // After the fix the log entry resolves against the task created above it.
    const after = interpretNote(markdown, { tasks });
    expect(after.counts.warnings).toBe(0);
    expect(after.counts.createTasks).toBe(1);
  });

  it("suggests the closest existing slug", () => {
    const fixes = noteFixes(firstWarning(md), tasks);
    const near = fixes.find((f) => f.kind === "use-closest-slug")!;
    expect(near.label).toBe("Use #task/grease-the-loader-pins");

    const { markdown } = applyNoteFix(md, 1, near);
    expect(markdown).toBe("#task/grease-the-loader-pins used two tubes of moly grease");
    expect(interpretNote(markdown, { tasks }).counts.warnings).toBe(0);
  });

  it("does not suggest a slug when nothing is remotely close", () => {
    const md2 = "#task/zzzz-qqqq-vvvv something happened";
    const fixes = noteFixes(firstWarning(md2), tasks);
    expect(fixes.map((f) => f.kind)).toEqual(["create-missing-task"]);
  });
});

describe("[[Title]] with no matching task", () => {
  const md = "!blocker [[Order cement for shop slab]] supplier is out until Friday";

  it("offers create, exact-title and slug variants", () => {
    const fixes = noteFixes(firstWarning(md), tasks);
    expect(fixes.map((f) => f.kind)).toEqual([
      "create-missing-task",
      "use-closest-title",
      "use-closest-slug",
    ]);

    const byTitle = applyNoteFix(md, 1, fixes[1]).markdown;
    expect(byTitle).toBe(
      "!blocker [[Order cement for the shop slab]] supplier is out until Friday",
    );
    const bySlug = applyNoteFix(md, 1, fixes[2]).markdown;
    expect(bySlug).toBe(
      "!blocker #task/order-cement-for-the-shop-slab supplier is out until Friday",
    );
    for (const fixed of [byTitle, bySlug]) {
      const res = interpretNote(fixed, { tasks });
      expect(res.counts.warnings).toBe(0);
      expect(res.lines[0].entryType).toBe("blocker");
    }
  });
});

describe("reference with no entry text", () => {
  it("focuses the line so the user can type", () => {
    const md = "#task/grease-the-loader-pins";
    const fixes = noteFixes(firstWarning(md), tasks);
    expect(fixes[0].kind).toBe("add-entry-text");
    expect(fixes[0].op).toEqual({ type: "focus-line-end" });
    const { markdown, caretLine } = applyNoteFix(md, 1, fixes[0]);
    expect(markdown).toBe(md); // text untouched
    expect(lineEndOffset(markdown, caretLine)).toBe(md.length);
  });
});

describe("!prefix with no task reference", () => {
  const md = "!blocker order cement for the shop slab is back-ordered";

  it("attaches to the best matching task or converts to a task", () => {
    const fixes = noteFixes(firstWarning(md), tasks);
    expect(fixes.map((f) => f.kind)).toEqual(["attach-to-task", "convert-to-task"]);

    const attached = applyNoteFix(md, 1, fixes[0]).markdown;
    expect(attached).toBe(
      "!blocker #task/order-cement-for-the-shop-slab order cement for the shop slab is back-ordered",
    );
    expect(interpretNote(attached, { tasks }).counts.warnings).toBe(0);

    const asTask = applyNoteFix(md, 1, fixes[1]).markdown;
    expect(asTask).toBe("- [ ] order cement for the shop slab is back-ordered");
  });
});

describe("checkbox with no title", () => {
  it("only offers a caret fix", () => {
    const line = firstWarning("- [ ] #project/bostead");
    const fixes = noteFixes(line, tasks);
    expect(fixes.map((f) => f.kind)).toEqual(["add-task-title"]);
  });
});

describe("applyNoteFix line handling", () => {
  const md = ["- [ ] Existing task", "#task/nope-not-real details here", "trailing prose"].join("\n");

  it("edits only the targeted line and preserves indentation", () => {
    const indented = "  #task/nope-not-real details here";
    const { markdown } = applyNoteFix(indented, 1, {
      kind: "use-closest-slug",
      label: "x",
      description: "x",
      op: { type: "replace-line", text: "#task/grease-the-loader-pins details here" },
    });
    expect(markdown).toBe("  #task/grease-the-loader-pins details here");
  });

  it("inserts above the right line without touching neighbours", () => {
    const { markdown } = applyNoteFix(md, 2, {
      kind: "create-missing-task",
      label: "x",
      description: "x",
      op: { type: "insert-before", text: "- [ ] Nope not real" },
    });
    expect(markdown.split("\n")).toEqual([
      "- [ ] Existing task",
      "- [ ] Nope not real",
      "#task/nope-not-real details here",
      "trailing prose",
    ]);
  });

  it("is a no-op for out-of-range line numbers", () => {
    expect(applyNoteFix(md, 99, { kind: "add-entry-text", label: "x", description: "x", op: { type: "focus-line-end" } }).markdown).toBe(md);
  });

  it("computes caret offsets at end of line", () => {
    expect(lineEndOffset(md, 1)).toBe("- [ ] Existing task".length);
    expect(lineEndOffset(md, 2)).toBe(
      "- [ ] Existing task".length + 1 + "#task/nope-not-real details here".length,
    );
  });
});

describe("healthy rows", () => {
  it("offer no fixes", () => {
    const { lines } = interpretNote(
      "- [ ] Grease the loader pins\n#task/grease-the-loader-pins done in 20 min",
      { tasks },
    );
    for (const l of lines) expect(noteFixes(l, tasks)).toEqual([]);
  });
});
