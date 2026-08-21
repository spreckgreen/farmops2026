import { describe, expect, it } from "vitest";
import { seedFromPreviousNote, stripStaleDoneLines } from "@/lib/note-seed";

describe("seedFromPreviousNote", () => {
  it("carries unfinished work forward and leaves finished lines behind", () => {
    const prior = [
      "## Weather",
      "Sunny · High 92 / Low 68 · Feels like 96°F / 70°F · 71% humidity",
      "",
      "## Tasks",
      "- [x] Grease loader pins #task/grease-loader-pins",
      "- [ ] Order steel doors #task/order-steel-doors",
      "- [ ] Call the vet",
    ].join("\n");

    expect(seedFromPreviousNote(prior)).toBe(
      ["## Tasks", "- [ ] Order steel doors #task/order-steel-doors", "- [ ] Call the vet"].join(
        "\n",
      ),
    );
  });

  it("drops nested children of a completed line", () => {
    const prior = [
      "- [x] Rebuild the pump #task/rebuild-pump",
      "    - pulled the impeller",
      "    - [ ] torque bolts",
      "- [ ] Mow the north field",
    ].join("\n");
    expect(seedFromPreviousNote(prior)).toBe("- [ ] Mow the north field");
  });

  it("drops headings whose whole section was completed", () => {
    const prior = ["## Done stuff", "- [x] Thing #task/thing", "", "## Open", "- [ ] Other"].join(
      "\n",
    );
    expect(seedFromPreviousNote(prior)).toBe(["## Open", "- [ ] Other"].join("\n"));
  });

  it("handles empty and missing input", () => {
    expect(seedFromPreviousNote("")).toBe("");
    expect(seedFromPreviousNote(null)).toBe("");
    expect(seedFromPreviousNote("   \n\n")).toBe("");
  });
});

describe("stripStaleDoneLines", () => {
  const md = [
    "- [x] Grease loader pins #task/grease-loader-pins",
    "- [x] Fix gate #task/fix-gate",
    "- [x] Untracked free text",
    "- [ ] Order steel doors #task/order-steel-doors",
  ].join("\n");

  it("removes only the slug lines closed on an earlier day", () => {
    const { markdown, removed } = stripStaleDoneLines(md, (s) => s === "grease-loader-pins");
    expect(removed).toEqual(["- [x] Grease loader pins #task/grease-loader-pins"]);
    expect(markdown).toBe(
      [
        "- [x] Fix gate #task/fix-gate",
        "- [x] Untracked free text",
        "- [ ] Order steel doors #task/order-steel-doors",
      ].join("\n"),
    );
  });

  it("is a no-op when nothing is stale", () => {
    const { markdown, removed } = stripStaleDoneLines(md, () => false);
    expect(removed).toEqual([]);
    expect(markdown).toBe(md);
  });
});
