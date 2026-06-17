import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Package, Upload, Loader2, Search } from "lucide-react";
import Papa from "papaparse";
import {
  listFoodStorage,
  upsertFoodStorageItem,
  deleteFoodStorageItem,
  bulkInsertFoodStorage,
} from "@/lib/food.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/food/storage")({
  component: StoragePage,
});

type StorageImportItem = {
  name: string;
  description: string | null;
  category: string | null;
  food_type: string | null;
  location: string | null;
  quantity: number;
  unit: string;
  acquired_on: string | null;
  best_by: string | null;
  status: string;
  source_url: string | null;
  price: number | null;
  notes: string | null;
};

type Item = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  food_type: string | null;
  location: string | null;
  quantity: number;
  unit: string;
  acquired_on: string | null;
  best_by: string | null;
  status: string;
  source_url: string | null;
  price: number | null;
  notes: string | null;
};

const STATUSES = ["available", "consumed", "expired", "reserved"] as const;

const empty = {
  id: null as string | null,
  name: "",
  description: "",
  category: "Freeze Dried",
  food_type: "",
  location: "",
  quantity: 0,
  unit: "lb",
  acquired_on: "",
  best_by: "",
  status: "available",
  source_url: "",
  price: "" as number | "",
  notes: "",
};

const TYPE_COLORS: Record<string, string> = {
  Protein: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  Vegitable: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  Vegetable: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  Fruit: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  Dessert: "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40",
};

function StoragePage() {
  const qc = useQueryClient();
  const list = useServerFn(listFoodStorage);
  const upsert = useServerFn(upsertFoodStorageItem);
  const remove = useServerFn(deleteFoodStorageItem);
  const bulk = useServerFn(bulkInsertFoodStorage);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food-storage"],
    queryFn: () => list(),
  });

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [type, setType] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const categories = useMemo(
    () => Array.from(new Set((items as Item[]).map((i) => i.category).filter(Boolean))) as string[],
    [items],
  );
  const types = useMemo(
    () => Array.from(new Set((items as Item[]).map((i) => i.food_type).filter(Boolean))) as string[],
    [items],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items as Item[]).filter((i) => {
      if (cat !== "all" && i.category !== cat) return false;
      if (type !== "all" && i.food_type !== type) return false;
      if (needle) {
        const hay = `${i.name} ${i.description ?? ""} ${i.location ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, cat, type]);

  const totalLbs = filtered.reduce((s, i) => s + (i.unit === "lb" ? Number(i.quantity) || 0 : 0), 0);

  const upsertM = useMutation({
    mutationFn: (v: typeof empty) =>
      upsert({
        data: {
          id: v.id,
          name: v.name,
          description: v.description,
          category: v.category,
          food_type: v.food_type,
          location: v.location,
          quantity: Number(v.quantity) || 0,
          unit: v.unit,
          acquired_on: v.acquired_on || null,
          best_by: v.best_by || null,
          status: v.status,
          source_url: v.source_url,
          price: v.price === "" ? null : Number(v.price),
          notes: v.notes,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["food-storage"] });
      setOpen(false);
      setForm(empty);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["food-storage"] });
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importM = useMutation({
    mutationFn: (its: StorageImportItem[]) => bulk({ data: { items: its } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["food-storage"] });
      toast.success(`Imported ${r.inserted} items`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setForm(empty);
    setOpen(true);
  }
  function openEdit(i: Item) {
    setForm({
      id: i.id,
      name: i.name,
      description: i.description ?? "",
      category: i.category ?? "",
      food_type: i.food_type ?? "",
      location: i.location ?? "",
      quantity: Number(i.quantity) || 0,
      unit: i.unit || "lb",
      acquired_on: i.acquired_on ?? "",
      best_by: i.best_by ?? "",
      status: i.status,
      source_url: i.source_url ?? "",
      price: i.price ?? "",
      notes: i.notes ?? "",
    });
    setOpen(true);
  }

  function parseDate(s: string): string | null {
    const t = (s || "").trim();
    if (!t) return null;
    // try dd-MMM-yy
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(t);
    if (m) {
      const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const mo = months[m[2].toLowerCase()];
      if (mo) {
        const y = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${y}-${mo}-${m[1].padStart(2, "0")}`;
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return null;
  }

  function handleImport(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const items = res.data
          .map((row) => {
            const name = String(row.itemTitle ?? row.name ?? "").trim();
            if (!name) return null;
            return {
              name,
              description: String(row.itemDesc ?? row.description ?? "").trim() || null,
              category: String(row.itemCatTitle ?? row.category ?? "").trim() || null,
              food_type: String(row["Food Type"] ?? row.food_type ?? "").trim() || null,
              location: String(row.PackTitle ?? row.location ?? "").trim() || null,
              quantity: parseFloat(String(row.itemWeight ?? row.quantity ?? "0")) || 0,
              unit: String(row.unit ?? "lb").trim() || "lb",
              acquired_on: parseDate(String(row.itemAcquired ?? row.acquired_on ?? "")),
              best_by: parseDate(String(row.best_by ?? "")),
              status: "available",
              source_url: String(row.itemURL ?? row.source_url ?? "").trim() || null,
              price: row.itemPrice ? parseFloat(String(row.itemPrice)) || null : null,
              notes: String(row.notes ?? "").trim() || null,
            };
          })
          .filter(Boolean) as StorageImportItem[];
        if (!items.length) {
          toast.error("No valid rows. Required: itemTitle or name");
          return;
        }
        importM.mutate(items);
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold flex items-center gap-2">
            <Package className="h-4 w-4" /> Food storage
          </h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length} items · {totalLbs.toFixed(2)} lb total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="storage-csv" className="cursor-pointer">
            <span className="inline-flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm hover:bg-muted">
              {importM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import CSV
            </span>
            <input
              id="storage-csv"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.currentTarget.value = "";
              }}
            />
          </Label>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Add item
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-8" />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No items.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Location</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-left px-3 py-2">Acquired</th>
                <th className="text-left px-3 py-2">Best by</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono">
                    <div>{i.name}</div>
                    {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {i.food_type && (
                      <Badge variant="outline" className={TYPE_COLORS[i.food_type] ?? ""}>{i.food_type}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{i.location}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(i.quantity).toFixed(2)} {i.unit}</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.acquired_on ?? ""}</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.best_by ?? ""}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(i)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteM.mutate(i.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit item" : "Add item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Freeze Dried" />
              </div>
              <div>
                <Label>Food type</Label>
                <Input value={form.food_type} onChange={(e) => setForm({ ...form, food_type: e.target.value })} placeholder="Protein" />
              </div>
              <div>
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="YellowBin01" />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Unit</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
              <div>
                <Label>Acquired</Label>
                <Input type="date" value={form.acquired_on} onChange={(e) => setForm({ ...form, acquired_on: e.target.value })} />
              </div>
              <div>
                <Label>Best by</Label>
                <Input type="date" value={form.best_by} onChange={(e) => setForm({ ...form, best_by: e.target.value })} />
              </div>
              <div>
                <Label>Price</Label>
                <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value === "" ? "" : parseFloat(e.target.value) })} />
              </div>
              <div>
                <Label>Source URL</Label>
                <Input value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => upsertM.mutate(form)} disabled={upsertM.isPending || !form.name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
