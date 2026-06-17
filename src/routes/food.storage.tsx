import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment as FragmentGroup, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Package, Upload, Loader2, Search, Download, Boxes, ClipboardList } from "lucide-react";
import Papa from "papaparse";
import {
  listFoodStorage,
  upsertFoodStorageItem,
  deleteFoodStorageItem,
  bulkInsertFoodStorage,
  listFoodStoragePlan,
  upsertFoodStoragePlanRow,
  deleteFoodStoragePlanRow,
  seedFoodStoragePlanFromPlan,
} from "@/lib/food.functions";
import { fmtUsd } from "@/lib/currency";
import { kcalFromLbs, fmtKcal } from "@/lib/calories";
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
  component: StorageRoute,
});

type SubTab = "inventory" | "plan";

function StorageRoute() {
  const [tab, setTab] = useState<SubTab>("inventory");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-border">
        <SubTabBtn active={tab === "inventory"} onClick={() => setTab("inventory")} icon={<Boxes className="h-4 w-4" />}>
          Inventory
        </SubTabBtn>
        <SubTabBtn active={tab === "plan"} onClick={() => setTab("plan")} icon={<ClipboardList className="h-4 w-4" />}>
          Long term plan
        </SubTabBtn>
      </div>
      {tab === "inventory" ? <InventoryPanel /> : <LongTermPlanPanel />}
    </div>
  );
}

function SubTabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-mono inline-flex items-center gap-2 border-b-2 -mb-px ${
        active ? "text-foreground border-foreground" : "text-muted-foreground border-transparent hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Inventory

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

// Freeze-dried foods are stored dry; one pound reconstitutes to roughly three
// pounds of as-eaten food. Calorie estimates in the kcal table assume
// as-eaten weight, so we convert freeze-dried qty to reconstituted lbs for
// any weight/kcal displays or roll-ups.
const RECONSTITUTION_FACTOR = 3;
function isFreezeDried(category: string | null | undefined): boolean {
  return !!category && /freeze/i.test(category);
}
function reconstitutedLbs(quantity: number, unit: string | null | undefined, category: string | null | undefined): number {
  const qty = Number(quantity) || 0;
  if ((unit ?? "lb") !== "lb") return qty;
  return isFreezeDried(category) ? qty * RECONSTITUTION_FACTOR : qty;
}

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

function InventoryPanel() {
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

  const totalLbs = filtered.reduce(
    (s, i) => s + reconstitutedLbs(Number(i.quantity) || 0, i.unit, i.category),
    0,
  );
  const totalKcal = filtered.reduce(
    (s, i) => s + kcalFromLbs(i.name, reconstitutedLbs(Number(i.quantity) || 0, i.unit, i.category)),
    0,
  );
  const freezeDriedCount = filtered.filter((i) => isFreezeDried(i.category)).length;

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
            {filtered.length} items · {totalLbs.toFixed(2)} lb reconstituted (consumable) · {fmtKcal(totalKcal)}
            {freezeDriedCount > 0 ? ` · ${freezeDriedCount} freeze-dried (stored ×${RECONSTITUTION_FACTOR} = reconstituted)` : ""}
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
                <th className="text-right px-3 py-2">Kcal</th>
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
                  <td className="px-3 py-2 text-right font-mono">
                    {(() => {
                      const qty = Number(i.quantity) || 0;
                      const fd = isFreezeDried(i.category) && (i.unit ?? "lb") === "lb";
                      const recon = reconstitutedLbs(qty, i.unit, i.category);
                      return (
                        <>
                          <div>{qty.toFixed(2)} {i.unit}{fd ? " dry" : ""}</div>
                          {fd && (
                            <div className="text-xs text-muted-foreground">
                              ≈ {recon.toFixed(2)} lb reconstituted
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {fmtKcal(kcalFromLbs(i.name, reconstitutedLbs(Number(i.quantity) || 0, i.unit, i.category)))}
                  </td>
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

// ---------------------------------------------------------------- Long term plan

type PlanRow = {
  id: string;
  name: string;
  category: string | null;
  food_type: string | null;
  pounds_per_year: number | string;
  target_months: number | string;
  price_per_pound: number | string | null;
  notes: string | null;
  sort_order: number;
  updated_at?: string | null;
};

type PlanField =
  | "name"
  | "category"
  | "food_type"
  | "pounds_per_year"
  | "target_months"
  | "price_per_pound"
  | "notes"
  | "sort_order";


type StorageRow = {
  id: string;
  name: string;
  category: string | null;
  quantity: number | string;
  unit: string;
  status: string;
};

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const emptyPlan = {
  id: null as string | null,
  name: "",
  category: "",
  food_type: "",
  pounds_per_year: 0,
  target_months: 12,
  price_per_pound: "" as number | "",
  notes: "",
  sort_order: 0,
};

function LongTermPlanPanel() {
  const qc = useQueryClient();
  const listPlan = useServerFn(listFoodStoragePlan);
  const listStorage = useServerFn(listFoodStorage);
  const upsert = useServerFn(upsertFoodStoragePlanRow);
  const remove = useServerFn(deleteFoodStoragePlanRow);
  const seedFn = useServerFn(seedFoodStoragePlanFromPlan);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["food-storage-plan"],
    queryFn: () => listPlan(),
  });
  const { data: storage = [] } = useQuery({
    queryKey: ["food-storage"],
    queryFn: () => listStorage(),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyPlan);

  const onHandByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of storage as StorageRow[]) {
      if (s.status !== "available") continue;
      if (s.unit !== "lb") continue;
      const key = normalizeName(s.name);
      m.set(key, (m.get(key) ?? 0) + reconstitutedLbs(Number(s.quantity) || 0, s.unit, s.category));
    }
    return m;
  }, [storage]);

  const computed = useMemo(() => {
    return (rows as PlanRow[]).map((r) => {
      const ppY = Number(r.pounds_per_year) || 0;
      const months = Number(r.target_months) || 0;
      const targetLbs = (ppY * months) / 12;
      const onHand = onHandByName.get(normalizeName(r.name)) ?? 0;
      const gapLbs = Math.max(0, targetLbs - onHand);
      const price = r.price_per_pound == null ? null : Number(r.price_per_pound);
      const targetCost = price != null ? targetLbs * price : null;
      const gapCost = price != null ? gapLbs * price : null;
      const targetKcal = kcalFromLbs(r.name, targetLbs);
      const onHandKcal = kcalFromLbs(r.name, onHand);
      const gapKcal = kcalFromLbs(r.name, gapLbs);
      const ppYKcal = kcalFromLbs(r.name, ppY);
      return { row: r, targetLbs, onHand, gapLbs, targetCost, gapCost, price, targetKcal, onHandKcal, gapKcal, ppYKcal };
    });
  }, [rows, onHandByName]);

  const totals = useMemo(() => {
    let target = 0, onHand = 0, gap = 0, targetCost = 0, gapCost = 0;
    let targetKcal = 0, onHandKcal = 0, gapKcal = 0;
    for (const c of computed) {
      target += c.targetLbs;
      onHand += c.onHand;
      gap += c.gapLbs;
      if (c.targetCost) targetCost += c.targetCost;
      if (c.gapCost) gapCost += c.gapCost;
      targetKcal += c.targetKcal;
      onHandKcal += c.onHandKcal;
      gapKcal += c.gapKcal;
    }
    return { target, onHand, gap, targetCost, gapCost, targetKcal, onHandKcal, gapKcal };
  }, [computed]);

  const grouped = useMemo(() => {
    const g = new Map<string, typeof computed>();
    for (const c of computed) {
      const k = c.row.category || "Uncategorized";
      const arr = g.get(k) ?? [];
      arr.push(c);
      g.set(k, arr);
    }
    return Array.from(g.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [computed]);

  const ALL_PLAN_FIELDS: PlanField[] = [
    "name", "category", "food_type", "pounds_per_year",
    "target_months", "price_per_pound", "notes", "sort_order",
  ];

  const upsertM = useMutation({
    mutationFn: (v: typeof emptyPlan) => {
      const current = v.id
        ? (qc.getQueryData<PlanRow[]>(["food-storage-plan"]) ?? []).find((r) => r.id === v.id)
        : undefined;
      return upsert({
        data: {
          id: v.id,
          name: v.name,
          category: v.category,
          food_type: v.food_type,
          pounds_per_year: Number(v.pounds_per_year) || 0,
          target_months: Number(v.target_months) || 0,
          price_per_pound: v.price_per_pound === "" ? null : Number(v.price_per_pound),
          notes: v.notes,
          sort_order: v.sort_order ?? 0,
          expected_updated_at: current?.updated_at ?? null,
          changed_fields: ALL_PLAN_FIELDS,
        },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["food-storage-plan"] });
      setOpen(false);
      setForm(emptyPlan);
      if (res.conflict) {
        toast.warning("Saved — but the row had changed elsewhere. Your edits were merged on top.");
      } else {
        toast.success("Saved");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inlineUpsertM = useMutation({
    mutationFn: ({ row, field }: { row: PlanRow; field: PlanField }) =>
      upsert({
        data: {
          id: row.id,
          name: row.name,
          category: row.category,
          food_type: row.food_type,
          pounds_per_year: Number(row.pounds_per_year) || 0,
          target_months: Number(row.target_months) || 0,
          price_per_pound: row.price_per_pound == null ? null : Number(row.price_per_pound),
          notes: row.notes,
          sort_order: row.sort_order,
          expected_updated_at: row.updated_at ?? null,
          changed_fields: [field],
        },
      }),
    onMutate: async ({ row }) => {
      await qc.cancelQueries({ queryKey: ["food-storage-plan"] });
      const prev = qc.getQueryData<PlanRow[]>(["food-storage-plan"]);
      qc.setQueryData<PlanRow[]>(["food-storage-plan"], (old) =>
        (old ?? []).map((r) => (r.id === row.id ? { ...r, ...row } : r)),
      );
      return { prev };
    },
    onSuccess: (res, { field }) => {
      // Replace the row in cache with the authoritative server row (so updated_at
      // advances and any concurrent server-side changes show through).
      qc.setQueryData<PlanRow[]>(["food-storage-plan"], (old) =>
        (old ?? []).map((r) => (r.id === res.row.id ? (res.row as PlanRow) : r)),
      );
      if (res.conflict) {
        toast.warning(
          `Merged change to ${field.replace(/_/g, " ")} — another edit landed first, so other fields were kept.`,
        );
      }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["food-storage-plan"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["food-storage-plan"] }),
  });



  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["food-storage-plan"] });
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seedM = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["food-storage-plan"] });
      toast.success(`Seeded ${r.inserted} foods from Plan tab`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setForm(emptyPlan);
    setOpen(true);
  }
  function openEdit(r: PlanRow) {
    setForm({
      id: r.id,
      name: r.name,
      category: r.category ?? "",
      food_type: r.food_type ?? "",
      pounds_per_year: Number(r.pounds_per_year) || 0,
      target_months: Number(r.target_months) || 12,
      price_per_pound: r.price_per_pound == null ? "" : Number(r.price_per_pound),
      notes: r.notes ?? "",
      sort_order: r.sort_order ?? 0,
    });
    setOpen(true);
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  if ((rows as PlanRow[]).length === 0) {
    return (
      <div className="space-y-4">
        <div className="border border-dashed border-border rounded-lg p-10 text-center">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="font-mono font-semibold mb-1">No long-term plan yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Seed the plan from the Plan tab (uses people × weekly servings × 52 to compute pounds/year per food)
            or start from scratch by adding rows.
          </p>
          <div className="flex items-center gap-2 justify-center">
            <Button onClick={() => seedM.mutate()} disabled={seedM.isPending}>
              <Download className="h-4 w-4 mr-2" />
              {seedM.isPending ? "Seeding…" : "Seed from Plan tab"}
            </Button>
            <Button variant="outline" onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> Add row
            </Button>
          </div>
        </div>
        <PlanEditDialog open={open} onOpenChange={setOpen} form={form} setForm={setForm}
          onSave={() => upsertM.mutate(form)} saving={upsertM.isPending} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Long term storage plan
          </h2>
          <p className="text-sm text-muted-foreground">
            {(rows as PlanRow[]).length} foods · target {totals.target.toFixed(0)} lb ({fmtKcal(totals.targetKcal)})
            {" · "}on hand {totals.onHand.toFixed(0)} lb ({fmtKcal(totals.onHandKcal)})
            {" · "}gap {totals.gap.toFixed(0)} lb ({fmtKcal(totals.gapKcal)})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => seedM.mutate()} disabled={seedM.isPending}>
            <Download className="h-3.5 w-3.5 mr-2" />
            Re-seed from Plan
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Add row
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Target lb" value={totals.target.toFixed(0)} sub={fmtKcal(totals.targetKcal)} />
        <Stat label="On hand lb" value={totals.onHand.toFixed(0)} sub={fmtKcal(totals.onHandKcal)} />
        <Stat label="Gap lb" value={totals.gap.toFixed(0)} sub={fmtKcal(totals.gapKcal)} tone={totals.gap > 0 ? "red" : "green"} />
        <Stat label="Target cost" value={fmtUsd(totals.targetCost)} />
        <Stat label="Gap cost" value={fmtUsd(totals.gapCost)} tone={totals.gapCost > 0 ? "red" : "green"} />
      </div>

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-2">Food</th>
              <th className="text-right px-2 py-2 w-20">lb/yr</th>
              <th className="text-right px-2 py-2 w-16">Months</th>
              <th className="text-right px-2 py-2 w-20">Target lb</th>
              <th className="text-right px-2 py-2 w-20">On hand</th>
              <th className="text-right px-2 py-2 w-20">Gap lb</th>
              <th className="text-right px-2 py-2 w-20">$/lb</th>
              <th className="text-right px-2 py-2 w-24">Gap cost</th>
              <th className="px-2 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([cat, items]) => (
              <FragmentGroup key={`cat-${cat}`}>
                <tr className="bg-muted/20 border-t border-border">
                  <td colSpan={9} className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{cat}</td>
                </tr>
                {items.map((c) => (
                  <tr key={c.row.id} className="border-t border-border hover:bg-accent/20">
                    <td className="px-2 py-1">
                      <div>{c.row.name}</div>
                      {c.row.food_type && <div className="text-[10px] text-muted-foreground">{c.row.food_type}</div>}
                    </td>
                    <td className="p-0 text-right">
                      <input
                        type="number" step="any" defaultValue={Number(c.row.pounds_per_year) || ""}
                        className="w-full h-7 px-2 bg-transparent text-right focus:bg-accent outline-none"
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value || "0") || 0;
                          if (v === Number(c.row.pounds_per_year)) return;
                          inlineUpsertM.mutate({ row: { ...c.row, pounds_per_year: v }, field: "pounds_per_year" });
                        }}
                      />
                    </td>
                    <td className="p-0 text-right">
                      <input
                        type="number" step="any" defaultValue={Number(c.row.target_months) || ""}
                        className="w-full h-7 px-2 bg-transparent text-right focus:bg-accent outline-none"
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value || "0") || 0;
                          if (v === Number(c.row.target_months)) return;
                          inlineUpsertM.mutate({ row: { ...c.row, target_months: v }, field: "target_months" });
                        }}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <div>{c.targetLbs.toFixed(1)}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtKcal(c.targetKcal)}</div>
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground">
                      <div>{c.onHand.toFixed(1)}</div>
                      <div className="text-[10px]">{fmtKcal(c.onHandKcal)}</div>
                    </td>
                    <td className={`px-2 py-1 text-right ${c.gapLbs > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      <div>{c.gapLbs.toFixed(1)}</div>
                      <div className="text-[10px] opacity-80">{fmtKcal(c.gapKcal)}</div>
                    </td>
                    <td className="p-0 text-right">
                      <input
                        type="number" step="any" defaultValue={c.price != null ? c.price : ""}
                        className="w-full h-7 px-2 bg-transparent text-right focus:bg-accent outline-none"
                        onBlur={(e) => {
                          const t = e.target.value;
                          const v = t === "" ? null : parseFloat(t) || 0;
                          if (v === c.price) return;
                          inlineUpsertM.mutate({ row: { ...c.row, price_per_pound: v }, field: "price_per_pound" });
                        }}
                      />
                    </td>
                    <td className={`px-2 py-1 text-right ${c.gapCost && c.gapCost > 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                      {c.gapCost != null ? fmtUsd(c.gapCost) : "—"}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEdit(c.row)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive"
                        onClick={() => {
                          if (confirm(`Remove "${c.row.name}" from plan?`)) deleteM.mutate(c.row.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </FragmentGroup>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Target lb = lb/yr × months ÷ 12. On-hand pulls from Inventory items (status available, unit lb) matched by name.
      </p>

      <PlanEditDialog open={open} onOpenChange={setOpen} form={form} setForm={setForm}
        onSave={() => upsertM.mutate(form)} saving={upsertM.isPending} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "green" }) {
  const toneCls = tone === "red" ? "text-rose-400" : tone === "green" ? "text-emerald-400" : "";
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-mono">{label}</div>
      <div className={`text-lg font-mono font-bold mt-0.5 ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{sub}</div>}
    </div>
  );
}

function PlanEditDialog({
  open, onOpenChange, form, setForm, onSave, saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: typeof emptyPlan;
  setForm: (v: typeof emptyPlan) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit plan row" : "Add plan row"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Food name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Breakfast / Lunch / Dinner / Other" />
          </div>
          <div>
            <Label>Food type</Label>
            <Input value={form.food_type} onChange={(e) => setForm({ ...form, food_type: e.target.value })} placeholder="Protein / Fruit / Vegetable" />
          </div>
          <div>
            <Label>Pounds / year</Label>
            <Input type="number" step="0.01" value={form.pounds_per_year}
              onChange={(e) => setForm({ ...form, pounds_per_year: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Target months</Label>
            <Input type="number" step="1" value={form.target_months}
              onChange={(e) => setForm({ ...form, target_months: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Price / lb</Label>
            <Input type="number" step="0.01" value={form.price_per_pound}
              onChange={(e) => setForm({ ...form, price_per_pound: e.target.value === "" ? "" : parseFloat(e.target.value) })} />
          </div>
          <div>
            <Label>Sort order</Label>
            <Input type="number" step="1" value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !form.name.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
