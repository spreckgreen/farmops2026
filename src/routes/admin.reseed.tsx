import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  ShieldX,
  Upload,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import {
  runCloudSyncedReseedWorkflow,
  type CloudSyncedReseedResult,
} from "@/lib/self-host.functions";
import {
  classifyRestoreWorkflowPath,
  hostingModelLabel,
  restoreWorkflowPathLabel,
  snapshotOriginFromEnv,
} from "@/lib/snapshot-hosting";
import {
  parseRestoreSnapshotJson,
  type RestoreIntegrityStatus,
} from "@/lib/snapshot-restore";
import { type Snapshot } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/reseed")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Cloud-synced reseed — Bostead Farms" }] }),
  component: CloudSyncedReseedPage,
});

function CloudSyncedReseedPage() {
  const profile = useCurrentProfile();
  const reseedFn = useServerFn(runCloudSyncedReseedWorkflow);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<RestoreIntegrityStatus | null>(null);
  const [allowMissingIntegrity, setAllowMissingIntegrity] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [ackDestructiveApply, setAckDestructiveApply] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const dryRunMut = useMutation({
    mutationFn: async () => {
      if (!snapshot) throw new Error("Pick a backup file first.");
      return reseedFn({
        data: {
          snapshot,
          mode: "dry-run",
          debug: debugMode,
          allowMissingIntegrity,
        },
      });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      if (!snapshot) throw new Error("Pick a backup file first.");
      return reseedFn({
        data: {
          snapshot,
          mode: "apply",
          confirm: "RESEED",
          debug: debugMode,
          allowMissingIntegrity,
        },
      });
    },
    onSuccess: (result) => {
      const failures = result.importResult.results.filter((row) => row.error).length;
      if (failures === 0) {
        toast.success("Cloud-synced reseed completed.");
      } else {
        toast.error(`Reseed finished with ${failures} table error(s). Review details below.`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const onPickFile = async (file: File) => {
    setFileName(file.name);
    setSnapshot(null);
    setIntegrity(null);
    setAllowMissingIntegrity(false);
    setConfirmText("");
    setAckDestructiveApply(false);
    dryRunMut.reset();
    applyMut.reset();
    try {
      const text = await file.text();
      const parsed = await parseRestoreSnapshotJson(text, {
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
      });
      if (!parsed.ok) {
        if (parsed.integrity) setIntegrity(parsed.integrity);
        toast.error(parsed.message);
        return;
      }
      setIntegrity(parsed.integrity);
      setSnapshot(parsed.snapshot);
      toast.success(`Loaded ${parsed.snapshot.tables.length} tables (${parsed.totalRows} rows).`);
    } catch (e) {
      toast.error(`Could not parse file: ${(e as Error).message}`);
    }
  };

  const totalRows = useMemo(
    () => (snapshot ? snapshot.tables.reduce((acc, table) => acc + (table.rows?.length ?? 0), 0) : 0),
    [snapshot],
  );
  const targetOrigin = snapshotOriginFromEnv();
  const reseedPath = classifyRestoreWorkflowPath({
    snapshotOrigin: snapshot?.origin,
    targetOrigin,
    mode: "replace",
  });
  const cloudSyncedTarget = targetOrigin.hosting_model === "cloud-synced";

  const preview = dryRunMut.data;
  const applyResult = applyMut.data;
  const activeResult = applyResult ?? preview;

  const integrityBlocked =
    integrity?.kind === "mismatch" ||
    (integrity?.kind === "missing" && !allowMissingIntegrity);
  const readyForDryRun = Boolean(snapshot) && !integrityBlocked && cloudSyncedTarget;
  const readyForApply =
    Boolean(preview) &&
    confirmText === "RESEED" &&
    ackDestructiveApply &&
    cloudSyncedTarget &&
    !applyMut.isPending;

  if (profile.isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-muted-foreground">
          Loading…
        </div>
      </AppLayout>
    );
  }

  if (!profile.data?.isAdmin) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-3">
          <ShieldX className="h-10 w-10 mx-auto text-destructive" />
          <h1 className="text-xl font-semibold">Admins only</h1>
          <p className="text-sm text-muted-foreground">
            You need the admin role to run cloud-synced reseed workflows.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <DatabaseBackup className="h-6 w-6" />
            Cloud-synced reseed
          </h1>
          <p className="text-sm text-muted-foreground">
            Dedicated destructive reseed path for cloud-synced instances. This workflow always uses replace mode and ownership rewrite to the currently signed-in operator.
          </p>
          <p className="text-sm text-muted-foreground">
            For routine backups or cross-model migration review, use <Link to="/admin/restore" className="underline">Restore backup</Link> instead.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workflow path</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-medium flex items-center gap-2">
                Path
                <Badge variant={cloudSyncedTarget ? "secondary" : "destructive"}>
                  {restoreWorkflowPathLabel(reseedPath)}
                </Badge>
              </div>
              <div className="text-muted-foreground">
                Target hosting mode: <strong>{hostingModelLabel(targetOrigin.hosting_model)}</strong>
              </div>
              {cloudSyncedTarget ? (
                <div className="text-muted-foreground">
                  This instance is in cloud-synced mode, so reseed dry-run and apply are available.
                </div>
              ) : (
                <div className="text-destructive">
                  This instance is not cloud-synced. Reseed dry-run and apply are disabled until hosting mode is switched. Configure mode in <Link to="/settings/self-host" className="underline">Self-host settings</Link>.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Label htmlFor="reseed-file">Snapshot file (.json)</Label>
            <Input
              id="reseed-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPickFile(file);
              }}
            />
            {fileName && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Upload className="h-3.5 w-3.5" />
                <span>{fileName}</span>
                {snapshot && (
                  <span>
                    {snapshot.tables.length} tables, {totalRows} rows
                  </span>
                )}
              </div>
            )}

            {integrity?.kind === "ok" && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700">
                Snapshot integrity verified.
              </div>
            )}

            {integrity?.kind === "missing" && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 space-y-2">
                <div>This snapshot has no integrity digest. Prefer a fresh export before reseed.</div>
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={allowMissingIntegrity}
                    onCheckedChange={(value) => setAllowMissingIntegrity(value === true)}
                    className="mt-0.5"
                  />
                  <span>Allow missing integrity for this reseed workflow.</span>
                </label>
              </div>
            )}

            {integrity?.kind === "mismatch" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                Snapshot integrity mismatch detected. Reseed is blocked for this file.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Dry-run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Dry-run enforces cloud-synced readiness first, then previews exactly what replace-mode reseed would delete and write.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={debugMode}
                onCheckedChange={(value) => setDebugMode(value === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Debug mode</span>
                <span className="block text-xs text-muted-foreground">
                  Includes first-failure diagnostics for table operations.
                </span>
              </span>
            </label>

            <Button
              onClick={() => dryRunMut.mutate()}
              disabled={!readyForDryRun || dryRunMut.isPending}
            >
              {dryRunMut.isPending
                ? "Running dry-run…"
                : cloudSyncedTarget
                  ? "Run reseed dry-run"
                  : "Cloud-synced mode required"}
            </Button>

            {preview && (
              <ResultSummary result={preview} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Apply reseed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This applies destructive replace-mode reseed after readiness passes. Type RESEED to unlock the button.
            </p>
            <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <Checkbox
                checked={ackDestructiveApply}
                onCheckedChange={(value) => setAckDestructiveApply(value === true)}
                className="mt-0.5"
              />
              <span>
                I understand this operation deletes current operational rows before reseeding and should only be used for intentional cloud-synced recovery.
              </span>
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESEED"
            />
            <Button
              variant="destructive"
              onClick={() => applyMut.mutate()}
              disabled={!readyForApply}
            >
              {applyMut.isPending
                ? "Applying reseed…"
                : cloudSyncedTarget
                  ? "Apply cloud-synced reseed"
                  : "Cloud-synced mode required"}
            </Button>
            {applyResult && <ResultSummary result={applyResult} />}
          </CardContent>
        </Card>

        {activeResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Table details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {activeResult.importResult.results.map((row) => (
                  <div key={row.table} className="rounded-md border p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono">{row.table}</div>
                      {row.error ? (
                        <Badge variant="destructive">error</Badge>
                      ) : (
                        <Badge variant="secondary">ok</Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      attempted {row.attempted} · wrote {row.succeeded} · deleted {row.deleted}
                    </div>
                    {row.error && (
                      <div className="text-destructive flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{row.error}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function ResultSummary({ result }: { result: CloudSyncedReseedResult }) {
  const failed = result.importResult.results.filter((row) => row.error).length;
  const ok = failed === 0;
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
      <div className="font-medium flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        )}
        {result.mode === "apply" ? "Apply result" : "Dry-run result"}
      </div>
      <div className="text-muted-foreground">{result.readiness.summary}</div>
      <div className="text-muted-foreground">
        Completed with {failed} table error(s) across {result.importResult.results.length} tables.
      </div>
    </div>
  );
}
