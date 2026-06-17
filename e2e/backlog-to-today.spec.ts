/**
 * Backlog → Today end-to-end test.
 *
 * Scenario:
 *   1. Test user has one seeded backlog task (created in global-setup).
 *   2. We visit /tasks/backlog and click "Add to today" for that task.
 *   3. We visit /notes/<today> and assert the daily-note textarea contains
 *      a line referencing the task as `#task/<slug>`.
 *
 * Repeat-click sub-test guards the idempotency rule in
 * `appendTaskRefLine`: a second click of "Add to today" within the same
 * day must NOT duplicate the bullet.
 */
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Seed = {
  userId: string;
  email: string;
  taskId: string;
  taskSlug: string;
  taskTitle: string;
};

let seed: Seed;

test.beforeAll(async () => {
  seed = JSON.parse(
    await readFile(path.resolve("e2e/.auth/seed.json"), "utf8"),
  ) as Seed;
});

function todayISO(): string {
  // Match the client's local-date convention used across the app.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("Backlog → Today appends #task/<slug> ref line to daily note markdown", async ({
  page,
}) => {
  // ---- 1. Open Backlog and click "Add to today" on the seeded task ----
  await page.goto("/tasks/backlog");

  const row = page
    .locator("li", { hasText: seed.taskTitle })
    .first();
  await expect(row, "seeded backlog task should be visible").toBeVisible();

  await row.getByRole("button", { name: /add to today/i }).click();

  // ---- 2. Open today's note and read the markdown textarea ------------
  await page.goto(`/notes/${todayISO()}`);

  const textarea = page.locator("textarea").first();
  await expect(textarea).toBeVisible();

  // Poll the textarea value because the editor seeds asynchronously from
  // a background query refetch after the Backlog mutation.
  await expect
    .poll(async () => (await textarea.inputValue()).includes(`#task/${seed.taskSlug}`), {
      timeout: 15_000,
      message: "today's markdown should contain #task/<slug> ref line",
    })
    .toBe(true);

  const markdown = await textarea.inputValue();
  const refLines = markdown
    .split("\n")
    .filter((l) => l.includes(`#task/${seed.taskSlug}`));
  expect(refLines.length, "exactly one ref line for the seeded task").toBe(1);
  expect(refLines[0]).toMatch(new RegExp(`#task/${seed.taskSlug}\\b`));
});

test("Backlog → Today is idempotent on repeat-click (no duplicate bullet)", async ({
  page,
}) => {
  await page.goto("/tasks/backlog");

  const row = page.locator("li", { hasText: seed.taskTitle }).first();

  // The first test already moved the task; depending on app behavior the
  // row may still show "Add to today" or may have disappeared. Click again
  // only if the button is still present.
  const addBtn = row.getByRole("button", { name: /add to today/i });
  if (await addBtn.count()) {
    await addBtn.first().click();
  }

  await page.goto(`/notes/${todayISO()}`);
  const textarea = page.locator("textarea").first();
  await expect(textarea).toBeVisible();

  // Allow any background refetch to settle.
  await page.waitForTimeout(1000);

  const markdown = await textarea.inputValue();
  const refLines = markdown
    .split("\n")
    .filter((l) => l.includes(`#task/${seed.taskSlug}`));
  expect(
    refLines.length,
    "repeat 'Add to today' clicks must not duplicate the ref line",
  ).toBe(1);
});
