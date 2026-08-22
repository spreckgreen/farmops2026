import { describe, expect, it } from "vitest";
import { appDateString } from "../src/lib/app-timezone";
import {
  dayStampUpdates,
  loggedDaysByTask,
  planDayStampFixes,
  type DayStampTask,
} from "../src/lib/task-day-stamps";

const task = (over: Partial<DayStampTask> = {}): DayStampTask => ({
  id: "t1",
  slug: "fix-gate",
  title: "Fix gate",
  status: "done",
  closed_at: null,
  start_at: null,
  ...over,
});

describe("planDayStampFixes", () => {
  it("pulls a UTC-rolled closed_at back onto the note's day", () => {
    const fixes = planDayStampFixes(
      [task({ closed_at: "2026-08-22T03:10:00.000Z" })],
      [{ task_id: "t1", note_date: "2026-08-21", created_at: "2026-08-22T03:10:00.000Z" }],
    );
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.field).toBe("closed_at");
    expect(fixes[0]!.fromDay).toBe("2026-08-22");
    expect(fixes[0]!.toDay).toBe("2026-08-21");
    expect(appDateString(new Date(fixes[0]!.to))).toBe("2026-08-21");
  });

  it("leaves correct stamps alone", () => {
    const fixes = planDayStampFixes(
      [task({ closed_at: "2026-08-21T18:00:00.000Z" })],
      [{ task_id: "t1", note_date: "2026-08-21", created_at: "2026-08-21T18:00:00.000Z" }],
    );
    expect(fixes).toEqual([]);
  });

  it("ignores tasks with no activity log", () => {
    expect(planDayStampFixes([task({ closed_at: "2026-08-22T03:10:00.000Z" })], [])).toEqual([]);
  });

  it("pulls start_at back but never forward", () => {
    const late = planDayStampFixes(
      [task({ status: "open", start_at: "2026-08-22T02:00:00.000Z" })],
      [{ task_id: "t1", note_date: "2026-08-21", created_at: "2026-08-22T02:00:00.000Z" }],
    );
    expect(late.map((f) => f.field)).toEqual(["start_at"]);

    const early = planDayStampFixes(
      [task({ status: "open", start_at: "2026-08-18T14:00:00.000Z" })],
      [{ task_id: "t1", note_date: "2026-08-21", created_at: "2026-08-21T14:00:00.000Z" }],
    );
    expect(early).toEqual([]);
  });

  it("falls back to the entry's farm day when the note date is missing", () => {
    const days = loggedDaysByTask([
      { task_id: "t1", note_date: null, created_at: "2026-08-22T03:10:00.000Z" },
    ]);
    expect(days.get("t1")).toEqual({ first: "2026-08-21", last: "2026-08-21" });
  });

  it("merges both fields into one update per task", () => {
    const fixes = planDayStampFixes(
      [task({ closed_at: "2026-08-22T03:10:00.000Z", start_at: "2026-08-22T03:00:00.000Z" })],
      [{ task_id: "t1", note_date: "2026-08-21", created_at: "2026-08-22T03:00:00.000Z" }],
    );
    const updates = dayStampUpdates(fixes);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]!.patch).sort()).toEqual(["closed_at", "start_at"]);
  });
});
