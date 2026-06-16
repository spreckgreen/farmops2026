import { describe, it, expect } from "vitest";
import {
  dayBounds,
  weekBoundsEndingSunday,
  monthBounds,
  quarterBounds,
  yearBounds,
  boundsForMode,
  groupEntriesByProject,
} from "@/lib/summary.functions";

// Reference instant: Wed 2026-06-17 14:30 UTC
const REF = new Date("2026-06-17T14:30:00Z");
const ms = (iso: string) => new Date(iso).getTime();

function spanDays(start: Date, end: Date) {
  return (end.getTime() - start.getTime() + 1) / (24 * 60 * 60 * 1000);
}

describe("report period boundaries", () => {
  it("daily_recap covers exactly one UTC day", () => {
    const { start, end } = dayBounds(REF);
    expect(start.toISOString()).toBe("2026-06-17T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-17T23:59:59.999Z");
    expect(spanDays(start, end)).toBeCloseTo(1, 5);
  });

  it("weekly_report covers Mon-Sun (7 days) ending on the most recent Sunday", () => {
    const { start, end } = weekBoundsEndingSunday(REF); // Wed 6/17 → previous Sun 6/14
    expect(start.getUTCDay()).toBe(1); // Monday
    expect(end.getUTCDay()).toBe(0); // Sunday
    expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-14T23:59:59.999Z");
    expect(spanDays(start, end)).toBeCloseTo(7, 5);
  });

  it("weekly_report on a Sunday uses that Sunday as the week-end", () => {
    const sunday = new Date("2026-06-21T10:00:00Z");
    const { start, end } = weekBoundsEndingSunday(sunday);
    expect(start.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-21T23:59:59.999Z");
  });

  it("monthly_rollup covers exactly one calendar month", () => {
    const { start, end } = monthBounds(2026, 5); // June (0-indexed)
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });

  it("quarter_review covers exactly one calendar quarter (3 months)", () => {
    const q2 = quarterBounds(2026, 2);
    expect(q2.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(q2.end.toISOString()).toBe("2026-06-30T23:59:59.999Z");
    const q4 = quarterBounds(2026, 4);
    expect(q4.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(q4.end.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("yearly_rollup covers exactly one calendar year", () => {
    const { start, end } = yearBounds(2026);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });
});

describe("boundsForMode routes each subtype to its own window", () => {
  it("daily uses day window", () => {
    const b = boundsForMode("daily_recap", REF)!;
    expect(b.end.getTime() - b.start.getTime()).toBeLessThan(ms("2026-06-19") - ms("2026-06-17"));
    expect(spanDays(b.start, b.end)).toBeCloseTo(1, 5);
  });

  it("weekly uses 7-day window", () => {
    const b = boundsForMode("weekly_report", REF)!;
    expect(spanDays(b.start, b.end)).toBeCloseTo(7, 5);
  });

  it("monthly window is between 28 and 31 days", () => {
    const b = boundsForMode("monthly_rollup", REF)!;
    const d = spanDays(b.start, b.end);
    expect(d).toBeGreaterThanOrEqual(28);
    expect(d).toBeLessThanOrEqual(31);
  });

  it("quarterly window is ~90 days", () => {
    const b = boundsForMode("quarter_review", REF)!;
    const d = spanDays(b.start, b.end);
    expect(d).toBeGreaterThanOrEqual(89);
    expect(d).toBeLessThanOrEqual(92);
  });

  it("yearly window is 365 or 366 days", () => {
    const b = boundsForMode("yearly_rollup", REF)!;
    const d = spanDays(b.start, b.end);
    expect([365, 366]).toContain(Math.round(d));
  });

  it("portfolio (project_rollup) has no time window — full history", () => {
    expect(boundsForMode("project_rollup", REF)).toBeNull();
  });

  it("each subtype's window is strictly distinct in span", () => {
    const d = spanDays(...Object.values(boundsForMode("daily_recap", REF)!) as [Date, Date]);
    const w = spanDays(...Object.values(boundsForMode("weekly_report", REF)!) as [Date, Date]);
    const m = spanDays(...Object.values(boundsForMode("monthly_rollup", REF)!) as [Date, Date]);
    const q = spanDays(...Object.values(boundsForMode("quarter_review", REF)!) as [Date, Date]);
    const y = spanDays(...Object.values(boundsForMode("yearly_rollup", REF)!) as [Date, Date]);
    expect(d).toBeLessThan(w);
    expect(w).toBeLessThan(m);
    expect(m).toBeLessThan(q);
    expect(q).toBeLessThan(y);
  });
});

describe("groupEntriesByProject (per-project aggregation)", () => {
  type E = {
    raw_content: string;
    tasks: { project_tags?: string[] } | null;
  };
  const entries: E[] = [
    { raw_content: "a", tasks: { project_tags: ["farm"] } },
    { raw_content: "b", tasks: { project_tags: ["farm", "garden"] } },
    { raw_content: "c", tasks: { project_tags: ["garden"] } },
    { raw_content: "d", tasks: null },
    { raw_content: "e", tasks: { project_tags: [] } },
  ];

  it("buckets entries under each of their project tags", () => {
    const groups = groupEntriesByProject(entries);
    expect(groups.get("farm")?.map((e) => e.raw_content)).toEqual(["a", "b"]);
    expect(groups.get("garden")?.map((e) => e.raw_content)).toEqual(["b", "c"]);
  });

  it("untagged entries fall under 'Unassigned'", () => {
    const groups = groupEntriesByProject(entries);
    expect(groups.get("Unassigned")?.map((e) => e.raw_content)).toEqual(["d", "e"]);
  });

  it("monthly/yearly/quarterly/portfolio all share the same per-project grouping shape", () => {
    // The same helper is reused across these modes — proving one proves all.
    const groups = groupEntriesByProject(entries);
    expect([...groups.keys()].sort()).toEqual(["Unassigned", "farm", "garden"]);
  });

  it("portfolio rollup produces one bucket per distinct project across full history", () => {
    const history: E[] = [
      { raw_content: "old", tasks: { project_tags: ["farm"] } },
      { raw_content: "mid", tasks: { project_tags: ["garden"] } },
      { raw_content: "new", tasks: { project_tags: ["farm"] } },
    ];
    const groups = groupEntriesByProject(history);
    expect(groups.size).toBe(2);
    expect(groups.get("farm")).toHaveLength(2);
    expect(groups.get("garden")).toHaveLength(1);
  });
});
