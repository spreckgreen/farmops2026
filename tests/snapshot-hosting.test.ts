import { describe, expect, it } from "vitest";
import {
  allowReplaceInGenericRestore,
  classifyRestoreWorkflowPath,
  evaluateSnapshotImportWarnings,
  hostingModelLabel,
  importWarningRemediation,
  importWarningsBlockApply,
  importWarningsRequireAcknowledgement,
  restoreWorkflowPathLabel,
  snapshotOriginFromEnv,
} from "@/lib/snapshot-hosting";

describe("snapshot hosting helpers", () => {
  it("derives isolated, cloud-only, and cloud-synced modes from env", () => {
    expect(snapshotOriginFromEnv({ SELF_HOST_MODE: "true" }).hosting_model).toBe("isolated");
    expect(snapshotOriginFromEnv({}).hosting_model).toBe("cloud-only");
    expect(
      snapshotOriginFromEnv({ SELF_HOST_MODE: "true", SELF_HOST_SYNC_MODE: "true" }).hosting_model,
    ).toBe("cloud-synced");
  });

  it("keeps a readable label for each mode", () => {
    expect(hostingModelLabel("isolated")).toBe("Isolated self-host");
    expect(hostingModelLabel("cloud-only")).toBe("Cloud-only");
    expect(hostingModelLabel("cloud-synced")).toBe("Cloud-synced");
  });

  it("warns for cross-model imports with divergence and disabled ownership rewrite", () => {
    const warnings = evaluateSnapshotImportWarnings({
      snapshotOrigin: {
        hosting_model: "cloud-synced",
        self_host_mode: true,
        pending_divergence: true,
        public_app_url: "https://farm.example.com",
        exported_from: "https://farm.example.com",
        intended_uses: ["backup", "migration"],
      },
      targetOrigin: {
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: null,
        exported_from: "isolated",
        intended_uses: ["backup", "migration"],
      },
      mode: "replace",
      rewriteOwnership: false,
    });

    expect(warnings.map((warning) => warning.code)).toEqual([
      "cross-model-import",
      "pending-divergence",
      "rewrite-ownership-disabled-cross-model",
    ]);
    expect(warnings.find((warning) => warning.code === "pending-divergence")?.severity).toBe(
      "blocking",
    );
  });

  it("warns when replace mode targets a cloud-synced instance", () => {
    const warnings = evaluateSnapshotImportWarnings({
      snapshotOrigin: {
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: null,
        exported_from: "isolated",
        intended_uses: ["backup", "migration"],
      },
      targetOrigin: {
        hosting_model: "cloud-synced",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: "https://farm.example.com",
        exported_from: "https://farm.example.com",
        intended_uses: ["backup", "migration"],
      },
      mode: "replace",
      rewriteOwnership: true,
    });

    expect(warnings.some((warning) => warning.code === "replace-into-cloud-synced")).toBe(true);
    expect(importWarningsBlockApply(warnings)).toBe(true);
  });

  it("requires acknowledgment only when warning-severity items exist", () => {
    expect(
      importWarningsRequireAcknowledgement([
        {
          code: "legacy-origin-metadata-missing",
          severity: "info",
          message: "legacy",
        },
      ]),
    ).toBe(false);

    expect(
      importWarningsRequireAcknowledgement([
        {
          code: "cross-model-import",
          severity: "warning",
          message: "cross model",
        },
      ]),
    ).toBe(true);

    expect(
      importWarningsBlockApply([
        {
          code: "replace-into-cloud-synced",
          severity: "blocking",
          message: "blocked",
        },
      ]),
    ).toBe(true);
  });

  it("provides remediation guidance for each warning code", () => {
    expect(importWarningRemediation("pending-divergence")).toMatch(/Resolve or intentionally discard/);
    expect(importWarningRemediation("replace-into-cloud-synced")).toMatch(/dedicated cloud-synced reseed workflow/);
  });

  it("classifies restore path as cloud-synced reseed for replace into cloud-synced", () => {
    const path = classifyRestoreWorkflowPath({
      snapshotOrigin: {
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: null,
        exported_from: "isolated",
        intended_uses: ["backup", "migration"],
      },
      targetOrigin: {
        hosting_model: "cloud-synced",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: "https://farm.example.com",
        exported_from: "https://farm.example.com",
        intended_uses: ["backup", "migration"],
      },
      mode: "replace",
    });

    expect(path).toBe("cloud-synced-reseed");
    expect(restoreWorkflowPathLabel(path)).toBe("Cloud-synced reseed");
  });

  it("classifies restore path as cross-model migration for non-replace cross-model imports", () => {
    const path = classifyRestoreWorkflowPath({
      snapshotOrigin: {
        hosting_model: "cloud-only",
        self_host_mode: false,
        pending_divergence: false,
        public_app_url: null,
        exported_from: "cloud-only",
        intended_uses: ["backup", "migration"],
      },
      targetOrigin: {
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: null,
        exported_from: "isolated",
        intended_uses: ["backup", "migration"],
      },
      mode: "merge",
    });

    expect(path).toBe("cross-model-migration-restore");
    expect(restoreWorkflowPathLabel(path)).toBe("Cross-model migration import");
  });

  it("classifies restore path as routine backup restore by default", () => {
    const path = classifyRestoreWorkflowPath({
      snapshotOrigin: {
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: "https://farm.example.com",
        exported_from: "https://farm.example.com",
        intended_uses: ["backup", "migration"],
      },
      targetOrigin: {
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: "https://farm.example.com",
        exported_from: "https://farm.example.com",
        intended_uses: ["backup", "migration"],
      },
      mode: "merge",
    });

    expect(path).toBe("routine-backup-restore");
    expect(restoreWorkflowPathLabel(path)).toBe("Routine backup restore");
  });

  it("disallows generic replace restores when target is cloud-synced", () => {
    expect(
      allowReplaceInGenericRestore({
        hosting_model: "cloud-synced",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: "https://farm.example.com",
        exported_from: "https://farm.example.com",
        intended_uses: ["backup", "migration"],
      }),
    ).toBe(false);

    expect(
      allowReplaceInGenericRestore({
        hosting_model: "isolated",
        self_host_mode: true,
        pending_divergence: false,
        public_app_url: null,
        exported_from: "isolated",
        intended_uses: ["backup", "migration"],
      }),
    ).toBe(true);
  });
});