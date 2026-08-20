import { describe, expect, it } from "vitest";
import { checkboxNearMiss, interpretNote, noteFixes, applyNoteFix } from "@/lib/note-syntax";

describe("checkboxNearMiss", () => {
  it("ignores well-formed checkboxes", () => {
    expect(checkboxNearMiss("- [ ] Fix gate")).toBeNull();
    expect(checkboxNearMiss("- [x] Fix gate")).toBeNull();
  });
  it("catches missing dash and missing space", () => {
    const m = checkboxNearMiss("[ ]Boiler_Test Boiler Pipe test ends")!;
    expect(m.done).toBe(false);
    expect(m.title).toBe("Boiler_Test Boiler Pipe test ends");
    expect(m.reason).toMatch(/leading/);
  });
  it("catches wrong bullet and empty brackets", () => {
    expect(checkboxNearMiss("* [ ] Grease pins")!.reason).toMatch(/bullet/);
    expect(checkboxNearMiss("- [] Grease pins")!.reason).toMatch(/brackets/);
  });
  it("leaves wiki links and md links alone", () => {
    expect(checkboxNearMiss("[[Task Name]] did stuff")).toBeNull();
    expect(checkboxNearMiss("[docs](https://x.dev)")).toBeNull();
    expect(checkboxNearMiss("[TODO] later")).toBeNull();
  });
  it("flags the line and offers a syntax fix", () => {
    const md = "[ ]FarmOps recovery features";
    const line = interpretNote(md).lines[0];
    expect(line.action).toBe("warning");
    expect(line.label).toBe("almost a task");
    const fix = noteFixes(line, [])[0];
    expect(applyNoteFix(md, 1, fix).markdown).toBe("- [ ] FarmOps recovery features");
  });
});
