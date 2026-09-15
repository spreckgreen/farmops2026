import { describe, expect, it } from "vitest";
import {
  assessCloudSyncedReseedReadiness,
  buildCloudSyncedReseedDryRunReport,
  buildReseedReadinessReport,
  summarizeReseedReadiness,
} from "@/lib/reseed-readiness";

describe("cloud-synced reseed readiness", () => {
  it("reports ready only when cloud-synced prerequisites are satisfied", () => {
    const readiness = assessCloudSyncedReseedReadiness({
      SELF_HOST_MODE: "true",
      SELF_HOST_SYNC_MODE: "true",
      PUBLIC_APP_URL: "https://farm.example.com",
      VAULT_ENCRYPTION_KEY: "abc",
      SELF_HOST_PENDING_DIVERGENCE: "false",
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.every((check) => check.ok)).toBe(true);
  });

  it("reports blocked checks when not cloud-synced or divergence is pending", () => {
    const readiness = assessCloudSyncedReseedReadiness({
      SELF_HOST_MODE: "true",
      PUBLIC_APP_URL: "",
      VAULT_ENCRYPTION_KEY: "",
      SELF_HOST_PENDING_DIVERGENCE: "true",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.key === "hosting-mode")?.ok).toBe(false);
    expect(readiness.checks.find((check) => check.key === "divergence")?.ok).toBe(false);
  });

  it("summarizes readiness failures and report metadata", () => {
    const readiness = assessCloudSyncedReseedReadiness({
      SELF_HOST_MODE: "true",
      SELF_HOST_SYNC_MODE: "true",
      PUBLIC_APP_URL: "",
      VAULT_ENCRYPTION_KEY: "",
      SELF_HOST_PENDING_DIVERGENCE: "true",
    });

    expect(summarizeReseedReadiness(readiness)).toMatch(/Blocked by/);

    const report = buildReseedReadinessReport({
      SELF_HOST_MODE: "true",
      SELF_HOST_SYNC_MODE: "true",
      PUBLIC_APP_URL: "https://farm.example.com",
      VAULT_ENCRYPTION_KEY: "abc",
      SELF_HOST_PENDING_DIVERGENCE: "false",
    });

    expect(report.summary).toBe("All reseed prerequisites are satisfied.");
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("builds a dry-run report with blocked reasons and a recommended path", () => {
    const report = buildCloudSyncedReseedDryRunReport({
      SELF_HOST_MODE: "true",
      PUBLIC_APP_URL: "",
      VAULT_ENCRYPTION_KEY: "",
      SELF_HOST_PENDING_DIVERGENCE: "true",
    });

    expect(report.ready).toBe(false);
    expect(report.recommendedPath).toBe("switch-to-cloud-synced-first");
    expect(report.blockedReasons.length).toBeGreaterThan(0);
    expect(report.requiredArtifacts).toContain("Configured PUBLIC_APP_URL");
  });
});