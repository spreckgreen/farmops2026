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
import AssetDialog from "@/components/dashboard/AssetDialog";
import AssetTable from "@/components/dashboard/AssetTable";
import StatsCards from "@/components/dashboard/StatsCards";
import BarcodeScanner from "@/components/dashboard/BarcodeScanner";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import type { Asset, AssetFormData } from "@/components/dashboard/types";
import { INVENTORY_TYPES } from "@/lib/obsidian-layout";


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
    const headers = [
      "name",
      "description",
      "item_type",
      "location",
      "quantity",
      "min_quantity",
      "status",
      "barcode",
      "tags",
    ];
    const rows = filtered.map((a) =>
      [
        a.name ?? "",
        a.description ?? "",
        a.item_type ?? "",
        a.location ?? "",
        a.quantity ?? 0,
        a.min_quantity ?? 0,
        a.status,
        a.barcode || "",
        (a.tags || []).join(";"),
      ]
        .map((v) => `"${v}"`)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "assets-export.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported successfully");
  };


  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.replace(/"/g, "").trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = vals[i] || "";
        });
        return obj;
      });

      const inserts = rows.map((r) => ({
        user_id: session!.user.id,
        name: r.name || "Unnamed",
        description: r.description || "",
        category: r.category || "",
        location: r.location || "",
        quantity: parseInt(r.quantity) || 1,
        min_quantity: parseInt(r.min_quantity) || 0,
        status: ["available", "in_use", "maintenance", "retired"].includes(r.status)
          ? r.status
          : "available",
        tags: r.tags ? r.tags.split(";").filter(Boolean) : [],
      }));

      const { error } = await supabase.from("inventory_items").insert(inserts);
      if (error) return toast.error("Import failed: " + error.message);
      toast.success(`Imported ${inserts.length} assets`);
      fetchAssets();
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const categories = [...new Set(assets.map((a) => a.category).filter(Boolean))] as string[];

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch =
      (a.name || "").toLowerCase().includes(q) ||
      (a.description || "").toLowerCase().includes(q) ||
      (a.category || "").toLowerCase().includes(q) ||
      (a.location || "").toLowerCase().includes(q) ||
      (a.barcode || "").toLowerCase().includes(q) ||
      (a.tags || []).some((t) => t.toLowerCase().includes(q));
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    const matchesCategory = categoryFilter === "all" || a.category === categoryFilter;
    const minQ = a.min_quantity ?? 0;
    const qty = a.quantity ?? 0;
    const matchesLowStock = !showLowStock || (minQ > 0 && qty <= minQ);
    return matchesSearch && matchesStatus && matchesCategory && matchesLowStock;
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
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
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
          <AssetTable assets={filtered} onEdit={handleEdit} onDelete={handleDelete} />
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

      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(code) => {
          setScannerOpen(false);
          setSearch(code);
        }}
      />
    </AppLayout>
  );
}
