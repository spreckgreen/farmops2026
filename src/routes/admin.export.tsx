// Admin-only snapshot export. Downloads a JSON dump of every operational
// table so a freshly self-hosted Bostead instance can be seeded from an
// existing farm's data. Also offers per-table CSV downloads.
//
// Before download the snapshot is validated against the known import schema:
// required fields, duplicate ids, and application-level foreign-key targets
// (e.g. food_plan_entries.person_id → food_plan_people.id). Errors block the
// JSON download unless the admin explicitly overrides.

import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  ShieldX,
  Table as TableIcon,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { exportApplicationData, type Snapshot } from "@/lib/admin.functions";
import { downloadCsv, rowsToCsv } from "@/lib/csv";
import { validateSnapshot, type SnapshotValidation } from "@/lib/snapshot-validation";

export const Route = createFileRoute("/admin/export")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Export snapshot — Bostead Farms" }] }),
  component: ExportPage,
});

function downloadBlob(filename: string, data: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function snapshotFilename(ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `bostead-snapshot-${stamp}.${ext}`;
}

function ExportPage() {
  const profile = useCurrentProfile();
  const exportFn = useServerFn(exportApplicationData);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [allowInvalid, setAllowInvalid] = useState(false);

  const validation: SnapshotValidation | null = useMemo(
    () => (snapshot ? validateSnapshot(snapshot) : null),
    [snapshot],
  );

  const mut = useMutation({
    mutationFn: () => exportFn(),
    onSuccess: (snap) => {
      setSnapshot(snap);
      setAllowInvalid(false);
      const v = validateSnapshot(snap);
      if (v.errors > 0) {
        toast.error(
          `Snapshot has ${v.errors} validation error${v.errors === 1 ? "" : "s"} — review before exporting.`,
        );
      } else if (v.warnings > 0) {
        toast.warning(`Snapshot ready with ${v.warnings} warning(s).`);
      } else {
        toast.success(
          `Snapshot ready (${v.totalRows} rows across ${snap.tables.length} tables) — all checks passed.`,
        );
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const blockDownload = !!validation && validation.errors > 0 && !allowInvalid;

  const downloadJson = () => {
    if (!snapshot || !validation) return;
    const payload = { ...snapshot, validation };
    downloadBlob(
      snapshotFilename("json"),
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  };

  const downloadReport = () => {
    if (!validation) return;
    downloadBlob(
      snapshotFilename("validation.json"),
      JSON.stringify(validation, null, 2),
      "application/json",
    );
  };

  const downloadTableCsv = (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) {
      toast.message(`${table} is empty — nothing to export.`);
      return;
    }
    const keys = Array.from(
      rows.reduce((set, row) => {
        for (const k of Object.keys(row)) set.add(k);
        return set;
      }, new Set<string>()),
    );
    const columns = keys.map((k) => ({ key: k, label: k }));
    downloadCsv(`${table}.csv`, rowsToCsv(rows, columns));
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
            You need the <strong>admin</strong> role to export application data.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Export snapshot</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generates a complete JSON dump of every operational table (tasks, projects,
            notes, maintenance, inventory, food plan, storage, crops, garden, orchard,
            livestock, summaries, activity log). User accounts and roles are{" "}
            <strong>not</strong> included.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Each snapshot is checked for missing required fields, duplicate ids, and
            broken cross-table references before download, so the file can be re-imported
            without failing partway through.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            <Download className="h-4 w-4 mr-2" />
            {mut.isPending ? "Generating…" : "Generate snapshot"}
          </Button>
          {snapshot && (
            <>
              <Button variant="secondary" onClick={downloadJson} disabled={blockDownload}>
                <FileJson className="h-4 w-4 mr-2" />
                Download JSON
              </Button>
              {validation && validation.issues.length > 0 && (
                <Button variant="ghost" onClick={downloadReport}>
                  Download validation report
                </Button>
              )}
            </>
          )}
        </div>

        {validation && (
          <div
            className={
              "rounded-lg p-4 border " +
              (validation.errors > 0
                ? "border-destructive/40 bg-destructive/5"
                : validation.warnings > 0
                  ? "border-yellow-500/40 bg-yellow-500/5"
                  : "border-emerald-500/40 bg-emerald-500/5")
            }
          >
            <div className="flex items-start gap-2 text-sm">
              {validation.errors > 0 ? (
                <AlertTriangle className="h-5 w-5 mt-0.5 text-destructive shrink-0" />
              ) : (
                <CheckCircle2 className="h-5 w-5 mt-0.5 text-emerald-600 shrink-0" />
              )}
              <div className="space-y-1">
                <div className="font-medium">
                  {validation.errors > 0
                    ? `${validation.errors} error${validation.errors === 1 ? "" : "s"} found`
                    : validation.warnings > 0
                      ? `${validation.warnings} warning${validation.warnings === 1 ? "" : "s"}`
                      : "All checks passed"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {validation.totalRows} rows checked across{" "}
                  {Object.keys(validation.byTable).length} tables. Errors mean the snapshot
                  cannot be imported as-is.
                </div>
              </div>
            </div>

            {validation.errors > 0 && (
              <label className="mt-3 flex items-center gap-2 text-xs">
                <Checkbox
                  checked={allowInvalid}
                  onCheckedChange={(v) => setAllowInvalid(v === true)}
                />
                <span>
                  Download anyway — I understand this snapshot will fail to import without
                  manual fixes.
                </span>
              </label>
            )}

            {validation.issues.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Show {validation.issues.length} issue
                  {validation.issues.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 text-xs font-mono space-y-1 max-h-72 overflow-auto">
                  {validation.issues.slice(0, 500).map((i, idx) => (
                    <li
                      key={idx}
                      className={i.severity === "error" ? "text-destructive" : "text-yellow-700"}
                    >
                      [{i.severity}] {i.table}
                      {i.rowId ? ` (${i.rowId.slice(0, 8)}…)` : ""}: {i.message}
                    </li>
                  ))}
                  {validation.issues.length > 500 && (
                    <li className="text-muted-foreground">
                      …{validation.issues.length - 500} more — download the validation report
                      for the full list.
                    </li>
                  )}
                </ul>
              </details>
            )}
          </div>
        )}

        {snapshot && validation && (
          <div className="border border-border rounded-lg bg-card/30 p-4 space-y-3">
            <div className="text-sm">
              <div className="font-medium">Snapshot ready</div>
              <div className="text-xs text-muted-foreground font-mono">
                generated {snapshot.generated_at}
              </div>
            </div>
            <ul className="text-xs divide-y divide-border/60">
              {snapshot.tables.map((t) => {
                const s = validation.byTable[t.table] ?? { rows: t.rows.length, errors: 0, warnings: 0 };
                const badge =
                  s.errors > 0
                    ? `${s.errors} error${s.errors === 1 ? "" : "s"}`
                    : s.warnings > 0
                      ? `${s.warnings} warning${s.warnings === 1 ? "" : "s"}`
                      : "ok";
                const badgeClass =
                  s.errors > 0
                    ? "text-destructive"
                    : s.warnings > 0
                      ? "text-yellow-700"
                      : "text-emerald-600";
                return (
                  <li
                    key={t.table}
                    className="flex items-center justify-between py-1.5 gap-3"
                  >
                    <div className="font-mono">
                      <span className={t.error ? "text-destructive" : ""}>{t.table}</span>
                      <span className="ml-2 text-muted-foreground">
                        {t.error ? `error — ${t.error}` : `${t.rows.length} rows`}
                      </span>
                      <span className={"ml-2 " + badgeClass}>{badge}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!t.error || t.rows.length === 0}
                      onClick={() => downloadTableCsv(t.table, t.rows)}
                    >
                      <TableIcon className="h-3.5 w-3.5 mr-1" />
                      CSV
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
