import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { slugify, taskRenamePatch, patchMutatesSlug } from "@/lib/slug";
import { interpretNote } from "@/lib/note-syntax";

// A task slug is a permanent reference: it is typed into daily notes as
// `#task/replace-hydraulic-filter` and used in `/tasks/<slug>` URLs. Renaming
// a task title must never rewrite it. These checks fail loudly if a future
// change reintroduces slug rewriting.

describe("taskRenamePatch", () => {
  it("returns the title only", () => {
    expect(taskRenamePatch("Fix north pasture gate")).toEqual({
      title: "Fix north pasture gate",
    });
  });

  it("never includes a slug key, even when the title's slug would differ", () => {
    const patch = taskRenamePatch("Fix north pasture gate");
    expect(patchMutatesSlug(patch)).toBe(false);
    expect(slugify("Fix north pasture gate")).toBe("fix-north-pasture-gate");
    expect(Object.keys(patch)).toEqual(["title"]);
  });

  it("patchMutatesSlug flags payloads that would rewrite the slug", () => {
    expect(patchMutatesSlug({ title: "x", slug: "x" })).toBe(true);
    expect(patchMutatesSlug({ title: "x", slug: undefined })).toBe(true);
    expect(patchMutatesSlug({ title: "x", recurrence: "weekly" })).toBe(false);
  });
});

describe("#task/<slug> references survive a title rename", () => {
  // Simulates: task created as "Fix gate" (slug fix-gate), later renamed to
  // "Fix north pasture gate". Old notes still say `#task/fix-gate`.
  const renamed = [{ slug: "fix-gate", title: "Fix north pasture gate", status: "open" }];

  it("resolves an old slug reference to the renamed task", () => {
    const result = interpretNote("#task/fix-gate hinge welded back on", { tasks: renamed });
    const line = result.lines[0];
    expect(line.taskSlug).toBe("fix-gate");
    expect(line.unresolvedRef).toBeFalsy();
    expect(line.action).not.toBe("warning");
  });

  it("does not resolve the slug derived from the new title (it was never assigned)", () => {
    const result = interpretNote("#task/fix-north-pasture-gate hinge welded", { tasks: renamed });
    expect(result.lines[0].unresolvedRef).toBe(true);
  });

  it("[[Task Name]] refs follow the current title, unlike slugs", () => {
    const byNewTitle = interpretNote("[[Fix north pasture gate]] hinge welded", { tasks: renamed });
    expect(byNewTitle.lines[0].unresolvedRef).toBeFalsy();

    const byOldTitle = interpretNote("[[Fix gate]] hinge welded", { tasks: renamed });
    expect(byOldTitle.lines[0].unresolvedRef).toBe(true);
  });

  it("completing a renamed task by slug still targets it", () => {
    const result = interpretNote("- [x] Fix north pasture gate", { tasks: renamed });
    expect(result.lines[0].action).toBe("complete-task");
  });
});

// ---- source-level guard -------------------------------------------------
// Any `supabase.from("tasks").update({ ... slug ... })` reintroduces the bug,
// so scan the source instead of trusting review.
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no code path rewrites tasks.slug", () => {
  it("has no tasks update payload containing a slug field", () => {
    const files = collectSources(path.resolve(__dirname, "../src"));
    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Match `.from("tasks")` followed by an `.update(...)` argument list
      // within the same chain, and inspect that payload for a slug key.
      const chain = /\.from\(\s*["']tasks["']\s*\)[\s\S]{0,400}?\.update\(([\s\S]{0,300}?)\)\s*\n?\s*\./g;
      let m: RegExpExecArray | null;
      while ((m = chain.exec(src))) {
        if (/\bslug\s*:/.test(m[1])) {
          offenders.push(`${path.relative(process.cwd(), file)}: ${m[1].trim().slice(0, 120)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the immutability guard wired into updateTask", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/lib/log.functions.ts"), "utf8");
    expect(src).toContain("patchMutatesSlug(patch)");
    expect(src).toContain("taskRenamePatch(");
  });
});
