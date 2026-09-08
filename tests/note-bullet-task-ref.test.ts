import { describe, it, expect } from "vitest";
import { interpretNote } from "@/lib/note-syntax";

/**
 * Lines written by "Add to today" look like `- #task/<slug> Title`. The leading
 * bullet used to prevent the `#task/` match, so each one was reported as
 * "Kept in this note's text. No task, no activity-log entry."
 */
describe("bullet-prefixed task references", () => {
  const tasks = [{ slug: "procure-chicken-fence", title: "Procure: Chicken Fence" }];

  it("logs an entry for `- #task/<slug> text`", () => {
    const { lines } = interpretNote("- #task/procure-chicken-fence Procure: Chicken Fence", {
      tasks,
    });
    expect(lines[0]!.action).toBe("log-entry");
    expect(lines[0]!.taskSlug).toBe("procure-chicken-fence");
  });

  it("still works without the bullet", () => {
    const { lines } = interpretNote("#task/procure-chicken-fence picked up posts", { tasks });
    expect(lines[0]!.action).toBe("log-entry");
  });

  it("logs an entry for a bulleted [[Title]] link", () => {
    const { lines } = interpretNote("- [[Procure: Chicken Fence]] posts delivered", { tasks });
    expect(lines[0]!.action).toBe("log-entry");
  });

  it("leaves plain prose as note only", () => {
    const { lines } = interpretNote("- lunch with K", { tasks });
    expect(lines[0]!.action).toBe("ignored");
  });
});
