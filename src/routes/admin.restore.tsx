// Admin-only guided restore wizard for Bostead snapshots.
//
// Steps: 1) pick file & verify integrity → 2) choose merge/replace + ownership
// → 3) dry-run preview → 4) confirm & run → 5) results.
//
// Ownership: rows are always re-scoped to the CURRENT signed-in admin (derived
// from the bearer token on the server). This UI only toggles whether that
// rewrite happens; it can never target a different user.

import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileJson,
  ShieldX,
  Upload,
  UserCheck,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
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

type Step = 1 | 2 | 3 | 4 | 5;

function RestorePage() {
  const profile = useCurrentProfile();
  const importFn = useServerFn(importApplicationData);

  const [step, setStep] = useState<Step>(1);

  // Step 1 — file
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<RestoreIntegrityStatus | null>(null);
  const [parseDebug, setParseDebug] = useState<RestoreParseDebugInfo | null>(null);
  const [allowMissingIntegrity, setAllowMissingIntegrity] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — options
  const [mode, setMode] = useState<ImportMode>("merge");
  const [rewriteOwnership, setRewriteOwnership] = useState(true);
  const [debugMode, setDebugMode] = useState(false);

  // Step 3 — dry-run preview
  const [preview, setPreview] = useState<ImportResult | null>(null);

  // Step 4 — apply
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const dryRunMut = useMutation({
    mutationFn: async () => {
      if (!snapshot) throw new Error("Pick a backup file first.");
      return importFn({
        data: {
          snapshot,
          mode,
          allowMissingIntegrity,
          debug: debugMode,
          dryRun: true,
          rewriteOwnership,
        },
      });
    },
    onSuccess: (r) => {
      setPreview(r);
      setStep(4);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      if (!snapshot) throw new Error("Pick a backup file first.");
      return importFn({
        data: {
          snapshot,
          mode,
          confirm: mode === "replace" ? confirmText : undefined,
          allowMissingIntegrity,
          debug: debugMode,
          dryRun: false,
          rewriteOwnership,
        },
      });
    },
    onSuccess: (r) => {
      setResult(r);
      setStep(5);
      const failed = r.results.filter((x) => x.error).length;
      if (failed === 0) {
        toast.success(`Restore complete (${r.results.length} tables).`);
      } else {
        toast.error(`Restore finished with ${failed} error(s) — see details below.`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const onPickFile = async (file: File) => {
    setFileName(file.name);
    setSnapshot(null);
    setPreview(null);
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
      setSnapshot(parsed.snapshot);
      toast.success(
        `Loaded ${parsed.snapshot.tables.length} tables (${parsed.totalRows} rows).`,
      );
    } catch (e) {
      toast.error(`Could not parse file: ${(e as Error).message}`);
    }
  };

  const totalRows = useMemo(
    () => (snapshot ? snapshot.tables.reduce((n, t) => n + (t.rows?.length ?? 0), 0) : 0),
    [snapshot],
  );

  const integrityBlocked =
    integrity?.kind === "mismatch" ||
    (integrity?.kind === "missing" && !allowMissingIntegrity);
  const canLeaveStep1 = !!snapshot && !integrityBlocked;
  const replaceLocked = mode === "replace" && confirmText !== "REPLACE";

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

  const meLabel = profile.data.email ?? profile.data.display_name ?? "you";

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Restore backup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Guided wizard for restoring a snapshot from{" "}
            <Link to="/admin/export" className="underline">
              Export snapshot
            </Link>
            . Every step is safe until you click <strong>Apply restore</strong> in step 4.
          </p>
        </header>

        <Stepper current={step} />

        {/* -------------------------------- STEP 1 -------------------------------- */}
        {step === 1 && (
          <StepCard title="Step 1 — Choose backup & verify">
            <div className="space-y-2">
              <Label htmlFor="backup-file">Backup file (.json)</Label>
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
            </div>

            {integrity && <IntegrityPanel
              integrity={integrity}
              allowMissingIntegrity={allowMissingIntegrity}
              setAllowMissingIntegrity={setAllowMissingIntegrity}
            />}

            {parseDebug && (
              <details className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-destructive">
                  JSON parse debug
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-background p-2 font-mono">
{JSON.stringify(parseDebug, null, 2)}
                </pre>
              </details>
            )}

            <WizardNav
              onNext={() => setStep(2)}
              nextDisabled={!canLeaveStep1}
              nextLabel="Continue"
            />
          </StepCard>
        )}

        {/* -------------------------------- STEP 2 -------------------------------- */}
        {step === 2 && (
          <StepCard title="Step 2 — Choose restore mode & ownership">
            <div className="space-y-3">
              <Label>Restore mode</Label>
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
                    <div className="font-medium">Merge (safe, recommended)</div>
                    <div className="text-muted-foreground text-xs">
                      Upsert each row by primary key. Never deletes. Existing rows
                      not in the backup are kept as-is.
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
            </div>

            <div className="space-y-2 pt-2">
              <Label>Ownership</Label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                <Checkbox
                  checked={rewriteOwnership}
                  onCheckedChange={(v) => setRewriteOwnership(v === true)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium flex items-center gap-2">
                    <UserCheck className="h-4 w-4" />
                    Rewrite ownership to me
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {meLabel}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground text-xs mt-1">
                    Every restored row's <code className="font-mono">user_id</code> is
                    set to your account. Required when moving a snapshot between
                    instances (user IDs differ) or between accounts on the same
                    instance. Turn this off only if you are restoring into the
                    exact same account the snapshot came from.
                  </div>
                  {!rewriteOwnership && (
                    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 flex gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Snapshot user IDs will be preserved. If any user ID in the
                        backup doesn't exist in this instance, RLS or foreign-key
                        rules will reject those rows.
                      </span>
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div className="pt-2">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={debugMode}
                  onCheckedChange={(v) => setDebugMode(v === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Debug mode</span>
                  <span className="block text-xs text-muted-foreground">
                    Capture PostgREST error, sample row, and RLS/grant diagnostics on
                    the first failing chunk per table.
                  </span>
                </span>
              </label>
            </div>

            <WizardNav
              onBack={() => setStep(1)}
              onNext={() => {
                setPreview(null);
                setStep(3);
              }}
              nextLabel="Continue to dry-run"
            />
          </StepCard>
        )}

        {/* -------------------------------- STEP 3 -------------------------------- */}
        {step === 3 && (
          <StepCard title="Step 3 — Dry-run preview">
            <p className="text-sm text-muted-foreground">
              A dry-run reports exactly what the restore <em>would</em> do — rows
              per table, delete counts for replace mode — without writing anything
              to the database. Nothing is committed until step 4.
            </p>
            <div className="rounded-md border p-3 text-xs bg-muted/40 space-y-1">
              <div>
                Mode: <strong>{mode}</strong>
              </div>
              <div>
                Ownership rewrite:{" "}
                <strong>{rewriteOwnership ? `yes → ${meLabel}` : "no (keep from snapshot)"}</strong>
              </div>
              <div>
                Debug mode: <strong>{debugMode ? "on" : "off"}</strong>
              </div>
              <div>
                Backup: <strong>{snapshot?.tables.length ?? 0}</strong> tables ·{" "}
                <strong>{totalRows}</strong> rows
              </div>
            </div>

            <Button
              onClick={() => dryRunMut.mutate()}
              disabled={dryRunMut.isPending}
            >
              <Eye className="h-4 w-4 mr-2" />
              {dryRunMut.isPending ? "Running dry-run…" : "Run dry-run"}
            </Button>

            <WizardNav onBack={() => setStep(2)} />
          </StepCard>
        )}

        {/* -------------------------------- STEP 4 -------------------------------- */}
        {step === 4 && preview && (
          <StepCard title="Step 4 — Review preview & apply">
            <p className="text-sm text-muted-foreground">
              Below is what the restore <em>would</em> do — nothing has been written
              yet. Review the counts and errors, then click <strong>Apply restore</strong>{" "}
              to commit.
            </p>

            <ResultTable result={preview} showDeleted={mode === "replace"} previewOnly />

            {mode === "replace" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Replace mode wipes every operational table before inserting.
                  Type <code className="font-mono bg-background px-1 rounded">REPLACE</code>{" "}
                  to unlock the apply button.
                </div>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="REPLACE"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to dry-run
              </Button>
              <Button
                onClick={() => applyMut.mutate()}
                disabled={applyMut.isPending || replaceLocked}
              >
                <Upload className="h-4 w-4 mr-2" />
                {applyMut.isPending ? "Restoring…" : `Apply restore (${mode})`}
              </Button>
            </div>
          </StepCard>
        )}

        {/* -------------------------------- STEP 5 -------------------------------- */}
        {step === 5 && result && (
          <StepCard title="Step 5 — Results">
            <div
              className={
                "flex items-center gap-2 text-sm font-medium rounded-md border p-3 " +
                (result.ok
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-destructive/40 bg-destructive/5")
              }
            >
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

            <ResultTable result={result} showDeleted={result.mode === "replace"} />

            <Button
              variant="outline"
              onClick={() => {
                setStep(1);
                setSnapshot(null);
                setFileName(null);
                setPreview(null);
                setResult(null);
                setIntegrity(null);
                setConfirmText("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Restore another file
            </Button>
          </StepCard>
        )}
      </div>
    </AppLayout>
  );
}

/* -------------------------------- helpers -------------------------------- */

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "File" },
  { n: 2, label: "Options" },
  { n: 3, label: "Dry-run" },
  { n: 4, label: "Apply" },
  { n: 5, label: "Done" },
];

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-1 text-xs">
      {STEPS.map((s, i) => {
        const state = current === s.n ? "current" : current > s.n ? "done" : "todo";
        return (
          <li key={s.n} className="flex items-center gap-1">
            <span
              className={
                "inline-flex h-6 w-6 items-center justify-center rounded-full border font-medium " +
                (state === "current"
                  ? "bg-primary text-primary-foreground border-primary"
                  : state === "done"
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700"
                    : "bg-muted text-muted-foreground border-border")
              }
            >
              {state === "done" ? "✓" : s.n}
            </span>
            <span
              className={state === "current" ? "font-medium" : "text-muted-foreground"}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 text-muted-foreground">→</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4 space-y-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function WizardNav({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = "Continue",
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex justify-between pt-2">
      {onBack ? (
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <Button onClick={onNext} disabled={nextDisabled}>
          {nextLabel} <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );
}

function IntegrityPanel({
  integrity,
  allowMissingIntegrity,
  setAllowMissingIntegrity,
}: {
  integrity: RestoreIntegrityStatus;
  allowMissingIntegrity: boolean;
  setAllowMissingIntegrity: (v: boolean) => void;
}) {
  return (
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
              Import anyway — I trust this file and accept that tampering or
              truncation cannot be detected.
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function ResultTable({
  result,
  showDeleted,
  previewOnly = false,
}: {
  result: ImportResult;
  showDeleted: boolean;
  previewOnly?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-3">Table</th>
            <th className="py-1 pr-3 text-right">
              {previewOnly ? "Would restore" : "Restored"}
            </th>
            {showDeleted && (
              <th className="py-1 pr-3 text-right">
                {previewOnly ? "Would delete" : "Deleted first"}
              </th>
            )}
            <th className="py-1">Error</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {result.results.map((r) => (
            <tr key={r.table} className="border-t">
              <td className="py-1 pr-3">{r.table}</td>
              <td className="py-1 pr-3 text-right">
                {r.succeeded}
                {r.attempted !== r.succeeded && (
                  <span className="text-muted-foreground"> / {r.attempted}</span>
                )}
              </td>
              {showDeleted && (
                <td className="py-1 pr-3 text-right">{r.deleted}</td>
              )}
              <td className="py-1 text-destructive">{r.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
