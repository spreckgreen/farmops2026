// Admin-only restore (import) of a Bostead snapshot. Pairs with /admin/export.
// Works identically on Lovable-hosted and self-hosted deployments because
// every operation flows through the same authenticated server function.

import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  ShieldX,
  Upload,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import {
  importApplicationData,
  type ImportMode,
  type ImportResult,
  type Snapshot,
} from "@/lib/admin.functions";
import {
  parseRestoreSnapshotJson,
  type RestoreParseDebugInfo,
  type RestoreIntegrityStatus,
} from "@/lib/snapshot-restore";

export const Route = createFileRoute("/admin/restore")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Restore backup — Bostead Farms" }] }),
  component: RestorePage,
});

function RestorePage() {
  const profile = useCurrentProfile();
  const importFn = useServerFn(importApplicationData);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [integrity, setIntegrity] = useState<RestoreIntegrityStatus | null>(null);
  const [parseDebug, setParseDebug] = useState<RestoreParseDebugInfo | null>(null);
  const [allowMissingIntegrity, setAllowMissingIntegrity] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  const mut = useMutation({
    mutationFn: () => {
      if (!snapshot) throw new Error("Pick a backup file first.");
      if (integrity?.kind === "mismatch") {
        throw new Error(
          "Refusing to restore: snapshot integrity check failed. Re-download the file from the source.",
        );
      }
      if (integrity?.kind === "missing" && !allowMissingIntegrity) {
        throw new Error(
          "Snapshot has no integrity digest. Tick the override box to import a legacy file.",
        );
      }
      return importFn({
        data: {
          snapshot,
          mode,
          confirm: mode === "replace" ? confirmText : undefined,
          allowMissingIntegrity,
          debug: debugMode,
        },
      });

    },
    onSuccess: (r) => {
      setResult(r);
      const failed = r.results.filter((x) => x.error).length;
      if (failed === 0) {
        toast.success(`Restore complete (${r.results.length} tables, mode: ${r.mode}).`);
      } else {
        toast.error(`Restore finished with ${failed} table error(s) — see details below.`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const onPickFile = async (file: File) => {
    setFileName(file.name);
    setSnapshot(null);
    setResult(null);
    setIntegrity(null);
    setParseDebug(null);
    setAllowMissingIntegrity(false);
    try {
      const text = await file.text();
      const parsed = await parseRestoreSnapshotJson(text, {
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
      });
      if (!parsed.ok) {
        if (parsed.integrity) setIntegrity(parsed.integrity);
        if (parsed.debug) setParseDebug(parsed.debug);
        toast.error(parsed.message);
        return;
      }

      setIntegrity(parsed.integrity);
      setParseDebug(null);
      setSnapshot(parsed.snapshot);
      toast.success(
        `Loaded ${parsed.snapshot.tables.length} tables (${parsed.totalRows} rows).`,
      );
    } catch (e) {
      toast.error(`Could not parse file: ${(e as Error).message}`);
    }
  };



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
            You need the <strong>admin</strong> role to restore application data.
          </p>
        </div>
      </AppLayout>
    );
  }

  const totalRows = snapshot
    ? snapshot.tables.reduce((n, t) => n + (t.rows?.length ?? 0), 0)
    : 0;
  const replaceLocked = mode === "replace" && confirmText !== "REPLACE";

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Restore backup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Import a snapshot previously created from{" "}
            <Link to="/admin/export" className="underline">
              Export snapshot
            </Link>
            . The same file works on Lovable-hosted, Docker, and Node.js
            self-hosted deployments — restore goes through the authenticated
            server, not a database connection.
          </p>
        </header>

        <section className="space-y-2">
          <Label htmlFor="backup-file" className="text-sm font-medium">
            1. Choose a backup file (.json)
          </Label>
          <div className="flex items-center gap-2">
            <Input
              ref={fileInputRef}
              id="backup-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
          </div>
          {fileName && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FileJson className="h-3.5 w-3.5" />
              {fileName}
              {snapshot && (
                <span>
                  — {snapshot.tables.length} tables, {totalRows} rows, generated{" "}
                  {new Date(snapshot.generated_at).toLocaleString()}
                </span>
              )}
            </p>
          )}

          {integrity && (
            <div
              className={
                "rounded-md border p-3 text-xs space-y-2 " +
                (integrity.kind === "verified"
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : integrity.kind === "mismatch"
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-yellow-500/40 bg-yellow-500/5")
              }
            >
              {integrity.kind === "verified" && (
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Integrity verified ({integrity.algo} ·{" "}
                    <code className="font-mono">{integrity.value.slice(0, 16)}…</code>)
                  </span>
                </div>
              )}
              {integrity.kind === "mismatch" && (
                <>
                  <div className="flex items-center gap-2 text-destructive font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    Integrity check FAILED — refusing to restore
                  </div>
                  <div className="text-muted-foreground">{integrity.reason}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    expected {integrity.expected.slice(0, 24)}…
                    <br />
                    actual&nbsp;&nbsp; {integrity.actual.slice(0, 24)}…
                  </div>
                  <div>
                    Re-download the file from the source and try again. Do not
                    edit snapshot files by hand.
                  </div>
                </>
              )}
              {integrity.kind === "missing" && (
                <>
                  <div className="flex items-center gap-2 text-yellow-700">
                    <AlertTriangle className="h-4 w-4" />
                    No integrity digest in this snapshot (legacy export)
                  </div>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={allowMissingIntegrity}
                      onCheckedChange={(v) => setAllowMissingIntegrity(v === true)}
                    />
                    <span>
                      Import anyway — I trust this file and accept that
                      tampering or truncation cannot be detected.
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          {parseDebug && debugMode && (
            <details className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs" open>
              <summary className="cursor-pointer font-medium text-destructive">
                JSON parse debug — no restore request was sent
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="font-semibold">Failing request</div>
                  <pre className="overflow-x-auto rounded bg-background p-2 font-mono">
{JSON.stringify(parseDebug.request, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="font-semibold">Parser error</div>
                  <pre className="overflow-x-auto rounded bg-background p-2 font-mono">
{JSON.stringify(parseDebug.parser, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="font-semibold">File diagnostics</div>
                  <pre className="overflow-x-auto rounded bg-background p-2 font-mono">
{JSON.stringify({ file: parseDebug.file, diagnostics: parseDebug.diagnostics }, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          )}
        </section>



        <section className="space-y-3">
          <Label className="text-sm font-medium">2. Pick a restore mode</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              setMode(v as ImportMode);
              setConfirmText("");
            }}
            className="space-y-2"
          >
            <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
              <RadioGroupItem value="merge" className="mt-1" />
              <div className="text-sm">
                <div className="font-medium">Merge (safe)</div>
                <div className="text-muted-foreground text-xs">
                  Upsert each row by primary key. Never deletes. Existing rows
                  not present in the backup are kept.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
              <RadioGroupItem value="replace" className="mt-1" />
              <div className="text-sm">
                <div className="font-medium text-destructive">
                  Replace (destructive)
                </div>
                <div className="text-muted-foreground text-xs">
                  Delete every row in every operational table first, then
                  insert from the backup. Use only when migrating into an empty
                  instance.
                </div>
              </div>
            </label>
          </RadioGroup>

          {mode === "replace" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Type <code className="font-mono bg-background px-1 rounded">REPLACE</code> to enable the restore button.
              </div>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="REPLACE"
              />
            </div>
          )}
        </section>

        <section className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={debugMode}
              onCheckedChange={(v) => setDebugMode(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Debug mode</span>
              <span className="block text-xs text-muted-foreground">
                On the first failing chunk per table, capture the PostgREST error
                (code, details, hint), a sample row, and live RLS / grant
                diagnostics for that table.
              </span>
            </span>
          </label>

          <Button
            onClick={() => mut.mutate()}
            disabled={
              !snapshot ||
              mut.isPending ||
              replaceLocked ||
              integrity?.kind === "mismatch" ||
              (integrity?.kind === "missing" && !allowMissingIntegrity)
            }
          >
            <Upload className="h-4 w-4 mr-2" />
            {mut.isPending ? "Restoring…" : `Restore (${mode}${debugMode ? " · debug" : ""})`}
          </Button>
        </section>


        {result && (
          <section
            className={
              "rounded-lg border p-4 " +
              (result.ok
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-destructive/40 bg-destructive/5")
            }
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              {result.ok ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              {result.ok ? "Restore complete" : "Restore finished with errors"}
              <span className="text-xs text-muted-foreground font-normal ml-2">
                ({result.mode} · {result.results.length} tables ·{" "}
                {new Date(result.finished_at).toLocaleTimeString()})
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Table</th>
                    <th className="py-1 pr-3 text-right">Attempted</th>
                    <th className="py-1 pr-3 text-right">Restored</th>
                    {result.mode === "replace" && (
                      <th className="py-1 pr-3 text-right">Deleted first</th>
                    )}
                    <th className="py-1">Error</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.results.map((r) => (
                    <tr key={r.table} className="border-t">
                      <td className="py-1 pr-3">{r.table}</td>
                      <td className="py-1 pr-3 text-right">{r.attempted}</td>
                      <td className="py-1 pr-3 text-right">{r.succeeded}</td>
                      {result.mode === "replace" && (
                        <td className="py-1 pr-3 text-right">{r.deleted}</td>
                      )}
                      <td className="py-1 text-destructive">
                        {r.error ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.results.some((r) => r.debug) && (
              <div className="mt-4 space-y-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Debug diagnostics
                </div>
                {result.results
                  .filter((r) => r.debug)
                  .map((r) => (
                    <details
                      key={`debug-${r.table}`}
                      className="rounded border bg-background p-3 text-xs"
                      open
                    >
                      <summary className="cursor-pointer font-mono font-medium">
                        {r.table} — {r.debug!.stage}
                        {r.debug!.chunkIndex !== undefined
                          ? ` · chunk ${r.debug!.chunkIndex} (${r.debug!.chunkSize} rows)`
                          : ""}
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div>
                          <div className="font-semibold">PostgREST error</div>
                          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono">
{JSON.stringify(r.debug!.postgrest, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="font-semibold">
                            RLS / grants for {r.table}
                          </div>
                          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono">
{JSON.stringify(r.debug!.diagnostics, null, 2)}
                          </pre>
                        </div>
                        {r.debug!.sampleRowJson && (
                          <div>
                            <div className="font-semibold">
                              Sample row (first in failing chunk)
                            </div>
                            <pre className="overflow-x-auto rounded bg-muted p-2 font-mono">
{(() => {
  try {
    return JSON.stringify(JSON.parse(r.debug!.sampleRowJson!), null, 2);
  } catch {
    return r.debug!.sampleRowJson;
  }
})()}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
              </div>
            )}
          </section>

        )}
      </div>
    </AppLayout>
  );
}
