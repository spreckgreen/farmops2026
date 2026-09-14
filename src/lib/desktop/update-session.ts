import type { UpdatePreflight } from "./update-preflight";

export type UpdatePhase =
  | "idle"
  | "awaiting-confirmation"
  | "installing"
  | "restarting"
  | "verifying"
  | "succeeded"
  | "rollback-required"
  | "failed";

export type UpdateSession =
  | { phase: "idle" }
  | { phase: "awaiting-confirmation"; targetVersion: string; backupId: string; rollbackInstallerVersion: string }
  | { phase: "installing"; targetVersion: string; backupId: string; rollbackInstallerVersion: string }
  | { phase: "restarting"; targetVersion: string; backupId: string; rollbackInstallerVersion: string }
  | { phase: "verifying"; targetVersion: string; backupId: string; rollbackInstallerVersion: string }
  | { phase: "succeeded"; targetVersion: string }
  | { phase: "rollback-required"; targetVersion: string; backupId: string; rollbackInstallerVersion: string; reason: string }
  | { phase: "failed"; reason: string };

export type UpdateEvent =
  | { type: "PREFLIGHT_COMPLETED"; targetVersion: string; result: UpdatePreflight }
  | { type: "CONFIRMED" }
  | { type: "CANCELED" }
  | { type: "INSTALLER_STARTED" }
  | { type: "RESTARTED" }
  | { type: "HEALTH_VERIFIED" }
  | { type: "FAILED"; reason: string };

function active(session: UpdateSession) {
  if (!("targetVersion" in session) || !("backupId" in session) || !("rollbackInstallerVersion" in session)) {
    throw new Error("update-session-has-no-recovery-context");
  }
  return session;
}

export function advanceUpdateSession(session: UpdateSession, event: UpdateEvent): UpdateSession {
  if (event.type === "PREFLIGHT_COMPLETED") {
    if (session.phase !== "idle") throw new Error("update-session-already-started");
    if (!event.result.authorized) return { phase: "failed", reason: event.result.reasons.join(",") };
    return {
      phase: "awaiting-confirmation",
      targetVersion: event.targetVersion,
      backupId: event.result.backupId,
      rollbackInstallerVersion: event.result.rollbackInstallerVersion,
    };
  }

  if (event.type === "CANCELED") {
    if (session.phase !== "awaiting-confirmation") throw new Error("update-cannot-be-canceled-now");
    return { phase: "idle" };
  }

  if (event.type === "FAILED") {
    if (["installing", "restarting", "verifying"].includes(session.phase)) {
      const context = active(session);
      return {
        phase: "rollback-required",
        targetVersion: context.targetVersion,
        backupId: context.backupId,
        rollbackInstallerVersion: context.rollbackInstallerVersion,
        reason: event.reason,
      };
    }
    return { phase: "failed", reason: event.reason };
  }

  if (session.phase === "awaiting-confirmation" && event.type === "CONFIRMED") {
    return { ...active(session), phase: "installing" };
  }
  if (session.phase === "installing" && event.type === "INSTALLER_STARTED") {
    return { ...active(session), phase: "restarting" };
  }
  if (session.phase === "restarting" && event.type === "RESTARTED") {
    return { ...active(session), phase: "verifying" };
  }
  if (session.phase === "verifying" && event.type === "HEALTH_VERIFIED") {
    return { phase: "succeeded", targetVersion: session.targetVersion };
  }

  throw new Error(`invalid-update-transition:${session.phase}:${event.type}`);
}

export function canInstallUpdate(session: UpdateSession): boolean {
  return session.phase === "installing";
}

export function requiresRollback(session: UpdateSession): session is Extract<UpdateSession, { phase: "rollback-required" }> {
  return session.phase === "rollback-required";
}
