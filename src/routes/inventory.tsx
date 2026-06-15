import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import Papa from "papaparse";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  importInventory,
  listInventory,
  deleteInventory,
} from "@/lib/inventory.functions";
import {
  Package,
  Plus,
  Boxes,
  AlertTriangle,
  Upload,
  Download,
  FileText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import { WelcomingPagesImportHelper } from "@/components/welcoming-pages-import-helper";
import { NewRecordDialog } from "@/components/new-record-dialog";

export const Route = createFileRoute("/inventory")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Inventory — Bostead Farms" },
      {
        name: "description",
        content: "Inventory tracking for Bostead Farms supplies and equipment.",
      },
    ],
  }),
  component: InventoryPage,
});

const HEADER_ALIASES: Record<string, string> = {
  sku: "sku",
  code: "sku",
  "item code": "sku",
  "part number": "sku",
  partno: "sku",
  name: "name",
  item: "name",
  "item name": "name",
  product: "name",
  description: "description",
  category: "category",
  type: "category",
  group: "category",
  location: "location",
  bin: "location",
  warehouse: "location",
  site: "location",
  quantity: "quantity",
  qty: "quantity",
  "on hand": "quantity",
  stock: "quantity",
  unit: "unit",
  uom: "unit",
  "unit of measure": "unit",
  "reorder level": "reorder_level",
  reorder: "reorder_level",
  "unit cost": "unit_cost",
  cost: "unit_cost",
  price: "unit_cost",
  vendor: "vendor",
  supplier: "vendor",
  notes: "notes",
  note: "notes",
  comment: "notes",
  comments: "notes",
  // Welcoming Pages parity — assets + consumables
  "quantity in stock": "quantity",
  "qty in stock": "quantity",
  "min qty": "min_quantity",
  "min quantity": "min_quantity",
  "minimum quantity": "min_quantity",
  minimum: "min_quantity",
  min_quantity: "min_quantity",
  "cost per unit": "unit_cost",
  "per unit cost": "unit_cost",
  tags: "tags",
  status: "status",
  barcode: "barcode",
  "current hours": "current_hours",
  current_hours: "current_hours",
  "current miles": "current_miles",
  current_miles: "current_miles",
  "usage tracking": "usage_tracking",
  usage_tracking: "usage_tracking",
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
      : Array.isArray((parsed as { records?: unknown; items?: unknown }).records)
        ? ((parsed as { records: unknown[] }).records as unknown[])
        : Array.isArray((parsed as { items?: unknown }).items)
          ? ((parsed as { items: unknown[] }).items as unknown[])
          : null;
    if (!arr) throw new Error("JSON must be an array or {records:[…]} / {items:[…]}");
    return arr.map((r) => mapRowKeys(r as Record<string, unknown>));
  }
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

function InventoryPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listInventory);
  const importFn = useServerFn(importInventory);
  const deleteFn = useServerFn(deleteInventory);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => listFn(),
  });

  const [pending, setPending] = useState<Record<string, unknown>[] | null>(null);
  const [pendingName, setPendingName] = useState<string>("");
  const [mode, setMode] = useState<"append" | "merge" | "replace">("append");
  const [mergeKey, setMergeKey] = useState<"sku" | "name">("sku");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!pending) return null;
      return importFn({
        data: { records: pending as never[], mode, mergeKey },
      });
    },
    onSuccess: (res) => {
      if (res) {
        const parts: string[] = [];
        if (res.inserted) parts.push(`${res.inserted} added`);
        if (res.updated) parts.push(`${res.updated} updated`);
        toast.success(`Imported — ${parts.join(", ") || "no changes"}`);
        setPending(null);
        setPendingName("");
        if (fileRef.current) fileRef.current.value = "";
        qc.invalidateQueries({ queryKey: ["inventory"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
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

  const locations = new Set(items.map((i) => i.location).filter(Boolean) as string[]);
  const stats = {
    total: items.length,
    locations: locations.size,
    low: items.filter(
      (i) =>
        i.reorder_level != null &&
        i.quantity != null &&
        Number(i.quantity) <= Number(i.reorder_level),
    ).length,
  };

  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-3.5rem)] bg-background text-foreground">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-start justify-between gap-6 mb-10 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-4">
                <Package className="h-3 w-3" /> Inventory
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                Know what's on hand, <span className="text-gradient-amber">always.</span>
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Track supplies, feed, parts, and equipment. Import existing stock from CSV or JSON.
              </p>
              <p className="mt-2 text-xs text-muted-foreground/80 max-w-2xl">
                Welcoming Pages preset is built in — exports of <code className="text-primary/80">assets</code> or <code className="text-primary/80">consumables</code> map automatically (quantity_in_stock, min_quantity, cost_per_unit, unit, category).
              </p>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap">
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
                  if (items.length === 0) {
                    toast.info("No inventory to export");
                    return;
                  }
                  const csv = rowsToCsv(items as never, [
                    { key: "sku", label: "sku" },
                    { key: "name", label: "name" },
                    { key: "description", label: "description" },
                    { key: "category", label: "category" },
                    { key: "location", label: "location" },
                    { key: "quantity", label: "quantity" },
                    { key: "unit", label: "unit" },
                    { key: "min_quantity", label: "min_quantity" },
                    { key: "reorder_level", label: "reorder_level" },
                    { key: "unit_cost", label: "unit_cost" },
                    { key: "vendor", label: "vendor" },
                    { key: "status", label: "status" },
                    { key: "tags", label: "tags" },
                    { key: "barcode", label: "barcode" },
                    { key: "current_hours", label: "current_hours" },
                    { key: "current_miles", label: "current_miles" },
                    { key: "usage_tracking", label: "usage_tracking" },
                    { key: "notes", label: "notes" },
                  ]);
                  downloadCsv(
                    `inventory_${new Date().toISOString().slice(0, 10)}.csv`,
                    csv,
                  );
                  toast.success(`Exported ${items.length} item${items.length === 1 ? "" : "s"}`);
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
              <NewRecordDialog
                kind="inventory"
                trigger={
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow">
                    <Plus className="h-4 w-4 mr-1" /> New item
                  </Button>
                }
              />
            </div>
          </div>

          <WelcomingPagesImportHelper kind="inventory" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {[
              { label: "Total items", value: String(stats.total), icon: Boxes },
              { label: "Locations", value: String(stats.locations), icon: Package },
              { label: "Below reorder level", value: String(stats.low), icon: AlertTriangle },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-gradient-card p-5 shadow-glow">
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
                  <div className="flex items-center gap-1 rounded-md border border-border bg-card/60 p-1 text-xs">
                    {(["append", "merge", "replace"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`px-2.5 py-1 rounded ${
                          mode === m
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m === "append" ? "Add new" : m === "merge" ? "Merge" : "Replace all"}
                      </button>
                    ))}
                  </div>
                  {mode === "merge" && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Match on
                      <select
                        value={mergeKey}
                        onChange={(e) => setMergeKey(e.target.value as "sku" | "name")}
                        className="bg-card border border-border rounded px-1.5 py-1 text-foreground"
                      >
                        <option value="sku">SKU</option>
                        <option value="name">Name</option>
                      </select>
                    </label>
                  )}
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
              Loading items…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/40 p-10 text-center">
              <Package className="h-10 w-10 text-primary mx-auto mb-3" />
              <h2 className="text-xl font-semibold mb-1">No inventory items yet</h2>
              <p className="text-muted-foreground mb-4">
                Upload a CSV/JSON export to bring stock forward, or add your first item.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Upload className="h-4 w-4 mr-1" /> Import file
                </Button>
                <NewRecordDialog
                  kind="inventory"
                  trigger={
                    <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow">
                      <Plus className="h-4 w-4 mr-1" /> New item
                    </Button>
                  }
                />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-card/80 text-muted-foreground text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">SKU</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Location</th>
                    <th className="px-4 py-2 font-medium">Qty</th>
                    <th className="px-4 py-2 font-medium">Reorder</th>
                    <th className="px-4 py-2 font-medium">Unit cost</th>
                    <th className="px-4 py-2 font-medium">Vendor</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const low =
                      r.reorder_level != null &&
                      r.quantity != null &&
                      Number(r.quantity) <= Number(r.reorder_level);
                    return (
                      <tr key={r.id} className="border-t border-border hover:bg-card/60">
                        <td className="px-4 py-2 text-muted-foreground">{r.sku ?? "—"}</td>
                        <td className="px-4 py-2">{r.name ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.category ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.location ?? "—"}</td>
                        <td className={`px-4 py-2 ${low ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                          {r.quantity ?? "—"}
                          {r.unit ? ` ${r.unit}` : ""}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{r.reorder_level ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {r.unit_cost != null ? `$${Number(r.unit_cost).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{r.vendor ?? "—"}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => deleteMut.mutate(r.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Delete item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
