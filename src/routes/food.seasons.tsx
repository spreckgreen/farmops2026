import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, Search, Plus, Trash2, RotateCcw, Wand2 } from "lucide-react";
import {
  listFoodPlan,
  listPlantSeasons,
  upsertPlantSeason,
  deletePlantSeason,
  resetPlantSeasons,
  applySeasonsToFoodPlan,
} from "@/lib/food.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CsvToolbar } from "@/components/csv-toolbar";
import { toast } from "sonner";

export const Route = createFileRoute("/food/seasons")({
  component: SeasonsPage,
});

type Row = {
  id: string;
  name: string;
  kind: string;
  season: string;
  lead: string;
  notes: string;
  sort_order?: number;
};

const SEASON_BUCKETS = [
  "All Year",
  "Spring",
  "Summer",
  "Fall",
  "Winter",
] as const;

function matchBucket(season: string, bucket: string): boolean {
  const s = season.toLowerCase();
  if (bucket === "All Year") return s.includes("all year");
  return s.includes(bucket.toLowerCase());
}

const SEASON_COLORS: Record<string, string> = {
  "All Year": "bg-muted text-muted-foreground border-border",
  Spring: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  Summer: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  Fall: "bg-orange-500/20 text-orange-200 border-orange-500/40",
  Winter: "bg-sky-500/20 text-sky-200 border-sky-500/40",
};

function seasonBadges(season: string) {
  const tags = SEASON_BUCKETS.filter((b) => matchBucket(season, b));
  if (!tags.length) return [season];
  return tags;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function SeasonsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlantSeasons);
  const upsertFn = useServerFn(upsertPlantSeason);
  const deleteFn = useServerFn(deletePlantSeason);
  const resetFn = useServerFn(resetPlantSeasons);
  const applyFn = useServerFn(applySeasonsToFoodPlan);
  const planFn = useServerFn(listFoodPlan);

  const seasonsQ = useQuery({
    queryKey: ["plant-seasons"],
    queryFn: () => listFn() as Promise<Row[]>,
  });
  const planQ = useQuery({ queryKey: ["food-plan"], queryFn: () => planFn() });

  const rows: Row[] = seasonsQ.data ?? [];

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [bucket, setBucket] = useState<string>("all");
  const [editing, setEditing] = useState<Record<string, Partial<Row>>>({});
  const [adding, setAdding] = useState<{ name: string; kind: string; season: string; lead: string; notes: string }>({
    name: "", kind: "", season: "", lead: "", notes: "",
  });

  const upsertMut = useMutation({
    mutationFn: (data: Partial<Row> & { name: string }) => upsertFn({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plant-seasons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plant-seasons"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const resetMut = useMutation({
    mutationFn: () => resetFn(),
    onSuccess: (res) => {
      toast.success(`Reset to defaults (${res.inserted} entries)`);
      qc.invalidateQueries({ queryKey: ["plant-seasons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const applyMut = useMutation({
    mutationFn: () => applyFn(),
    onSuccess: (res) => {
      toast.success(`Updated season on ${res.updated} food plan items (${res.matched} plants matched)`);
      qc.invalidateQueries({ queryKey: ["food-plan"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const categoryByName = useMemo(() => {
    const map = new Map<string, string>();
    const foods = (planQ.data?.foods ?? []) as Array<{ name: string; category: string | null }>;
    for (const f of foods) {
      if (!f.category) continue;
      const key = normalizeName(f.name);
      if (key) map.set(key, f.category);
    }
    return map;
  }, [planQ.data]);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        category: categoryByName.get(normalizeName(r.name)) ?? null,
      })),
    [rows, categoryByName],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of enriched) if (r.category) set.add(r.category);
    return Array.from(set).sort();
  }, [enriched]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enriched.filter((r) => {
      if (cat !== "all") {
        if (cat === "__none__") {
          if (r.category) return false;
        } else if (r.category !== cat) return false;
      }
      if (bucket !== "all" && !matchBucket(r.season, bucket)) return false;
      if (
        needle &&
        !r.name.toLowerCase().includes(needle) &&
        !r.season.toLowerCase().includes(needle) &&
        !r.notes.toLowerCase().includes(needle) &&
        !(r.category ?? "").toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [enriched, q, cat, bucket]);

  const matchedCount = enriched.filter((r) => r.category).length;

  function getField<K extends keyof Row>(r: Row, k: K): Row[K] {
    const e = editing[r.id];
    if (e && k in e) return e[k] as Row[K];
    return r[k];
  }
  function setField<K extends keyof Row>(id: string, k: K, value: Row[K]) {
    setEditing((s) => ({ ...s, [id]: { ...(s[id] ?? {}), [k]: value } }));
  }
  function saveRow(r: Row) {
    const e = editing[r.id];
    if (!e) return;
    upsertMut.mutate({
      id: r.id,
      name: (e.name ?? r.name).trim() || r.name,
      kind: e.kind ?? r.kind,
      season: e.season ?? r.season,
      lead: e.lead ?? r.lead,
      notes: e.notes ?? r.notes,
      sort_order: r.sort_order,
    });
    setEditing((s) => {
      const { [r.id]: _, ...rest } = s;
      return rest;
    });
  }

  function addRow() {
    const name = adding.name.trim();
    if (!name) return;
    upsertMut.mutate({ name, kind: adding.kind, season: adding.season, lead: adding.lead, notes: adding.notes });
    setAdding({ name: "", kind: "", season: "", lead: "", notes: "" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Plant seasons reference
          </h2>
          <p className="text-sm text-muted-foreground">
            {rows.length} entries · {matchedCount} matched to food plan categories
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyMut.mutate()}
            disabled={applyMut.isPending}
          >
            <Wand2 className="h-3 w-3 mr-1" />
            Apply to Food Plan
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm("Reset Plant seasons to defaults? Your custom edits will be lost.")) {
                resetMut.mutate();
              }
            }}
            disabled={resetMut.isPending}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
          <CsvToolbar
            filename="plant-seasons.csv"
            columns={[
              { key: "name", label: "name" },
              { key: "kind", label: "kind" },
              { key: "category", label: "category" },
              { key: "season", label: "season" },
              { key: "lead", label: "lead" },
              { key: "notes", label: "notes" },
            ]}
            rows={filtered.map((r) => ({
              name: r.name,
              kind: r.kind,
              category: r.category ?? "",
              season: r.season,
              lead: r.lead,
              notes: r.notes,
            }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, season, category, notes…"
            className="pl-8"
          />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="__none__">Unmatched</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={bucket} onValueChange={setBucket}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All seasons</SelectItem>
            {SEASON_BUCKETS.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Kind</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Season</th>
              <th className="text-left px-3 py-2">Notes</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border bg-muted/20">
              <td className="px-2 py-2">
                <Input
                  value={adding.name}
                  onChange={(e) => setAdding((s) => ({ ...s, name: e.target.value }))}
                  placeholder="New plant name"
                  className="h-8"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={adding.kind}
                  onChange={(e) => setAdding((s) => ({ ...s, kind: e.target.value }))}
                  placeholder="Vegetable"
                  className="h-8"
                />
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground">—</td>
              <td className="px-2 py-2">
                <Input
                  value={adding.season}
                  onChange={(e) => setAdding((s) => ({ ...s, season: e.target.value }))}
                  placeholder="Spring->Summer"
                  className="h-8"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={adding.notes}
                  onChange={(e) => setAdding((s) => ({ ...s, notes: e.target.value }))}
                  placeholder="notes"
                  className="h-8"
                />
              </td>
              <td className="px-2 py-2 text-right">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={addRow}
                  disabled={!adding.name.trim() || upsertMut.isPending}
                  aria-label="Add"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </td>
            </tr>
            {filtered.map((r) => {
              const dirty = !!editing[r.id];
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-1">
                    <Input
                      value={String(getField(r, "name"))}
                      onChange={(e) => setField(r.id, "name", e.target.value)}
                      onBlur={() => dirty && saveRow(r)}
                      className="h-8 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      value={String(getField(r, "kind"))}
                      onChange={(e) => setField(r.id, "kind", e.target.value)}
                      onBlur={() => dirty && saveRow(r)}
                      className="h-8"
                    />
                  </td>
                  <td className="px-2 py-1">
                    {r.category ? (
                      <Badge variant="outline">{r.category}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <Input
                        value={String(getField(r, "season"))}
                        onChange={(e) => setField(r.id, "season", e.target.value)}
                        onBlur={() => dirty && saveRow(r)}
                        className="h-8 max-w-[180px]"
                      />
                      <div className="flex flex-wrap gap-1">
                        {seasonBadges(String(getField(r, "season"))).map((t) => (
                          <Badge key={t} variant="outline" className={SEASON_COLORS[t] ?? ""}>
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      value={String(getField(r, "notes"))}
                      onChange={(e) => setField(r.id, "notes", e.target.value)}
                      onBlur={() => dirty && saveRow(r)}
                      className="h-8"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => {
                        if (confirm(`Delete "${r.name}"?`)) deleteMut.mutate(r.id);
                      }}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: edit a cell and click outside (blur) to save. Use <strong>Apply to Food Plan</strong>{" "}
        to copy the season bucket (Spring/Summer/Fall/Winter/All Year) onto matching food plan items.
      </p>
    </div>
  );
}
