import { describe, expect, it } from "vitest";
import { inferUsageScheduledDate, estimateUsageRatePerDay } from "@/lib/usage-due-status";

const now = new Date("2026-08-23T12:00:00Z");
const sched = (recurrence: string, raw: Record<string, unknown>) =>
  ({ recurrence, scheduled_date: null, raw }) as never;

describe("usage schedule inference", () => {
  it("derives rate from snapshots", () => {
    const r = estimateUsageRatePerDay(
      [
        { recorded_at: "2026-07-24T12:00:00Z", hours: 100, miles: null },
        { recorded_at: "2026-08-23T12:00:00Z", hours: 190, miles: null },
      ],
      "hours",
    );
    expect(r.ratePerDay).toBeCloseTo(3, 5);
  });

  it("projects a date from measured rate", () => {
    const out = inferUsageScheduledDate(
      sched("custom:100:hours", { baseline_hours: 100, threshold_hours: 200 }),
      { current_hours: 190, current_miles: null } as never,
      [
        { recorded_at: "2026-07-24T12:00:00Z", hours: 100, miles: null },
        { recorded_at: "2026-08-23T12:00:00Z", hours: 190, miles: null },
      ],
      now,
    );
    expect(out?.source).toBe("measured");
    expect(out?.date).toBe("2026-08-26"); // 10 hours left at 3 h/day
  });

  it("falls back to an assumed rate with no snapshots", () => {
    const out = inferUsageScheduledDate(
      sched("custom:100:hours", { baseline_hours: 0, threshold_hours: 100 }),
      { current_hours: 0, current_miles: null } as never,
      [],
      now,
    );
    expect(out?.source).toBe("assumed");
    expect(out?.iso).toBeTruthy();
  });

  it("schedules overdue usage for today", () => {
    const out = inferUsageScheduledDate(
      sched("custom:100:miles", { baseline_miles: 0, threshold_miles: 100 }),
      { current_hours: null, current_miles: 150 } as never,
      [],
      now,
    );
    expect(out?.source).toBe("overdue");
    expect(out?.date).toBe("2026-08-23");
  });

  it("returns null for date-based schedules", () => {
    expect(inferUsageScheduledDate({ recurrence: "monthly", scheduled_date: null } as never, undefined, [], now)).toBeNull();
  });
});
