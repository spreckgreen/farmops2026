import { loadUpdateSession, saveUpdateSession } from "./update-session-store.mjs";

const MESSAGES = Object.freeze({
  idle: "No update is in progress.",
  "awaiting-confirmation": "A verified update is waiting for confirmation.",
  installing: "FarmOps is installing an update.",
  restarting: "FarmOps is restarting to finish an update.",
  verifying: "FarmOps is verifying the installed update.",
  succeeded: "The most recent update completed successfully.",
  "rollback-required": "Update recovery is required before another update can start.",
  failed: "The most recent update did not complete.",
});

export function recoverUpdateHealth(userDataRoot, currentVersion) {
  const session = loadUpdateSession(userDataRoot, { currentVersion });
  if (session.phase === "verifying" || session.phase === "rollback-required") {
    saveUpdateSession(userDataRoot, session);
  }
  return {
    phase: session.phase,
    severity: session.phase === "rollback-required" || session.phase === "failed"
      ? "error"
      : session.phase === "idle" || session.phase === "succeeded"
        ? "none"
        : "warning",
    message: MESSAGES[session.phase] ?? "Update state is unavailable.",
    requiresRecovery: session.phase === "rollback-required",
  };
}
