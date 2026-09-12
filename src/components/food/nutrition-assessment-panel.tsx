import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Calculator, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildDailyNutritionAssessment,
  estimatePreservationConversions,
  FDA_ADULT_DAILY_VALUES,
  NUTRITION_METRICS,
  type NutritionTargets,
} from "@/lib/nutrition-assessment";
import type { NutritionProfile } from "@/lib/usda-fooddata.functions";

type Person = {
  id: string;
  name: string;
  nutrition_targets?: Partial<NutritionTargets> | null;
};

type Food = {
  id: string;
  name: string;
  oz_per_serving: number | null;
  nutrition_form?: string | null;
};

type Entry = {
  person_id: string;
  food_id: string;
  day_of_week: number;
  quantity: number;
};

function targetsFor(person: Person | undefined): NutritionTargets {
  return { ...FDA_ADULT_DAILY_VALUES, ...(person?.nutrition_targets ?? {}) };
}

function display(value: number | null, unit: string): string {
  return value == null ? "—" : `${Number(value.toFixed(1))} ${unit}`;
}

export function NutritionAssessmentPanel({
  people,
  foods,
  entries,
  profiles,
  activePersonId,
  savingTargets,
  onSaveTargets,
}: {
  people: Person[];
  foods: Food[];
  entries: Entry[];
  profiles: NutritionProfile[];
  activePersonId: string | null;
  savingTargets: boolean;
  onSaveTargets: (personId: string, targets: NutritionTargets) => void;
}) {
  const [day, setDay] = useState(1);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [conversionFoodId, setConversionFoodId] = useState("");

  const person = people.find((item) => item.id === activePersonId);
  const targets = targetsFor(person);
  const assessment = useMemo(
    () =>
      buildDailyNutritionAssessment({
        personId: activePersonId ?? "",
        foods,
        entries,
        profiles,
        targets,
      }),
    [activePersonId, entries, foods, profiles, targets.energyKcal, targets.proteinG, targets.fatG,
      targets.carbohydrateG, targets.fiberG, targets.sodiumMg],
  );

  if (!activePersonId || !person) return null;

  const chartRows = assessment.rows.map((row) => ({
    day: row.dayLabel,
    Energy: row.percent.energyKcal,
    Protein: row.percent.proteinG,
    Fat: row.percent.fatG,
    Carbohydrate: row.percent.carbohydrateG,
    Fiber: row.percent.fiberG,
    Sodium: row.percent.sodiumMg,
  }));
  const selected = assessment.rows.find((row) => row.day === day) ?? assessment.rows[0];
  const personFoodIds = new Set(
    entries
      .filter((entry) => entry.person_id === activePersonId && entry.quantity > 0)
      .map((entry) => entry.food_id),
  );
  const linkedUsed = [...personFoodIds].filter((id) => assessment.linkedFoodIds.has(id)).length;
  const conversionFoods = foods.filter((food) => personFoodIds.has(food.id));
  const conversionFood = conversionFoods.find((food) => food.id === conversionFoodId)
    ?? conversionFoods[0];
  const weeklyServings = conversionFood
    ? entries
        .filter((entry) => entry.person_id === activePersonId && entry.food_id === conversionFood.id)
        .reduce((sum, entry) => sum + Number(entry.quantity), 0)
    : 0;
  const freshOunces = weeklyServings * (conversionFood?.oz_per_serving ?? 1);
  const conversions = estimatePreservationConversions(conversionFood?.name ?? "", freshOunces);
  const foodProfiles = profiles.filter((profile) => profile.foodId === conversionFood?.id);

  return (
    <section className="border border-border rounded-md bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            <h2 className="font-semibold">Daily nutrition — {person.name}</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            USDA values from approved food/form links. Planner quantities are servings and use each
            food's ounces per serving; foods without a serving size retain the one-ounce fallback.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={linkedUsed === personFoodIds.size ? "secondary" : "outline"}>
            {linkedUsed}/{personFoodIds.size} used foods linked
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => setTargetsOpen(true)}>
            <Settings2 className="h-4 w-4" /> Targets
          </Button>
        </div>
      </div>

      {assessment.unlinkedFoodIds.size > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          {assessment.unlinkedFoodIds.size} food(s) used by {person.name} are omitted because they
          do not yet have an approved USDA profile. Use Food → Nutrition to review suggested links.
        </div>
      )}

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis unit="%" domain={[0, "auto"]} />
            <Tooltip formatter={(value) => [`${Number(value ?? 0).toFixed(0)}%`, "Daily target"]} />
            <Legend />
            <ReferenceLine y={100} stroke="currentColor" strokeDasharray="5 5" label="100% target" />
            <Line type="monotone" dataKey="Energy" stroke="var(--chart-1)" strokeWidth={2} />
            <Line type="monotone" dataKey="Protein" stroke="var(--chart-2)" strokeWidth={2} />
            <Line type="monotone" dataKey="Fat" stroke="var(--chart-3)" strokeWidth={2} />
            <Line type="monotone" dataKey="Carbohydrate" stroke="var(--chart-4)" strokeWidth={2} />
            <Line type="monotone" dataKey="Fiber" stroke="var(--chart-5)" strokeWidth={2} />
            <Line type="monotone" dataKey="Sodium" stroke="var(--destructive)" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1 flex-wrap">
          {assessment.rows.map((row) => (
            <Button
              key={row.day}
              type="button"
              size="sm"
              variant={day === row.day ? "default" : "outline"}
              onClick={() => setDay(row.day)}
            >
              {row.dayLabel}
            </Button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {NUTRITION_METRICS.map((metric) => {
            const actual = selected.actual[metric.key];
            const target = targets[metric.key];
            const percent = selected.percent[metric.key];
            return (
              <div key={metric.key} className="rounded border border-border p-2">
                <div className="text-xs font-medium">{metric.label}</div>
                <div className="font-mono text-sm">
                  {display(actual, metric.unit)} / {display(target, metric.unit)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {percent == null ? "No target" : `${percent.toFixed(0)}% of daily target`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {conversionFood && (
        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Weekly storage-form conversions</h3>
          </div>
          <select
            value={conversionFood.id}
            onChange={(event) => setConversionFoodId(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {conversionFoods.map((food) => (
              <option key={food.id} value={food.id}>{food.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
            <Conversion label="Fresh planned" value={`${conversions.freshOunces.toFixed(1)} oz`} />
            <Conversion label="Freeze-dried estimate" value={`${conversions.freezeDriedOunces.toFixed(1)} dry oz`} />
            <Conversion label="Dehydrated estimate" value={`${conversions.dehydratedOunces.toFixed(1)} dry oz`} />
            <Conversion label="Canned estimate" value={`${conversions.cannedQuarts.toFixed(1)} qt`} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Planning estimates use the same crop-yield assumptions as Preservation Coach. Actual
            batch yields should replace them. Nutrition changes by method are shown only when that
            food has an approved USDA profile for the corresponding form.
          </p>
          {foodProfiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {foodProfiles.map((profile) => (
                <Badge key={profile.id} variant="outline">
                  {profile.foodForm}: FDC {profile.fdcId}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <NutritionTargetsDialog
        open={targetsOpen}
        onOpenChange={setTargetsOpen}
        personName={person.name}
        initial={targets}
        saving={savingTargets}
        onSave={(next) => {
          onSaveTargets(person.id, next);
          setTargetsOpen(false);
        }}
      />
    </section>
  );
}

function Conversion({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}

function NutritionTargetsDialog({
  open,
  onOpenChange,
  personName,
  initial,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  initial: NutritionTargets;
  saving: boolean;
  onSave: (targets: NutritionTargets) => void;
}) {
  const [draft, setDraft] = useState<NutritionTargets>(initial);
  const set = (key: keyof NutritionTargets, value: string) =>
    setDraft((current) => ({ ...current, [key]: Number(value) }));

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next) setDraft(initial);
      onOpenChange(next);
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Daily nutrition targets — {personName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Defaults are FDA adult Daily Values, not individualized medical recommendations. Adjust
          them for this person using guidance from their qualified clinician or dietitian.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {NUTRITION_METRICS.map((metric) => (
            <div key={metric.key}>
              <Label>{metric.label} ({metric.unit})</Label>
              <Input
                type="number"
                min="0.01"
                step="any"
                value={draft[metric.key] ?? ""}
                onChange={(event) => set(metric.key, event.target.value)}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => onSave(draft)}>
            {saving ? "Saving…" : "Save targets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
