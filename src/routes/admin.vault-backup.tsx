// Admin-only vault backup/restore UI.
//
// Exports encrypted rows as-is (ciphertext + IV + tag). The backup is safe
// to store next to app snapshots — plaintext never leaves the server and the
// file is useless without VAULT_ENCRYPTION_KEY on the target instance.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Upload,
  KeyRound,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  exportVaultBackup,
  importVaultBackup,
  type VaultBackup,
  type VaultImportMode,
  type VaultImportResult,
} from "@/lib/vault-backup.functions";

export const Route = createFileRoute("/admin/vault-backup")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Vault backup & restore — Bostead" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VaultBackupPage,
});

function VaultBackupPage() {
  const exportFn = useServerFn(exportVaultBackup);
  const importFn = useServerFn(importVaultBackup);

  const [backup, setBackup] = useState<VaultBackup | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<VaultImportMode>("merge");
  const [rewriteOwnership, setRewriteOwnership] = useState(true);
  const [preview, setPreview] = useState<VaultImportResult | null>(null);
  const [result, setResult] = useState<VaultImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportMutation = useMutation({
    mutationFn: async () => await exportFn(),
    onSuccess: (data: VaultBackup) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `bostead-vault-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.count} vault entries`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      if (!backup) throw new Error("Pick a backup file first");
      return await importFn({
        data: { backup, mode, rewriteOwnership, dryRun: true },
      });
    },
    onSuccess: (r: VaultImportResult) => {
      setPreview(r);
      toast.success("Dry-run complete");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!backup) throw new Error("Pick a backup file first");
      return await importFn({
        data: { backup, mode, rewriteOwnership, dryRun: false },
      });
    },
    onSuccess: (r: VaultImportResult) => {
      setResult(r);
      const ok = r.errors.length === 0;
      (ok ? toast.success : toast.error)(
        `Restore ${ok ? "complete" : "finished with errors"}: +${r.inserted} inserted, ${r.updated} updated${r.deleted ? `, ${r.deleted} deleted` : ""}`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as VaultBackup;
      if (
        parsed?.app !== "bostead" ||
        parsed?.kind !== "vault" ||
        parsed?.version !== 1
      ) {
        throw new Error("Not a Bostead vault backup (v1).");
      }
      setBackup(parsed);
      toast.success(`Loaded ${parsed.count ?? parsed.rows?.length ?? 0} entries`);
    } catch (err) {
      setBackup(null);
      toast.error(err instanceof Error ? err.message : "Failed to parse file");
    }
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Admin
            </Link>
          </Button>
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="h-6 w-6" /> Vault backup & restore
          </h1>
          <p className="text-sm text-muted-foreground">
            The secrets vault is not part of the main snapshot. Back it up
            separately — the export contains only ciphertext and is useless
            without <code>VAULT_ENCRYPTION_KEY</code>.
          </p>
        </header>

        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Keep the encryption key with the backup plan, not the file.</p>
              <p className="text-muted-foreground">
                Restoring into a new instance requires the exact same
                <code className="mx-1">VAULT_ENCRYPTION_KEY</code> that produced the
                ciphertext (or that key wired up as
                <code className="mx-1">VAULT_ENCRYPTION_KEY_OLD</code> during rotation).
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" /> Export
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Downloads a JSON file with every vault row (personal + shared)
              exactly as stored — ciphertext, IV, auth tag, and key version.
            </p>
            <Button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              {exportMutation.isPending ? "Exporting…" : "Download vault backup"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> Restore
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vault-file">Backup file</Label>
              <input
                ref={fileRef}
                id="vault-file"
                type="file"
                accept="application/json,.json"
                onChange={onFileChange}
                className="block text-sm"
              />
              {fileName && backup && (
                <p className="text-xs text-muted-foreground">
                  {fileName} — {backup.rows.length} entries, generated{" "}
                  {new Date(backup.generated_at).toLocaleString()}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as VaultImportMode)}
                className="space-y-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="merge" id="mode-merge" className="mt-1" />
                  <Label htmlFor="mode-merge" className="font-normal">
                    <span className="font-medium">Merge</span> — upsert by id.
                    Existing rows are updated, new rows inserted, nothing
                    deleted.
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="replace" id="mode-replace" className="mt-1" />
                  <Label htmlFor="mode-replace" className="font-normal">
                    <span className="font-medium">Replace</span> — wipe the
                    vault first, then insert every row from the backup.
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="rewrite-ownership"
                checked={rewriteOwnership}
                onCheckedChange={(v) => setRewriteOwnership(v === true)}
              />
              <Label htmlFor="rewrite-ownership" className="font-normal">
                Rewrite ownership to me — remap personal secrets and
                <code className="mx-1">created_by</code> to my user id. Required
                when restoring into a fresh database with different
                <code className="mx-1">auth.users</code> UUIDs.
              </Label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => dryRunMutation.mutate()}
                disabled={!backup || dryRunMutation.isPending}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {dryRunMutation.isPending ? "Checking…" : "Dry-run"}
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={!backup || applyMutation.isPending}
              >
                <Upload className="h-4 w-4 mr-2" />
                {applyMutation.isPending ? "Restoring…" : "Apply restore"}
              </Button>
            </div>

            {preview && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">Dry-run projection</p>
                <p>Will insert: {preview.inserted}</p>
                <p>Will update: {preview.updated}</p>
                {mode === "replace" && <p>Will delete first: {preview.deleted}</p>}
                {preview.errors.length > 0 && (
                  <p className="text-destructive">
                    {preview.errors.length} lookup error(s)
                  </p>
                )}
              </div>
            )}

            {result && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">Result</p>
                <p>Inserted: {result.inserted}</p>
                <p>Updated: {result.updated}</p>
                {result.deleted > 0 && <p>Deleted: {result.deleted}</p>}
                {result.skipped > 0 && <p>Skipped: {result.skipped}</p>}
                {result.errors.length > 0 && (
                  <div className="text-destructive">
                    <p>Errors:</p>
                    <ul className="list-disc pl-4">
                      {result.errors.map((e, i) => (
                        <li key={i}>{e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
