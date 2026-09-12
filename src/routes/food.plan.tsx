import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Snowflake, Download, Pencil, ChevronRight, ChevronDown } from "lucide-react";
import {
  listFoodPlan,
  upsertFoodPlanPerson,
  deleteFoodPlanPerson,
  upsertFoodPlanFood,
  deleteFoodPlanFood,
  setFoodPlanEntry,
  seedFoodPlanFromTemplate,
  setFoodPlanNutritionTargets,
} from "@/lib/food.functions";
import { getNutritionCatalog, type NutritionProfile } from "@/lib/usda-fooddata.functions";
import { NutritionAssessmentPanel } from "@/components/food/nutrition-assessment-panel";
import type { NutritionTargets } from "@/lib/nutrition-assessment";
import { fmtUsd } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const FOOD_CATEGORIES = [
  "Vegetables",
  "Orchard (fruit/nut)",
  "Field crops",
  "Animal protein",
  "Dairy",
  "Eggs",
  "Fiber",
  "Beverages",
  "Pantry / staples",
  "Other",
];

export const Route = createFileRoute("/food/plan")({
  component: FoodPlanPage,
});

type Person = {
  id: string;
  name: string;
  sort_order: number;
  nutrition_targets?: Partial<NutritionTargets> | null;
};
type Food = {
  id: string;
  name: string;
  category: string | null;
  season: string | null;
  freeze_dry: boolean;
  price_per_pound: number | null;
  oz_per_serving: number | null;
  unit: string | null;
  nutrition_form?: string | null;
  sort_order: number;
};
type Entry = {
  id: string;
  person_id: string;
  food_id: string;
  day_of_week: number;
  quantity: number;
};

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function FoodPlanPage() {
  const qc = useQueryClient();
  const list = useServerFn(listFoodPlan);
  const seedFn = useServerFn(seedFoodPlanFromTemplate);
  const upsertPerson = useServerFn(upsertFoodPlanPerson);
  const delPerson = useServerFn(deleteFoodPlanPerson);
  const upsertFood = useServerFn(upsertFoodPlanFood);
  const delFood = useServerFn(deleteFoodPlanFood);
  const setEntryFn = useServerFn(setFoodPlanEntry);
  const catalogFn = useServerFn(getNutritionCatalog);
  const setTargetsFn = useServerFn(setFoodPlanNutritionTargets);

  const { data, isLoading } = useQuery({
    queryKey: ["food-plan"],
    queryFn: () => list(),
  });
  const nutritionCatalog = useQuery({
    queryKey: ["food", "nutrition"],
    queryFn: () => catalogFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["food-plan"] });

  const seed = useMutation({
    mutationFn: () => seedFn(),
    onSuccess: (r) => {
      toast.success(`Loaded template: ${r.foods} foods, ${r.people} people, ${r.entries} entries`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addPerson = useMutation({
    mutationFn: (name: string) => upsertPerson({ data: { name, sort_order: (data?.people.length ?? 0) } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const removePerson = useMutation({
    mutationFn: (id: string) => delPerson({ data: { id } }),
    onSuccess: () => invalidate(),
  });
  const saveFood = useMutation({
    mutationFn: (v: Partial<Food> & { name: string }) =>
      upsertFood({ data: { ...v, sort_order: v.sort_order ?? (data?.foods.length ?? 0) } as any }),
    onSuccess: () => {
      invalidate();
      toast.success("Food saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeFood = useMutation({
    mutationFn: (id: string) => delFood({ data: { id } }),
    onSuccess: () => invalidate(),
  });
  const updateEntry = useMutation({
    mutationFn: (v: { person_id: string; food_id: string; day_of_week: number; quantity: number }) =>
      setEntryFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const saveTargets = useMutation({
    mutationFn: ({ personId, targets }: { personId: string; targets: NutritionTargets }) =>
      setTargetsFn({ data: { personId, targets } }),
    onSuccess: () => {
      toast.success("Nutrition targets saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const people = (data?.people ?? []) as Person[];
  const foods = (data?.foods ?? []) as Food[];
  const entries = (data?.entries ?? []) as Entry[];

  // Entry lookup map
  const entryMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(`${e.person_id}|${e.food_id}|${e.day_of_week}`, Number(e.quantity));
    return m;
  }, [entries]);

  // Totals (weekly servings per food + cost)
  const totals = useMemo(() => {
    const perFood = new Map<string, number>();
    for (const e of entries) perFood.set(e.food_id, (perFood.get(e.food_id) ?? 0) + Number(e.quantity));
    let weeklyCost = 0;
    for (const f of foods) {
      const qty = perFood.get(f.id) ?? 0;
      const plannedOunces = qty * (f.oz_per_serving ?? 1);
      if (f.price_per_pound != null) weeklyCost += (f.price_per_pound * plannedOunces) / 16;
    }
    return { perFood, weeklyCost };
  }, [entries, foods]);

  const perPersonTotals = useMemo(() => {
    const foodById = new Map(foods.map((food) => [food.id, food]));
    return people.map((person) => {
      const daily = DAYS.map(() => 0);
      let weeklyCost = 0;
      for (const entry of entries) {
        if (entry.person_id !== person.id) continue;
        const quantity = Number(entry.quantity) || 0;
        daily[entry.day_of_week - 1] += quantity;
        const food = foodById.get(entry.food_id);
        const plannedOunces = quantity * (food?.oz_per_serving ?? 1);
        if (food?.price_per_pound != null) {
          weeklyCost += Number(food.price_per_pound) * plannedOunces / 16;
        }
      }
      return {
        personId: person.id,
        name: person.name,
        daily,
        weeklyQuantity: daily.reduce((sum, value) => sum + value, 0),
        weeklyCost,
      };
    });
  }, [entries, foods, people]);

  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [personDialog, setPersonDialog] = useState(false);
  const [personName, setPersonName] = useState("");
  const [foodDialog, setFoodDialog] = useState(false);
  const [editingFood, setEditingFood] = useState<Food | null>(null);
  const [showFreezeDryOnly, setShowFreezeDryOnly] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [activeSeasons, setActiveSeasons] = useState<Set<string>>(new Set());

  type FilterPreset = {
    name: string;
    freezeDry: boolean;
    categories: string[];
    seasons: string[];
  };
  const PRESETS_KEY = "food-plan-filter-presets";
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (raw) setPresets(JSON.parse(raw));
    } catch {}
  }, []);
  const savePresets = (next: FilterPreset[]) => {
    setPresets(next);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch {}
  };
  const applyPreset = (p: FilterPreset) => {
    setShowFreezeDryOnly(p.freezeDry);
    setActiveCategories(new Set(p.categories));
    setActiveSeasons(new Set(p.seasons));
  };
  const currentMatchesPreset = (p: FilterPreset) =>
    p.freezeDry === showFreezeDryOnly &&
    p.categories.length === activeCategories.size &&
    p.categories.every((c) => activeCategories.has(c)) &&
    p.seasons.length === activeSeasons.size &&
    p.seasons.every((s) => activeSeasons.has(s));



  if (isLoading) return <div className="text-muted-foreground font-mono text-sm">Loading…</div>;

  const empty = people.length === 0 && foods.length === 0;

  if (empty) {
    return (
      <div className="border border-dashed border-border rounded-md p-10 text-center">
        <h2 className="text-lg font-mono font-bold mb-2">No Food Plan yet</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
          Load the template from your FoodSurvey spreadsheet — 60 foods with prices, 5 people (R, S, B, J, L),
          and the 7-day plan. You can edit everything afterwards.
        </p>
        <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
          <Download className="h-4 w-4 mr-2" />
          {seed.isPending ? "Loading…" : "Load template"}
        </Button>
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => setPersonDialog(true)}>
            Or start empty — add a person
          </Button>
        </div>
        <PersonDialog
          open={personDialog}
          onOpenChange={setPersonDialog}
          name={personName}
          setName={setPersonName}
          onSubmit={() => {
            if (!personName.trim()) return;
            addPerson.mutate(personName.trim());
            setPersonName("");
            setPersonDialog(false);
          }}
        />
      </div>
    );
  }

  const activePerson = selectedPerson ?? people[0]?.id ?? null;
  const dayTotalsForActive = (food_id: string) =>
    DAYS.reduce((s, d) => s + (entryMap.get(`${activePerson}|${food_id}|${d}`) ?? 0), 0);

  const allSeasons = useMemo(() => {
    const set = new Set<string>();
    for (const f of foods) if (f.season) set.add(f.season);
    return Array.from(set).sort();
  }, [foods]);

  const hasActiveFilters = showFreezeDryOnly || activeCategories.size > 0 || activeSeasons.size > 0;

  const visibleFoods = useMemo(() => {
    return foods.filter((f) => {
      if (showFreezeDryOnly && !f.freeze_dry) return false;
      if (activeCategories.size > 0 && !activeCategories.has(f.category ?? "")) return false;
      if (activeSeasons.size > 0 && !activeSeasons.has(f.season ?? "")) return false;
      return true;
    });
  }, [foods, showFreezeDryOnly, activeCategories, activeSeasons]);

  const UNCATEGORIZED = "Uncategorized";
  const groupedFoods = useMemo(() => {
    const groups = new Map<string, Food[]>();
    for (const f of visibleFoods) {
      const key = f.category && f.category.trim() ? f.category : UNCATEGORIZED;
      const arr = groups.get(key);
      if (arr) arr.push(f); else groups.set(key, [f]);
    }
    // Order: follow FOOD_CATEGORIES, then any extras alphabetically, then Uncategorized
    const ordered: { category: string; foods: Food[] }[] = [];
    for (const cat of FOOD_CATEGORIES) {
      const arr = groups.get(cat);
      if (arr) { ordered.push({ category: cat, foods: arr }); groups.delete(cat); }
    }
    const extras = Array.from(groups.keys()).filter((k) => k !== UNCATEGORIZED).sort();
    for (const k of extras) ordered.push({ category: k, foods: groups.get(k)! });
    if (groups.has(UNCATEGORIZED)) ordered.push({ category: UNCATEGORIZED, foods: groups.get(UNCATEGORIZED)! });
    return ordered;
  }, [visibleFoods]);

  const COLLAPSED_KEY = "food-plan-collapsed-groups";
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsedGroups(new Set(JSON.parse(raw)));
    } catch {}
  }, []);
  const toggleGroup = (cat: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };
  const setAllCollapsed = (collapsed: boolean) => {
    const next = collapsed ? new Set(groupedFoods.map((g) => g.category)) : new Set<string>();
    setCollapsedGroups(next);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next))); } catch {}
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="People" value={String(people.length)} />
        <Stat label="Foods" value={`${visibleFoods.length}${hasActiveFilters ? ` / ${foods.length}` : ""}`} />
        <Stat label="Est. weekly cost" value={fmtUsd(totals.weeklyCost)} />
      </div>

      {/* People bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {people.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedPerson(p.id)}
            className={`px-3 py-1 rounded-md border text-sm font-mono ${
              activePerson === p.id ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"
            }`}
          >
            {p.name}
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={() => setPersonDialog(true)}>
          <Plus className="h-3 w-3 mr-1" /> Person
        </Button>
        {activePerson && people.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm("Remove this person and all their entries?")) {
                removePerson.mutate(activePerson);
                setSelectedPerson(null);
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="border border-border rounded-md overflow-auto">
        <table className="w-full min-w-[720px] text-xs font-mono">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2 text-left">Person totals</th>
              {DAY_LABELS.map((label) => <th key={label} className="p-2 text-right">{label}</th>)}
              <th className="p-2 text-right">Week</th>
              <th className="p-2 text-right">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {perPersonTotals.map((total) => (
              <tr
                key={total.personId}
                className={`border-t border-border cursor-pointer hover:bg-accent/30 ${activePerson === total.personId ? "bg-accent/40" : ""}`}
                onClick={() => setSelectedPerson(total.personId)}
              >
                <td className="p-2 font-semibold">{total.name}</td>
                {total.daily.map((value, index) => (
                  <td key={index} className="p-2 text-right">{value ? value.toFixed(2) : "—"}</td>
                ))}
                <td className="p-2 text-right font-semibold">{total.weeklyQuantity.toFixed(2)}</td>
                <td className="p-2 text-right">{fmtUsd(total.weeklyCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30">
            <tr>
              <td className="p-2 font-semibold">Household</td>
              {DAYS.map((_, index) => {
                const value = perPersonTotals.reduce((sum, total) => sum + total.daily[index], 0);
                return <td key={index} className="p-2 text-right font-semibold">{value ? value.toFixed(2) : "—"}</td>;
              })}
              <td className="p-2 text-right font-semibold">
                {perPersonTotals.reduce((sum, total) => sum + total.weeklyQuantity, 0).toFixed(2)}
              </td>
              <td className="p-2 text-right font-semibold">{fmtUsd(totals.weeklyCost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <NutritionAssessmentPanel
        people={people}
        foods={foods}
        entries={entries}
        profiles={nutritionCatalog.data?.profiles ?? []}
        activePersonId={activePerson}
        savingTargets={saveTargets.isPending}
        onSaveTargets={(personId, targets) => saveTargets.mutate({ personId, targets })}
      />

      {/* Filter chips */}
      <div className="space-y-2">
        {/* Presets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase text-muted-foreground tracking-wider font-mono mr-1">Presets</span>
          {presets.length === 0 && (
            <span className="text-[10px] text-muted-foreground font-mono italic">none saved</span>
          )}
          {presets.map((p) => {
            const active = currentMatchesPreset(p);
            return (
              <span key={p.name} className="inline-flex items-center">
                <button
                  onClick={() => applyPreset(p)}
                  className={`px-2 py-0.5 rounded-l-full text-xs font-mono border transition-colors ${
                    active ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"
                  }`}
                  title={[
                    p.freezeDry ? "freeze-dry" : null,
                    ...p.categories,
                    ...p.seasons,
                  ].filter(Boolean).join(" · ") || "no filters"}
                >
                  {p.name}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete preset "${p.name}"?`)) {
                      savePresets(presets.filter((x) => x.name !== p.name));
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded-r-full text-xs font-mono border border-l-0 transition-colors ${
                    active ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent text-muted-foreground"
                  }`}
                  title="Delete preset"
                >
                  ×
                </button>
              </span>
            );
          })}
          {hasActiveFilters && !presets.some(currentMatchesPreset) && (
            <button
              onClick={() => {
                const name = prompt("Name this preset:")?.trim();
                if (!name) return;
                if (presets.some((p) => p.name === name)) {
                  if (!confirm(`Overwrite preset "${name}"?`)) return;
                }
                const next: FilterPreset = {
                  name,
                  freezeDry: showFreezeDryOnly,
                  categories: Array.from(activeCategories),
                  seasons: Array.from(activeSeasons),
                };
                savePresets([...presets.filter((p) => p.name !== name), next]);
              }}
              className="px-2 py-0.5 rounded-full text-xs font-mono border border-dashed border-border hover:bg-accent text-muted-foreground"
              title="Save current filters as a preset"
            >
              + Save current
            </button>
          )}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setShowFreezeDryOnly(false);
                setActiveCategories(new Set());
                setActiveSeasons(new Set());
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1"
            >
              Reset all
            </button>
          )}
        </div>

        {FOOD_CATEGORIES.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase text-muted-foreground tracking-wider font-mono mr-1">Category</span>
            {FOOD_CATEGORIES.map((cat) => {
              const active = activeCategories.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveCategories((prev) => {
                      const next = new Set(prev);
                      if (active) next.delete(cat); else next.add(cat);
                      return next;
                    });
                  }}
                  className={`px-2 py-0.5 rounded-full text-xs font-mono border transition-colors ${
                    active ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
            {activeCategories.size > 0 && (
              <button
                onClick={() => setActiveCategories(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
        {allSeasons.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase text-muted-foreground tracking-wider font-mono mr-1">Season</span>
            {allSeasons.map((season) => {
              const active = activeSeasons.has(season);
              return (
                <button
                  key={season}
                  onClick={() => {
                    setActiveSeasons((prev) => {
                      const next = new Set(prev);
                      if (active) next.delete(season); else next.add(season);
                      return next;
                    });
                  }}
                  className={`px-2 py-0.5 rounded-full text-xs font-mono border transition-colors ${
                    active ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"
                  }`}
                >
                  {season}
                </button>
              );
            })}
            {activeSeasons.size > 0 && (
              <button
                onClick={() => setActiveSeasons(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase text-muted-foreground tracking-wider font-mono mr-1">Other</span>
          <button
            onClick={() => setShowFreezeDryOnly((v) => !v)}
            className={`px-2 py-0.5 rounded-full text-xs font-mono border transition-colors flex items-center gap-1 ${
              showFreezeDryOnly ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"
            }`}
          >
            <Snowflake className="h-3 w-3" />
            Freeze-dry
          </button>
        </div>
      </div>

      {/* Matrix */}
      <div className="flex items-center justify-end gap-2 -mb-3">
        <button
          onClick={() => setAllCollapsed(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground underline font-mono"
        >
          Expand all
        </button>
        <span className="text-[10px] text-muted-foreground">·</span>
        <button
          onClick={() => setAllCollapsed(true)}
          className="text-[10px] text-muted-foreground hover:text-foreground underline font-mono"
        >
          Collapse all
        </button>
      </div>
      <div className="border border-border rounded-md overflow-auto max-h-[70vh]">
        <table className="text-xs font-mono w-full">
          <thead className="bg-card sticky top-0 z-10">
            <tr>
              <th className="text-left p-2 sticky left-0 bg-card border-r border-border min-w-[180px]">Food</th>
              <th className="p-2 border-r border-border">$/lb</th>
              {DAY_LABELS.map((d) => (
                <th key={d} className="p-2 border-r border-border w-16">{d}</th>
              ))}
              <th className="p-2 border-r border-border">Week</th>
              <th className="p-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {groupedFoods.map((group) => {
              const collapsed = collapsedGroups.has(group.category);
              const groupWeekly = group.foods.reduce((s, f) => s + dayTotalsForActive(f.id), 0);
              return (
                <Fragment key={group.category}>
                  <tr
                    key={`group-${group.category}`}
                    className="border-t border-border bg-muted/40 cursor-pointer hover:bg-muted/60"
                    onClick={() => toggleGroup(group.category)}
                  >
                    <td className="p-2 sticky left-0 bg-muted/40 border-r border-border">
                      <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[11px]">
                        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        <span>{group.category}</span>
                        <span className="text-muted-foreground font-normal normal-case tracking-normal">
                          ({group.foods.length})
                        </span>
                      </div>
                    </td>
                    <td className="p-2 border-r border-border" colSpan={DAYS.length + 1}></td>
                    <td className="p-2 border-r border-border text-right font-semibold">
                      {groupWeekly ? groupWeekly.toFixed(2) : ""}
                    </td>
                    <td className="p-1"></td>
                  </tr>
                  {!collapsed && group.foods.map((f) => {
                    const weekly = dayTotalsForActive(f.id);
                    return (
                      <tr key={f.id} className="border-t border-border hover:bg-accent/30">
                        <td className="p-2 sticky left-0 bg-background border-r border-border">
                          <div className="flex items-center gap-1 pl-4">
                            {f.freeze_dry && <Snowflake className="h-3 w-3 text-blue-500 shrink-0" />}
                            <span>{f.name}</span>
                            {f.season && <Badge variant="outline" className="text-[10px] px-1 py-0">{f.season}</Badge>}
                          </div>
                        </td>
                        <td className="p-1 border-r border-border text-right text-muted-foreground">
                          {f.price_per_pound != null ? fmtUsd(Number(f.price_per_pound)) : "—"}
                        </td>
                        {DAYS.map((d) => {
                          const key = `${activePerson}|${f.id}|${d}`;
                          const v = entryMap.get(key) ?? 0;
                          return (
                            <td key={d} className="p-0 border-r border-border">
                              <input
                                type="number"
                                step="any"
                                defaultValue={v || ""}
                                className="w-full h-8 px-2 bg-transparent text-right focus:bg-accent outline-none"
                                onBlur={(e) => {
                                  const newVal = parseFloat(e.target.value || "0") || 0;
                                  if (newVal === v) return;
                                  if (!activePerson) return;
                                  updateEntry.mutate({
                                    person_id: activePerson,
                                    food_id: f.id,
                                    day_of_week: d,
                                    quantity: newVal,
                                  });
                                }}
                              />
                            </td>
                          );
                        })}
                        <td className="p-2 border-r border-border text-right font-semibold">
                          {weekly ? weekly.toFixed(2) : ""}
                        </td>
                        <td className="p-1">
                          <div className="flex items-center gap-0.5 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Edit food"
                              onClick={() => {
                                setEditingFood(f);
                                setFoodDialog(true);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Delete food"
                              onClick={() => {
                                if (confirm(`Delete "${f.name}" and all its entries?`)) removeFood.mutate(f.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          {(() => {
            const total = perPersonTotals.find((item) => item.personId === activePerson);
            if (!total) return null;
            return (
              <tfoot className="sticky bottom-0 border-t-2 border-border bg-card">
                <tr>
                  <td className="p-2 sticky left-0 bg-card border-r border-border font-semibold">
                    {total.name} total (all foods)
                  </td>
                  <td className="p-2 border-r border-border"></td>
                  {total.daily.map((value, index) => (
                    <td key={index} className="p-2 border-r border-border text-right font-semibold">
                      {value ? value.toFixed(2) : "—"}
                    </td>
                  ))}
                  <td className="p-2 border-r border-border text-right font-semibold">
                    {total.weeklyQuantity.toFixed(2)}
                  </td>
                  <td className="p-1"></td>
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

      <div className="flex justify-between items-center">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingFood(null);
            setFoodDialog(true);
          }}
        >
          <Plus className="h-3 w-3 mr-1" /> Add food
        </Button>
        <p className="text-xs text-muted-foreground">
          Quantities are per day. Click the pencil to edit a food's category, season, price, or serving size.
        </p>
      </div>

      <PersonDialog
        open={personDialog}
        onOpenChange={setPersonDialog}
        name={personName}
        setName={setPersonName}
        onSubmit={() => {
          if (!personName.trim()) return;
          addPerson.mutate(personName.trim());
          setPersonName("");
          setPersonDialog(false);
        }}
      />
      <FoodEditDialog
        open={foodDialog}
        onOpenChange={(v) => {
          setFoodDialog(v);
          if (!v) setEditingFood(null);
        }}
        food={editingFood}
        profiles={(nutritionCatalog.data?.profiles ?? []).filter(
          (profile) => profile.foodId === editingFood?.id,
        )}
        onSubmit={(payload) => {
          saveFood.mutate(payload);
          setFoodDialog(false);
          setEditingFood(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-4">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-mono">{label}</div>
      <div className="text-2xl font-mono font-bold mt-1">{value}</div>
    </div>
  );
}

function PersonDialog({
  open,
  onOpenChange,
  name,
  setName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  setName: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add person</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FoodPayload = {
  id?: string;
  name: string;
  category: string | null;
  season: string | null;
  unit: string | null;
  oz_per_serving: number | null;
  price_per_pound: number | null;
  freeze_dry: boolean;
  nutrition_form?: string | null;
};

function FoodEditDialog({
  open,
  onOpenChange,
  food,
  profiles,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  food: Food | null;
  profiles: NutritionProfile[];
  onSubmit: (payload: FoodPayload) => void;
}) {
  const isEdit = !!food;
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [season, setSeason] = useState<string>("");
  const [unit, setUnit] = useState<string>("");
  const [oz, setOz] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [freezeDry, setFreezeDry] = useState(false);
  const [nutritionForm, setNutritionForm] = useState("As listed");

  // reset whenever dialog opens
  useEffect(() => {
    if (open) {
      setName(food?.name ?? "");
      setCategory(food?.category ?? "");
      setSeason(food?.season ?? "");
      setUnit(food?.unit ?? "");
      setOz(food?.oz_per_serving != null ? String(food.oz_per_serving) : "");
      setPrice(food?.price_per_pound != null ? String(food.price_per_pound) : "");
      setFreezeDry(!!food?.freeze_dry);
      setNutritionForm(food?.nutrition_form ?? "As listed");
    }
  }, [open, food]);

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({
      id: food?.id,
      name: name.trim(),
      category: category.trim() ? category.trim() : null,
      season: season.trim() ? season.trim() : null,
      unit: unit.trim() ? unit.trim() : null,
      oz_per_serving: oz.trim() ? Number(oz) : null,
      price_per_pound: price.trim() ? Number(price) : null,
      freeze_dry: freezeDry,
      nutrition_form: nutritionForm,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit food" : "Add food"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category || "__none"} onValueChange={(v) => setCategory(v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Uncategorized</SelectItem>
                {FOOD_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                {category && !FOOD_CATEGORIES.includes(category) && (
                  <SelectItem value={category}>{category} (current)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Drives grouping on the Food Overview dashboard.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Season</Label>
              <Input
                placeholder="e.g. Summer"
                value={season}
                onChange={(e) => setSeason(e.target.value)}
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Input
                placeholder="lb, oz, dozen…"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div>
              <Label>Oz / serving</Label>
              <Input
                type="number"
                step="any"
                value={oz}
                onChange={(e) => setOz(e.target.value)}
              />
            </div>
            <div>
              <Label>Price / lb (USD)</Label>
              <Input
                type="number"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          {profiles.length > 0 && (
            <div>
              <Label>Planner nutrition form</Label>
              <Select value={nutritionForm} onValueChange={setNutritionForm}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.foodForm}>
                      {profile.foodForm} — FDC {profile.fdcId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Chooses which approved USDA form supplies this food's planner nutrition.
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={freezeDry}
              onCheckedChange={(v) => setFreezeDry(!!v)}
            />
            Freeze-dry candidate
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>{isEdit ? "Save" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
