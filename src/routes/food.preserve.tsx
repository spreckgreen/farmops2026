import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
// FoodLayout in src/routes/food.tsx already wraps children in AppLayout.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  recommendPreservation,
  logPreservationBatch,
  listRecentPreservations,
  getHarvestForPreservation,
  type PreservationRecommendation,
} from "@/lib/preservation-coach.functions";
import {
  Sparkles, ArrowLeft, AlertTriangle, BookOpen, Package, ChefHat, Snowflake,
  Sun, FlaskConical, Warehouse,
} from "lucide-react";
import { AiProgressStages } from "@/components/ai-progress-stages";
import { toast } from "sonner";
import { format } from "date-fns";
import { z } from "zod";

const search = z.object({
  harvestId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/food/preserve")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Preservation Coach — Bostead Farms" },
      {
        name: "description",
        content:
          "Given a harvest batch, get the safest preservation method, jar counts, and matching procedure.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PreservePage,
});

const METHOD_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  can_water_bath: ChefHat,
  can_pressure: ChefHat,
  freeze: Snowflake,
  dehydrate: Sun,
  ferment: FlaskConical,
  cold_store: Warehouse,
};

function PreservePage() {
  const qc = useQueryClient();
  const { harvestId } = Route.useSearch();

  const [crop, setCrop] = useState("");
  const [variety, setVariety] = useState("");
  const [quantity, setQuantity] = useState<string>("");
  const [unit, setUnit] = useState("lb");
  const [months, setMonths] = useState<string>("12");
  const [result, setResult] = useState<PreservationRecommendation | null>(null);

  const getHarvestFn = useServerFn(getHarvestForPreservation);
  const recommendFn = useServerFn(recommendPreservation);
  const logFn = useServerFn(logPreservationBatch);
  const listFn = useServerFn(listRecentPreservations);

  // Prefill from harvest
  useEffect(() => {
    if (!harvestId) return;
    getHarvestFn({ data: { id: harvestId } })
      .then((h) => {
        if (!h) return;
        setCrop(h.crop);
        setVariety(h.variety ?? "");
        setQuantity(String(h.quantity));
        setUnit(h.unit);
      })
      .catch(() => void 0);
  }, [harvestId, getHarvestFn]);

  const recentQ = useQuery({
    queryKey: ["preservations", "recent"],
    queryFn: () => listFn(),
  });

  const recommendMut = useMutation({
    mutationFn: () =>
      recommendFn({
        data: {
          crop: crop.trim(),
          variety: variety.trim() || null,
          quantity: Number(quantity),
          unit: unit.trim(),
          targetShelfMonths: months ? Number(months) : null,
          harvestId: harvestId ?? null,
        },
      }),
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Recommendation failed"),
  });

  const logMut = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("No recommendation to log");
      return logFn({
        data: {
          name: result.storageSuggestion.name,
          category: result.storageSuggestion.category,
          food_type: result.storageSuggestion.food_type,
          unit: result.storageSuggestion.unit,
          quantity: result.storageSuggestion.quantity,
          best_by_months: result.storageSuggestion.best_by_months,
          method: result.primaryMethod,
          crop: result.crop,
          variety: result.variety,
          harvest_id: harvestId ?? null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Added to food storage");
      qc.invalidateQueries({ queryKey: ["preservations", "recent"] });
      qc.invalidateQueries({ queryKey: ["food"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not log batch"),
  });

  const canSubmit =
    crop.trim().length > 0 &&
    Number(quantity) > 0 &&
    unit.trim().length > 0 &&
    !recommendMut.isPending;

  const PrimaryIcon = result ? (METHOD_ICON[result.primaryMethod] ?? ChefHat) : ChefHat;

  return (
    <>
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
            <Link to="/food" className="hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Food
            </Link>
            <span>·</span>
            <Link to="/food/crops" className="hover:text-foreground">Crops</Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ChefHat className="h-7 w-7 text-primary" />
            Preservation Coach
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Enter what you harvested. Get the safest method, jar counts, and the matching procedure from your library.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="crop">Crop</Label>
                <Input
                  id="crop"
                  value={crop}
                  onChange={(e) => setCrop(e.target.value)}
                  placeholder="tomato, green bean, apple…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="variety">Variety (optional)</Label>
                <Input
                  id="variety"
                  value={variety}
                  onChange={(e) => setVariety(e.target.value)}
                  placeholder="Roma, Blue Lake…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="qty">Quantity</Label>
                <Input
                  id="qty"
                  type="number"
                  step="0.1"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="unit">Unit</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger id="unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="oz">oz</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="bushel">bushel</SelectItem>
                    <SelectItem value="peck">peck</SelectItem>
                    <SelectItem value="quart">quart</SelectItem>
                    <SelectItem value="pint">pint</SelectItem>
                    <SelectItem value="gallon">gallon</SelectItem>
                    <SelectItem value="count">count (each)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="months">Target shelf months</Label>
                <Input
                  id="months"
                  type="number"
                  min="1"
                  max="60"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => recommendMut.mutate()}
                disabled={!canSubmit}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {recommendMut.isPending ? "Coaching…" : "Recommend method"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {result && (
          <Card className="border-primary/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <PrimaryIcon className="h-4 w-4 text-primary" />
                <span className="font-mono">{result.primaryMethodLabel}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  · {result.crop}{result.variety ? ` (${result.variety})` : ""} · {result.yields.inputLbs} lb
                </span>
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {result.model} · {result.latencyMs}ms
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground italic">{result.rationale}</p>

              {(result.isLowAcid || result.safetyNotes.length > 0) && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Safety
                  </div>
                  <ul className="list-disc pl-5 text-xs space-y-0.5">
                    {result.safetyNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Expected yield
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="rounded border border-border bg-card/50 p-2">
                    <div className="text-muted-foreground">Quart jars</div>
                    <div className="text-lg font-mono">{result.yields.quartJars}</div>
                  </div>
                  <div className="rounded border border-border bg-card/50 p-2">
                    <div className="text-muted-foreground">Pint jars</div>
                    <div className="text-lg font-mono">{result.yields.pintJars}</div>
                  </div>
                  <div className="rounded border border-border bg-card/50 p-2">
                    <div className="text-muted-foreground">Freezer qt bags</div>
                    <div className="text-lg font-mono">{result.yields.freezerQtBags}</div>
                  </div>
                  <div className="rounded border border-border bg-card/50 p-2">
                    <div className="text-muted-foreground">Dehydrated oz</div>
                    <div className="text-lg font-mono">{result.yields.dehydratedOz}</div>
                  </div>
                </div>
              </div>

              {result.alternates.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Alternates
                  </div>
                  <ul className="space-y-1">
                    {result.alternates.map((a, i) => (
                      <li key={i} className="rounded border border-border bg-card/50 p-2 text-xs">
                        <div className="font-medium">{a.label}</div>
                        <div className="text-muted-foreground">{a.rationale}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3 w-3" /> Matching procedure
                </div>
                {result.procedure ? (
                  <Link
                    to="/procedures"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {result.procedure.name} →
                  </Link>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No matching procedure in your library.{" "}
                    <Link to="/procedures" className="underline">
                      Create one
                    </Link>
                    .
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
                  <Package className="h-3 w-3" /> Log to food storage
                </div>
                <div className="text-sm">
                  <span className="font-mono">{result.storageSuggestion.quantity}</span>{" "}
                  <span className="text-muted-foreground">{result.storageSuggestion.unit}</span>
                  {" · "}
                  <span>{result.storageSuggestion.name}</span>
                  {" · best-by "}
                  <span className="text-muted-foreground">
                    {result.storageSuggestion.best_by_months} months
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() => logMut.mutate()}
                  disabled={logMut.isPending}
                >
                  {logMut.isPending ? "Adding…" : "Add to pantry"}
                </Button>
              </div>

              {result.candidatesConsidered.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Procedures considered ({result.candidatesConsidered.length})
                  </summary>
                  <ul className="mt-1 pl-4 list-disc text-muted-foreground">
                    {result.candidatesConsidered.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {(recentQ.data?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent batches</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentQ.data!.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-xs rounded px-2 py-1 hover:bg-accent"
                >
                  <span className="truncate">
                    <span className="font-mono">{b.quantity} {b.unit}</span>
                    {" · "}
                    <span>{b.name}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {b.acquired_on && format(new Date(b.acquired_on), "MMM d")}
                    {b.best_by && ` → ${format(new Date(b.best_by), "MMM yyyy")}`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

