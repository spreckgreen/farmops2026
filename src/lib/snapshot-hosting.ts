export type SnapshotHostingModel = "isolated" | "cloud-only" | "cloud-synced";

export type SnapshotOrigin = {
  hosting_model: SnapshotHostingModel;
  self_host_mode: boolean;
  pending_divergence: boolean;
  public_app_url: string | null;
  exported_from: string;
  intended_uses: Array<"backup" | "migration">;
};

export type ImportWarning = {
  code:
    | "legacy-origin-metadata-missing"
    | "cross-model-import"
    | "pending-divergence"
    | "rewrite-ownership-disabled-cross-model"
    | "replace-into-cloud-synced";
  severity: "info" | "warning" | "blocking";
  message: string;
};

export type RestoreWorkflowPath =
  | "routine-backup-restore"
  | "cross-model-migration-restore"
  | "cloud-synced-reseed";

export function snapshotOriginFromEnv(
  env: Record<string, string | undefined> = process.env,
): SnapshotOrigin {
  const selfHostMode = String(env.SELF_HOST_MODE ?? "").toLowerCase() === "true";
  const syncMode = String(env.SELF_HOST_SYNC_MODE ?? "").toLowerCase() === "true";
  const pendingDivergence =
    String(env.SELF_HOST_PENDING_DIVERGENCE ?? "").toLowerCase() === "true";
  const publicAppUrl = env.PUBLIC_APP_URL?.trim() || null;
  const hostingModel: SnapshotHostingModel = selfHostMode
    ? syncMode
      ? "cloud-synced"
      : "isolated"
    : "cloud-only";

  return {
    hosting_model: hostingModel,
    self_host_mode: selfHostMode,
    pending_divergence: pendingDivergence,
    public_app_url: publicAppUrl,
    exported_from: publicAppUrl ?? hostingModel,
    intended_uses: ["backup", "migration"],
  };
}

export function hostingModelLabel(value: SnapshotHostingModel): string {
  switch (value) {
    case "isolated":
      return "Isolated self-host";
    case "cloud-synced":
      return "Cloud-synced";
    case "cloud-only":
    default:
      return "Cloud-only";
  }
}

export function evaluateSnapshotImportWarnings(input: {
  snapshotOrigin?: SnapshotOrigin;
  targetOrigin: SnapshotOrigin;
  mode: "merge" | "replace";
  rewriteOwnership: boolean;
}): ImportWarning[] {
  const { snapshotOrigin, targetOrigin, mode, rewriteOwnership } = input;
  const warnings: ImportWarning[] = [];

  if (!snapshotOrigin) {
    warnings.push({
      code: "legacy-origin-metadata-missing",
      severity: "info",
      message:
        "This snapshot has no hosting-model metadata. Treat it as a legacy file and review the dry-run carefully before using it for migration.",
    });
    return warnings;
  }

  if (snapshotOrigin.hosting_model !== targetOrigin.hosting_model) {
    warnings.push({
      code: "cross-model-import",
      severity: "warning",
      message:
        `This snapshot was exported from ${hostingModelLabel(snapshotOrigin.hosting_model).toLowerCase()} and is being imported into ${hostingModelLabel(targetOrigin.hosting_model).toLowerCase()}. ` +
        "Review compatibility, ownership rewrite, and dry-run output as migration evidence, not only as a routine restore.",
    });
  }

  if (snapshotOrigin.pending_divergence) {
    warnings.push({
      code: "pending-divergence",
      severity: mode === "replace" ? "blocking" : "warning",
      message:
        mode === "replace"
          ? "The snapshot reports pending local/cloud divergence at export time. Replace mode is blocked until divergence is reconciled or an operator intentionally reseeds from a cleaner snapshot."
          : "The snapshot reports pending local/cloud divergence at export time. Confirm that the missing side's edits are either reconciled or intentionally abandoned before apply.",
    });
  }

  if (!rewriteOwnership && snapshotOrigin.hosting_model !== targetOrigin.hosting_model) {
    warnings.push({
      code: "rewrite-ownership-disabled-cross-model",
      severity: "warning",
      message:
        "Ownership rewrite is disabled during a cross-model import. This is likely to fail when user IDs differ between environments.",
    });
  }

  if (mode === "replace" && targetOrigin.hosting_model === "cloud-synced") {
    warnings.push({
      code: "replace-into-cloud-synced",
      severity: "blocking",
      message:
        "Replace mode into a cloud-synced instance is blocked because it can invalidate pending sync assumptions. Reseed through an explicit cloud-synced recovery workflow instead.",
    });
  }

  return warnings;
}

export function classifyRestoreWorkflowPath(input: {
  snapshotOrigin?: SnapshotOrigin;
  targetOrigin: SnapshotOrigin;
  mode: "merge" | "replace";
}): RestoreWorkflowPath {
  const { snapshotOrigin, targetOrigin, mode } = input;
  if (mode === "replace" && targetOrigin.hosting_model === "cloud-synced") {
    return "cloud-synced-reseed";
  }
  if (snapshotOrigin && snapshotOrigin.hosting_model !== targetOrigin.hosting_model) {
    return "cross-model-migration-restore";
  }
  return "routine-backup-restore";
}

export function restoreWorkflowPathLabel(path: RestoreWorkflowPath): string {
  switch (path) {
    case "cloud-synced-reseed":
      return "Cloud-synced reseed";
    case "cross-model-migration-restore":
      return "Cross-model migration import";
    case "routine-backup-restore":
    default:
      return "Routine backup restore";
  }
}

export function allowReplaceInGenericRestore(targetOrigin: SnapshotOrigin): boolean {
  return targetOrigin.hosting_model !== "cloud-synced";
}

export function importWarningsRequireAcknowledgement(warnings: ImportWarning[]): boolean {
  return warnings.some((warning) => warning.severity === "warning");
}

export function importWarningsBlockApply(warnings: ImportWarning[]): boolean {
  return warnings.some((warning) => warning.severity === "blocking");
}

export function importWarningRemediation(code: ImportWarning["code"]): string {
  switch (code) {
    case "legacy-origin-metadata-missing":
      return "Prefer a freshly exported snapshot with hosting metadata before using this file for migration.";
    case "cross-model-import":
      return "Use dry-run results as migration evidence and keep ownership rewrite enabled unless you are restoring into the same account identity.";
    case "pending-divergence":
      return "Resolve or intentionally discard outstanding local/cloud differences, then export a cleaner snapshot before applying replace mode.";
    case "rewrite-ownership-disabled-cross-model":
      return "Turn ownership rewrite back on unless you have already confirmed identical user IDs on both sides.";
    case "replace-into-cloud-synced":
      return "Switch to merge mode or use a dedicated cloud-synced reseed workflow instead of a generic replace restore.";
    default:
      return "Review migration compatibility and operator guidance before applying this restore.";
  }
}