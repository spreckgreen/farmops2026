import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverUpdateHealth } from "../src/update-health.mjs";
import { loadUpdateSession, saveUpdateSession } from "../src/update-session-store.mjs";

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "farmops-update-health-"));
}

const recovery = {
  targetVersion: "0.2.0",
  backupId: "private-backup-id",
  rollbackInstallerVersion: "0.1.0",
};

test("startup advances a successful restart to verification and persists it", () => {
  const userData = root();
  saveUpdateSession(userData, { phase: "restarting", ...recovery });
  const health = recoverUpdateHealth(userData, "0.2.0");
  assert.deepEqual(health, {
    phase: "verifying",
    severity: "warning",
    message: "FarmOps is verifying the installed update.",
    requiresRecovery: false,
  });
  assert.equal(loadUpdateSession(userData, { currentVersion: "0.2.0" }).phase, "verifying");
  fs.rmSync(userData, { recursive: true });
});

test("startup makes an interrupted install durable as rollback-required", () => {
  const userData = root();
  saveUpdateSession(userData, { phase: "installing", ...recovery });
  const health = recoverUpdateHealth(userData, "0.1.0");
  assert.deepEqual(health, {
    phase: "rollback-required",
    severity: "error",
    message: "Update recovery is required before another update can start.",
    requiresRecovery: true,
  });
  assert.equal(loadUpdateSession(userData, { currentVersion: "0.1.0" }).phase, "rollback-required");
  fs.rmSync(userData, { recursive: true });
});

test("public health never exposes recovery identifiers", () => {
  const userData = root();
  saveUpdateSession(userData, { phase: "rollback-required", ...recovery, reason: "interrupted-during-install" });
  const serialized = JSON.stringify(recoverUpdateHealth(userData, "0.1.0"));
  assert.equal(serialized.includes(recovery.backupId), false);
  assert.equal(serialized.includes(recovery.rollbackInstallerVersion), false);
  assert.equal(serialized.includes("interrupted-during-install"), false);
  fs.rmSync(userData, { recursive: true });
});

test("idle health remains non-blocking", () => {
  const userData = root();
  assert.deepEqual(recoverUpdateHealth(userData, "0.1.0"), {
    phase: "idle",
    severity: "none",
    message: "No update is in progress.",
    requiresRecovery: false,
  });
  fs.rmSync(userData, { recursive: true });
});
