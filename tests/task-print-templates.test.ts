import { describe, expect, it } from "vitest";
import {
  TASK_PRINT_TEMPLATES,
  getTemplate,
  parseMonth,
  renderTaskPrint,
  type PrintTask,
} from "@/lib/task-print-templates";

const tasks: PrintTask[] = [
  { title: "Walk the cellar", slug: "walk-cellar", status: "open", recurrence: "weekly", date: "2026-09-07" },
  { title: "Set <hams> in cure", slug: "cure-hams", status: "done", date: "2026-09-12" },
];

const opts = { title: "Tasks", subtitle: "today", motto: "CURE · CELLAR", blankRows: 3, month: "2026-09" };

describe("task print templates", () => {
  it("exposes a stable registry", () => {
    expect(TASK_PRINT_TEMPLATES.map((t) => t.id)).toEqual([
      "work",
      "work-your-own",
      "grid",
      "ledger",
      "record",
      "farmops-list",
    ]);
    expect(getTemplate("nope")).toBeNull();
  });

  it("renders a full document per template", () => {
    for (const t of TASK_PRINT_TEMPLATES) {
      const html = renderTaskPrint(t.id, tasks, opts);
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain(`size: letter ${t.orientation}`);
    }
  });

  it("prints task titles only in task-consuming templates and escapes HTML", () => {
    const work = renderTaskPrint("work", tasks, opts);
    expect(work).toContain("Walk the cellar");
    expect(work).toContain("Set &lt;hams&gt; in cure");
    expect(renderTaskPrint("work-your-own", tasks, opts)).not.toContain("Walk the cellar");
    expect(renderTaskPrint("record", tasks, opts)).not.toContain("Walk the cellar");
  });

  it("places dated tasks in their day box on the grid", () => {
    const grid = renderTaskPrint("grid", tasks, opts);
    expect(grid).toContain("September 2026");
    expect(grid).toContain("· Walk the cellar");
    const other = renderTaskPrint("grid", tasks, { ...opts, month: "2026-10" });
    expect(other).not.toContain("· Walk the cellar");
  });

  it("rejects an unknown template and bad months", () => {
    expect(() => renderTaskPrint("bogus", tasks, opts)).toThrow(/Unknown task print template/);
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });
});
