import { describe, expect, it } from "vitest";
import {
  closedStampFor,
  dayWindow,
  findStatusDrift,
  isTaskInDayView,
} from "../src/lib/task-status-window";

const DATE = "2026-08-20";

describe("closedStampFor", () => {
  it("uses the real clock when it falls inside the note's UTC day", () => {
    const now = new Date("2026-08-20T18:05:00.000Z");
    expect(closedStampFor(DATE, now)).toBe("2026-08-20T18:05:00.000Z");
  });

  it("keeps an evening commit that rolled over in UTC inside the farm-local day", () => {
    // 20:37 New York on Aug 20 == 00:37 UTC on Aug 21 — still Aug 20 on the farm.
    const now = new Date("2026-08-21T00:37:00.000Z");
    expect(closedStampFor(DATE, now)).toBe("2026-08-21T00:37:00.000Z");
    const { start, end } = dayWindow(DATE);
    const stamp = closedStampFor(DATE, now);
    expect(stamp >= start && stamp <= end).toBe(true);
  });

  it("clamps a stamp that truly falls outside the farm-local day", () => {
    // 08:00 UTC Aug 22 == 04:00 New York Aug 22, past Aug 20's window.
    expect(closedStampFor(DATE, new Date("2026-08-22T08:00:00.000Z"))).toBe(
      "2026-08-20T12:00:00.000Z",
    );
  });
});

describe("isTaskInDayView", () => {
  const logged = new Set(["t1"]);

  it("keeps open and blocked tasks regardless of closed_at", () => {
    expect(isTaskInDayView({ id: "a", status: "open", closed_at: null }, DATE, logged)).toBe(true);
    expect(
      isTaskInDayView({ id: "b", status: "blocked", closed_at: null }, DATE, logged),
    ).toBe(true);
  });

  it("shows a done task the day's log references even when closed_at drifted", () => {
    expect(
      isTaskInDayView(
        { id: "t1", status: "done", closed_at: "2026-08-21T00:37:00.000Z" },
        DATE,
        logged,
      ),
    ).toBe(true);
  });

  it("shows a done task closed inside the day even without a log entry", () => {
    expect(
      isTaskInDayView(
        { id: "z", status: "done", closed_at: "2026-08-20T09:00:00.000Z" },
        DATE,
        logged,
      ),
    ).toBe(true);
  });

  it("hides stale done tasks with no log entry and no in-day closed_at", () => {
    expect(
      isTaskInDayView(
        { id: "z", status: "done", closed_at: "2026-07-01T09:00:00.000Z" },
        DATE,
        logged,
      ),
    ).toBe(false);
    expect(isTaskInDayView({ id: "z", status: "done", closed_at: null }, DATE, logged)).toBe(
      false,
    );
  });

  it("open + done filters partition the set with no task lost", () => {
    const tasks = [
      { id: "t1", status: "done", closed_at: "2026-08-21T00:37:00.000Z" },
      { id: "o1", status: "open", closed_at: null },
      { id: "b1", status: "blocked", closed_at: null },
    ];
    const visible = tasks.filter((t) => isTaskInDayView(t, DATE, logged));
    const open = visible.filter((t) => t.status === "open");
    const blocked = visible.filter((t) => t.status === "blocked");
    const done = visible.filter((t) => t.status === "done");
    expect(open.length + blocked.length + done.length).toBe(visible.length);
    expect(done.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("findStatusDrift", () => {
  it("flags done rows missing closed_at and open rows carrying closed_at", () => {
    const drift = findStatusDrift(
      [
        { id: "d1", status: "done", closed_at: null },
        { id: "o1", status: "open", closed_at: "2026-08-20T10:00:00.000Z" },
      ],
      DATE,
      new Set(),
    );
    expect(drift.map((d) => d.kind)).toEqual([
      "done-without-closed-at",
      "closed-at-without-done",
    ]);
  });

  it("flags a logged done task whose closed_at landed outside the day", () => {
    const drift = findStatusDrift(
      [{ id: "t1", status: "done", closed_at: "2026-08-21T00:37:00.000Z" }],
      DATE,
      new Set(["t1"]),
    );
    expect(drift[0].kind).toBe("closed-at-outside-day");
  });

  it("reports nothing for consistent rows", () => {
    expect(
      findStatusDrift(
        [
          { id: "a", status: "open", closed_at: null },
          { id: "b", status: "done", closed_at: "2026-08-20T10:00:00.000Z" },
        ],
        DATE,
        new Set(["b"]),
      ),
    ).toEqual([]);
  });
});
