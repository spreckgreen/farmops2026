import { describe, expect, it } from "vitest";
import {
  assertCloudSyncedReseedPreconditions,
  normalizeCloudSyncedReseedWorkflowInput,
} from "@/lib/self-host.functions";
import { buildReseedReadinessReport } from "@/lib/reseed-readiness";
import type { Snapshot } from "@/lib/admin.functions";

function makeSnapshot(): Snapshot {
  return {
    generated_at: new Date().toISOString(),
    generated_by: "user-1",
    app: "bostead",
    version: 1,
    tables: [],
  };
}

describe("cloud-synced reseed workflow validation", () => {
  it("normalizes valid input with defaults", () => {
    const normalized = normalizeCloudSyncedReseedWorkflowInput({
      snapshot: makeSnapshot(),
    });

    expect(normalized.mode).toBe("dry-run");
    expect(normalized.debug).toBe(false);
    expect(normalized.acknowledgeDestructiveApply).toBe(false);
    expect(normalized.allowMissingIntegrity).toBe(false);
  });

  it("rejects non-bostead snapshots", () => {
    const snapshot = {
      ...makeSnapshot(),
      app: "other-app",
    } as unknown as Snapshot;

    expect(() =>
      normalizeCloudSyncedReseedWorkflowInput({
        snapshot,
      }),
    ).toThrow(/Not a Bostead snapshot/);
  });

  it("rejects unsupported snapshot versions", () => {
    const snapshot = {
      ...makeSnapshot(),
      version: 2,
    } as unknown as Snapshot;

    expect(() =>
      normalizeCloudSyncedReseedWorkflowInput({
        snapshot,
      }),
    ).toThrow(/Unsupported snapshot version/);
  });

  it("blocks apply without RESEED confirmation", () => {
    const readiness = buildReseedReadinessReport({
      SELF_HOST_MODE: "true",
      SELF_HOST_SYNC_MODE: "true",
      PUBLIC_APP_URL: "https://farm.example.com",
      VAULT_ENCRYPTION_KEY: "abc",
      SELF_HOST_PENDING_DIVERGENCE: "false",
    });

    expect(() =>
      assertCloudSyncedReseedPreconditions({
        readiness,
        mode: "apply",
        confirm: "",
        acknowledgeDestructiveApply: true,
      }),
    ).toThrow(/confirm="RESEED"/);
  });

  it("blocks apply without destructive acknowledgement", () => {
    const readiness = buildReseedReadinessReport({
      SELF_HOST_MODE: "true",
      SELF_HOST_SYNC_MODE: "true",
      PUBLIC_APP_URL: "https://farm.example.com",
      VAULT_ENCRYPTION_KEY: "abc",
      SELF_HOST_PENDING_DIVERGENCE: "false",
    });

    expect(() =>
      assertCloudSyncedReseedPreconditions({
        readiness,
        mode: "apply",
        confirm: "RESEED",
        acknowledgeDestructiveApply: false,
      }),
    ).toThrow(/destructive acknowledgement/);
  });

  it("blocks reseed when readiness checks are not satisfied", () => {
    const readiness = buildReseedReadinessReport({
      SELF_HOST_MODE: "true",
      SELF_HOST_SYNC_MODE: "false",
      PUBLIC_APP_URL: "",
      VAULT_ENCRYPTION_KEY: "",
      SELF_HOST_PENDING_DIVERGENCE: "true",
    });

    expect(() =>
      assertCloudSyncedReseedPreconditions({
        readiness,
        mode: "dry-run",
      }),
    ).toThrow(/Cloud-synced reseed is blocked/);
  });
});
