import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sprout, Loader2 } from "lucide-react";
import {
  listGardenPlots,
  upsertGardenPlot,
  deleteGardenPlot,
  seedGardenFromTemplate,
} from "@/lib/food.functions";
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

  const [editing, setEditing] = useState<{ row: string; position: number; plot: Plot | null } | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Garden</h2>
          <p className="text-sm text-muted-foreground">Click any cell to plan or update what's planted.</p>
        </div>
        {plots.length === 0 && !isLoading && (
          <Button onClick={() => seedM.mutate()} disabled={seedM.isPending} variant="outline">
            {seedM.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sprout className="h-4 w-4 mr-2" />}
            Load template
          </Button>
        )}
      </div>

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
