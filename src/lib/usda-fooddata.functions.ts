/* eslint-disable @typescript-eslint/no-explicit-any -- migration tables are not present in generated Database types until deployed */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  extractMacros,
  normalizeNutrients,
  normalizeUsdaFood,
  type MacroNutrients,
  type UsdaFoodSummary,
} from "./usda-fooddata";

const DATA_TYPES = ["Foundation", "Survey (FNDDS)", "SR Legacy", "Branded"] as const;

const SearchInput = z.object({
  query: z.string().trim().min(2).max(120),
  dataTypes: z
    .array(z.enum(DATA_TYPES))
    .min(1)
    .default(["Foundation", "Survey (FNDDS)", "SR Legacy"]),
  pageSize: z.number().int().min(1).max(50).default(25),
});

const ApproveInput = z.object({
  foodId: z.string().uuid(),
  fdcId: z.number().int().positive(),
  foodForm: z.string().trim().min(1).max(100).default("As listed"),
  servingAmount: z.number().positive().nullable().optional(),
  servingUnit: z.string().trim().max(40).nullable().optional(),
  servingGrams: z.number().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export type UsdaSearchResult = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory: string | null;
  brandOwner: string | null;
  publicationDate: string | null;
  macros: MacroNutrients;
  source: "local" | "api";
};

export type NutritionFood = {
  id: string;
  name: string;
  category: string | null;
};

export type NutritionProfile = {
  id: string;
  foodId: string;
  foodName: string;
  category: string | null;
  foodForm: string;
  fdcId: number;
  description: string;
  dataType: string;
  approvedAt: string;
  servingAmount: number | null;
  servingUnit: string | null;
  servingGrams: number | null;
  macros: MacroNutrients;
};

type LooseDb = {
  from: (table: string) => any;
};

function toSearchResult(food: UsdaFoodSummary, source: "local" | "api"): UsdaSearchResult {
  return {
    fdcId: food.fdcId,
    description: food.description,
    dataType: food.dataType,
    foodCategory: food.foodCategory,
    brandOwner: food.brandOwner,
    publicationDate: food.publicationDate,
    macros: extractMacros(food.nutrients),
    source,
  };
}

function fromCacheRow(row: Record<string, any>): UsdaFoodSummary {
  return normalizeUsdaFood({
    ...(row.raw_payload ?? {}),
    fdcId: Number(row.fdc_id),
    description: row.description,
    dataType: row.data_type,
    foodCategory: row.food_category,
    publicationDate: row.publication_date,
    brandOwner: row.brand_owner,
    ingredients: row.ingredients,
    foodNutrients: row.nutrients,
    foodPortions: row.portions,
  });
}

async function fdcApiKey(client: unknown): Promise<string | undefined> {
  const { getServerEnv } = await import("./server-env.server");
  return getServerEnv("USDA_FDC_API_KEY", client as Parameters<typeof getServerEnv>[1]);
}

async function fetchFdcFood(fdcId: number, client: unknown): Promise<UsdaFoodSummary> {
  const key = await fdcApiKey(client);
  if (!key)
    throw new Error(
      "USDA_FDC_API_KEY is not configured. Add it to the Shared vault or server environment.",
    );
  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(key)}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`USDA FoodData Central returned HTTP ${response.status}`);
  return normalizeUsdaFood(await response.json());
}

async function cacheFdcFood(food: UsdaFoodSummary, release?: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as LooseDb;
  const { error } = await admin.from("usda_fdc_foods").upsert(
    {
      fdc_id: food.fdcId,
      description: food.description,
      data_type: food.dataType,
      food_category: food.foodCategory,
      publication_date: food.publicationDate,
      brand_owner: food.brandOwner,
      ingredients: food.ingredients,
      nutrients: food.nutrients,
      portions: food.portions,
      raw_payload: food.raw,
      source_release: release ?? null,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fdc_id" },
  );
  if (error) throw new Error(error.message);
}

export const getNutritionCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ foods: NutritionFood[]; profiles: NutritionProfile[] }> => {
      const db = context.supabase as unknown as LooseDb;
      const [{ data: foods, error: foodsError }, { data: profiles, error: profilesError }] =
        await Promise.all([
          db
            .from("food_plan_foods")
            .select("id,name,category")
            .eq("user_id", context.userId)
            .order("name"),
          db
            .from("food_nutrient_profiles")
            .select(
              "id,food_id,fdc_id,food_form,serving_amount,serving_unit,serving_grams,approved_at",
            )
            .eq("user_id", context.userId)
            .eq("match_status", "approved")
            .order("approved_at", { ascending: false }),
        ]);
      if (foodsError) throw new Error(foodsError.message);
      if (profilesError) throw new Error(profilesError.message);

      const fdcIds = [...new Set((profiles ?? []).map((profile: any) => profile.fdc_id))];
      let refs: any[] = [];
      if (fdcIds.length) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await (supabaseAdmin as unknown as LooseDb)
          .from("usda_fdc_foods")
          .select("fdc_id,description,data_type,nutrients")
          .in("fdc_id", fdcIds);
        if (error) throw new Error(error.message);
        refs = data ?? [];
      }

      const foodsById = new Map<string, { name: string; category: string | null }>(
        (foods ?? []).map((food: any) => [food.id, { name: food.name, category: food.category }]),
      );
      const refsById = new Map<
        number,
        { description: string; data_type: string; nutrients: unknown[] }
      >(refs.map((ref) => [Number(ref.fdc_id), ref]));
      return {
        foods: (foods ?? []) as NutritionFood[],
        profiles: (profiles ?? []).flatMap((profile: any): NutritionProfile[] => {
          const food = foodsById.get(profile.food_id);
          const ref = refsById.get(Number(profile.fdc_id));
          if (!food || !ref) return [];
          return [
            {
              id: profile.id,
              foodId: profile.food_id,
              foodName: food.name,
              category: food.category,
              foodForm: profile.food_form,
              fdcId: Number(profile.fdc_id),
              description: ref.description,
              dataType: ref.data_type,
              approvedAt: profile.approved_at,
              servingAmount: profile.serving_amount == null ? null : Number(profile.serving_amount),
              servingUnit: profile.serving_unit,
              servingGrams: profile.serving_grams == null ? null : Number(profile.serving_grams),
              macros: extractMacros(normalizeNutrients(ref.nutrients)),
            },
          ];
        }),
      };
    },
  );

export const searchUsdaFoods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => SearchInput.parse(value))
  .handler(
    async ({ context, data }): Promise<{ results: UsdaSearchResult[]; apiConfigured: boolean }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as LooseDb;
      const safeQuery = data.query.replace(/[%_]/g, "");
      const { data: cached, error } = await admin
        .from("usda_fdc_foods")
        .select("*")
        .ilike("description", `%${safeQuery}%`)
        .in("data_type", data.dataTypes)
        .limit(data.pageSize);
      if (error) throw new Error(error.message);

      const localResults = (cached ?? []).map((row: any) =>
        toSearchResult(fromCacheRow(row), "local"),
      );
      const key = await fdcApiKey(context.supabase);
      if (!key) return { results: localResults, apiConfigured: false };

      const response = await fetch(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            query: data.query,
            dataType: data.dataTypes,
            pageSize: data.pageSize,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error(`USDA FoodData Central returned HTTP ${response.status}`);
      const payload = (await response.json()) as { foods?: unknown[] };
      const apiResults = (payload.foods ?? []).map((food) =>
        toSearchResult(normalizeUsdaFood(food), "api"),
      );
      const merged = new Map<number, UsdaSearchResult>();
      for (const result of [...localResults, ...apiResults]) merged.set(result.fdcId, result);
      return { results: [...merged.values()].slice(0, data.pageSize), apiConfigured: true };
    },
  );

export const approveUsdaFoodMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => ApproveInput.parse(value))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as LooseDb;
    const { data: ownedFood, error: foodError } = await db
      .from("food_plan_foods")
      .select("id")
      .eq("id", data.foodId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (foodError) throw new Error(foodError.message);
    if (!ownedFood) throw new Error("Food record was not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as LooseDb;
    const { data: cached, error: cacheError } = await admin
      .from("usda_fdc_foods")
      .select("*")
      .eq("fdc_id", data.fdcId)
      .maybeSingle();
    if (cacheError) throw new Error(cacheError.message);
    const food = cached ? fromCacheRow(cached) : await fetchFdcFood(data.fdcId, context.supabase);
    if (!cached) await cacheFdcFood(food);

    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await db
      .from("food_nutrient_profiles")
      .upsert(
        {
          user_id: context.userId,
          food_id: data.foodId,
          fdc_id: data.fdcId,
          food_form: data.foodForm,
          serving_amount: data.servingAmount ?? null,
          serving_unit: data.servingUnit ?? null,
          serving_grams: data.servingGrams ?? null,
          match_status: "approved",
          match_method: cached ? "download_match" : "api_search",
          notes: data.notes ?? null,
          approved_at: now,
          updated_at: now,
        },
        { onConflict: "user_id,food_id,food_form" },
      )
      .select("id")
      .single();
    if (saveError) throw new Error(saveError.message);
    return { id: saved.id, fdcId: data.fdcId, description: food.description };
  });

export const removeNutritionProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ id: z.string().uuid() }).parse(value))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as LooseDb;
    const { error } = await db
      .from("food_nutrient_profiles")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { removed: true };
  });
