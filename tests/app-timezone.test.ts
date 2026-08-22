import { describe, expect, it } from "vitest";
import { appDateString, dayBoundsUtc, dayStartUtc } from "@/lib/app-timezone";
import { closedStampFor, isTaskInDayView } from "@/lib/task-status-window";

const TZ = "America/New_York";

describe("farm-local calendar days", () => {
  it("treats 11pm Friday New York as Friday, not Saturday", () => {
    expect(appDateString(new Date("2026-08-22T03:15:00Z"), TZ)).toBe("2026-08-21");
  });

  it("windows a summer day from 04:00Z to 03:59:59.999Z next day", () => {
    expect(dayBoundsUtc("2026-08-21", TZ)).toEqual({
      start: "2026-08-21T04:00:00.000Z",
      end: "2026-08-22T03:59:59.999Z",
    });
  });

  it("handles standard time (EST, -05:00)", () => {
    expect(dayStartUtc("2026-01-15", TZ).toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(appDateString(new Date("2026-01-16T04:30:00Z"), TZ)).toBe("2026-01-15");
  });

  it("keeps an 11pm Friday completion on Friday's board and off Saturday's", () => {
    const stamp = closedStampFor("2026-08-21", new Date("2026-08-22T03:15:00Z"));
    const task = { id: "t1", status: "done", closed_at: stamp };
    expect(isTaskInDayView(task, "2026-08-21", new Set())).toBe(true);
    expect(isTaskInDayView(task, "2026-08-22", new Set())).toBe(false);
  });
});
