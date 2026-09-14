import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearUpdateSession, loadUpdateSession, saveUpdateSession } from "../src/update-session-store.mjs";

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "farmops-update-session-"));
}

const recovery = {
  targetVersion: "0.2.0",
  backupId: "backup-pre-update",
  rollbackInstallerVersion: "0.1.0",
};

test("missing session starts idle", () => {
  const root = temporaryRoot();
  assert.deepEqual(loadUpdateSession(root), { phase: "idle" });
  fs.rmSync(root, { recursive: true });
});

test("atomically persists recovery evidence without paths or secrets", () => {
  const root = temporaryRoot();
  const target = saveUpdateSession(root, { phase: "awaiting-confirmation", ...recovery }, new Date("2026-09-14T12:00:00.000Z"));
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.deepEqual(loadUpdateSession(root), { phase: "awaiting-confirmation", ...recovery });
  assert.deepEqual(fs.readdirSync(root), ["update-session.json"]);
  const stored = fs.readFileSync(target, "utf8");
  assert.equal(stored.includes("installerPath"), false);
  assert.equal(stored.includes("signature"), false);
  fs.rmSync(root, { recursive: true });
});

test("interrupted installation requires rollback", () => {
  const root = temporaryRoot();
  saveUpdateSession(root, { phase: "installing", ...recovery });
  assert.deepEqual(loadUpdateSession(root), {
    phase: "rollback-required",
    ...recovery,
    reason: "interrupted-during-install",
  });
  fs.rmSync(root, { recursive: true });
});

test("restart advances only when the expected version is running", () => {
  const root = temporaryRoot();
  saveUpdateSession(root, { phase: "restarting", ...recovery });
  assert.deepEqual(loadUpdateSession(root, { currentVersion: "0.2.0" }), { phase: "verifying", ...recovery });
  assert.deepEqual(loadUpdateSession(root, { currentVersion: "0.1.0" }), {
    phase: "rollback-required",
    ...recovery,
    reason: "restart-version-mismatch",
  });
  fs.rmSync(root, { recursive: true });
});

test("corrupt and structurally invalid state fails closed", () => {
  const root = temporaryRoot();
  fs.writeFileSync(path.join(root, "update-session.json"), "{");
  assert.deepEqual(loadUpdateSession(root), { phase: "failed", reason: "persisted-update-session-unreadable" });
  fs.writeFileSync(path.join(root, "update-session.json"), JSON.stringify({
    storeVersion: 1,
    recordedAt: new Date().toISOString(),
    session: { phase: "installing", targetVersion: "0.2.0" },
  }));
  assert.deepEqual(loadUpdateSession(root), { phase: "failed", reason: "persisted-update-session-invalid" });
  fs.rmSync(root, { recursive: true });
});

test("clear removes only the update session record", () => {
  const root = temporaryRoot();
  const unrelated = path.join(root, "installation.json");
  fs.writeFileSync(unrelated, "{}");
  saveUpdateSession(root, { phase: "succeeded", targetVersion: "0.2.0" });
  clearUpdateSession(root);
  assert.equal(fs.existsSync(path.join(root, "update-session.json")), false);
  assert.equal(fs.existsSync(unrelated), true);
  fs.rmSync(root, { recursive: true });
});

test("relative roots and invalid sessions are rejected", () => {
  assert.throws(() => saveUpdateSession("relative", { phase: "idle" }), /must-be-absolute/);
  const root = temporaryRoot();
  assert.throws(() => saveUpdateSession(root, { phase: "rollback-required", ...recovery }), /invalid-update-session/);
  fs.rmSync(root, { recursive: true });
});
