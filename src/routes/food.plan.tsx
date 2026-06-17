import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Snowflake, Download, Pencil } from "lucide-react";
import {
  listFoodPlan,
  upsertFoodPlanPerson,
  deleteFoodPlanPerson,
  upsertFoodPlanFood,
  deleteFoodPlanFood,
  setFoodPlanEntry,
  seedFoodPlanFromTemplate,
} from "@/lib/food.functions";
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

type Person = { id: string; name: string; sort_order: number };
type Food = {
  id: string;
  name: string;
  category: string | null;
  season: string | null;
  freeze_dry: boolean;
  price_per_pound: number | null;
  oz_per_serving: number | null;
  unit: string | null;
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

  const { data, isLoading } = useQuery({
    queryKey: ["food-plan"],
    queryFn: () => list(),
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
      // qty here is treated as servings/oz; price_per_pound × (qty/16) assuming qty is ounces
      if (f.price_per_pound != null) weeklyCost += (f.price_per_pound * qty) / 16;
    }
    return { perFood, weeklyCost };
  }, [entries, foods]);

  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [personDialog, setPersonDialog] = useState(false);
  const [personName, setPersonName] = useState("");
  const [foodDialog, setFoodDialog] = useState(false);
  const [editingFood, setEditingFood] = useState<Food | null>(null);


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

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="People" value={String(people.length)} />
        <Stat label="Foods" value={String(foods.length)} />
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

      {/* Matrix */}
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
            {foods.map((f) => {
              const weekly = dayTotalsForActive(f.id);
              return (
                <tr key={f.id} className="border-t border-border hover:bg-accent/30">
                  <td className="p-2 sticky left-0 bg-background border-r border-border">
                    <div className="flex items-center gap-1">
                      <span>{f.name}</span>
                      {f.freeze_dry && <Snowflake className="h-3 w-3 text-blue-500" />}
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
          </tbody>
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
};

function FoodEditDialog({
  open,
  onOpenChange,
  food,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  food: Food | null;
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
