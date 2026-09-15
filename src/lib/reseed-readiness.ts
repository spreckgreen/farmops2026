import { hostingModelLabel, snapshotOriginFromEnv } from "@/lib/snapshot-hosting";

export type ReseedReadinessCheck = {
  key: "hosting-mode" | "public-app-url" | "vault-key" | "divergence";
  label: string;
  ok: boolean;
  detail: string;
};

export type ReseedReadiness = {
  ready: boolean;
  checks: ReseedReadinessCheck[];
};

export type ReseedReadinessReport = {
  checkedAt: string;
  readiness: ReseedReadiness;
  summary: string;
};

export type ReseedDryRunReport = {
  checkedAt: string;
  ready: boolean;
  targetHostingModel: "isolated" | "cloud-only" | "cloud-synced";
  blockedReasons: string[];
  requiredArtifacts: string[];
  recommendedPath:
    | "proceed-with-restore-dry-run"
    | "resolve-divergence-first"
    | "finish-self-host-config-first"
    | "switch-to-cloud-synced-first";
  summary: string;
};

export function assessCloudSyncedReseedReadiness(
  env: Record<string, string | undefined> = process.env,
): ReseedReadiness {
  const origin = snapshotOriginFromEnv(env);
  const publicAppUrl = env.PUBLIC_APP_URL || null;
  const hasVaultKey = Boolean(env.VAULT_ENCRYPTION_KEY);

  const checks: ReseedReadinessCheck[] = [
    {
      key: "hosting-mode",
      label: "Cloud-synced mode enabled",
      ok: origin.hosting_model === "cloud-synced",
      detail:
        origin.hosting_model === "cloud-synced"
          ? "This instance is already operating in cloud-synced mode."
          : `Current mode is ${hostingModelLabel(origin.hosting_model)}. Dedicated reseed planning is only relevant for cloud-synced instances.`,
    },
    {
      key: "public-app-url",
      label: "Public origin configured",
      ok: Boolean(publicAppUrl),
      detail: publicAppUrl
        ? `PUBLIC_APP_URL is set to ${publicAppUrl}.`
        : "Set PUBLIC_APP_URL so the instance can describe its externally reachable origin during migration and sync operations.",
    },
    {
      key: "vault-key",
      label: "Vault key configured",
      ok: hasVaultKey,
      detail: hasVaultKey
        ? "VAULT_ENCRYPTION_KEY is configured for this instance."
        : "Set VAULT_ENCRYPTION_KEY before relying on cross-instance secret recovery or reseed-adjacent workflows.",
    },
    {
      key: "divergence",
      label: "No pending divergence",
      ok: !origin.pending_divergence,
      detail: origin.pending_divergence
        ? "Pending divergence is reported. Reconcile or intentionally discard outstanding local/cloud differences before reseed."
        : "No pending divergence is reported right now.",
    },
  ];

  return {
    ready: checks.every((check) => check.ok),
    checks,
  };
}

export function summarizeReseedReadiness(readiness: ReseedReadiness): string {
  const failed = readiness.checks.filter((check) => !check.ok);
  if (failed.length === 0) return "All reseed prerequisites are satisfied.";
  if (failed.length === 1) return `Blocked by 1 prerequisite: ${failed[0].label}.`;
  return `Blocked by ${failed.length} prerequisites: ${failed.map((check) => check.label).join(", ")}.`;
}

export function buildReseedReadinessReport(
  env: Record<string, string | undefined> = process.env,
): ReseedReadinessReport {
  const readiness = assessCloudSyncedReseedReadiness(env);
  return {
    checkedAt: new Date().toISOString(),
    readiness,
    summary: summarizeReseedReadiness(readiness),
  };
}

export function buildCloudSyncedReseedDryRunReport(
  env: Record<string, string | undefined> = process.env,
): ReseedDryRunReport {
  const checkedAt = new Date().toISOString();
  const readiness = assessCloudSyncedReseedReadiness(env);
  const targetHostingModel = snapshotOriginFromEnv(env).hosting_model;
  const blockedReasons = readiness.checks
    .filter((check) => !check.ok)
    .map((check) => check.detail);

  const requiredArtifacts = [
    "Fresh export snapshot from the source instance",
    "Restore dry-run results reviewed by an operator",
  ];
  if (!env.PUBLIC_APP_URL) requiredArtifacts.push("Configured PUBLIC_APP_URL");
  if (!env.VAULT_ENCRYPTION_KEY) requiredArtifacts.push("Configured VAULT_ENCRYPTION_KEY");
  if (String(env.SELF_HOST_PENDING_DIVERGENCE ?? "").toLowerCase() === "true") {
    requiredArtifacts.push("Resolved or intentionally discarded pending divergence");
  }

  let recommendedPath: ReseedDryRunReport["recommendedPath"];
  if (targetHostingModel !== "cloud-synced") {
    recommendedPath = "switch-to-cloud-synced-first";
  } else if (String(env.SELF_HOST_PENDING_DIVERGENCE ?? "").toLowerCase() === "true") {
    recommendedPath = "resolve-divergence-first";
  } else if (!env.PUBLIC_APP_URL || !env.VAULT_ENCRYPTION_KEY) {
    recommendedPath = "finish-self-host-config-first";
  } else {
    recommendedPath = "proceed-with-restore-dry-run";
  }

  const summary =
    recommendedPath === "proceed-with-restore-dry-run"
      ? "Cloud-synced reseed dry-run can proceed to restore preview."
      : recommendedPath === "resolve-divergence-first"
        ? "Cloud-synced reseed dry-run is blocked until pending divergence is resolved."
        : recommendedPath === "finish-self-host-config-first"
          ? "Cloud-synced reseed dry-run is blocked until self-host prerequisites are configured."
          : "Cloud-synced reseed dry-run is blocked until this instance is operating in cloud-synced mode.";

  return {
    checkedAt,
    ready: readiness.ready,
    targetHostingModel,
    blockedReasons,
    requiredArtifacts,
    recommendedPath,
    summary,
  };
}