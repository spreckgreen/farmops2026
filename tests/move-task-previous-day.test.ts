import { describe, it, expect } from "vitest";
import { extractTaskRefLines, appendLines } from "@/lib/daily-note-append";
import { appDateStringBefore, shiftStampToDay, appDateString } from "@/lib/app-timezone";

describe("extractTaskRefLines", () => {
  it("pulls the task line plus children", () => {
    const md = "# Day\n- #task/fix-gate Welded hinge\n  - detail\n- #task/other Other\n";
    const { remaining, extracted } = extractTaskRefLines(md, "fix-gate");
    expect(remaining).toBe("# Day\n- #task/other Other\n");
    expect(extracted).toEqual(["- #task/fix-gate Welded hinge", "  - detail"]);
  });
  it("does not match slug prefixes", () => {
    const md = "- #task/fix-gate-latch keep\n";
    expect(extractTaskRefLines(md, "fix-gate").extracted).toEqual([]);
  });
});

describe("appendLines", () => {
  it("appends without duplicating", () => {
    expect(appendLines("a\n", ["b", "b"])).toBe("a\nb\n");
    expect(appendLines("", ["- x"])).toBe("- x\n");
  });
});

describe("day math", () => {
  it("computes previous day across month boundary", () => {
    expect(appDateStringBefore("2026-09-01")).toBe("2026-08-31");
  });
  it("shifts a stamp onto the target day", () => {
    const shifted = shiftStampToDay("2026-08-21", "2026-08-22T03:10:00.000Z");
    expect(appDateString(new Date(shifted))).toBe("2026-08-21");
  });
});
