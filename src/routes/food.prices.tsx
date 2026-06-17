import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Minus, History, Download, Plus, RefreshCw, Loader2, Globe, Beef, Tags, ListChecks } from "lucide-react";
import { toast } from "sonner";
import {
  listPriceHistory,
  listFoodPlan,
  recordFoodPrice,
  refreshPricesSouthernOhio,
  seedLivestockProducts,
  autoClassifyFoodCategories,
  bulkUpdateFoodCategories,
} from "@/lib/food.functions";
import { fmtUsd, fmtUsdSigned } from "@/lib/currency";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/food/prices")({
  component: PriceHistoryPage,
});

type Entry = {
  id: string;
  food_id: string | null;
  food_name: string;
  old_price: number | null;
  new_price: number | null;
  changed_at: string;
};

type Food = { id: string; name: string; price_per_pound: number | null; category: string | null };

const SOURCE_LABEL = "Southern Ohio regional reference (Cincinnati / Dayton / Columbus retail + farmers' market avg)";

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return fmtUsd(Number(n));
}

function PriceHistoryPage() {
  const qc = useQueryClient();
  const list = useServerFn(listPriceHistory);
  const listPlan = useServerFn(listFoodPlan);
  const record = useServerFn(recordFoodPrice);
  const refresh = useServerFn(refreshPricesSouthernOhio);
  const seedLivestock = useServerFn(seedLivestockProducts);
  const reclassify = useServerFn(autoClassifyFoodCategories);
  const bulkUpdate = useServerFn(bulkUpdateFoodCategories);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["food-price-history"],
    queryFn: () => list(),
  });
  const { data: plan } = useQuery({
    queryKey: ["food-plan"],
    queryFn: () => listPlan(),
  });
  const foods: Food[] = useMemo(
    () => (((plan as { foods?: Food[] } | undefined)?.foods) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [plan],
  );

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addFoodId, setAddFoodId] = useState<string>("");
  const [addPrice, setAddPrice] = useState<string>("");

  const addM = useMutation({
    mutationFn: (vars: { food_id: string; new_price: number }) =>
      record({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["food-price-history"] });
      qc.invalidateQueries({ queryKey: ["food-plan"] });
      toast.success("Price recorded");
      setAddOpen(false);
      setAddFoodId("");
      setAddPrice("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshM = useMutation({
    mutationFn: () => refresh(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["food-price-history"] });
      qc.invalidateQueries({ queryKey: ["food-plan"] });
      toast.success(`Refreshed: ${r.updated} updated, ${r.unchanged} unchanged`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seedM = useMutation({
    mutationFn: () => seedLivestock(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["food-plan"] });
      toast.success(
        r.inserted
          ? `Added ${r.inserted} livestock items (${r.skipped} already present). Run Refresh to price them.`
          : "All livestock items already in catalog.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const classifyM = useMutation({
    mutationFn: (overwrite: boolean) => reclassify({ data: { overwriteExisting: overwrite } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["food-plan"] });
      qc.invalidateQueries({ queryKey: ["food", "yield-progress"] });
      toast.success(`Categories: ${r.updated} updated, ${r.unchanged} unchanged`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkM = useMutation({
    mutationFn: (updates: Array<{ id: string; category: string | null }>) =>
      bulkUpdate({ data: { updates } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["food-plan"] });
      qc.invalidateQueries({ queryKey: ["food", "yield-progress"] });
      toast.success(`Updated ${r.updated} food categories`);
      setBulkOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const byFood = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    (entries as Entry[]).forEach((e) => {
      const arr = groups.get(e.food_name) ?? [];
      arr.push(e);
      groups.set(e.food_name, arr);
    });
    return Array.from(groups.entries())
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => b.changed_at.localeCompare(a.changed_at)),
        latest: items[0],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return byFood;
    return byFood.filter((g) => g.name.toLowerCase().includes(q));
  }, [byFood, filter]);

  const detail = selected ? byFood.find((g) => g.name === selected) : null;

  function exportCsv(scope: "all" | "selected") {
    const rows: Entry[] =
      scope === "selected" && detail
        ? detail.items
        : (entries as Entry[]).slice().sort(
            (a, b) =>
              a.food_name.localeCompare(b.food_name) ||
              b.changed_at.localeCompare(a.changed_at),
          );
    if (rows.length === 0) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["food_name", "changed_at", "old_price_per_lb", "new_price_per_lb", "delta"];
    const body = rows.map((e) => {
      const delta =
        e.old_price !== null && e.new_price !== null
          ? (e.new_price - e.old_price).toFixed(4)
          : "";
      return [e.food_name, e.changed_at, e.old_price ?? "", e.new_price ?? "", delta]
        .map(esc)
        .join(",");
    });
    const csv = [header.join(","), ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    const name =
      scope === "selected" && detail
        ? `price-history-${detail.name.replace(/\s+/g, "_").toLowerCase()}-${stamp}.csv`
        : `price-history-${stamp}.csv`;
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openAdd(prefillName?: string) {
    if (prefillName) {
      const f = foods.find((x) => x.name === prefillName);
      if (f) {
        setAddFoodId(f.id);
        setAddPrice(f.price_per_pound != null ? String(f.price_per_pound) : "");
      }
    }
    setAddOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Price History</h2>
          <p className="text-sm text-muted-foreground">
            Tracks every $/lb change to your food catalog.
          </p>
          <p className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
            <Globe className="h-3 w-3" /> Reference source: {SOURCE_LABEL}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Filter by food…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-60"
          />
          <Button size="sm" onClick={() => openAdd(selected ?? undefined)}>
            <Plus className="h-4 w-4 mr-2" />
            Add price entry
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedM.mutate()}
            disabled={seedM.isPending}
            title="Add livestock-derived items (meat, eggs, dairy, fiber) to the catalog"
          >
            {seedM.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Beef className="h-4 w-4 mr-2" />
            )}
            Seed livestock items
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const overwrite = confirm(
                "Auto-classify food categories?\n\nOK = overwrite ALL recognizable items (recommended to fix wrong categories like 'Chicken' as a vegetable).\nCancel = fill only empty/Uncategorized items.",
              );
              classifyM.mutate(overwrite);
            }}
            disabled={classifyM.isPending || foods.length === 0}
            title="Auto-assign categories on the source pricing table based on food name"
          >
            {classifyM.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Tags className="h-4 w-4 mr-2" />
            )}
            Auto-classify
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshM.mutate()}
            disabled={refreshM.isPending || foods.length === 0}
            title="Refresh prices from Southern Ohio regional reference"
          >
            {refreshM.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh from S. Ohio
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv("selected")}
            disabled={!detail || detail.items.length === 0}
            title={detail ? `Export ${detail.name}` : "Select a food first"}
          >
            <Download className="h-4 w-4 mr-2" />
            Export selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv("all")}
            disabled={(entries as Entry[]).length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export all
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : byFood.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No price changes recorded yet. Add an entry or refresh from the regional reference to seed history.
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm font-mono">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Food</th>
                  <th className="text-right p-2">Current</th>
                  <th className="text-right p-2">Δ</th>
                  <th className="text-right p-2">Last change</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const e = g.latest;
                  const diff =
                    e.old_price !== null && e.new_price !== null
                      ? e.new_price - e.old_price
                      : null;
                  const isSel = selected === g.name;
                  return (
                    <tr
                      key={g.name}
                      onClick={() => setSelected(g.name)}
                      className={`border-t border-border cursor-pointer hover:bg-muted/30 ${isSel ? "bg-muted/40" : ""}`}
                    >
                      <td className="p-2">{g.name}</td>
                      <td className="p-2 text-right">{fmt(e.new_price)}</td>
                      <td className="p-2 text-right">
                        {diff === null ? (
                          <span className="text-muted-foreground inline-flex items-center gap-1 justify-end">
                            <Minus className="h-3 w-3" /> new
                          </span>
                        ) : diff > 0 ? (
                          <span className="text-red-400 inline-flex items-center gap-1 justify-end">
                            <ArrowUp className="h-3 w-3" />{fmtUsd(diff)}
                          </span>
                        ) : diff < 0 ? (
                          <span className="text-emerald-400 inline-flex items-center gap-1 justify-end">
                            <ArrowDown className="h-3 w-3" />{fmtUsd(Math.abs(diff))}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-right text-xs text-muted-foreground">
                        {format(new Date(e.changed_at), "MMM d, yyyy")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border border-border rounded-lg p-4">
            {!detail ? (
              <div className="text-sm text-muted-foreground">Select a food to see its full history.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono">PRICE HISTORY</div>
                    <div className="text-lg font-mono font-semibold">{detail.name}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openAdd(detail.name)}>
                    <Plus className="h-4 w-4 mr-1" /> New entry
                  </Button>
                </div>
                <ol className="space-y-2">
                  {detail.items.map((e) => {
                    const diff =
                      e.old_price !== null && e.new_price !== null ? e.new_price - e.old_price : null;
                    return (
                      <li key={e.id} className="flex items-center justify-between border-l-2 border-border pl-3 py-1 font-mono text-sm">
                        <div>
                          <div>{fmt(e.old_price)} → {fmt(e.new_price)}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(e.changed_at), "MMM d, yyyy · h:mm a")}
                          </div>
                        </div>
                        {diff !== null && diff !== 0 && (
                          <span className={`text-xs ${diff > 0 ? "text-red-400" : "text-emerald-400"}`}>
                            {fmtUsdSigned(diff)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add price entry</DialogTitle>
            <DialogDescription>
              Updates the food's current $/lb and logs a new entry to history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Food</Label>
              <Select value={addFoodId} onValueChange={setAddFoodId}>
                <SelectTrigger><SelectValue placeholder="Select a food…" /></SelectTrigger>
                <SelectContent>
                  {foods.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}{f.price_per_pound != null ? ` — ${fmtUsd(Number(f.price_per_pound))}/lb` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>New price ($/lb)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={addPrice}
                onChange={(e) => setAddPrice(e.target.value)}
                placeholder="3.49"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addM.mutate({ food_id: addFoodId, new_price: Number(addPrice) })}
              disabled={addM.isPending || !addFoodId || addPrice === "" || !Number.isFinite(Number(addPrice))}
            >
              {addM.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
