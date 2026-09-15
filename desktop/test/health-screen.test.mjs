import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopHealthHtml } from "../src/health-screen.mjs";

test("renders standalone desktop tasks, procedures, and setup screens", () => {
  const html = buildDesktopHealthHtml({
    profileType: "demo",
    schemaVersion: 1,
    databasePath: "/tmp/farmops/demo/database.sqlite",
    appVersion: "0.1.0",
    tasks: [
      {
        id: "demo-task-well-check",
        slug: "weekly-well-check",
        title: "Weekly well-system check",
        status: "open",
        createdAt: "2026-09-14T12:00:00.000Z",
      },
    ],
    procedures: [
      {
        id: "demo-procedure-well-check",
        siteId: "demo-farm",
        title: "Weekly well-system check",
        body: "Inspect pressure, leaks, and pump status; record findings.",
      },
    ],
  });

  assert.match(html, /FarmOps Desktop/);
  assert.match(html, /Standalone local app powered by the desktop SQLite profile/);
  assert.match(html, /data-screen-target="tasks"/);
  assert.match(html, /data-screen-target="procedures"/);
  assert.match(html, /data-screen-target="setup"/);
  assert.match(html, /id="screen-tasks"/);
  assert.match(html, /id="screen-procedures"/);
  assert.match(html, /id="screen-setup"/);
  assert.match(html, /Local tasks/);
  assert.match(html, /Add local task/);
  assert.match(html, /Refresh local tasks/);
  assert.match(html, /data-task-edit=/);
  assert.match(html, /data-task-delete=/);
  assert.match(html, /Cancel edit/);
  assert.match(html, /Local procedures/);
  assert.match(html, /Add local procedure/);
  assert.match(html, /Refresh local procedures/);
  assert.match(html, /data-procedure-edit=/);
  assert.match(html, /data-procedure-delete=/);
  assert.match(html, /Open setup &amp; recovery/);
  assert.match(html, /Procedures: <strong>Free for life/);
});

test("escapes displayed profile, task, and procedure data", () => {
  const html = buildDesktopHealthHtml({
    profileType: "<script>alert(1)<\/script>",
    schemaVersion: 1,
    databasePath: "db",
    appVersion: "0.1.0",
    backupConfigured: true,
    aiConfigured: true,
    tasks: [
      {
        id: "task-1",
        slug: "<bad-slug>",
        title: "<img src=x onerror=alert(1)>",
        status: "blocked",
        createdAt: "2026-09-14T12:00:00.000Z",
      },
    ],
    procedures: [
      {
        id: "p1",
        siteId: "demo",
        title: "<img src=x onerror=alert(1)>",
        body: "<script>alert(2)<\/script>",
      },
    ],
  });

  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Required setup is ready/);
});