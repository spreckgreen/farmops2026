import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sprout, Loader2, Printer } from "lucide-react";
import { openPrintWindow, escapeHtml } from "@/lib/print";
import Papa from "papaparse";
import { CsvToolbar } from "@/components/csv-toolbar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  listGardenPlots,
  upsertGardenPlot,
  deleteGardenPlot,
  seedGardenFromTemplate,
  bulkUpsertGardenPlots,
  getGardenDashboard,
} from "@/lib/food.functions";
import { fmtUsd } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/food/garden")({
  component: GardenPage,
});

type Plot = {
  id: string;
  row_label: string;
  position: number;
  plant_name: string | null;
  notes: string | null;
};

const DEFAULT_ROWS = ["Row01","Row02","Row03","Row04","Row05","Row06","Row07","Row08"];
const DEFAULT_POSITIONS = 16;


function plantColor(name: string | null | undefined): string {
  if (!name) return "bg-muted/30 text-muted-foreground";
  const key = name.toLowerCase();
  if (key.includes("tomato")) return "bg-red-500/20 text-red-200 border-red-500/40";
  if (key.includes("pepper")) return "bg-orange-500/20 text-orange-200 border-orange-500/40";
  if (key.includes("cucumber")) return "bg-emerald-500/20 text-emerald-200 border-emerald-500/40";
  if (key.includes("cabbage")) return "bg-lime-500/20 text-lime-200 border-lime-500/40";
  if (key.includes("squash") || key.includes("melon")) return "bg-yellow-500/20 text-yellow-100 border-yellow-500/40";
  if (key.includes("bean") || key.includes("pea")) return "bg-green-500/20 text-green-200 border-green-500/40";
  if (key.includes("spinach") || key.includes("basil")) return "bg-teal-500/20 text-teal-100 border-teal-500/40";
  if (key.includes("beet") || key.includes("radish")) return "bg-fuchsia-500/20 text-fuchsia-100 border-fuchsia-500/40";
  if (key.includes("berr")) return "bg-purple-500/20 text-purple-100 border-purple-500/40";
  return "bg-sky-500/20 text-sky-100 border-sky-500/40";
}

function getPlantSeason(name: string): string {
  const k = name.toLowerCase();
  const spring = ["pea", "spinach", "lettuce", "cabbage", "radish", "beet", "broccoli", "kale", "cauliflower", "brussels", "carrot", "onion", "potato", "turnip", "parsnip", "leek", "asparagus", "rhubarb"];
  const summer = ["tomato", "pepper", "cucumber", "melon", "squash", "bean", "corn", "eggplant", "basil", "zucchini", "okra", "berry", "berries"];
  const fall = ["garlic", "pumpkin", "sweet potato", "yam", "winter squash"];
  if (spring.some((s) => k.includes(s))) return "Spring";
  if (summer.some((s) => k.includes(s))) return "Summer";
  if (fall.some((s) => k.includes(s))) return "Fall";
  return "Other";
}

function GardenPage() {
  const qc = useQueryClient();
  const list = useServerFn(listGardenPlots);
  const upsert = useServerFn(upsertGardenPlot);
  const remove = useServerFn(deleteGardenPlot);
  const seed = useServerFn(seedGardenFromTemplate);

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ["garden-plots"],
    queryFn: () => list(),
  });

  const dashFn = useServerFn(getGardenDashboard);
  const { data: dash } = useQuery({
    queryKey: ["garden-dashboard"],
    queryFn: () => dashFn(),
  });

  const [editing, setEditing] = useState<{ row: string; position: number; plot: Plot | null } | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [seasonFilter, setSeasonFilter] = useState<string>("All");

  const grid = useMemo(() => {
    const rows = new Set<string>(DEFAULT_ROWS);
    plots.forEach((p) => rows.add(p.row_label));
    const sortedRows = Array.from(rows).sort();
    const map = new Map<string, Plot>();
    plots.forEach((p) => map.set(`${p.row_label}_${p.position}`, p as Plot));
    return { rows: sortedRows, map };
  }, [plots]);

  const upsertM = useMutation({
    mutationFn: (vars: { id?: string | null; row_label: string; position: number; plant_name: string; notes: string }) =>
      upsert({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["garden-plots"] });
      setEditing(null);
      toast.success("Plot saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["garden-plots"] });
      setEditing(null);
      toast.success("Plot cleared");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seedM = useMutation({
    mutationFn: () => seed({}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["garden-plots"] });
      toast.success(`Loaded ${r.inserted} plots`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCell(row: string, position: number) {
    const plot = grid.map.get(`${row}_${position}`) ?? null;
    setEditing({ row, position, plot });
    setName(plot?.plant_name ?? "");
    setNotes(plot?.notes ?? "");
  }

  const bulk = useServerFn(bulkUpsertGardenPlots);
  const importM = useMutation({
    mutationFn: (plots: Array<{ row_label: string; position: number; plant_name: string; notes: string }>) =>
      bulk({ data: { plots } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["garden-plots"] });
      toast.success(`Imported ${r.inserted} plots`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleImport(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const plots: Array<{ row_label: string; position: number; plant_name: string; notes: string }> = [];
        for (const row of res.data) {
          const rowLabel = String(row.row_label ?? row.row ?? row.Row ?? "").trim();
          const pos = parseInt(String(row.position ?? row.pos ?? row.Position ?? ""), 10);
          const plant = String(row.plant_name ?? row.plant ?? row.Plant ?? "").trim();
          if (!rowLabel || !Number.isFinite(pos) || !plant) continue;
          plots.push({
            row_label: rowLabel,
            position: pos,
            plant_name: plant,
            notes: String(row.notes ?? "").trim(),
          });
        }
        if (!plots.length) {
          toast.error("No valid rows. Expect columns: row_label, position, plant_name, notes");
          return;
        }
        importM.mutate(plots);
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
  }

  function printGarden() {
    const positions = Array.from({ length: DEFAULT_POSITIONS }, (_, i) => i + 1);
    const head = `<tr><th></th>${positions.map((p) => `<th>P${String(p).padStart(2, "0")}</th>`).join("")}</tr>`;
    const body = grid.rows
      .map((row) => {
        const cells = positions
          .map((pos) => {
            const plot = grid.map.get(`${row}_${pos}`);
            if (!plot?.plant_name) return `<td class="empty">·</td>`;
            return `<td class="filled">${escapeHtml(plot.plant_name)}</td>`;
          })
          .join("");
        return `<tr><td class="row-label">${escapeHtml(row)}</td>${cells}</tr>`;
      })
      .join("");
    const filled = plots.filter((p) => p.plant_name).length;
    openPrintWindow(
      "Garden Layout",
      `<header><h1>Garden Layout</h1><div class="meta">${filled} plantings · printed ${new Date().toLocaleDateString()}</div></header>
       <table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Garden</h2>
          <p className="text-sm text-muted-foreground">Click any cell to plan or update what's planted.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={printGarden} disabled={isLoading}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          <CsvToolbar
            filename="garden-plots.csv"
            columns={[
              { key: "row_label", label: "row_label" },
              { key: "position", label: "position" },
              { key: "plant_name", label: "plant_name" },
              { key: "notes", label: "notes" },
            ]}
            rows={plots.map((p) => ({
              row_label: p.row_label,
              position: p.position,
              plant_name: p.plant_name ?? "",
              notes: p.notes ?? "",
            }))}
            onImport={(rows) => {
              const parsed: Array<{ row_label: string; position: number; plant_name: string; notes: string }> = [];
              for (const row of rows) {
                const rowLabel = String(row.row_label ?? row.row ?? row.Row ?? "").trim();
                const pos = parseInt(String(row.position ?? row.pos ?? row.Position ?? ""), 10);
                const plant = String(row.plant_name ?? row.plant ?? row.Plant ?? "").trim();
                if (!rowLabel || !Number.isFinite(pos) || !plant) continue;
                parsed.push({ row_label: rowLabel, position: pos, plant_name: plant, notes: String(row.notes ?? "").trim() });
              }
              if (!parsed.length) {
                toast.error("No valid rows. Expect columns: row_label, position, plant_name, notes");
                return;
              }
              importM.mutate(parsed);
            }}
            importing={importM.isPending}
          />
          {plots.length === 0 && !isLoading && (
            <Button onClick={() => seedM.mutate()} disabled={seedM.isPending} variant="outline">
              {seedM.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sprout className="h-4 w-4 mr-2" />}
              Load template
            </Button>
          )}
        </div>
      </div>

      {dash && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <DashStat label="Distinct plants" value={String(dash.summary.distinct_plants)} />
            <DashStat label="Total plants" value={String(dash.summary.total_plants)} />
            <DashStat
              label="Est. yield / season"
              value={`${dash.summary.total_expected_yield_lbs.toFixed(0)} lbs`}
            />
            <DashStat
              label="Yield value"
              value={fmtUsd(dash.summary.total_expected_yield_value)}
            />
            <DashStat
              label="Plan need / season"
              value={`${dash.summary.total_needed_lbs.toFixed(0)} lbs`}
            />
            <DashStat label="Gap value" value={fmtUsd(dash.summary.total_gap_value)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="border border-border rounded-md bg-card">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Plants · estimated seasonal yield
                </span>
                <Select value={seasonFilter} onValueChange={setSeasonFilter}>
                  <SelectTrigger className="h-7 w-auto min-w-[7rem] text-xs">
                    <SelectValue placeholder="Season" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All seasons</SelectItem>
                    <SelectItem value="Spring">Spring</SelectItem>
                    <SelectItem value="Summer">Summer</SelectItem>
                    <SelectItem value="Fall">Fall</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {dash.plants.filter((p) => p.count > 0).length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No plants in garden yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-1.5 font-normal">Plant</th>
                      <th className="text-right px-3 py-1.5 font-normal">Count</th>
                      <th className="text-right px-3 py-1.5 font-normal">lbs/plant</th>
                      <th className="text-right px-3 py-1.5 font-normal">Est. lbs</th>
                      <th className="text-right px-3 py-1.5 font-normal">Projected gap</th>
                      <th className="text-right px-3 py-1.5 font-normal">$/lb</th>
                      <th className="text-right px-3 py-1.5 font-normal">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.plants
                      .filter((p) => p.count > 0)
                      .filter((p) => seasonFilter === "All" || getPlantSeason(p.name) === seasonFilter)
                      .map((p) => (
                        <tr key={p.key} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-1.5 capitalize">{p.name}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{p.count}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                            {p.yield_per_plant_lbs}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {p.expected_yield_lbs.toFixed(1)}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-mono ${p.gap_lbs > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {p.needed_lbs > 0 ? (p.gap_lbs > 0 ? `${p.gap_lbs.toFixed(1)} lbs` : "—") : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                            {p.price_per_lb > 0 ? fmtUsd(p.price_per_lb) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {p.price_per_lb > 0 ? fmtUsd(p.expected_yield_value) : "—"}
                          </td>
                        </tr>
                      ))}

                  </tbody>
                </table>
              )}
            </div>

            <div className="border border-border rounded-md bg-card">
              <div className="px-3 py-2 border-b border-border text-xs font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Gaps · need vs. planted</span>
                <span>{dash.gaps.length} short</span>
              </div>
              {dash.gaps.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No gaps — every planned food is covered (or no plan entries).
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-1.5 font-normal">Plant</th>
                      <th className="text-right px-3 py-1.5 font-normal">Need lbs</th>
                      <th className="text-right px-3 py-1.5 font-normal">Have</th>
                      <th className="text-right px-3 py-1.5 font-normal">Need plants</th>
                      <th className="text-right px-3 py-1.5 font-normal text-destructive">Gap</th>
                      <th className="text-right px-3 py-1.5 font-normal text-destructive">Gap $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.gaps.map((p) => (
                      <tr key={p.key} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-1.5 capitalize">{p.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {p.needed_lbs.toFixed(1)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                          {p.count}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{p.plants_needed}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-destructive">
                          +{p.gap_plants}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-destructive">
                          {p.price_per_lb > 0 ? fmtUsd(p.gap_value) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="text-xs font-mono">
            <thead>
              <tr>
                <th className="p-2 sticky left-0 bg-background z-10 border-r border-border"></th>
                {Array.from({ length: DEFAULT_POSITIONS }, (_, i) => i + 1).map((p) => (
                  <th key={p} className="p-2 text-muted-foreground font-normal w-24 min-w-24">P{String(p).padStart(2, "0")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row} className="border-t border-border">
                  <td className="p-2 sticky left-0 bg-background z-10 border-r border-border font-semibold text-muted-foreground">{row}</td>
                  {Array.from({ length: DEFAULT_POSITIONS }, (_, i) => i + 1).map((pos) => {
                    const plot = grid.map.get(`${row}_${pos}`);
                    return (
                      <td key={pos} className="p-1 align-top">
                        <button
                          onClick={() => openCell(row, pos)}
                          className={`w-24 h-16 rounded border px-2 py-1 text-left text-[11px] leading-tight transition hover:ring-1 hover:ring-foreground/40 ${plantColor(plot?.plant_name)}`}
                        >
                          {plot?.plant_name ?? <span className="opacity-50">+</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.row} · P{String(editing?.position ?? 0).padStart(2, "0")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Plant</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tomatoes" autoFocus />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <DialogFooter className="flex justify-between gap-2 sm:justify-between">
            <div>
              {editing?.plot && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => editing.plot && deleteM.mutate(editing.plot.id)}
                  disabled={deleteM.isPending}
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                onClick={() =>
                  editing &&
                  upsertM.mutate({
                    id: editing.plot?.id ?? null,
                    row_label: editing.row,
                    position: editing.position,
                    plant_name: name.trim(),
                    notes: notes.trim(),
                  })
                }
                disabled={upsertM.isPending || !name.trim()}
              >
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DashStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-mono font-semibold mt-1">{value}</div>
    </div>
  );
}
