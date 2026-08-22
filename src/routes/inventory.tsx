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
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [applying, setApplying] = useState(false);


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
    setDeleteMissing(false);
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


  const applyPlan = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      if (plan.creates.length) {
        const { error } = await supabase.from("inventory_items").insert(
          plan.creates.map((c) => ({ ...c.patch, user_id: session!.user.id })),
        );
        if (error) throw new Error(error.message);
      }
      for (const u of plan.updates) {
        const { error } = await supabase
          .from("inventory_items")
          .update(u.patch)
          .eq("id", u.existing!.id);
        if (error) throw new Error(error.message);
      }
      if (deleteMissing && plan.missing.length) {
        const { error } = await supabase
          .from("inventory_items")
          .delete()
          .in(
            "id",
            plan.missing.map((m) => m.id),
          );
        if (error) throw new Error(error.message);
      }
      toast.success(
        `Import applied: ${plan.creates.length} added, ${plan.updates.length} updated` +
          (deleteMissing && plan.missing.length ? `, ${plan.missing.length} deleted` : ""),
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
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {plan.creates.slice(0, 50).map((c, i) => (
                    <div key={`c${i}`} className="px-3 py-2 flex justify-between gap-3">
                      <span className="truncate">{c.patch.name}</span>
                      <span className="text-emerald-400 text-xs shrink-0">new</span>
                    </div>
                  ))}
                  {plan.updates.slice(0, 50).map((u, i) => (
                    <div key={`u${i}`} className="px-3 py-2 flex justify-between gap-3">
                      <span className="truncate">{u.patch.name}</span>
                      <span className="text-sky-400 text-xs shrink-0">
                        {u.changedFields.join(", ")} (by {u.matchedBy})
                      </span>
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

