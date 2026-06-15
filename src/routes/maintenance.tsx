import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import Papa from "papaparse";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  importMaintenance,
  listMaintenance,
  deleteMaintenance,
} from "@/lib/maintenance.functions";
import {
  Wrench,
  Plus,
  Calendar,
  AlertTriangle,
  Upload,
  Download,
  FileText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import { WelcomingPagesImportHelper } from "@/components/welcoming-pages-import-helper";

export const Route = createFileRoute("/maintenance")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Maintenance — Bostead Farms" },
      {
        name: "description",
        content: "Service and maintenance records for Bostead Farms equipment.",
      },
    ],
  }),
  component: MaintenancePage,
});

// Map common header variants → our canonical field names.
const HEADER_ALIASES: Record<string, string> = {
  asset: "asset_name",
  "asset name": "asset_name",
  equipment: "asset_name",
  item: "asset_name",
  asset_id: "asset_id",
  service: "service_type",
  "service type": "service_type",
  type: "service_type",
  title: "title",
  status: "status",
  state: "status",
  "performed at": "performed_at",
  "performed on": "performed_at",
  "service date": "performed_at",
  date: "performed_at",
  "completed at": "performed_at",
  "completed date": "completed_date",
  "completed_date": "completed_date",
  "due at": "due_at",
  "next due": "due_at",
  "due date": "due_at",
  "scheduled date": "scheduled_date",
  "scheduled_date": "scheduled_date",
  recurrence: "recurrence",
  "consumables used": "consumables_used",
  consumables_used: "consumables_used",
  cost: "cost",
  amount: "cost",
  price: "cost",
  vendor: "vendor",
  supplier: "vendor",
  technician: "vendor",
  notes: "notes",
  note: "notes",
  description: "description",
  comment: "notes",
  comments: "notes",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function mapRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null || v === "") continue;
    const norm = normalizeHeader(k);
    const mapped = HEADER_ALIASES[norm] ?? norm.replace(/\s+/g, "_");
    out[mapped] = v;
  }
  return out;
}

async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json")) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { records?: unknown }).records)
        ? ((parsed as { records: unknown[] }).records as unknown[])
        : null;
    if (!arr) throw new Error("JSON must be an array or {records:[…]}");
    return arr.map((r) => mapRowKeys(r as Record<string, unknown>));
  }
  // CSV
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (result.errors.length) {
    const first = result.errors[0];
    throw new Error(`CSV parse error: ${first.message} (row ${first.row})`);
  }
  return (result.data ?? []).map((r) => mapRowKeys(r));
}

function MaintenancePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMaintenance);
  const importFn = useServerFn(importMaintenance);
  const deleteFn = useServerFn(deleteMaintenance);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["maintenance"],
    queryFn: () => listFn(),
  });

  const [pending, setPending] = useState<Record<string, unknown>[] | null>(null);
  const [pendingName, setPendingName] = useState<string>("");
  const [replace, setReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!pending) return null;
      return importFn({ data: { records: pending as never[], replace } });
    },
    onSuccess: (res) => {
      if (res) {
        toast.success(`Imported ${res.inserted} record${res.inserted === 1 ? "" : "s"}`);
        setPending(null);
        setPendingName("");
        if (fileRef.current) fileRef.current.value = "";
        qc.invalidateQueries({ queryKey: ["maintenance"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance"] }),
  });

  const onFile = async (file: File) => {
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        toast.error("No rows found in file");
        return;
      }
      setPending(rows);
      setPendingName(file.name);
      toast.success(`Parsed ${rows.length} row${rows.length === 1 ? "" : "s"} from ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not parse file");
    }
  };

  const stats = {
    total: records.length,
    open: records.filter((r) => (r.status ?? "").toLowerCase() !== "done").length,
    overdue: records.filter(
      (r) => r.due_at && new Date(r.due_at) < new Date() && (r.status ?? "").toLowerCase() !== "done",
    ).length,
  };

  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-3.5rem)] bg-background text-foreground">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-start justify-between gap-6 mb-10 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-4">
                <Wrench className="h-3 w-3" /> Service Maintenance
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                Keep every asset <span className="text-gradient-amber">running smoothly.</span>
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Track service intervals, log repairs, and import existing records from CSV or JSON.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <Button
                onClick={() => {
                  if (records.length === 0) {
                    toast.info("No records to export");
                    return;
                  }
                  const csv = rowsToCsv(records as never, [
                    { key: "title", label: "title" },
                    { key: "asset_name", label: "asset_name" },
                    { key: "service_type", label: "service_type" },
                    { key: "status", label: "status" },
                    { key: "scheduled_date", label: "scheduled_date" },
                    { key: "completed_date", label: "completed_date" },
                    { key: "performed_at", label: "performed_at" },
                    { key: "due_at", label: "due_at" },
                    { key: "recurrence", label: "recurrence" },
                    { key: "cost", label: "cost" },
                    { key: "vendor", label: "vendor" },
                    { key: "description", label: "description" },
                    { key: "notes", label: "notes" },
                    { key: "consumables_used", label: "consumables_used" },
                  ]);
                  downloadCsv(
                    `maintenance_${new Date().toISOString().slice(0, 10)}.csv`,
                    csv,
                  );
                  toast.success(`Exported ${records.length} record${records.length === 1 ? "" : "s"}`);
                }}
                variant="ghost"
                className="text-muted-foreground hover:text-primary"
              >
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
              <Button
                onClick={() => fileRef.current?.click()}
                variant="outline"
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <Upload className="h-4 w-4 mr-1" /> Import file
              </Button>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow">
                <Plus className="h-4 w-4 mr-1" /> New record
              </Button>
            </div>
          </div>

          <WelcomingPagesImportHelper kind="maintenance" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {[
              { label: "Total records", value: String(stats.total), icon: Wrench },
              { label: "Open / scheduled", value: String(stats.open), icon: Calendar },
              { label: "Overdue", value: String(stats.overdue), icon: AlertTriangle },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-border bg-gradient-card p-5 shadow-glow"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <s.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="text-3xl font-bold">{s.value}</div>
              </div>
            ))}
          </div>

          {pending && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 mb-8">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{pendingName}</span>
                  <span className="text-sm text-muted-foreground">
                    · {pending.length} row{pending.length === 1 ? "" : "s"} ready
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-sm text-foreground/80">
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                      className="accent-[oklch(0.78_0.17_65)]"
                    />
                    Replace all my existing records
                  </label>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPending(null);
                      setPendingName("");
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => importMut.mutate()}
                    disabled={importMut.isPending}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow"
                  >
                    {importMut.isPending ? "Importing…" : `Import ${pending.length}`}
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      {Object.keys(pending[0] ?? {})
                        .slice(0, 8)
                        .map((k) => (
                          <th key={k} className="px-2 py-1 font-medium">
                            {k}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pending.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {Object.keys(pending[0] ?? {})
                          .slice(0, 8)
                          .map((k) => (
                            <td key={k} className="px-2 py-1 text-muted-foreground truncate max-w-[160px]">
                              {String(r[k] ?? "")}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pending.length > 3 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Showing first 3 rows. Unrecognized columns are kept in a JSON field.
                  </p>
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="rounded-xl border border-border bg-card/40 p-10 text-center text-muted-foreground">
              Loading records…
            </div>
          ) : records.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/40 p-10 text-center">
              <Wrench className="h-10 w-10 text-primary mx-auto mb-3" />
              <h2 className="text-xl font-semibold mb-1">No maintenance records yet</h2>
              <p className="text-muted-foreground mb-4">
                Upload a CSV/JSON export to bring records forward, or add your first one.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Upload className="h-4 w-4 mr-1" /> Import file
                </Button>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow">
                  <Plus className="h-4 w-4 mr-1" /> New record
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-card/80 text-muted-foreground text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Asset</th>
                    <th className="px-4 py-2 font-medium">Service</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Performed</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Cost</th>
                    <th className="px-4 py-2 font-medium">Vendor</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-card/60">
                      <td className="px-4 py-2">{r.asset_name ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.service_type ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.status ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.performed_at ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.due_at ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.cost != null ? `$${Number(r.cost).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{r.vendor ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => deleteMut.mutate(r.id)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Delete record"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
