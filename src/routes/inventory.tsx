import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Download,
  Upload,
  AlertTriangle,
  ScanLine,
  Wrench,
  History,
  Undo2,
} from "lucide-react";
import Papa from "papaparse";
import AssetDialog from "@/components/dashboard/AssetDialog";
import AssetTable from "@/components/dashboard/AssetTable";
import StatsCards from "@/components/dashboard/StatsCards";
import BarcodeScanner from "@/components/dashboard/BarcodeScanner";
import { InventoryBomDialog } from "@/components/inventory-bom-dialog";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import type { Asset, AssetFormData } from "@/components/dashboard/types";
import { INVENTORY_TYPES } from "@/lib/obsidian-layout";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import {
  INVENTORY_CSV_COLUMNS,
  reconcileInventory,
  type ParsedRow,
  type ReconcilePlan,
} from "@/lib/inventory-reconcile";
import {
  validateInventoryCsv,
  type ValidationReport,
} from "@/lib/inventory-csv-validate";
import {
  listImportSnapshots,
  recordImportSnapshot,
  revertImportSnapshot,
  type ImportSnapshot,
} from "@/lib/inventory-import-history";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";



export const Route = createFileRoute("/inventory")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Inventory — Bostead Farms" },
      { name: "description", content: "Assets, stock, and equipment dashboard." },
    ],
  }),
  component: InventoryPage,
});

/** Render a field value from either an existing asset or an import patch for the diff view. */
function fieldLabel(src: Record<string, unknown> | null | undefined, field: string): string {
  const v = src?.[field];
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join("; ") : "—";
  return String(v);
}

function InventoryPage() {

  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showLowStock, setShowLowStock] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [partsItemId, setPartsItemId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReconcilePlan | null>(null);
  const [report, setReport] = useState<{
    fileName: string;
    parseErrors: string[];
    result: ValidationReport | null;
    rows: Array<Record<string, unknown>>;
  } | null>(null);
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<ImportSnapshot[]>([]);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  /** Per-row keys ("c0", "u3", "d5") the user rejected in the review dialog. */
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const isAccepted = (key: string) => !rejected.has(key);
  const toggleRow = (key: string) =>
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setAllRows = (keys: string[], accept: boolean) =>
    setRejected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (accept) next.delete(k);
        else next.add(k);
      }
      return next;
    });



  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) navigate({ to: "/auth" });
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (!s) navigate({ to: "/auth" });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session) fetchAssets();
  }, [session]);

  const fetchAssets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("Failed to load assets");
    else setAssets((data as unknown as Asset[]) || []);
    setLoading(false);
  };

  const handleSave = async (formData: AssetFormData) => {
    const payload = { ...formData, item_type: formData.item_type || null };
    if (editingAsset) {
      const { error } = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", editingAsset.id);
      if (error) return toast.error("Failed to update asset");
      toast.success("Asset updated");
    } else {
      const { error } = await supabase
        .from("inventory_items")
        .insert({ ...payload, user_id: session!.user.id });
      if (error) return toast.error("Failed to create asset");
      toast.success("Asset created");
    }
    setDialogOpen(false);
    setEditingAsset(null);
    fetchAssets();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) return toast.error("Failed to delete asset");
    toast.success("Asset deleted");
    fetchAssets();
  };

  const handleEdit = (asset: Asset) => {
    setEditingAsset(asset);
    setDialogOpen(true);
  };

  const handleExportCSV = () => {
    const rows = filtered.map((a) => ({
      id: a.id,
      name: a.name ?? "",
      description: a.description ?? "",
      item_type: a.item_type ?? "",
      location: a.location ?? "",
      quantity: a.quantity ?? 0,
      min_quantity: a.min_quantity ?? 0,
      status: a.status,
      barcode: a.barcode ?? "",
      tags: (a.tags ?? []).join(";"),
    }));
    const csv = rowsToCsv(
      rows,
      INVENTORY_CSV_COLUMNS.map((key) => ({ key, label: key })),
    );
    downloadCsv("assets-export.csv", csv);
    toast.success(`Exported ${rows.length} rows (keep the id column to match on re-import)`);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => {
        const fatal = res.errors.filter((err) => err.code !== "TooFewFields");
        if (fatal.length) {
          setReport({
            fileName: file.name,
            parseErrors: fatal.slice(0, 20).map(
              (err) => `Line ${(err.row ?? 0) + 2}: ${err.message}`,
            ),
            result: null,
            rows: [],
          });
          return;
        }
        const rows = res.data ?? [];
        const result = validateInventoryCsv(rows, {
          headers: res.meta.fields ?? undefined,
          knownIds: assets.map((a) => a.id),
        });
        setReport({ fileName: file.name, parseErrors: [], result, rows });
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
  };

  const proceedFromReport = () => {
    if (!report?.result?.ok) return;
    setPlan(reconcileInventory(report.rows as ParsedRow[], assets));
    setImportFileName(report.fileName);
    setDeleteMissing(false);
    setRejected(new Set());
    setReport(null);
  };

  const downloadIssueReport = () => {
    if (!report?.result) return;
    const csv = rowsToCsv(
      report.result.issues.map((i) => ({
        line: i.line,
        row: i.row,
        severity: i.severity,
        field: i.field,
        value: i.value,
        problem: i.message,
      })),
      ["line", "row", "severity", "field", "value", "problem"].map((key) => ({
        key: key as "line",
        label: key,
      })),
    );
    downloadCsv("inventory-import-errors.csv", csv);
  };


  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistory(await listImportSnapshots());
    } catch (err) {
      toast.error(`Could not load import history: ${(err as Error).message}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  const rollback = async (snapshot: ImportSnapshot) => {
    setRevertingId(snapshot.id);
    try {
      const res = await revertImportSnapshot(snapshot);
      toast.success(
        `Rolled back: ${res.removed} removed, ${res.restored} restored, ${res.reinserted} re-added`,
      );
      setHistory(await listImportSnapshots());
      fetchAssets();
    } catch (err) {
      toast.error(`Rollback failed: ${(err as Error).message}`);
    } finally {
      setRevertingId(null);
    }
  };

  const applyPlan = async () => {
    if (!plan) return;
    const creates = plan.creates.filter((_, i) => isAccepted(`c${i}`));
    const updates = plan.updates.filter((_, i) => isAccepted(`u${i}`));
    const missing = plan.missing.filter((_, i) => isAccepted(`d${i}`));
    if (!creates.length && !updates.length && !(deleteMissing && missing.length)) {
      toast.error("Nothing selected — accept at least one row to import.");
      return;
    }
    setApplying(true);
    const createdIds: string[] = [];
    try {
      if (creates.length) {
        const { data, error } = await supabase
          .from("inventory_items")
          .insert(creates.map((c) => ({ ...c.patch, user_id: session!.user.id })))
          .select("id");
        if (error) throw new Error(error.message);
        for (const row of data ?? []) createdIds.push(row.id as string);
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("inventory_items")
          .update(u.patch)
          .eq("id", u.existing!.id);
        if (error) throw new Error(error.message);
      }
      if (deleteMissing && missing.length) {
        const { error } = await supabase
          .from("inventory_items")
          .delete()
          .in(
            "id",
            missing.map((m) => m.id),
          );
        if (error) throw new Error(error.message);
      }
      const deletedRows = deleteMissing ? missing : [];
      try {
        await recordImportSnapshot(session!.user.id, {
          fileName: importFileName || "import.csv",
          deleteMissing,
          createdIds,
          updatedBefore: updates.map((u) => u.existing!),
          deletedRows,
        });
      } catch (err) {
        toast.warning(`Import applied, but the rollback snapshot failed: ${(err as Error).message}`);
      }
      toast.success(
        `Import applied: ${creates.length} added, ${updates.length} updated` +
          (deletedRows.length ? `, ${deletedRows.length} deleted` : "") +
          " — use Import history to roll back",
      );
      setPlan(null);
      fetchAssets();
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };


  const usedTypes = new Set(assets.map((a) => a.item_type).filter(Boolean) as string[]);
  const availableTypes = INVENTORY_TYPES.filter((t) => usedTypes.has(t.value));

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase();
    const typeLabel =
      INVENTORY_TYPES.find((t) => t.value === a.item_type)?.label.toLowerCase() ?? "";
    const matchesSearch =
      (a.name || "").toLowerCase().includes(q) ||
      (a.description || "").toLowerCase().includes(q) ||
      typeLabel.includes(q) ||
      (a.location || "").toLowerCase().includes(q) ||
      (a.barcode || "").toLowerCase().includes(q) ||
      (a.tags || []).some((t) => t.toLowerCase().includes(q));
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    const matchesType = typeFilter === "all" || a.item_type === typeFilter;
    const minQ = a.min_quantity ?? 0;
    const qty = a.quantity ?? 0;
    const matchesLowStock = !showLowStock || (minQ > 0 && qty <= minQ);
    return matchesSearch && matchesStatus && matchesType && matchesLowStock;
  });


  const lowStockCount = assets.filter((a) => {
    const minQ = a.min_quantity ?? 0;
    const qty = a.quantity ?? 0;
    return minQ > 0 && qty <= minQ;
  }).length;

  return (
    <AppLayout>
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <StatsCards
          total={assets.length}
          available={assets.filter((a) => a.status === "available").length}
          inUse={assets.filter((a) => a.status === "in_use").length}
          lowStock={lowStockCount}
        />

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="all">All Status</option>
              <option value="available">Available</option>
              <option value="in_use">In Use</option>
              <option value="maintenance">Maintenance</option>
              <option value="retired">Retired</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="all">All Inventory Types</option>
              {availableTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>


            <Button
              variant={showLowStock ? "default" : "outline"}
              size="sm"
              onClick={() => setShowLowStock(!showLowStock)}
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              Low Stock {lowStockCount > 0 && `(${lowStockCount})`}
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button size="sm" variant="outline" onClick={openHistory}>
              <History className="h-4 w-4 mr-1" /> Import history
            </Button>
            <label>
              <Button size="sm" variant="outline" asChild className="cursor-pointer">
                <span>
                  <Upload className="h-4 w-4 mr-1" /> Import
                </span>
              </Button>
              <input type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
            </label>
            <Button size="sm" variant="outline" onClick={() => setScannerOpen(true)}>
              <ScanLine className="h-4 w-4 mr-1" /> Scan
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ to: "/service-scheduling" })}
            >
              <Wrench className="h-4 w-4 mr-1" /> Services
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingAsset(null);
                setDialogOpen(true);
              }}
              className="shadow-glow font-semibold"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Asset
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-20">Loading assets...</div>
        ) : (
          <AssetTable
            assets={filtered}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onEditParts={(asset) => setPartsItemId(asset.id)}
          />
        )}
      </main>

      <AssetDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingAsset(null);
        }}
        onSave={handleSave}
        asset={editingAsset}
      />

      <InventoryBomDialog
        itemId={partsItemId}
        open={Boolean(partsItemId)}
        onOpenChange={(open) => {
          if (!open) setPartsItemId(null);
        }}
      />

      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(code) => {
          setScannerOpen(false);
          setSearch(code);
        }}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import history</DialogTitle>
            <DialogDescription>
              Every applied import stores a snapshot of the rows it touched. Rolling back deletes
              the rows it created, restores the previous values of rows it changed, and re-adds
              rows it deleted.
            </DialogDescription>
          </DialogHeader>

          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports recorded yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-border/60 rounded-lg border border-border">
              {history.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="text-sm">
                    <p className="font-medium">{s.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString()} — {s.created_ids.length} added,{" "}
                      {s.updated_before.length} updated, {s.deleted_rows.length} deleted
                    </p>
                    {s.reverted_at ? (
                      <p className="text-xs text-muted-foreground">
                        Rolled back {new Date(s.reverted_at).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(s.reverted_at) || revertingId === s.id}
                    onClick={() => rollback(s)}
                  >
                    <Undo2 className="h-4 w-4 mr-1" />
                    {s.reverted_at
                      ? "Reverted"
                      : revertingId === s.id
                        ? "Rolling back…"
                        : "Roll back"}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(report)} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>CSV validation</DialogTitle>
            <DialogDescription>
              {report?.fileName} — every row is checked before anything is written. Errors must be
              fixed in the file; warnings are safe to ignore.
            </DialogDescription>
          </DialogHeader>

          {report?.parseErrors.length ? (
            <div className="space-y-2 text-sm">
              <p className="text-destructive font-medium">
                This file could not be read as CSV.
              </p>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                {report.parseErrors.map((m, i) => (
                  <li key={i} className="px-3 py-2 text-muted-foreground">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : report?.result ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Rows", value: report.result.totalRows },
                  { label: "Valid", value: report.result.validRows },
                  { label: "Errors", value: report.result.errors.length },
                  { label: "Warnings", value: report.result.warnings.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border p-3">
                    <div className="text-xl font-semibold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {report.result.unknownColumns.length > 0 && (
                <p className="text-muted-foreground">
                  Unrecognized columns ignored: {report.result.unknownColumns.join(", ")}
                </p>
              )}

              {report.result.issues.length > 0 ? (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {report.result.issues.slice(0, 200).map((i, idx) => (
                    <div key={idx} className="px-3 py-2 flex gap-3 items-start">
                      <span
                        className={`text-xs shrink-0 font-medium ${
                          i.severity === "error" ? "text-destructive" : "text-amber-400"
                        }`}
                      >
                        line {i.line}
                      </span>
                      <span className="text-xs shrink-0 text-muted-foreground w-24 truncate">
                        {i.field}
                      </span>
                      <span className="text-muted-foreground">{i.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-400">
                  All {report.result.totalRows} row(s) look valid.
                </p>
              )}

              {report.result.blankRows > 0 && (
                <p className="text-xs text-muted-foreground">
                  {report.result.blankRows} blank row(s) skipped.
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            {report?.result && report.result.issues.length > 0 && (
              <Button variant="ghost" onClick={downloadIssueReport}>
                <Download className="h-4 w-4 mr-1" /> Download report
              </Button>
            )}
            <Button variant="outline" onClick={() => setReport(null)}>
              {report?.result?.ok ? "Cancel" : "Close"}
            </Button>
            {report?.result?.ok && (
              <Button onClick={proceedFromReport}>Continue to review</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(plan)} onOpenChange={(open) => !open && setPlan(null)}>

        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review import</DialogTitle>
            <DialogDescription>
              Rows are matched to existing inventory by <strong>id</strong>, then{" "}
              <strong>barcode</strong>, then <strong>name</strong>. Matches are updated in place;
              unmatched rows are added as new items. Nothing is deleted unless you opt in below.
            </DialogDescription>
          </DialogHeader>

          {plan && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Add", value: plan.creates.length },
                  { label: "Update", value: plan.updates.length },
                  { label: "Unchanged", value: plan.unchanged.length },
                  { label: "Not in file", value: plan.missing.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border p-3">
                    <div className="text-xl font-semibold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {(plan.creates.length > 0 || plan.updates.length > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {plan.creates.filter((_, i) => isAccepted(`c${i}`)).length} of{" "}
                      {plan.creates.length} new and{" "}
                      {plan.updates.filter((_, i) => isAccepted(`u${i}`)).length} of{" "}
                      {plan.updates.length} update(s) accepted
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAllRows(
                            [
                              ...plan.creates.map((_, i) => `c${i}`),
                              ...plan.updates.map((_, i) => `u${i}`),
                            ],
                            true,
                          )
                        }
                      >
                        Accept all
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAllRows(
                            [
                              ...plan.creates.map((_, i) => `c${i}`),
                              ...plan.updates.map((_, i) => `u${i}`),
                            ],
                            false,
                          )
                        }
                      >
                        Reject all
                      </Button>
                    </div>
                  </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {plan.creates.map((c, i) => (
                    <div
                      key={`c${i}`}
                      className={`px-3 py-2 flex items-center gap-3 ${
                        isAccepted(`c${i}`) ? "" : "opacity-50"
                      }`}
                    >
                      <Checkbox
                        checked={isAccepted(`c${i}`)}
                        onCheckedChange={() => toggleRow(`c${i}`)}
                        aria-label={`Accept new item ${c.patch.name}`}
                      />
                      <span className="truncate flex-1">{c.patch.name}</span>
                      <span className="text-emerald-400 text-xs shrink-0">new</span>
                    </div>
                  ))}
                  {plan.updates.map((u, i) => (
                    <div
                      key={`u${i}`}
                      className={`px-3 py-2 space-y-1.5 ${isAccepted(`u${i}`) ? "" : "opacity-50"}`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isAccepted(`u${i}`)}
                          onCheckedChange={() => toggleRow(`u${i}`)}
                          aria-label={`Accept update for ${u.existing?.name ?? u.patch.name}`}
                        />
                        <span className="truncate font-medium flex-1">
                          {u.existing?.name ?? u.patch.name}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          matched by {u.matchedBy}
                        </span>
                      </div>
                      <div className="rounded-md border border-border/60 overflow-hidden">
                        <div className="grid grid-cols-[7rem_1fr_1fr] bg-card/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span className="px-2 py-1">Field</span>
                          <span className="px-2 py-1">Current</span>
                          <span className="px-2 py-1">After import</span>
                        </div>
                        {u.changedFields.map((f) => (
                          <div
                            key={f}
                            className="grid grid-cols-[7rem_1fr_1fr] border-t border-border/50 text-xs"
                          >
                            <span className="px-2 py-1 text-muted-foreground">{f}</span>
                            <span className="px-2 py-1 text-muted-foreground line-through decoration-destructive/60 break-words">
                              {fieldLabel(u.existing as unknown as Record<string, unknown>, f)}
                            </span>
                            <span className="px-2 py-1 text-sky-400 break-words">
                              {fieldLabel(u.patch as unknown as Record<string, unknown>, f)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}


              {plan.missing.length > 0 && (
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={deleteMissing}
                    onCheckedChange={(v) => setDeleteMissing(Boolean(v))}
                  />
                  <span>
                    Delete the {plan.missing.length} item(s) missing from this file (treat the CSV
                    as the full inventory). Leave unchecked to keep them.
                  </span>
                </label>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={applyPlan} disabled={applying}>
              {applying ? "Applying…" : "Apply import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

