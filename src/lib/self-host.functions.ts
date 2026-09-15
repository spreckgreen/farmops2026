import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  executeImportApplicationData,
  type ImportResult,
  type Snapshot,
} from "@/lib/admin.functions";
import {
  assessCloudSyncedReseedReadiness,
  buildCloudSyncedReseedDryRunReport,
  buildReseedReadinessReport,
  type ReseedReadiness,
  type ReseedDryRunReport,
  type ReseedReadinessReport,
} from "@/lib/reseed-readiness";
import {
  hostingModelLabel,
  snapshotOriginFromEnv,
  type SnapshotHostingModel,
} from "@/lib/snapshot-hosting";

export interface SelfHostConfig {
  /** True when SELF_HOST_MODE=true — hides Lovable-hosted-only UI. */
  selfHostMode: boolean;
  /** Which hosting model this runtime currently presents as. */
  hostingModel: SnapshotHostingModel;
  hostingModelLabel: string;
  pendingDivergence: boolean;
  reseedWorkflowAvailable: boolean;
  reseedWorkflowHint: string;
  reseedReadiness: ReseedReadiness;
  /** Whether a legacy environment-based custom provider is configured. */
  aiProvider: "custom" | "none";
  hasCustomAi: boolean;
  /** Custom base URL (safe: operator-configured, no secret). */
  customAiBaseUrl: string | null;
  /** Custom model override, if set. */
  customAiModel: string | null;
  /** Origin used for outbound webhook callback URLs. */
  publicAppUrl: string | null;
  webhookOrigin: string;
  /** Human-friendly configuration status. */
  aiFallbackNote: string;
}

export const getSelfHostConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<SelfHostConfig> => {
    const selfHostMode =
      String(process.env.SELF_HOST_MODE ?? "").toLowerCase() === "true";
    const origin = snapshotOriginFromEnv();
    const customBase = process.env.CUSTOM_AI_BASE_URL || null;
    const customKey = Boolean(process.env.CUSTOM_AI_API_KEY);
    const hasCustomAi = Boolean(customBase) && customKey;

    const aiProvider: "custom" | "none" = hasCustomAi ? "custom" : "none";

    const publicAppUrl = process.env.PUBLIC_APP_URL || null;
    const webhookOrigin = publicAppUrl || "https://bostead.lovable.app";
    const reseedReadiness = assessCloudSyncedReseedReadiness();

    const aiFallbackNote =
      aiProvider === "none"
        ? "AI-powered features (weekly/monthly report generation, task summary drafts, and Southern Ohio price refresh) are disabled. Buttons remain visible but are non-functional until AI credentials are configured."
        : aiProvider === "custom"
          ? `AI calls are routed to your custom endpoint (${customBase}). Model defaults still apply unless CUSTOM_AI_MODEL is set.`
          : "AI calls use the configured custom endpoint.";

    return {
      selfHostMode,
      hostingModel: origin.hosting_model,
      hostingModelLabel: hostingModelLabel(origin.hosting_model),
      pendingDivergence: origin.pending_divergence,
      reseedWorkflowAvailable: origin.hosting_model === "cloud-synced",
      reseedWorkflowHint:
        origin.hosting_model === "cloud-synced"
          ? "Dedicated cloud-synced reseed is available with explicit dry-run and apply steps. Use it instead of generic replace restores when reseeding from another instance."
          : "Dedicated cloud-synced reseed is only available after this instance is switched to cloud-synced mode.",
      reseedReadiness,
      aiProvider,
      hasCustomAi,
      customAiBaseUrl: customBase,
      customAiModel: process.env.CUSTOM_AI_MODEL || null,
      publicAppUrl,
      webhookOrigin,
      aiFallbackNote,
    };
  },
);

export const runReseedReadinessCheck = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReseedReadinessReport> => buildReseedReadinessReport(),
);

export const runCloudSyncedReseedDryRun = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReseedDryRunReport> => buildCloudSyncedReseedDryRunReport(),
);

export type CloudSyncedReseedRunMode = "dry-run" | "apply";

export type CloudSyncedReseedWorkflowInput = {
  snapshot: Snapshot;
  mode?: CloudSyncedReseedRunMode;
  confirm?: string;
  debug?: boolean;
  allowMissingIntegrity?: boolean;
};

export type NormalizedCloudSyncedReseedWorkflowInput = {
  snapshot: Snapshot;
  mode: CloudSyncedReseedRunMode;
  confirm?: string;
  debug: boolean;
  allowMissingIntegrity: boolean;
};

export type CloudSyncedReseedResult = {
  workflow: "cloud-synced-reseed";
  mode: CloudSyncedReseedRunMode;
  readiness: ReseedReadinessReport;
  importResult: ImportResult;
};

export function normalizeCloudSyncedReseedWorkflowInput(
  d: CloudSyncedReseedWorkflowInput,
): NormalizedCloudSyncedReseedWorkflowInput {
  if (!d || typeof d !== "object") throw new Error("Invalid reseed payload");
  if (!d.snapshot || d.snapshot.app !== "bostead") {
    throw new Error('Not a Bostead snapshot (missing app: "bostead")');
  }
  if (d.snapshot.version !== 1) {
    throw new Error(`Unsupported snapshot version: ${d.snapshot.version}`);
  }

  return {
    snapshot: d.snapshot,
    mode: d.mode === "apply" ? "apply" : "dry-run",
    confirm: d.confirm,
    debug: d.debug === true,
    allowMissingIntegrity: d.allowMissingIntegrity === true,
  };
}

export function assertCloudSyncedReseedPreconditions(args: {
  readiness: ReseedReadinessReport;
  mode: CloudSyncedReseedRunMode;
  confirm?: string;
}): void {
  if (!args.readiness.readiness.ready) {
    throw new Error(`Cloud-synced reseed is blocked: ${args.readiness.summary}`);
  }
  if (args.mode === "apply" && args.confirm !== "RESEED") {
    throw new Error('Apply mode requires confirm="RESEED".');
  }
}

export const runCloudSyncedReseedWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: CloudSyncedReseedWorkflowInput) =>
    normalizeCloudSyncedReseedWorkflowInput(d),
  )
  .handler(async ({ context, data }): Promise<CloudSyncedReseedResult> => {
    const readiness = buildReseedReadinessReport();
    const mode = data.mode;
    assertCloudSyncedReseedPreconditions({
      readiness,
      mode,
      confirm: data.confirm,
    });

    const importResult = await executeImportApplicationData({
      context,
      data: {
        snapshot: data.snapshot,
        mode: "replace",
        // The generic restore executor requires REPLACE for destructive runs.
        confirm: mode === "apply" ? "REPLACE" : undefined,
        allowMissingIntegrity: data.allowMissingIntegrity,
        debug: data.debug,
        dryRun: mode !== "apply",
        // Reseed always remaps ownership to the signed-in operator account.
        rewriteOwnership: true,
      },
    });

    return {
      workflow: "cloud-synced-reseed",
      mode,
      readiness,
      importResult,
    };
  });
