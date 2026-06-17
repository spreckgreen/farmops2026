import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

export const getFoodYieldProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [foods, people, entries, plantings, harvests] = await Promise.all([
      context.supabase.from("food_plan_foods").select("id, name, category, oz_per_serving, unit, price_per_pound"),
      context.supabase.from("food_plan_people").select("id, name"),
      context.supabase.from("food_plan_entries").select("food_id, person_id, day_of_week, quantity"),
      context.supabase.from("crop_plantings").select("id, crop, variety, status, planted_on, expected_harvest"),
      context.supabase.from("crop_harvests").select("id, planting_id, harvested_on, quantity, unit, quality, notes"),
    ]);
    if (foods.error) throw new Error(foods.error.message);
    if (people.error) throw new Error(people.error.message);
    if (entries.error) throw new Error(entries.error.message);
    if (plantings.error) throw new Error(plantings.error.message);
    if (harvests.error) throw new Error(harvests.error.message);

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

    type FoodRow = {
      food_id: string;
      name: string;
      category: string;
      expected_pounds: number;
      actual_pounds: number;
      progress: number;
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
      const weeklyServings = planEntries.reduce((s, e) => s + e.quantity, 0);
      const ozPerServing = Number(f.oz_per_serving) || 0;
      const expectedPounds = (weeklyServings * 52 * ozPerServing) / 16;
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
      if (expectedPounds === 0 && actualPounds === 0 && planEntries.length === 0) continue;
      rows.push({
        food_id: f.id,
        name: f.name,
        category: f.category ?? "Uncategorized",
        expected_pounds: expectedPounds,
        actual_pounds: actualPounds,
        progress: expectedPounds > 0 ? actualPounds / expectedPounds : 0,
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
        const actual = items.reduce((s, r) => s + r.actual_pounds, 0);
        return {
          category,
          expected_pounds: expected,
          actual_pounds: actual,
          progress: expected > 0 ? actual / expected : 0,
          items: items.sort((a, b) => b.expected_pounds - a.expected_pounds),
        };
      })
      .sort((a, b) => b.expected_pounds - a.expected_pounds);

    return { categories };
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
      category: emptyToNull(data.category ?? null),
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

const OrchardTreeSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  species: z.string().trim().min(1).max(200),
  variety: z.string().trim().max(200).nullable().optional(),
  quantity: z.number().int().min(1).max(99999).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  planted_on: z.string().nullable().optional(),
  status: z.enum(ORCHARD_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const listOrchardTrees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orchard_trees")
      .select("id, species, variety, quantity, location, planted_on, status, notes, created_at")
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
    const { data, error } = await context.supabase
      .from("food_price_history")
      .select("id, food_id, food_name, old_price, new_price, changed_at")
      .order("changed_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return data ?? [];
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
