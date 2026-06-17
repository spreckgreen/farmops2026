import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { classFallbackCategory, normalizeFoodCategory } from "./food-categories";

// ----------------------------------------------------------------------
// Crops & harvests
// ----------------------------------------------------------------------

const CROP_STATUSES = ["planned", "growing", "harvested", "ended"] as const;

const PlantingSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  crop: z.string().trim().min(1).max(200),
  variety: z.string().trim().max(200).nullable().optional(),
  area: z.string().trim().max(200).nullable().optional(),
  planted_on: z.string().nullable().optional(),
  expected_harvest: z.string().nullable().optional(),
  status: z.enum(CROP_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const HarvestSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  planting_id: z.string().uuid().nullable().optional(),
  harvested_on: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string().trim().min(1).max(50),
  quality: z.string().trim().max(50).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export const listCropPlantings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("crop_plantings")
      .select(
        "id, crop, variety, area, planted_on, expected_harvest, status, notes, created_at, updated_at, crop_harvests(id, harvested_on, quantity, unit, quality, notes)",
      )
      .order("planted_on", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertCropPlanting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlantingSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      crop: data.crop.trim(),
      variety: emptyToNull(data.variety ?? null),
      area: emptyToNull(data.area ?? null),
      planted_on: emptyToNull(data.planted_on ?? null),
      expected_harvest: emptyToNull(data.expected_harvest ?? null),
      status: data.status ?? "planned",
      notes: data.notes ?? "",
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("crop_plantings")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("crop_plantings")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteCropPlanting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("crop_plantings")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addCropHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => HarvestSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      planting_id: data.planting_id ?? null,
      harvested_on: data.harvested_on,
      quantity: toNumber(data.quantity),
      unit: data.unit.trim(),
      quality: emptyToNull(data.quality ?? null),
      notes: data.notes ?? "",
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("crop_harvests")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("crop_harvests")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteCropHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("crop_harvests")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------
// Food overview — counts for /food landing
// ----------------------------------------------------------------------

export const getFoodOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [garden, orchard, harvests] = await Promise.all([
      context.supabase
        .from("garden_plots")
        .select("id, row_label, position, plant_name, notes, updated_at")
        .not("plant_name", "is", null)
        .neq("plant_name", ""),
      context.supabase
        .from("orchard_trees")
        .select("id, species, variety, quantity, status, planted_on, updated_at"),
      context.supabase
        .from("crop_harvests")
        .select("id, harvested_on, quantity, unit, planting_id")
        .order("harvested_on", { ascending: false })
        .limit(5),
    ]);
    if (garden.error) throw new Error(garden.error.message);
    if (orchard.error) throw new Error(orchard.error.message);
    if (harvests.error) throw new Error(harvests.error.message);

    const gardenRows = garden.data ?? [];
    const orchardRows = orchard.data ?? [];
    const orchardTrees = orchardRows.reduce((s, r) => s + (Number(r.quantity) || 1), 0);

    const recentPlantings = [
      ...gardenRows.map((r) => ({
        id: `g-${r.id}`,
        source: "Garden" as const,
        name: r.plant_name ?? "",
        detail: `${r.row_label}${r.position}`,
        updated_at: r.updated_at,
      })),
      ...orchardRows.map((r) => ({
        id: `o-${r.id}`,
        source: "Orchard" as const,
        name: r.variety ? `${r.species} — ${r.variety}` : r.species,
        detail: `${r.quantity ?? 1} tree${(r.quantity ?? 1) === 1 ? "" : "s"}`,
        updated_at: r.updated_at,
      })),
    ]
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, 8);

    return {
      garden_plantings: gardenRows.length,
      orchard_trees: orchardTrees,
      orchard_entries: orchardRows.length,
      livestock_count: 0,
      total_plantings: gardenRows.length + orchardRows.length,
      recent_plantings: recentPlantings,
      recent_harvests: harvests.data ?? [],
    };
  });

// ----------------------------------------------------------------------
// Yield progress dashboard — expected (from food plan) vs actual (harvests)
// ----------------------------------------------------------------------

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function toPounds(qty: number, unit: string | null | undefined): number {
  const u = (unit ?? "").toLowerCase().trim();
  if (!u) return qty;
  if (["lb", "lbs", "pound", "pounds"].includes(u)) return qty;
  if (["oz", "ounce", "ounces"].includes(u)) return qty / 16;
  if (["kg", "kilogram", "kilograms"].includes(u)) return qty * 2.20462;
  if (["g", "gram", "grams"].includes(u)) return qty * 0.00220462;
  // counts (each, head, bunch, dozen) — treat as 1 lb proxy so they still register
  return qty;
}

// Lookup yield per garden plant (declared further down at module scope; safe at call time)
function yieldForPlant(name: string): number {
  const k = normalizeName(name);
  if (!k) return 0;
  if (YIELD_PER_PLANT_LBS[k] !== undefined) return YIELD_PER_PLANT_LBS[k];
  for (const [key, val] of Object.entries(YIELD_PER_PLANT_LBS)) {
    if (k.includes(key)) return val;
  }
  return DEFAULT_YIELD_LBS;
}

// Match a food plan item to one of our planting data sets by normalized name
// (or substring), case-insensitive. Returns true if foodName ~ recordName.
function nameMatches(foodName: string, recordName: string): boolean {
  const a = normalizeName(foodName);
  const b = normalizeName(recordName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export const getFoodYieldProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [foods, people, entries, plantings, harvests, gardenPlots, orchardTrees, storage] = await Promise.all([
      context.supabase.from("food_plan_foods").select("id, name, category, oz_per_serving, unit, price_per_pound"),
      context.supabase.from("food_plan_people").select("id, name"),
      context.supabase.from("food_plan_entries").select("food_id, person_id, day_of_week, quantity"),
      context.supabase.from("crop_plantings").select("id, crop, variety, status, planted_on, expected_harvest"),
      context.supabase.from("crop_harvests").select("id, planting_id, harvested_on, quantity, unit, quality, notes"),
      context.supabase.from("garden_plots").select("plant_name").not("plant_name", "is", null).neq("plant_name", ""),
      context.supabase.from("orchard_trees").select("species, quantity, status").neq("status", "removed"),
      context.supabase.from("food_storage_items").select("name, quantity, unit, status").eq("status", "available"),
    ]);
    if (foods.error) throw new Error(foods.error.message);
    if (people.error) throw new Error(people.error.message);
    if (entries.error) throw new Error(entries.error.message);
    if (plantings.error) throw new Error(plantings.error.message);
    if (harvests.error) throw new Error(harvests.error.message);
    if (gardenPlots.error) throw new Error(gardenPlots.error.message);
    if (orchardTrees.error) throw new Error(orchardTrees.error.message);
    if (storage.error) throw new Error(storage.error.message);

    // Storage on hand, indexed by normalized name
    const storageByName = new Map<string, number>();
    for (const s of storage.data ?? []) {
      const key = normalizeName(s.name);
      if (!key) continue;
      const lbs = toPounds(Number(s.quantity) || 0, s.unit);
      storageByName.set(key, (storageByName.get(key) ?? 0) + lbs);
    }

    // Aggregate garden plots → distinct plant name + count
    const gardenAgg = new Map<string, { display: string; count: number }>();
    for (const p of gardenPlots.data ?? []) {
      const key = normalizeName(p.plant_name);
      if (!key) continue;
      const cur = gardenAgg.get(key) ?? { display: (p.plant_name ?? "").trim(), count: 0 };
      cur.count += 1;
      gardenAgg.set(key, cur);
    }
    // Aggregate orchard trees → distinct species + count (skip removed)
    const orchardAgg = new Map<string, { display: string; count: number }>();
    for (const t of orchardTrees.data ?? []) {
      const key = normalizeName(t.species);
      if (!key) continue;
      const cur = orchardAgg.get(key) ?? { display: (t.species ?? "").trim(), count: 0 };
      cur.count += Number(t.quantity) || 1;
      orchardAgg.set(key, cur);
    }

    const peopleById = new Map((people.data ?? []).map((p) => [p.id, p.name]));
    const plantingById = new Map((plantings.data ?? []).map((p) => [p.id, p]));

    // Harvest totals indexed by normalized crop name
    const harvestByName = new Map<string, { pounds: number; entries: typeof harvests.data }>();
    for (const h of harvests.data ?? []) {
      const planting = h.planting_id ? plantingById.get(h.planting_id) : null;
      const name = normalizeName(planting?.crop);
      if (!name) continue;
      const lbs = toPounds(Number(h.quantity) || 0, h.unit);
      const cur = harvestByName.get(name) ?? { pounds: 0, entries: [] as any };
      cur.pounds += lbs;
      (cur.entries as any[]).push({ ...h, planting });
      harvestByName.set(name, cur);
    }

    // Plan entries indexed by food
    const entriesByFood = new Map<string, Array<{ person: string; day_of_week: number; quantity: number }>>();
    for (const e of entries.data ?? []) {
      const arr = entriesByFood.get(e.food_id) ?? [];
      arr.push({
        person: peopleById.get(e.person_id) ?? "—",
        day_of_week: e.day_of_week,
        quantity: Number(e.quantity) || 0,
      });
      entriesByFood.set(e.food_id, arr);
    }

    type Source = "garden" | "orchard" | "crops" | "livestock" | "other";
    type PlantingContrib = {
      source: Source;
      name: string;
      count: number;
      yield_per_unit_lbs: number;
      estimated_pounds: number;
    };
    type FoodRow = {
      food_id: string;
      name: string;
      category: string;
      source: Source;
      expected_pounds: number;
      estimated_pounds: number;
      actual_pounds: number;
      planned_gap_pounds: number;
      planned_gap_value: number;
      actual_gap_pounds: number;
      actual_gap_value: number;
      storage_pounds: number;
      mitigated_gap_pounds: number;
      mitigated_gap_value: number;
      price_per_lb: number;
      progress: number;
      plantings: PlantingContrib[];
      plan_entries: Array<{ person: string; day_of_week: number; quantity: number }>;
      harvest_entries: Array<{
        id: string;
        harvested_on: string;
        quantity: number;
        unit: string;
        pounds: number;
        notes: string | null;
      }>;
    };

    const rows: FoodRow[] = [];
    for (const f of foods.data ?? []) {
      const planEntries = entriesByFood.get(f.id) ?? [];
      // Plan quantities are stored as ounces per person per day (matches the
      // Plan tab's weekly-cost math: price_per_pound × qty / 16). Annual need
      // in pounds is therefore weekly_ounces × 52 / 16.
      const weeklyOunces = planEntries.reduce((s, e) => s + e.quantity, 0);
      const expectedPounds = (weeklyOunces * 52) / 16;
      const matched = harvestByName.get(normalizeName(f.name));
      const actualPounds = matched?.pounds ?? 0;
      const harvestEntries = (matched?.entries ?? []).map((h: any) => ({
        id: h.id,
        harvested_on: h.harvested_on,
        quantity: Number(h.quantity) || 0,
        unit: h.unit,
        pounds: toPounds(Number(h.quantity) || 0, h.unit),
        notes: h.notes ?? null,
      }));

      const cls = classifyFood(f.name);
      const source: Source = cls ?? "other";

      // Estimated pounds from planted records matching this food's name
      const plantingContribs: PlantingContrib[] = [];
      if (cls === "garden" || cls === null) {
        for (const [key, g] of gardenAgg) {
          if (!nameMatches(f.name, key)) continue;
          const ypu = yieldForPlant(key);
          plantingContribs.push({
            source: "garden",
            name: g.display,
            count: g.count,
            yield_per_unit_lbs: ypu,
            estimated_pounds: g.count * ypu,
          });
        }
      }
      if (cls === "orchard" || cls === null) {
        for (const [key, t] of orchardAgg) {
          if (!nameMatches(f.name, key)) continue;
          const ypu = yieldForTree(key);
          plantingContribs.push({
            source: "orchard",
            name: t.display,
            count: t.count,
            yield_per_unit_lbs: ypu,
            estimated_pounds: t.count * ypu,
          });
        }
      }
      const estimatedPounds = plantingContribs.reduce((s, p) => s + p.estimated_pounds, 0);
      const pricePerLb = Number(f.price_per_pound) || 0;
      // Planned gap: plan need vs what we've planted (do we have enough in the
      // ground to meet the plan?). Actual gap: plan need vs what's been
      // harvested so far (are we tracking against the plan?).
      const plannedGapPounds = Math.max(0, expectedPounds - estimatedPounds);
      const actualGapPounds = Math.max(0, expectedPounds - actualPounds);
      // Storage on hand for this food (matched by normalized name) offsets the
      // actual gap — a "supplement" the pantry can cover.
      const storagePounds = storageByName.get(normalizeName(f.name)) ?? 0;
      const mitigatedGapPounds = Math.max(0, actualGapPounds - storagePounds);

      if (
        expectedPounds === 0 &&
        actualPounds === 0 &&
        estimatedPounds === 0 &&
        storagePounds === 0 &&
        planEntries.length === 0
      ) continue;

      const category = normalizeFoodCategory(f.category, classFallbackCategory(cls));
      rows.push({
        food_id: f.id,
        name: f.name,
        category,
        source,
        expected_pounds: expectedPounds,
        estimated_pounds: estimatedPounds,
        actual_pounds: actualPounds,
        planned_gap_pounds: plannedGapPounds,
        planned_gap_value: plannedGapPounds * pricePerLb,
        actual_gap_pounds: actualGapPounds,
        actual_gap_value: actualGapPounds * pricePerLb,
        storage_pounds: storagePounds,
        mitigated_gap_pounds: mitigatedGapPounds,
        mitigated_gap_value: mitigatedGapPounds * pricePerLb,
        price_per_lb: pricePerLb,
        progress: expectedPounds > 0 ? actualPounds / expectedPounds : 0,
        plantings: plantingContribs.sort((a, b) => b.estimated_pounds - a.estimated_pounds),
        plan_entries: planEntries.sort((a, b) => a.day_of_week - b.day_of_week),
        harvest_entries: harvestEntries.sort((a, b) =>
          (b.harvested_on ?? "").localeCompare(a.harvested_on ?? ""),
        ),
      });
    }

    // Group by category
    const byCategory = new Map<string, FoodRow[]>();
    for (const r of rows) {
      const arr = byCategory.get(r.category) ?? [];
      arr.push(r);
      byCategory.set(r.category, arr);
    }
    const categories = Array.from(byCategory.entries())
      .map(([category, items]) => {
        const expected = items.reduce((s, r) => s + r.expected_pounds, 0);
        const estimated = items.reduce((s, r) => s + r.estimated_pounds, 0);
        const actual = items.reduce((s, r) => s + r.actual_pounds, 0);
        const plannedGap = items.reduce((s, r) => s + r.planned_gap_pounds, 0);
        const plannedGapValue = items.reduce((s, r) => s + r.planned_gap_value, 0);
        const actualGap = items.reduce((s, r) => s + r.actual_gap_pounds, 0);
        const actualGapValue = items.reduce((s, r) => s + r.actual_gap_value, 0);
        const storage = items.reduce((s, r) => s + r.storage_pounds, 0);
        const mitigatedGap = items.reduce((s, r) => s + r.mitigated_gap_pounds, 0);
        const mitigatedGapValue = items.reduce((s, r) => s + r.mitigated_gap_value, 0);
        return {
          category,
          expected_pounds: expected,
          estimated_pounds: estimated,
          actual_pounds: actual,
          planned_gap_pounds: plannedGap,
          planned_gap_value: plannedGapValue,
          actual_gap_pounds: actualGap,
          actual_gap_value: actualGapValue,
          storage_pounds: storage,
          mitigated_gap_pounds: mitigatedGap,
          mitigated_gap_value: mitigatedGapValue,
          progress: expected > 0 ? actual / expected : 0,
          items: items.sort((a, b) => b.expected_pounds - a.expected_pounds),
        };
      })
      .sort((a, b) => b.expected_pounds - a.expected_pounds);

    const totals = {
      expected_pounds: rows.reduce((s, r) => s + r.expected_pounds, 0),
      estimated_pounds: rows.reduce((s, r) => s + r.estimated_pounds, 0),
      actual_pounds: rows.reduce((s, r) => s + r.actual_pounds, 0),
      planned_gap_pounds: rows.reduce((s, r) => s + r.planned_gap_pounds, 0),
      planned_gap_value: rows.reduce((s, r) => s + r.planned_gap_value, 0),
      actual_gap_pounds: rows.reduce((s, r) => s + r.actual_gap_pounds, 0),
      actual_gap_value: rows.reduce((s, r) => s + r.actual_gap_value, 0),
      storage_pounds: rows.reduce((s, r) => s + r.storage_pounds, 0),
      mitigated_gap_pounds: rows.reduce((s, r) => s + r.mitigated_gap_pounds, 0),
      mitigated_gap_value: rows.reduce((s, r) => s + r.mitigated_gap_value, 0),
    };

    return { categories, totals };
  });

// ----------------------------------------------------------------------
// Food Plan: people / foods / weekly entries matrix
// ----------------------------------------------------------------------

import seedJson from "@/data/food-plan-seed.json";

const PersonSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(100),
  sort_order: z.number().int().optional(),
});

const FoodSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).nullable().optional(),
  season: z.string().trim().max(50).nullable().optional(),
  meal: z.string().trim().max(50).nullable().optional(),
  freeze_dry: z.boolean().optional(),
  price_per_pound: z.union([z.number(), z.string(), z.null()]).optional(),
  oz_per_serving: z.union([z.number(), z.string(), z.null()]).optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  sort_order: z.number().int().optional(),
});

const EntrySchema = z.object({
  person_id: z.string().uuid(),
  food_id: z.string().uuid(),
  day_of_week: z.number().int().min(1).max(7),
  quantity: z.union([z.number(), z.string()]),
});

export const listFoodPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [people, foods, entries] = await Promise.all([
      context.supabase.from("food_plan_people").select("*").order("sort_order"),
      context.supabase.from("food_plan_foods").select("*").order("sort_order"),
      context.supabase.from("food_plan_entries").select("*"),
    ]);
    if (people.error) throw new Error(people.error.message);
    if (foods.error) throw new Error(foods.error.message);
    if (entries.error) throw new Error(entries.error.message);
    return {
      people: people.data ?? [],
      foods: foods.data ?? [],
      entries: entries.data ?? [],
    };
  });

export const upsertFoodPlanPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersonSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name.trim(),
      sort_order: data.sort_order ?? 0,
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("food_plan_people")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("food_plan_people")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteFoodPlanPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("food_plan_people").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertFoodPlanFood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FoodSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name.trim(),
      category: normalizeFoodCategory(data.category ?? null),
      season: emptyToNull(data.season ?? null),
      meal: emptyToNull(data.meal ?? null),
      freeze_dry: !!data.freeze_dry,
      price_per_pound:
        data.price_per_pound === null || data.price_per_pound === undefined || data.price_per_pound === ""
          ? null
          : toNumber(data.price_per_pound),
      oz_per_serving:
        data.oz_per_serving === null || data.oz_per_serving === undefined || data.oz_per_serving === ""
          ? null
          : toNumber(data.oz_per_serving),
      unit: emptyToNull(data.unit ?? null),
      sort_order: data.sort_order ?? 0,
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("food_plan_foods")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("food_plan_foods")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteFoodPlanFood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("food_plan_foods").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setFoodPlanEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EntrySchema.parse(d))
  .handler(async ({ data, context }) => {
    const qty = toNumber(data.quantity);
    if (qty === 0) {
      const { error } = await context.supabase
        .from("food_plan_entries")
        .delete()
        .eq("person_id", data.person_id)
        .eq("food_id", data.food_id)
        .eq("day_of_week", data.day_of_week);
      if (error) throw new Error(error.message);
      return { ok: true, deleted: true };
    }
    const { data: out, error } = await context.supabase
      .from("food_plan_entries")
      .upsert(
        {
          user_id: context.userId,
          person_id: data.person_id,
          food_id: data.food_id,
          day_of_week: data.day_of_week,
          quantity: qty,
        },
        { onConflict: "user_id,person_id,food_id,day_of_week" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const seedFoodPlanFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const seed = seedJson as {
      persons: string[];
      foods: Array<{
        name: string;
        price_per_pound: number | null;
        season: string | null;
        freeze_dry: boolean;
      }>;
      plan: Record<string, Record<string, number>>;
    };

    // Insert people
    const peopleRows = seed.persons.map((name, i) => ({
      user_id: context.userId,
      name,
      sort_order: i,
    }));
    const { data: peopleData, error: pErr } = await context.supabase
      .from("food_plan_people")
      .insert(peopleRows)
      .select();
    if (pErr) throw new Error(pErr.message);

    // Insert foods
    const foodRows = seed.foods.map((f, i) => ({
      user_id: context.userId,
      name: f.name,
      category: normalizeFoodCategory(null, classFallbackCategory(classifyFood(f.name))),
      season: f.season,
      freeze_dry: f.freeze_dry,
      price_per_pound: f.price_per_pound,
      sort_order: i,
    }));
    const { data: foodData, error: fErr } = await context.supabase
      .from("food_plan_foods")
      .insert(foodRows)
      .select();
    if (fErr) throw new Error(fErr.message);

    // Build lookup
    const personByCode: Record<string, string> = {};
    seed.persons.forEach((code, i) => {
      personByCode[code] = peopleData![i].id;
    });
    const foodByName: Record<string, string> = {};
    seed.foods.forEach((f, i) => {
      foodByName[f.name] = foodData![i].id;
    });

    // Build entries
    const entries: Array<{
      user_id: string;
      person_id: string;
      food_id: string;
      day_of_week: number;
      quantity: number;
    }> = [];
    for (const key of Object.keys(seed.plan)) {
      const [code, dayStr] = key.split("_");
      const day = parseInt(dayStr, 10);
      const personId = personByCode[code];
      const dayPlan = seed.plan[key];
      for (const foodName of Object.keys(dayPlan)) {
        const foodId = foodByName[foodName];
        if (!personId || !foodId) continue;
        entries.push({
          user_id: context.userId,
          person_id: personId,
          food_id: foodId,
          day_of_week: day,
          quantity: dayPlan[foodName],
        });
      }
    }
    if (entries.length) {
      const { error: eErr } = await context.supabase.from("food_plan_entries").insert(entries);
      if (eErr) throw new Error(eErr.message);
    }

    return { people: peopleData!.length, foods: foodData!.length, entries: entries.length };
  });

// ----------------------------------------------------------------------
// Garden
// ----------------------------------------------------------------------

const GardenPlotSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  row_label: z.string().trim().min(1).max(50),
  position: z.number().int().min(1).max(999),
  plant_name: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const listGardenPlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("garden_plots")
      .select("id, row_label, position, plant_name, notes")
      .order("row_label", { ascending: true })
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertGardenPlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GardenPlotSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      row_label: data.row_label,
      position: data.position,
      plant_name: emptyToNull(data.plant_name ?? null),
      notes: emptyToNull(data.notes ?? null),
    };
    const { data: out, error } = await context.supabase
      .from("garden_plots")
      .upsert(row, { onConflict: "user_id,row_label,position" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteGardenPlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("garden_plots").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const seedGardenFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { default: seed } = await import("@/data/garden-seed.json");
    const rows: Array<{ user_id: string; row_label: string; position: number; plant_name: string | null }> = [];
    for (const rowLabel of seed.rows) {
      const plants = (seed.plants as Record<string, Array<string | null>>)[rowLabel] ?? [];
      plants.forEach((plant, idx) => {
        if (!plant) return;
        rows.push({
          user_id: context.userId,
          row_label: rowLabel,
          position: idx + 1,
          plant_name: plant,
        });
      });
    }
    if (rows.length) {
      const { error } = await context.supabase
        .from("garden_plots")
        .upsert(rows, { onConflict: "user_id,row_label,position" });
      if (error) throw new Error(error.message);
    }
    return { inserted: rows.length };
  });

// ----------------------------------------------------------------------
// Orchard
// ----------------------------------------------------------------------

const ORCHARD_STATUSES = ["healthy", "young", "producing", "diseased", "removed"] as const;
const ORCHARD_CATEGORIES = ["fruit", "nut", "hardwood", "softwood", "other"] as const;

const OrchardTreeSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  species: z.string().trim().min(1).max(200),
  variety: z.string().trim().max(200).nullable().optional(),
  quantity: z.number().int().min(1).max(99999).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  planted_on: z.string().nullable().optional(),
  status: z.enum(ORCHARD_STATUSES).optional(),
  category: z.enum(ORCHARD_CATEGORIES).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const listOrchardTrees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orchard_trees")
      .select("id, species, variety, quantity, location, planted_on, status, category, notes, created_at")
      .order("species", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertOrchardTree = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OrchardTreeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      species: data.species.trim(),
      variety: emptyToNull(data.variety ?? null),
      quantity: data.quantity ?? 1,
      location: emptyToNull(data.location ?? null),
      planted_on: emptyToNull(data.planted_on ?? null),
      status: data.status ?? "healthy",
      notes: emptyToNull(data.notes ?? null),
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("orchard_trees").update(row).eq("id", data.id).select().single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("orchard_trees").insert(row).select().single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteOrchardTree = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("orchard_trees").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------
// Price history
// ----------------------------------------------------------------------

export const listPriceHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [hist, foods] = await Promise.all([
      context.supabase
        .from("food_price_history")
        .select("id, food_id, food_name, old_price, new_price, changed_at")
        .order("changed_at", { ascending: false })
        .limit(2000),
      context.supabase.from("food_plan_foods").select("id, category, unit"),
    ]);
    if (hist.error) throw new Error(hist.error.message);
    if (foods.error) throw new Error(foods.error.message);
    const metaById = new Map(
      (foods.data ?? []).map((f) => [
        f.id as string,
        { category: (f.category as string | null) ?? null, unit: (f.unit as string | null) ?? null },
      ]),
    );
    return (hist.data ?? []).map((row) => {
      const meta = row.food_id ? metaById.get(row.food_id) : null;
      return { ...row, category: meta?.category ?? null, unit: meta?.unit ?? null };
    });
  });

// Add/update a price for a food. The food_price_history trigger logs the change
// automatically when food_plan_foods.price_per_pound is updated/inserted.
export const recordFoodPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      food_id: z.string().uuid(),
      new_price: z.union([z.number(), z.string()]).transform((v) => toNumber(v)),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("food_plan_foods")
      .update({ price_per_pound: data.new_price })
      .eq("id", data.food_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Seed (or top up) the food catalog with livestock-derived products so they
// appear in the Pricing page and can be priced/refreshed: meats, eggs, dairy,
// and fiber (wool/mohair/alpaca/cashmere/hair). Existing entries (matched
// case-insensitively by name) are left alone.
export const seedLivestockProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    type Seed = { name: string; category: string; unit: string; oz_per_serving: number | null };
    const SEEDS: Seed[] = [
      // Meat
      { name: "Chicken (whole)",     category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Chicken breast",      category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Turkey",              category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Duck",                category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Goose",               category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Rabbit",              category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Beef (ground)",       category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Beef (steak)",        category: "livestock-meat", unit: "lb", oz_per_serving: 6 },
      { name: "Beef (roast)",        category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Pork (chops)",        category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Pork (ground)",       category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Bacon",               category: "livestock-meat", unit: "lb", oz_per_serving: 2 },
      { name: "Ham",                 category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Sausage",             category: "livestock-meat", unit: "lb", oz_per_serving: 3 },
      { name: "Lamb",                category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Mutton",              category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Goat",                category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Venison",             category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      { name: "Bison",               category: "livestock-meat", unit: "lb", oz_per_serving: 4 },
      // Eggs (priced per lb; ~1 dozen large eggs ≈ 1.5 lb)
      { name: "Chicken eggs",        category: "livestock-eggs", unit: "dozen", oz_per_serving: 3.5 },
      { name: "Duck eggs",           category: "livestock-eggs", unit: "dozen", oz_per_serving: 4.5 },
      { name: "Quail eggs",          category: "livestock-eggs", unit: "dozen", oz_per_serving: 1.5 },
      { name: "Goose eggs",          category: "livestock-eggs", unit: "each",  oz_per_serving: 5 },
      // Dairy
      { name: "Cow milk",            category: "livestock-dairy", unit: "gallon", oz_per_serving: 8 },
      { name: "Goat milk",           category: "livestock-dairy", unit: "gallon", oz_per_serving: 8 },
      { name: "Sheep milk",          category: "livestock-dairy", unit: "gallon", oz_per_serving: 8 },
      { name: "Cream",               category: "livestock-dairy", unit: "pint",   oz_per_serving: 2 },
      { name: "Butter",              category: "livestock-dairy", unit: "lb",     oz_per_serving: 1 },
      { name: "Cheese (cheddar)",    category: "livestock-dairy", unit: "lb",     oz_per_serving: 1.5 },
      { name: "Cheese (mozzarella)", category: "livestock-dairy", unit: "lb",     oz_per_serving: 1.5 },
      { name: "Cheese (feta)",       category: "livestock-dairy", unit: "lb",     oz_per_serving: 1 },
      { name: "Cheese (chevre)",     category: "livestock-dairy", unit: "lb",     oz_per_serving: 1 },
      { name: "Yogurt",              category: "livestock-dairy", unit: "lb",     oz_per_serving: 6 },
      { name: "Ghee",                category: "livestock-dairy", unit: "lb",     oz_per_serving: 0.5 },
      { name: "Whey",                category: "livestock-dairy", unit: "lb",     oz_per_serving: 8 },
      // Fiber (priced per lb of raw / clean fiber)
      { name: "Wool (raw fleece)",   category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Wool (clean)",        category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Mohair",              category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Cashmere",            category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Alpaca fiber",        category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Llama fiber",         category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Angora (rabbit hair)",category: "livestock-fiber", unit: "lb", oz_per_serving: null },
      { name: "Horsehair",           category: "livestock-fiber", unit: "lb", oz_per_serving: null },
    ];

    const { data: existing, error: exErr } = await context.supabase
      .from("food_plan_foods")
      .select("name");
    if (exErr) throw new Error(exErr.message);
    const have = new Set(((existing ?? []) as Array<{ name: string }>).map((r) => r.name.trim().toLowerCase()));

    const rows = SEEDS
      .filter((s) => !have.has(s.name.trim().toLowerCase()))
      .map((s, i) => ({
        user_id: context.userId,
        name: s.name,
        category: s.category,
        unit: s.unit,
        oz_per_serving: s.oz_per_serving,
        freeze_dry: false,
        price_per_pound: null,
        sort_order: 1000 + i,
      }));

    if (rows.length === 0) return { inserted: 0, skipped: SEEDS.length };

    const { error } = await context.supabase.from("food_plan_foods").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length, skipped: SEEDS.length - rows.length };
  });

// Uses Lovable AI gateway to estimate current retail $/lb based on the model's
// knowledge of Southern Ohio (Cincinnati / Dayton / Columbus metro) grocery
// and farmers' market pricing.
export const refreshPricesSouthernOhio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const { data: foods, error } = await context.supabase
      .from("food_plan_foods")
      .select("id, name, category, unit, price_per_pound");
    if (error) throw new Error(error.message);
    const list = (foods ?? []) as Array<{
      id: string; name: string; category: string | null; unit: string | null; price_per_pound: number | null;
    }>;
    if (list.length === 0) return { updated: 0, unchanged: 0, source: "Southern Ohio regional reference (USDA AMS + retail avg)" };

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const itemsBlock = list
      .map((f) => `- ${f.name}${f.category ? ` [${f.category}]` : ""}`)
      .join("\n");

    const prompt = `You are a USDA AMS market reporter. Return current retail reference prices in USD per pound for Southern Ohio (Cincinnati / Dayton / Columbus metro), averaging conventional grocery and regional farmers' markets as of the latest available data.

Return ONLY a strict JSON object of the form:
{"prices":[{"name":"<exact food name from list>","price_per_pound":<number>}]}

Rules:
- Use the exact food name string from the list, do not rename.
- price_per_pound is a plain number (e.g. 3.49), no currency symbol.
- Omit items you have no reasonable Southern Ohio reference for; do not guess wildly.
- Eggs: report price per dozen converted to per pound (1 dozen large eggs ≈ 1.5 lb; duck ≈ 2.25 lb/dozen; quail ≈ 0.75 lb/dozen).
- Milk: report per gallon converted to per pound (1 gallon ≈ 8.6 lb).
- Cream: report per pint converted to per pound (1 pint ≈ 1 lb).
- Cheese, butter, yogurt, ghee, whey: report per pound directly (retail block / tub).
- Meat (chicken, turkey, duck, goose, rabbit, beef, pork, lamb, mutton, goat, venison, bison, ham, bacon, sausage): report retail per pound.
- Fiber (wool raw fleece, wool clean, mohair, cashmere, alpaca, llama, angora rabbit, horsehair): report wholesale/farmgate USD per pound of fiber as priced at Midwest/Ohio fiber mills and fleece auctions.

ITEMS:
${itemsBlock}`;

    const { text } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      prompt,
    });

    // Extract JSON object from the model output.
    let parsed: { prices?: Array<{ name: string; price_per_pound: number }> } = {};
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* ignore */ }
    }
    const prices = Array.isArray(parsed.prices) ? parsed.prices : [];
    const byName = new Map<string, number>();
    for (const p of prices) {
      if (p && typeof p.name === "string" && Number.isFinite(Number(p.price_per_pound))) {
        byName.set(p.name.trim().toLowerCase(), Number(p.price_per_pound));
      }
    }

    let updated = 0;
    let unchanged = 0;
    for (const f of list) {
      const next = byName.get(f.name.trim().toLowerCase());
      if (next === undefined) { unchanged++; continue; }
      const rounded = Math.round(next * 100) / 100;
      if (f.price_per_pound != null && Math.abs(Number(f.price_per_pound) - rounded) < 0.005) {
        unchanged++;
        continue;
      }
      const { error: upErr } = await context.supabase
        .from("food_plan_foods")
        .update({ price_per_pound: rounded })
        .eq("id", f.id);
      if (!upErr) updated++;
    }

    return {
      updated,
      unchanged,
      source: "Southern Ohio regional reference (Cincinnati / Dayton / Columbus retail + farmers' market avg)",
    };
  });


// ----------------------------------------------------------------------
// Bulk import
// ----------------------------------------------------------------------

export const bulkUpsertGardenPlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      plots: z.array(GardenPlotSchema.omit({ id: true })).min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = data.plots
      .map((p) => ({
        user_id: context.userId,
        row_label: p.row_label,
        position: p.position,
        plant_name: emptyToNull(p.plant_name ?? null),
        notes: emptyToNull(p.notes ?? null),
      }))
      .filter((r) => r.plant_name);
    if (!rows.length) return { inserted: 0 };
    const { error } = await context.supabase
      .from("garden_plots")
      .upsert(rows, { onConflict: "user_id,row_label,position" });
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

export const bulkInsertOrchardTrees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      trees: z.array(OrchardTreeSchema.omit({ id: true })).min(1).max(1000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = data.trees.map((t) => ({
      user_id: context.userId,
      species: t.species.trim(),
      variety: emptyToNull(t.variety ?? null),
      quantity: t.quantity ?? 1,
      location: emptyToNull(t.location ?? null),
      planted_on: emptyToNull(t.planted_on ?? null),
      status: t.status ?? "healthy",
      notes: emptyToNull(t.notes ?? null),
    }));
    const { error } = await context.supabase.from("orchard_trees").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

// ----------------------------------------------------------------------
// Garden dashboard — plant counts, expected seasonal yield, gaps vs. food plan
// ----------------------------------------------------------------------

const YIELD_PER_PLANT_LBS: Record<string, number> = {
  tomato: 10, tomatoes: 10,
  pepper: 3, peppers: 3,
  cucumber: 5, cucumbers: 5,
  cabbage: 3,
  squash: 8, zucchini: 10,
  melon: 6, watermelon: 15, cantaloupe: 8,
  bean: 0.5, beans: 0.5,
  pea: 0.3, peas: 0.3,
  spinach: 0.5,
  basil: 0.5, herb: 0.25, herbs: 0.25,
  beet: 0.4, beets: 0.4,
  radish: 0.1, radishes: 0.1,
  carrot: 0.25, carrots: 0.25,
  onion: 0.4, onions: 0.4,
  garlic: 0.15,
  potato: 2, potatoes: 2,
  lettuce: 0.5,
  kale: 1,
  broccoli: 1,
  cauliflower: 1.5,
  corn: 0.5,
  strawberry: 1, strawberries: 1,
  blueberry: 5, blueberries: 5,
  raspberry: 2, raspberries: 2,
};
const DEFAULT_YIELD_LBS = 1;
const GROWING_WEEKS = 26;

// ---- Plan-food classifier: maps a food plan item to one production category
// so each dashboard's "need" list is scoped (e.g. Apple → orchard, Chicken →
// livestock). Priority: livestock > orchard > crops > garden.
const LIVESTOCK_KEYWORDS = [
  "beef", "steak", "ground beef", "ribs", "brisket", "veal",
  "pork", "ham", "bacon", "sausage", "pepperoni", "salami", "hot dog",
  "chicken", "poultry", "turkey", "duck", "goose",
  "lamb", "mutton", "goat", "rabbit", "venison",
  "fish", "salmon", "tuna", "tilapia", "cod", "trout", "shrimp", "crab", "lobster",
  "egg", "eggs",
  "milk", "cream", "butter", "cheese", "yogurt", "whey", "ghee",
  "jerky", "meat",
];
const ORCHARD_KEYWORDS = [
  "apple", "pear", "peach", "nectarine", "plum", "cherry", "apricot", "fig", "persimmon",
  "almond", "walnut", "pecan", "chestnut", "hazelnut",
  "orange", "lemon", "lime", "grapefruit", "mandarin",
  "avocado", "mango", "olive", "grape",
  "blueberr", "raspberr", "blackberr", "boysenberr", "strawberr",
  "berries", "berry", "citrus", "pineapple", "banana", "lychee",
  "kiwi", "papaya", "passion fruit", "guava", "pomegranate",
];
const CROPS_KEYWORDS = [
  "wheat", "flour", "bread", "pasta", "cereal", "oats", "oat", "barley",
  "rye", "rice", "quinoa", "millet", "buckwheat", "cornmeal", "popcorn",
  "lentil", "chickpea", "garbanzo", "kidney bean", "pinto bean", "black bean",
  "soy", "tofu", "tempeh", "sugar", "honey", "molasses", "syrup", "oil",
];
const GARDEN_KEYWORDS = [
  "tomato", "pepper", "cucumber", "cabbage", "squash", "zucchini",
  "melon", "watermelon", "cantaloupe", "bean", "pea", "spinach",
  "basil", "herb", "beet", "radish", "carrot", "onion", "garlic",
  "potato", "lettuce", "kale", "broccoli", "cauliflower", "corn",
  "asparagus", "celery", "chard", "arugula", "eggplant", "okra",
  "leek", "scallion", "parsley", "cilantro", "dill", "mint", "thyme",
  "rosemary", "sage", "oregano", "chive",
];

// Map a food name to a display category label used by the dashboard / plan UI.
function inferCategoryLabel(name: string): string | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  const hit = (list: string[]) => list.some((k) => n.includes(k));
  // Livestock-derived: split into protein / eggs / dairy / fiber
  if (hit(["wool", "mohair", "alpaca", "cashmere", "angora", "fiber", "fleece"]))
    return "Fiber";
  if (hit(["egg", "eggs"])) return "Eggs";
  if (hit(["milk", "cream", "butter", "cheese", "yogurt", "whey", "ghee"]))
    return "Dairy";
  if (
    hit([
      "beef", "steak", "ground beef", "ribs", "brisket", "veal",
      "pork", "ham", "bacon", "sausage", "pepperoni", "salami", "hot dog",
      "chicken", "poultry", "turkey", "duck", "goose",
      "lamb", "mutton", "goat", "rabbit", "venison",
      "fish", "salmon", "tuna", "tilapia", "cod", "trout", "shrimp", "crab", "lobster",
      "jerky", "meat",
    ])
  )
    return "Animal protein";
  if (hit(ORCHARD_KEYWORDS)) return "Orchard (fruit/nut)";
  if (hit(GARDEN_KEYWORDS)) return "Vegetables";
  if (hit(CROPS_KEYWORDS)) return "Field crops";
  if (hit(["coffee", "tea", "juice", "wine", "beer", "soda", "drink"]))
    return "Beverages";
  return null;
}

export const autoClassifyFoodCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ overwriteExisting: z.boolean().optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const overwrite = !!data.overwriteExisting;
    const { data: foods, error } = await context.supabase
      .from("food_plan_foods")
      .select("id, name, category");
    if (error) throw new Error(error.message);

    let updated = 0;
    let unchanged = 0;
    for (const f of foods ?? []) {
      const current = (f.category ?? "").trim();
      const isEmpty = !current || current.toLowerCase() === "uncategorized";
      const inferred = inferCategoryLabel(f.name);
      if (!inferred) {
        unchanged += 1;
        continue;
      }
      if (!isEmpty && !overwrite) {
        unchanged += 1;
        continue;
      }
      if (current === inferred) {
        unchanged += 1;
        continue;
      }
      const { error: upErr } = await context.supabase
        .from("food_plan_foods")
        .update({ category: inferred })
        .eq("id", f.id);
      if (upErr) throw new Error(upErr.message);
      updated += 1;
    }
    return { updated, unchanged };
  });

export const bulkUpdateFoodCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        updates: z
          .array(
            z.object({
              id: z.string().uuid(),
              category: z.string().trim().max(100).nullable(),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let updated = 0;
    for (const u of data.updates) {
      const cat = normalizeFoodCategory(u.category ?? null);
      const { error } = await context.supabase
        .from("food_plan_foods")
        .update({ category: cat })
        .eq("id", u.id);
      if (error) throw new Error(error.message);
      updated += 1;
    }
    return { updated };
  });

function classifyFood(name: string): "livestock" | "orchard" | "crops" | "garden" | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  const hit = (list: string[]) => list.some((k) => n.includes(k));
  if (hit(LIVESTOCK_KEYWORDS)) return "livestock";
  if (hit(ORCHARD_KEYWORDS)) return "orchard";
  if (hit(CROPS_KEYWORDS)) return "crops";
  if (hit(GARDEN_KEYWORDS)) return "garden";
  return null;
}

export const getGardenDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [plots, foods, entries] = await Promise.all([
      context.supabase
        .from("garden_plots")
        .select("plant_name")
        .not("plant_name", "is", null)
        .neq("plant_name", ""),
      context.supabase.from("food_plan_foods").select("id, name, oz_per_serving, price_per_pound"),
      context.supabase.from("food_plan_entries").select("food_id, quantity"),
    ]);
    if (plots.error) throw new Error(plots.error.message);
    if (foods.error) throw new Error(foods.error.message);
    if (entries.error) throw new Error(entries.error.message);

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    const yieldFor = (name: string) => {
      const k = norm(name);
      if (YIELD_PER_PLANT_LBS[k] !== undefined) return YIELD_PER_PLANT_LBS[k];
      for (const [key, val] of Object.entries(YIELD_PER_PLANT_LBS)) {
        if (k.includes(key)) return val;
      }
      return DEFAULT_YIELD_LBS;
    };

    const counts = new Map<string, { display: string; count: number }>();
    for (const p of plots.data ?? []) {
      const key = norm(p.plant_name);
      if (!key) continue;
      const cur = counts.get(key) ?? { display: (p.plant_name ?? "").trim(), count: 0 };
      cur.count += 1;
      counts.set(key, cur);
    }

    const weeklyByFood = new Map<string, number>();
    for (const e of entries.data ?? []) {
      weeklyByFood.set(e.food_id, (weeklyByFood.get(e.food_id) ?? 0) + (Number(e.quantity) || 0));
    }
    const priceByName = new Map<string, number>();
    const neededByName = new Map<string, { needed_lbs: number; display: string }>();
    for (const f of foods.data ?? []) {
      const price = Number(f.price_per_pound) || 0;
      if (price > 0) priceByName.set(norm(f.name), price);
      const weekly = weeklyByFood.get(f.id) ?? 0;
      if (weekly === 0) continue;
      if (classifyFood(f.name) !== "garden") continue;
      const oz = Number(f.oz_per_serving) || 0;
      const lbs = (weekly * GROWING_WEEKS * oz) / 16;
      if (lbs <= 0) continue;
      neededByName.set(norm(f.name), { needed_lbs: lbs, display: f.name });
    }

    const keys = new Set<string>([...counts.keys(), ...neededByName.keys()]);
    const plants = Array.from(keys).map((k) => {
      const c = counts.get(k);
      const need = neededByName.get(k);
      const ypp = yieldFor(k);
      const count = c?.count ?? 0;
      const expectedYield = count * ypp;
      const neededLbs = need?.needed_lbs ?? 0;
      const plantsNeeded = neededLbs > 0 ? Math.ceil(neededLbs / ypp) : 0;
      const gapPlants = Math.max(0, plantsNeeded - count);
      const gapLbs = Math.max(0, neededLbs - expectedYield);
      const pricePerLb = priceByName.get(k) ?? 0;
      return {
        key: k,
        name: c?.display || need?.display || k,
        count,
        yield_per_plant_lbs: ypp,
        expected_yield_lbs: expectedYield,
        needed_lbs: neededLbs,
        plants_needed: plantsNeeded,
        gap_plants: gapPlants,
        gap_lbs: gapLbs,
        price_per_lb: pricePerLb,
        expected_yield_value: expectedYield * pricePerLb,
        gap_value: gapLbs * pricePerLb,
      };
    });

    const summary = {
      total_plants: plants.reduce((s, p) => s + p.count, 0),
      distinct_plants: plants.filter((p) => p.count > 0).length,
      total_expected_yield_lbs: plants.reduce((s, p) => s + p.expected_yield_lbs, 0),
      total_needed_lbs: plants.reduce((s, p) => s + p.needed_lbs, 0),
      total_expected_yield_value: plants.reduce((s, p) => s + p.expected_yield_value, 0),
      total_gap_value: plants.reduce((s, p) => s + p.gap_value, 0),
    };

    return {
      summary,
      plants: plants.sort((a, b) => b.expected_yield_lbs - a.expected_yield_lbs),
      gaps: plants.filter((p) => p.gap_plants > 0).sort((a, b) => b.gap_lbs - a.gap_lbs),
    };
  });

// ----------------------------------------------------------------------
// Orchard dashboard — trees x yield/tree, gaps vs. food plan
// ----------------------------------------------------------------------

const YIELD_PER_TREE_LBS: Record<string, number> = {
  apple: 150, pear: 100, peach: 100, nectarine: 100,
  plum: 60, cherry: 75, apricot: 75, fig: 50, persimmon: 75,
  almond: 30, walnut: 50, pecan: 75, chestnut: 50, hazelnut: 15,
  orange: 150, lemon: 100, lime: 60, grapefruit: 200, mandarin: 100,
  avocado: 150, mango: 200, olive: 50,
  blueberry: 8, raspberry: 4, blackberry: 6, grape: 20,
};
const DEFAULT_TREE_YIELD_LBS = 50;

function yieldForTree(name: string): number {
  const k = name.trim().toLowerCase();
  if (YIELD_PER_TREE_LBS[k] !== undefined) return YIELD_PER_TREE_LBS[k];
  for (const [key, val] of Object.entries(YIELD_PER_TREE_LBS)) {
    if (k.includes(key)) return val;
  }
  return DEFAULT_TREE_YIELD_LBS;
}

export const getOrchardDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [trees, foods, entries] = await Promise.all([
      context.supabase
        .from("orchard_trees")
        .select("species, quantity, status")
        .neq("status", "removed"),
      context.supabase.from("food_plan_foods").select("id, name, oz_per_serving, price_per_pound"),
      context.supabase.from("food_plan_entries").select("food_id, quantity"),
    ]);
    if (trees.error) throw new Error(trees.error.message);
    if (foods.error) throw new Error(foods.error.message);
    if (entries.error) throw new Error(entries.error.message);

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

    const counts = new Map<string, { display: string; count: number }>();
    for (const t of trees.data ?? []) {
      const key = norm(t.species);
      if (!key) continue;
      const cur = counts.get(key) ?? { display: (t.species ?? "").trim(), count: 0 };
      cur.count += Number(t.quantity) || 1;
      counts.set(key, cur);
    }

    const weeklyByFood = new Map<string, number>();
    for (const e of entries.data ?? []) {
      weeklyByFood.set(e.food_id, (weeklyByFood.get(e.food_id) ?? 0) + (Number(e.quantity) || 0));
    }
    const priceByName = new Map<string, number>();
    const neededByName = new Map<string, { needed_lbs: number; display: string }>();
    for (const f of foods.data ?? []) {
      const price = Number(f.price_per_pound) || 0;
      if (price > 0) priceByName.set(norm(f.name), price);
      const weekly = weeklyByFood.get(f.id) ?? 0;
      if (weekly === 0) continue;
      if (classifyFood(f.name) !== "orchard") continue;
      const oz = Number(f.oz_per_serving) || 0;
      const lbs = (weekly * 52 * oz) / 16; // orchard fruits = year-round consumption assumption
      if (lbs <= 0) continue;
      neededByName.set(norm(f.name), { needed_lbs: lbs, display: f.name });
    }

    const keys = new Set<string>([...counts.keys(), ...neededByName.keys()]);
    const items = Array.from(keys).map((k) => {
      const c = counts.get(k);
      const need = neededByName.get(k);
      const ypu = yieldForTree(k);
      const count = c?.count ?? 0;
      const expectedYield = count * ypu;
      const neededLbs = need?.needed_lbs ?? 0;
      const unitsNeeded = neededLbs > 0 ? Math.ceil(neededLbs / ypu) : 0;
      const gapUnits = Math.max(0, unitsNeeded - count);
      const gapLbs = Math.max(0, neededLbs - expectedYield);
      const price = priceByName.get(k) ?? 0;
      return {
        key: k,
        name: c?.display || need?.display || k,
        count,
        yield_per_unit_lbs: ypu,
        expected_yield_lbs: expectedYield,
        needed_lbs: neededLbs,
        units_needed: unitsNeeded,
        gap_units: gapUnits,
        gap_lbs: gapLbs,
        price_per_lb: price,
        expected_yield_value: expectedYield * price,
        gap_value: gapLbs * price,
      };
    });

    const summary = {
      distinct_items: items.filter((i) => i.count > 0).length,
      total_units: items.reduce((s, i) => s + i.count, 0),
      total_expected_yield_lbs: items.reduce((s, i) => s + i.expected_yield_lbs, 0),
      total_needed_lbs: items.reduce((s, i) => s + i.needed_lbs, 0),
      total_expected_yield_value: items.reduce((s, i) => s + i.expected_yield_value, 0),
      total_gap_value: items.reduce((s, i) => s + i.gap_value, 0),
    };

    return {
      summary,
      items: items.sort((a, b) => b.expected_yield_lbs - a.expected_yield_lbs),
      gaps: items.filter((i) => i.gap_units > 0).sort((a, b) => b.gap_lbs - a.gap_lbs),
    };
  });

// ----------------------------------------------------------------------
// Crops dashboard — plantings, actual harvested vs. plan need
// ----------------------------------------------------------------------

export const getCropsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [plantings, harvests, foods, entries] = await Promise.all([
      context.supabase.from("crop_plantings").select("id, crop, status"),
      context.supabase.from("crop_harvests").select("planting_id, quantity, unit"),
      context.supabase.from("food_plan_foods").select("id, name, oz_per_serving, price_per_pound"),
      context.supabase.from("food_plan_entries").select("food_id, quantity"),
    ]);
    if (plantings.error) throw new Error(plantings.error.message);
    if (harvests.error) throw new Error(harvests.error.message);
    if (foods.error) throw new Error(foods.error.message);
    if (entries.error) throw new Error(entries.error.message);

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    const toLbs = (qty: number, unit: string | null | undefined) => {
      const u = (unit ?? "").toLowerCase().trim();
      if (["lb", "lbs", "pound", "pounds", ""].includes(u)) return qty;
      if (["oz", "ounce", "ounces"].includes(u)) return qty / 16;
      if (["kg", "kilogram", "kilograms"].includes(u)) return qty * 2.20462;
      if (["g", "gram", "grams"].includes(u)) return qty * 0.00220462;
      return qty;
    };

    // group plantings by crop
    const byCrop = new Map<string, { display: string; plantings: number; planting_ids: Set<string> }>();
    for (const p of plantings.data ?? []) {
      const k = norm(p.crop);
      if (!k) continue;
      const cur = byCrop.get(k) ?? { display: (p.crop ?? "").trim(), plantings: 0, planting_ids: new Set<string>() };
      cur.plantings += 1;
      cur.planting_ids.add(p.id);
      byCrop.set(k, cur);
    }

    // harvested lbs per crop (via planting_id lookup)
    const plantingToCrop = new Map<string, string>();
    for (const p of plantings.data ?? []) plantingToCrop.set(p.id, norm(p.crop));
    const harvestedByCrop = new Map<string, number>();
    for (const h of harvests.data ?? []) {
      if (!h.planting_id) continue;
      const k = plantingToCrop.get(h.planting_id);
      if (!k) continue;
      harvestedByCrop.set(k, (harvestedByCrop.get(k) ?? 0) + toLbs(Number(h.quantity) || 0, h.unit));
    }

    // plan need per crop name
    const weeklyByFood = new Map<string, number>();
    for (const e of entries.data ?? []) {
      weeklyByFood.set(e.food_id, (weeklyByFood.get(e.food_id) ?? 0) + (Number(e.quantity) || 0));
    }
    const priceByName = new Map<string, number>();
    const neededByName = new Map<string, { needed_lbs: number; display: string }>();
    for (const f of foods.data ?? []) {
      const price = Number(f.price_per_pound) || 0;
      if (price > 0) priceByName.set(norm(f.name), price);
      const weekly = weeklyByFood.get(f.id) ?? 0;
      if (weekly === 0) continue;
      if (classifyFood(f.name) !== "crops") continue;
      const oz = Number(f.oz_per_serving) || 0;
      const lbs = (weekly * 26 * oz) / 16;
      if (lbs <= 0) continue;
      neededByName.set(norm(f.name), { needed_lbs: lbs, display: f.name });
    }

    const keys = new Set<string>([...byCrop.keys(), ...neededByName.keys()]);
    const items = Array.from(keys).map((k) => {
      const c = byCrop.get(k);
      const need = neededByName.get(k);
      const count = c?.plantings ?? 0;
      const harvested = harvestedByCrop.get(k) ?? 0;
      const neededLbs = need?.needed_lbs ?? 0;
      const lbsPerPlanting = count > 0 ? harvested / count : 0;
      const unitsNeeded = neededLbs > 0 && lbsPerPlanting > 0 ? Math.ceil(neededLbs / lbsPerPlanting) : 0;
      const gapUnits = Math.max(0, unitsNeeded - count);
      const gapLbs = Math.max(0, neededLbs - harvested);
      const price = priceByName.get(k) ?? 0;
      return {
        key: k,
        name: c?.display || need?.display || k,
        count,
        yield_per_unit_lbs: lbsPerPlanting,
        expected_yield_lbs: harvested,
        needed_lbs: neededLbs,
        units_needed: unitsNeeded,
        gap_units: gapUnits,
        gap_lbs: gapLbs,
        price_per_lb: price,
        expected_yield_value: harvested * price,
        gap_value: gapLbs * price,
      };
    });

    const summary = {
      distinct_items: items.filter((i) => i.count > 0).length,
      total_units: items.reduce((s, i) => s + i.count, 0),
      total_expected_yield_lbs: items.reduce((s, i) => s + i.expected_yield_lbs, 0),
      total_needed_lbs: items.reduce((s, i) => s + i.needed_lbs, 0),
      total_expected_yield_value: items.reduce((s, i) => s + i.expected_yield_value, 0),
      total_gap_value: items.reduce((s, i) => s + i.gap_value, 0),
    };

    return {
      summary,
      items: items.sort((a, b) => b.expected_yield_lbs - a.expected_yield_lbs),
      gaps: items.filter((i) => i.gap_lbs > 0).sort((a, b) => b.gap_lbs - a.gap_lbs),
    };
  });

// ----------------------------------------------------------------------
// Livestock CRUD
// ----------------------------------------------------------------------

const LIVESTOCK_PURPOSES = ["meat", "dairy", "eggs", "fiber", "breeding", "other"] as const;
const LIVESTOCK_STATUSES = ["active", "sold", "processed", "deceased"] as const;
const LIVESTOCK_YIELD_UNITS = ["lbs", "gal_milk", "dozen_eggs", "eggs", "other"] as const;

const LivestockSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  species: z.string().trim().min(1).max(100),
  breed: z.string().trim().max(100).nullable().optional(),
  tag: z.string().trim().max(100).nullable().optional(),
  sex: z.string().trim().max(20).nullable().optional(),
  birth_date: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(99999).optional(),
  purpose: z.enum(LIVESTOCK_PURPOSES).optional(),
  expected_yield_lbs: z.union([z.number(), z.string(), z.null()]).optional(),
  yield_unit: z.enum(LIVESTOCK_YIELD_UNITS).optional(),
  status: z.enum(LIVESTOCK_STATUSES).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const listLivestock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("livestock_animals")
      .select("*")
      .order("species", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertLivestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LivestockSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      species: data.species.trim(),
      breed: emptyToNull(data.breed ?? null),
      tag: emptyToNull(data.tag ?? null),
      sex: emptyToNull(data.sex ?? null),
      birth_date: emptyToNull(data.birth_date ?? null),
      quantity: data.quantity ?? 1,
      purpose: data.purpose ?? "meat",
      expected_yield_lbs:
        data.expected_yield_lbs === null || data.expected_yield_lbs === undefined || data.expected_yield_lbs === ""
          ? null
          : toNumber(data.expected_yield_lbs),
      yield_unit: data.yield_unit ?? "lbs",
      status: data.status ?? "active",
      location: emptyToNull(data.location ?? null),
      notes: emptyToNull(data.notes ?? null),
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("livestock_animals").update(row).eq("id", data.id).select().single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("livestock_animals").insert(row).select().single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteLivestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("livestock_animals").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const bulkInsertLivestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ animals: z.array(LivestockSchema).min(1).max(1000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = data.animals.map((a) => ({
      user_id: context.userId,
      species: a.species.trim(),
      breed: emptyToNull(a.breed ?? null),
      tag: emptyToNull(a.tag ?? null),
      sex: emptyToNull(a.sex ?? null),
      birth_date: emptyToNull(a.birth_date ?? null),
      quantity: a.quantity ?? 1,
      purpose: a.purpose ?? "meat",
      expected_yield_lbs:
        a.expected_yield_lbs === null || a.expected_yield_lbs === undefined || a.expected_yield_lbs === ""
          ? null
          : toNumber(a.expected_yield_lbs),
      yield_unit: a.yield_unit ?? "lbs",
      status: a.status ?? "active",
      location: emptyToNull(a.location ?? null),
      notes: emptyToNull(a.notes ?? null),
    }));
    const { error } = await context.supabase.from("livestock_animals").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

// ----------------------------------------------------------------------
// Livestock dashboard — uses real livestock_animals + food plan need
// ----------------------------------------------------------------------

const YIELD_PER_ANIMAL_LBS: Record<string, number> = {
  chicken: 4, broiler: 4, poultry: 4,
  turkey: 15, duck: 4, goose: 8, rabbit: 3,
  pork: 150, ham: 150, bacon: 150, sausage: 150, pepperoni: 150, salami: 150,
  pig: 150, hog: 150, swine: 150,
  beef: 500, steak: 500, brisket: 500, veal: 200, "ground beef": 500,
  cow: 500, cattle: 500, steer: 500, bull: 500, heifer: 500,
  lamb: 50, mutton: 50, sheep: 50,
  goat: 40, venison: 80, deer: 80,
  fish: 1, salmon: 5, tuna: 30, tilapia: 1, cod: 5, trout: 1,
  shrimp: 0.1, crab: 1, lobster: 1,
  egg: 0.5, eggs: 0.5,
  milk: 1500, cream: 1500, butter: 100, cheese: 300, yogurt: 500, whey: 100, ghee: 100,
  jerky: 50, meat: 100,
};
function yieldForAnimal(name: string): number {
  const k = name.trim().toLowerCase();
  if (YIELD_PER_ANIMAL_LBS[k] !== undefined) return YIELD_PER_ANIMAL_LBS[k];
  for (const [key, val] of Object.entries(YIELD_PER_ANIMAL_LBS)) {
    if (k.includes(key)) return val;
  }
  return 50;
}

export const getLivestockDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [foods, entries, animals] = await Promise.all([
      context.supabase.from("food_plan_foods").select("id, name, oz_per_serving, price_per_pound"),
      context.supabase.from("food_plan_entries").select("food_id, quantity"),
      context.supabase
        .from("livestock_animals")
        .select("species, breed, quantity, expected_yield_lbs, status")
        .neq("status", "deceased")
        .neq("status", "sold"),
    ]);
    if (foods.error) throw new Error(foods.error.message);
    if (entries.error) throw new Error(entries.error.message);
    if (animals.error) throw new Error(animals.error.message);

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

    // Aggregate livestock by species
    const livestockAgg = new Map<string, { display: string; count: number; explicit_lbs: number }>();
    for (const a of animals.data ?? []) {
      const key = norm(a.species);
      if (!key) continue;
      const cur = livestockAgg.get(key) ?? { display: (a.species ?? "").trim(), count: 0, explicit_lbs: 0 };
      const qty = Number(a.quantity) || 1;
      cur.count += qty;
      if (a.expected_yield_lbs != null) cur.explicit_lbs += Number(a.expected_yield_lbs) * qty;
      livestockAgg.set(key, cur);
    }

    const weeklyByFood = new Map<string, number>();
    for (const e of entries.data ?? []) {
      weeklyByFood.set(e.food_id, (weeklyByFood.get(e.food_id) ?? 0) + (Number(e.quantity) || 0));
    }

    // Build need map from livestock-classified plan foods
    const priceByName = new Map<string, number>();
    const neededByName = new Map<string, { needed_lbs: number; display: string }>();
    for (const f of foods.data ?? []) {
      const price = Number(f.price_per_pound) || 0;
      if (price > 0) priceByName.set(norm(f.name), price);
      const weekly = weeklyByFood.get(f.id) ?? 0;
      if (weekly === 0) continue;
      if (classifyFood(f.name) !== "livestock") continue;
      const oz = Number(f.oz_per_serving) || 0;
      const lbs = (weekly * 52 * oz) / 16;
      if (lbs <= 0) continue;
      neededByName.set(norm(f.name), { needed_lbs: lbs, display: f.name });
    }

    // Merge keys: union of livestock species (matched to plan food name) and plan need names
    const matchAnimal = (foodKey: string) => {
      // exact match first
      if (livestockAgg.has(foodKey)) return foodKey;
      for (const k of livestockAgg.keys()) {
        if (foodKey.includes(k) || k.includes(foodKey)) return k;
      }
      return null;
    };

    const items: Array<{
      key: string; name: string; count: number; yield_per_unit_lbs: number;
      expected_yield_lbs: number; needed_lbs: number; units_needed: number;
      gap_units: number; gap_lbs: number; price_per_lb: number;
      expected_yield_value: number; gap_value: number;
    }> = [];
    const seenAnimalKeys = new Set<string>();

    for (const [foodKey, need] of neededByName) {
      const animalKey = matchAnimal(foodKey);
      const agg = animalKey ? livestockAgg.get(animalKey) : null;
      if (animalKey) seenAnimalKeys.add(animalKey);
      const count = agg?.count ?? 0;
      const ypu = yieldForAnimal(need.display);
      const expectedYield = agg && agg.explicit_lbs > 0 ? agg.explicit_lbs : count * ypu;
      const neededLbs = need.needed_lbs;
      const unitsNeeded = ypu > 0 ? Math.ceil(neededLbs / ypu) : 0;
      const gapUnits = Math.max(0, unitsNeeded - count);
      const gapLbs = Math.max(0, neededLbs - expectedYield);
      const price = priceByName.get(foodKey) ?? 0;
      items.push({
        key: foodKey,
        name: need.display,
        count,
        yield_per_unit_lbs: ypu,
        expected_yield_lbs: expectedYield,
        needed_lbs: neededLbs,
        units_needed: unitsNeeded,
        gap_units: gapUnits,
        gap_lbs: gapLbs,
        price_per_lb: price,
        expected_yield_value: expectedYield * price,
        gap_value: gapLbs * price,
      });
    }

    // Animals with no matching plan food — still show in items so user sees what's on the farm
    for (const [key, agg] of livestockAgg) {
      if (seenAnimalKeys.has(key)) continue;
      const ypu = yieldForAnimal(agg.display);
      const expectedYield = agg.explicit_lbs > 0 ? agg.explicit_lbs : agg.count * ypu;
      const price = priceByName.get(key) ?? 0;
      items.push({
        key,
        name: agg.display,
        count: agg.count,
        yield_per_unit_lbs: ypu,
        expected_yield_lbs: expectedYield,
        needed_lbs: 0,
        units_needed: 0,
        gap_units: 0,
        gap_lbs: 0,
        price_per_lb: price,
        expected_yield_value: expectedYield * price,
        gap_value: 0,
      });
    }

    const summary = {
      distinct_items: items.filter((i) => i.count > 0).length,
      total_units: items.reduce((s, i) => s + i.count, 0),
      total_expected_yield_lbs: items.reduce((s, i) => s + i.expected_yield_lbs, 0),
      total_needed_lbs: items.reduce((s, i) => s + i.needed_lbs, 0),
      total_expected_yield_value: items.reduce((s, i) => s + i.expected_yield_value, 0),
      total_gap_value: items.reduce((s, i) => s + i.gap_value, 0),
    };

    return {
      summary,
      items: items.sort((a, b) => b.needed_lbs - a.needed_lbs || b.expected_yield_lbs - a.expected_yield_lbs),
      gaps: items.filter((i) => i.gap_lbs > 0).sort((a, b) => b.gap_lbs - a.gap_lbs),
    };
  });



// ----------------------------------------------------------------------
// Food storage items
// ----------------------------------------------------------------------

const StorageItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  food_type: z.string().max(100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  unit: z.string().trim().max(50).optional(),
  acquired_on: z.string().nullable().optional(),
  best_by: z.string().nullable().optional(),
  status: z.string().max(50).optional(),
  source_url: z.string().max(500).nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const listFoodStorage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("food_storage_items")
      .select("*")
      .order("category", { ascending: true, nullsFirst: false })
      .order("food_type", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertFoodStorageItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StorageItemSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name.trim(),
      description: emptyToNull(data.description ?? null),
      category: emptyToNull(data.category ?? null),
      food_type: emptyToNull(data.food_type ?? null),
      location: emptyToNull(data.location ?? null),
      quantity: toNumber(data.quantity ?? 0),
      unit: (data.unit || "lb").trim(),
      acquired_on: emptyToNull(data.acquired_on ?? null),
      best_by: emptyToNull(data.best_by ?? null),
      status: data.status || "available",
      source_url: emptyToNull(data.source_url ?? null),
      price: data.price == null || data.price === "" ? null : toNumber(data.price),
      notes: emptyToNull(data.notes ?? null),
    };
    if (data.id) {
      const { data: out, error } = await context.supabase
        .from("food_storage_items").update(row).eq("id", data.id).select().single();
      if (error) throw new Error(error.message);
      return out;
    }
    const { data: out, error } = await context.supabase
      .from("food_storage_items").insert(row).select().single();
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteFoodStorageItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("food_storage_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const bulkInsertFoodStorage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ items: z.array(StorageItemSchema).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.items.map((i) => ({
      user_id: context.userId,
      name: i.name.trim(),
      description: emptyToNull(i.description ?? null),
      category: emptyToNull(i.category ?? null),
      food_type: emptyToNull(i.food_type ?? null),
      location: emptyToNull(i.location ?? null),
      quantity: toNumber(i.quantity ?? 0),
      unit: (i.unit || "lb").trim(),
      acquired_on: emptyToNull(i.acquired_on ?? null),
      best_by: emptyToNull(i.best_by ?? null),
      status: i.status || "available",
      source_url: emptyToNull(i.source_url ?? null),
      price: i.price == null || i.price === "" ? null : toNumber(i.price),
      notes: emptyToNull(i.notes ?? null),
    }));
    const { error } = await context.supabase.from("food_storage_items").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

// ----------------------------------------------------------------------
// Long term storage plan
// ----------------------------------------------------------------------

const StoragePlanRowSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).nullable().optional(),
  food_type: z.string().trim().max(100).nullable().optional(),
  pounds_per_year: z.union([z.number(), z.string()]).optional(),
  target_months: z.union([z.number(), z.string()]).optional(),
  price_per_pound: z.union([z.number(), z.string()]).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  sort_order: z.number().int().optional(),
  // Optimistic-concurrency token: the updated_at value the client last saw.
  // When present on update, the row only writes if updated_at still matches.
  expected_updated_at: z.string().nullable().optional(),
  // Which fields the user actually changed in this edit. Used for server-side
  // field-level merge when a conflict is detected.
  changed_fields: z.array(z.string()).optional(),
});

const PLAN_MERGEABLE_FIELDS = [
  "name",
  "category",
  "food_type",
  "pounds_per_year",
  "target_months",
  "price_per_pound",
  "notes",
  "sort_order",
] as const;

export const listFoodStoragePlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("food_storage_plan")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertFoodStoragePlanRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StoragePlanRowSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const fullRow = {
      user_id: context.userId,
      name: data.name.trim(),
      category: emptyToNull(data.category ?? null),
      food_type: emptyToNull(data.food_type ?? null),
      pounds_per_year: toNumber(data.pounds_per_year ?? 0),
      target_months: toNumber(data.target_months ?? 12),
      price_per_pound:
        data.price_per_pound == null || data.price_per_pound === ""
          ? null
          : toNumber(data.price_per_pound),
      notes: emptyToNull(data.notes ?? null),
      sort_order: data.sort_order ?? 0,
    };

    if (!data.id) {
      const { data: out, error } = await sb
        .from("food_storage_plan").insert(fullRow).select().single();
      if (error) throw new Error(error.message);
      return { row: out, conflict: false as const };
    }

    // Fetch current server row for conflict check + field merge
    const { data: current, error: curErr } = await sb
      .from("food_storage_plan").select("*").eq("id", data.id).maybeSingle();
    if (curErr) throw new Error(curErr.message);
    if (!current) throw new Error("Plan row not found");

    const expected = data.expected_updated_at ?? null;
    const isConflict = expected != null && current.updated_at !== expected;

    let toWrite: Record<string, unknown> = fullRow;
    if (isConflict) {
      // Field-level merge: keep server values, then re-apply only the fields
      // this client changed. Falls back to writing all fields if changed_fields
      // wasn't sent (old client).
      const changed = new Set(data.changed_fields ?? PLAN_MERGEABLE_FIELDS);
      toWrite = { user_id: context.userId };
      for (const f of PLAN_MERGEABLE_FIELDS) {
        toWrite[f] = changed.has(f)
          ? (fullRow as Record<string, unknown>)[f]
          : (current as Record<string, unknown>)[f];
      }
    }

    const { data: out, error } = await sb
      .from("food_storage_plan").update(toWrite as never).eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    return {
      row: out,
      conflict: isConflict,
      server: isConflict ? current : null,
      merged_fields: isConflict ? Array.from(data.changed_fields ?? []) : [],
    };
  });


export const deleteFoodStoragePlanRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("food_storage_plan").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const seedFoodStoragePlanFromPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [foodsR, peopleR, entriesR] = await Promise.all([
      sb.from("food_plan_foods").select("id,name,category,price_per_pound,sort_order"),
      sb.from("food_plan_people").select("id"),
      sb.from("food_plan_entries").select("food_id,quantity"),
    ]);
    if (foodsR.error) throw new Error(foodsR.error.message);
    if (peopleR.error) throw new Error(peopleR.error.message);
    if (entriesR.error) throw new Error(entriesR.error.message);
    const foods = foodsR.data ?? [];
    const peopleCount = (peopleR.data ?? []).length || 1;
    const ozPerFood = new Map<string, number>();
    for (const e of entriesR.data ?? []) {
      ozPerFood.set(e.food_id, (ozPerFood.get(e.food_id) ?? 0) + Number(e.quantity ?? 0));
    }
    // weekly oz (sum of per-day quantities across all 7 days for ONE person)
    // pounds per year = weekly_oz * peopleCount * 52 / 16
    const rows = foods
      .map((f, idx) => {
        const weeklyOz = ozPerFood.get(f.id) ?? 0;
        const lbsYear = (weeklyOz * peopleCount * 52) / 16;
        return {
          user_id: context.userId,
          name: f.name,
          category: f.category ?? null,
          food_type: null as string | null,
          pounds_per_year: Number(lbsYear.toFixed(2)),
          target_months: 12,
          price_per_pound: f.price_per_pound ?? null,
          notes: null,
          sort_order: f.sort_order ?? idx,
        };
      })
      .filter((r) => r.pounds_per_year > 0 || r.price_per_pound != null);
    if (!rows.length) return { inserted: 0 };
    // clear existing
    await sb.from("food_storage_plan").delete().eq("user_id", context.userId);
    const { error } = await sb.from("food_storage_plan").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });
