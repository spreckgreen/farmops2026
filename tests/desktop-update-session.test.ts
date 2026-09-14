import { describe, expect, it } from "vitest";
import { advanceUpdateSession, canInstallUpdate, requiresRollback, type UpdateSession } from "../src/lib/desktop/update-session";

const authorized = {
  authorized: true as const,
  backupId: "backup-pre-update",
  transactionalMigration: true as const,
  rollbackInstallerVersion: "0.1.0",
  allowEntitlementIndependentCoreUpdate: true as const,
};

function approved(): UpdateSession {
  return advanceUpdateSession(
    { phase: "idle" },
    { type: "PREFLIGHT_COMPLETED", targetVersion: "0.2.0", result: authorized },
  );
}

describe("desktop update session", () => {
  it("requires authorization and explicit confirmation before install", () => {
    const waiting = approved();
    expect(waiting.phase).toBe("awaiting-confirmation");
    expect(canInstallUpdate(waiting)).toBe(false);

    const installing = advanceUpdateSession(waiting, { type: "CONFIRMED" });
    expect(installing).toEqual({
      phase: "installing",
      targetVersion: "0.2.0",
      backupId: "backup-pre-update",
      rollbackInstallerVersion: "0.1.0",
    });
    expect(canInstallUpdate(installing)).toBe(true);
  });

  it("cancels without starting an installer", () => {
    expect(advanceUpdateSession(approved(), { type: "CANCELED" })).toEqual({ phase: "idle" });
  });

  it("fails closed when preflight is blocked", () => {
    const blocked = advanceUpdateSession(
      { phase: "idle" },
      {
        type: "PREFLIGHT_COMPLETED",
        targetVersion: "0.2.0",
        result: { authorized: false, reasons: ["verified-backup-required", "signature-invalid"] },
      },
    );
    expect(blocked).toEqual({ phase: "failed", reason: "verified-backup-required,signature-invalid" });
    expect(() => advanceUpdateSession(blocked, { type: "CONFIRMED" })).toThrow(/invalid-update-transition/);
  });

  it("retains recovery evidence through restart and verification", () => {
    let session = advanceUpdateSession(approved(), { type: "CONFIRMED" });
    session = advanceUpdateSession(session, { type: "INSTALLER_STARTED" });
    session = advanceUpdateSession(session, { type: "RESTARTED" });
    expect(session).toEqual({
      phase: "verifying",
      targetVersion: "0.2.0",
      backupId: "backup-pre-update",
      rollbackInstallerVersion: "0.1.0",
    });
    expect(advanceUpdateSession(session, { type: "HEALTH_VERIFIED" })).toEqual({
      phase: "succeeded",
      targetVersion: "0.2.0",
    });
  });

  it.each(["installing", "restarting", "verifying"] as const)(
    "requires rollback when %s fails",
    (phase) => {
      let session = advanceUpdateSession(approved(), { type: "CONFIRMED" });
      if (phase !== "installing") session = advanceUpdateSession(session, { type: "INSTALLER_STARTED" });
      if (phase === "verifying") session = advanceUpdateSession(session, { type: "RESTARTED" });
      const failed = advanceUpdateSession(session, { type: "FAILED", reason: "post-update-health-failed" });
      expect(requiresRollback(failed)).toBe(true);
      if (requiresRollback(failed)) {
        expect(failed.backupId).toBe("backup-pre-update");
        expect(failed.rollbackInstallerVersion).toBe("0.1.0");
      }
    },
  );

  it("rejects skipped and repeated transitions", () => {
    expect(() => advanceUpdateSession(approved(), { type: "RESTARTED" })).toThrow(/invalid-update-transition/);
    expect(() =>
      advanceUpdateSession({ phase: "succeeded", targetVersion: "0.2.0" }, { type: "HEALTH_VERIFIED" }),
    ).toThrow(/invalid-update-transition/);
  });
});
