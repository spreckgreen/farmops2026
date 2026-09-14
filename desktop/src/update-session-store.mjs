import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 1;
const FILE_NAME = "update-session.json";
const RECOVERY_PHASES = new Set(["awaiting-confirmation", "installing", "restarting", "verifying", "rollback-required"]);
const TERMINAL_PHASES = new Set(["idle", "succeeded", "failed"]);

function filePath(userDataRoot) {
  if (!path.isAbsolute(userDataRoot)) throw new Error("update-session-root-must-be-absolute");
  return path.join(userDataRoot, FILE_NAME);
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function validateSession(session) {
  if (!session || typeof session !== "object" || !nonEmpty(session.phase)) return false;
  if (TERMINAL_PHASES.has(session.phase)) {
    if (session.phase === "idle") return Object.keys(session).length === 1;
    if (session.phase === "succeeded") return nonEmpty(session.targetVersion);
    return nonEmpty(session.reason);
  }
  if (!RECOVERY_PHASES.has(session.phase)) return false;
  if (!nonEmpty(session.targetVersion) || !nonEmpty(session.backupId) || !nonEmpty(session.rollbackInstallerVersion)) return false;
  return session.phase !== "rollback-required" || nonEmpty(session.reason);
}

function persisted(session, recordedAt) {
  if (!validateSession(session)) throw new Error("invalid-update-session");
  const timestamp = new Date(recordedAt).toISOString();
  return { storeVersion: STORE_VERSION, recordedAt: timestamp, session };
}

export function saveUpdateSession(userDataRoot, session, recordedAt = new Date()) {
  fs.mkdirSync(userDataRoot, { recursive: true, mode: 0o700 });
  const destination = filePath(userDataRoot);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(persisted(session, recordedAt), null, 2);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, body, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return destination;
}

export function loadUpdateSession(userDataRoot, { currentVersion } = {}) {
  const source = filePath(userDataRoot);
  if (!fs.existsSync(source)) return { phase: "idle" };
  let document;
  try {
    document = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch {
    return { phase: "failed", reason: "persisted-update-session-unreadable" };
  }
  if (document?.storeVersion !== STORE_VERSION || !Number.isFinite(Date.parse(document.recordedAt)) || !validateSession(document.session)) {
    return { phase: "failed", reason: "persisted-update-session-invalid" };
  }
  const session = document.session;
  if (session.phase === "installing") {
    return { ...session, phase: "rollback-required", reason: "interrupted-during-install" };
  }
  if (session.phase === "restarting") {
    if (nonEmpty(currentVersion) && currentVersion === session.targetVersion) return { ...session, phase: "verifying" };
    return { ...session, phase: "rollback-required", reason: "restart-version-mismatch" };
  }
  return session;
}

export function clearUpdateSession(userDataRoot) {
  const target = filePath(userDataRoot);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
