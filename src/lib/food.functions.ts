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
    const [plantings, harvests] = await Promise.all([
      context.supabase
        .from("crop_plantings")
        .select("id, status", { count: "exact", head: false }),
      context.supabase
        .from("crop_harvests")
        .select("id, harvested_on, quantity, unit, planting_id")
        .order("harvested_on", { ascending: false })
        .limit(5),
    ]);
    if (plantings.error) throw new Error(plantings.error.message);
    if (harvests.error) throw new Error(harvests.error.message);
    const counts = (plantings.data ?? []).reduce<Record<string, number>>(
      (acc, r) => ((acc[r.status ?? "planned"] = (acc[r.status ?? "planned"] ?? 0) + 1), acc),
      {},
    );
    return {
      planting_counts: counts,
      total_plantings: plantings.data?.length ?? 0,
      recent_harvests: harvests.data ?? [],
    };
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
