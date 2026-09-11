import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Database, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  approveUsdaFoodMatch,
  getNutritionCatalog,
  removeNutritionProfile,
  searchUsdaFoods,
  type UsdaSearchResult,
} from "@/lib/usda-fooddata.functions";

export const Route = createFileRoute("/food/nutrition")({
  component: FoodNutritionPage,
});

const DEFAULT_TYPES = ["Foundation", "Survey (FNDDS)", "SR Legacy"] as const;

function fmt(value: number | null, unit: string): string {
  return value == null ? "—" : `${Number(value.toFixed(2))} ${unit}`;
}

function MacroLine({ result }: { result: UsdaSearchResult }) {
  const m = result.macros;
  return (
    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
      <span>{fmt(m.energyKcal, "kcal")}</span>
      <span>{fmt(m.proteinG, "g protein")}</span>
      <span>{fmt(m.fatG, "g fat")}</span>
      <span>{fmt(m.carbohydrateG, "g carbs")}</span>
      <span>{fmt(m.fiberG, "g fiber")}</span>
      <span>{fmt(m.sodiumMg, "mg sodium")}</span>
      <span>per 100 g</span>
    </div>
  );
}

function FoodNutritionPage() {
  const qc = useQueryClient();
  const catalogFn = useServerFn(getNutritionCatalog);
  const searchFn = useServerFn(searchUsdaFoods);
  const approveFn = useServerFn(approveUsdaFoodMatch);
  const removeFn = useServerFn(removeNutritionProfile);
  const catalog = useQuery({ queryKey: ["food", "nutrition"], queryFn: () => catalogFn() });

  const [foodId, setFoodId] = useState("");
  const [query, setQuery] = useState("");
  const [foodForm, setFoodForm] = useState("As listed");
  const [includeBranded, setIncludeBranded] = useState(false);
  const foods = catalog.data?.foods ?? [];
  const selectedFood = foods.find((food) => food.id === foodId);

  const search = useMutation({
    mutationFn: () =>
      searchFn({
        data: {
          query,
          dataTypes: [...DEFAULT_TYPES, ...(includeBranded ? ["Branded" as const] : [])],
          pageSize: 25,
        },
      }),
    onError: (error: Error) => toast.error(error.message),
  });

  const approve = useMutation({
    mutationFn: (result: UsdaSearchResult) =>
      approveFn({
        data: { foodId, fdcId: result.fdcId, foodForm },
      }),
    onSuccess: (saved) => {
      toast.success(`Approved USDA FDC ${saved.fdcId}`);
      qc.invalidateQueries({ queryKey: ["food", "nutrition"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Nutrition profile removed");
      qc.invalidateQueries({ queryKey: ["food", "nutrition"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const profilesByCategory = (() => {
    const map = new Map<string, NonNullable<typeof catalog.data>["profiles"]>();
    for (const profile of catalog.data?.profiles ?? []) {
      const key = profile.category || "Other";
      map.set(key, [...(map.get(key) ?? []), profile]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  })();

  const runSearch = () => {
    if (!foodId) return toast.error("Select the FarmOps food you are matching");
    if (query.trim().length < 2) return toast.error("Enter at least two search characters");
    search.mutate();
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <h2 className="text-lg font-semibold">USDA FoodData Central nutrition</h2>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Match a FarmOps food and preparation form to an authoritative USDA record. Search results
          are previews only; nothing is saved until you approve a specific FDC record.
        </p>
      </section>

      <section className="border border-border rounded-md bg-card p-4 space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="nutrition-food">FarmOps food</Label>
            <select
              id="nutrition-food"
              value={foodId}
              onChange={(event) => {
                const next = event.target.value;
                setFoodId(next);
                const food = foods.find((item) => item.id === next);
                if (food) setQuery(food.name);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a food…</option>
              {foods.map((food) => (
                <option key={food.id} value={food.id}>
                  {food.name} — {food.category}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="food-form">Food form</Label>
            <Input
              id="food-form"
              value={foodForm}
              onChange={(event) => setFoodForm(event.target.value)}
              placeholder="Raw, cooked, canned, dehydrated…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usda-query">USDA search</Label>
            <div className="flex gap-2">
              <Input
                id="usda-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
                placeholder="e.g. tomatoes red ripe raw"
              />
              <Button type="button" onClick={runSearch} disabled={search.isPending}>
                <Search className="h-4 w-4" />
                {search.isPending ? "Searching…" : "Search"}
              </Button>
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeBranded}
            onChange={(event) => setIncludeBranded(event.target.checked)}
          />
          Include commercial Branded Foods
        </label>
      </section>

      {search.data && !search.data.apiConfigured && (
        <div className="border border-amber-500/40 bg-amber-500/10 rounded-md p-3 text-sm">
          USDA API search is not configured, so these results come only from the local downloaded
          reference cache. Add <code>USDA_FDC_API_KEY</code> to the Shared vault or server
          environment to search FoodData Central directly.
        </div>
      )}

      {search.data && (
        <section className="space-y-3">
          <h3 className="font-semibold">Search results</h3>
          {search.data.results.length === 0 && (
            <p className="text-sm text-muted-foreground">No matching USDA records were found.</p>
          )}
          <div className="space-y-2">
            {search.data.results.map((result) => (
              <div
                key={result.fdcId}
                className="border border-border rounded-md bg-card p-3 flex gap-3 justify-between items-start"
              >
                <div className="min-w-0 space-y-1">
                  <div className="font-medium">{result.description}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">{result.dataType}</Badge>
                    <Badge variant="outline">
                      {result.source === "local" ? "Local cache" : "USDA API"}
                    </Badge>
                    <span className="text-muted-foreground">FDC {result.fdcId}</span>
                    {result.foodCategory && (
                      <span className="text-muted-foreground">{result.foodCategory}</span>
                    )}
                  </div>
                  <MacroLine result={result} />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!selectedFood || !foodForm.trim() || approve.isPending}
                  onClick={() => approve.mutate(result)}
                >
                  Use for {selectedFood?.name ?? "selected food"}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">Approved nutrient profiles</h3>
          <p className="text-xs text-muted-foreground">
            These reviewed profiles are the shared nutrition source for Food planning, production,
            preservation, storage, and reports.
          </p>
        </div>
        {catalog.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!catalog.isLoading && profilesByCategory.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No USDA nutrient profiles have been approved yet.
          </p>
        )}
        {profilesByCategory.map(([category, profiles]) => (
          <div key={category} className="border border-border rounded-md overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-sm font-semibold">{category}</div>
            <div className="divide-y divide-border">
              {profiles.map((profile) => (
                <div key={profile.id} className="p-3 flex gap-3 justify-between items-start">
                  <div className="space-y-1">
                    <div className="font-medium">
                      {profile.foodName}{" "}
                      <span className="text-muted-foreground">— {profile.foodForm}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {profile.description} · {profile.dataType} · FDC {profile.fdcId}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                      <span>{fmt(profile.macros.energyKcal, "kcal")}</span>
                      <span>{fmt(profile.macros.proteinG, "g protein")}</span>
                      <span>{fmt(profile.macros.fatG, "g fat")}</span>
                      <span>{fmt(profile.macros.carbohydrateG, "g carbs")}</span>
                      <span>per 100 g</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => remove.mutate(profile.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove nutrition profile</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
