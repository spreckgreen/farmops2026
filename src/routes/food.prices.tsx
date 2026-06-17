import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Minus, History, Download } from "lucide-react";
import { listPriceHistory } from "@/lib/food.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toFixed(2)}`;
}

function PriceHistoryPage() {
  const list = useServerFn(listPriceHistory);
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["food-price-history"],
    queryFn: () => list(),
  });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Price History</h2>
          <p className="text-sm text-muted-foreground">
            Tracks every $/lb change to your food catalog.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Filter by food…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-60"
          />
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
          No price changes recorded yet. Update a price on the Plan tab to log it here.
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
                            <ArrowUp className="h-3 w-3" />${diff.toFixed(2)}
                          </span>
                        ) : diff < 0 ? (
                          <span className="text-emerald-400 inline-flex items-center gap-1 justify-end">
                            <ArrowDown className="h-3 w-3" />${Math.abs(diff).toFixed(2)}
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
                <div>
                  <div className="text-xs text-muted-foreground font-mono">PRICE HISTORY</div>
                  <div className="text-lg font-mono font-semibold">{detail.name}</div>
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
                            {diff > 0 ? "+" : "-"}${Math.abs(diff).toFixed(2)}
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
    </div>
  );
}
