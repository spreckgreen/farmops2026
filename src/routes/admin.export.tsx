// Admin-only snapshot export. Downloads a JSON dump of every operational
// table so a freshly self-hosted Bostead instance can be seeded from an
// existing farm's data. Also offers per-table CSV downloads.

import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileJson, ShieldX, Table as TableIcon } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { exportApplicationData, type Snapshot } from "@/lib/admin.functions";
import { downloadCsv, rowsToCsv } from "@/lib/csv";

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

  const mut = useMutation({
    mutationFn: () => exportFn(),
    onSuccess: (snap) => {
      setSnapshot(snap);
      const failed = snap.tables.filter((t) => t.error);
      if (failed.length) {
        toast.error(`${failed.length} table(s) failed to export — see details below.`);
      } else {
        const total = snap.tables.reduce((n, t) => n + t.rows.length, 0);
        toast.success(`Snapshot ready (${total} rows across ${snap.tables.length} tables).`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const downloadJson = () => {
    if (!snapshot) return;
    downloadBlob(snapshotFilename("json"), JSON.stringify(snapshot, null, 2), "application/json");
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
            Use this to seed a freshly self-hosted Bostead instance from an existing farm's
            data, or to keep an off-platform backup.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            <Download className="h-4 w-4 mr-2" />
            {mut.isPending ? "Generating…" : "Generate snapshot"}
          </Button>
          {snapshot && (
            <Button variant="secondary" onClick={downloadJson}>
              <FileJson className="h-4 w-4 mr-2" />
              Download JSON
            </Button>
          )}
        </div>

        {snapshot && (
          <div className="border border-border rounded-lg bg-card/30 p-4 space-y-3">
            <div className="text-sm">
              <div className="font-medium">Snapshot ready</div>
              <div className="text-xs text-muted-foreground font-mono">
                generated {snapshot.generated_at}
              </div>
            </div>
            <ul className="text-xs divide-y divide-border/60">
              {snapshot.tables.map((t) => (
                <li
                  key={t.table}
                  className="flex items-center justify-between py-1.5 gap-3"
                >
                  <div className="font-mono">
                    <span className={t.error ? "text-destructive" : ""}>{t.table}</span>
                    <span className="ml-2 text-muted-foreground">
                      {t.error ? `error — ${t.error}` : `${t.rows.length} rows`}
                    </span>
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
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
