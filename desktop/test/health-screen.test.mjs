import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopHealthHtml } from "../src/health-screen.mjs";

test("renders profile, schema, license, and actionable setup warnings", () => {
  const html = buildDesktopHealthHtml({
    profileType: "demo",
    schemaVersion: 1,
    databasePath: "/tmp/farmops/demo/database.sqlite",
    appVersion: "0.1.0",
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
  assert.match(html, /demo/);
  assert.match(html, /Database schema 1/);
  assert.match(html, /Demo-trial|demo-trial/);
  assert.match(html, /href="#config-backup"/);
  assert.match(html, /href="#config-ai"/);
  assert.match(html, /Procedures: <strong>Free for life/);
  assert.match(html, /Local procedures/);
  assert.match(html, /Weekly well-system check/);
  assert.match(html, /Refresh local procedures/);
  assert.match(html, /Add local procedure/);
  assert.match(html, /Procedure title/);
  assert.match(html, /data-procedure-edit=/);
  assert.match(html, /data-procedure-delete=/);
  assert.match(html, /Cancel edit/);
});

test("escapes displayed profile and procedure data", () => {
  const html = buildDesktopHealthHtml({
    profileType: "<script>alert(1)<\/script>",
    schemaVersion: 1,
    databasePath: "db",
    appVersion: "0.1.0",
    backupConfigured: true,
    aiConfigured: true,
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