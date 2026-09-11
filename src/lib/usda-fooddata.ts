export type UsdaNutrient = {
  id: number | null;
  name: string;
  unit: string;
  amount: number;
};

export type UsdaFoodSummary = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory: string | null;
  publicationDate: string | null;
  brandOwner: string | null;
  ingredients: string | null;
  nutrients: UsdaNutrient[];
  portions: unknown[];
  raw: Record<string, unknown>;
};

export type MacroNutrients = {
  energyKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbohydrateG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Handles both Food Details and abridged Food Search nutrient shapes. */
export function normalizeNutrients(value: unknown): UsdaNutrient[] {
  if (!Array.isArray(value)) return [];
  const nutrients = value.flatMap((entry): UsdaNutrient[] => {
    const row = record(entry);
    const definition = record(row.nutrient);
    const name = text(definition.name) ?? text(row.nutrientName) ?? text(row.name);
    const amount = number(row.amount ?? row.value);
    if (!name || amount == null) return [];
    return [
      {
        id: number(definition.id ?? row.nutrientId),
        name,
        unit: text(definition.unitName) ?? text(row.unitName) ?? text(row.unit) ?? "",
        amount,
      },
    ];
  });

  // USDA occasionally supplies duplicate analytical rows. Keep the first
  // identified nutrient so display and calculations stay deterministic.
  const seen = new Set<string>();
  return nutrients.filter((nutrient) => {
    const key = nutrient.id != null ? `id:${nutrient.id}` : `${nutrient.name}:${nutrient.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeUsdaFood(value: unknown): UsdaFoodSummary {
  const raw = record(value);
  const fdcId = number(raw.fdcId);
  const description = text(raw.description);
  if (fdcId == null || !description)
    throw new Error("USDA food record is missing fdcId or description");

  const category = record(raw.foodCategory);
  return {
    fdcId,
    description,
    dataType: text(raw.dataType) ?? "Unknown",
    foodCategory: text(category.description) ?? text(raw.foodCategory),
    publicationDate: text(raw.publicationDate),
    brandOwner: text(raw.brandOwner),
    ingredients: text(raw.ingredients),
    nutrients: normalizeNutrients(raw.foodNutrients),
    portions: Array.isArray(raw.foodPortions) ? raw.foodPortions : [],
    raw,
  };
}

function findNutrient(nutrients: UsdaNutrient[], ids: number[], names: RegExp): number | null {
  // The order of ids is a preference order. This matters for Foundation Foods,
  // which can include both Atwater specific and general energy calculations.
  for (const id of ids) {
    const match = nutrients.find((item) => item.id === id);
    if (match) return match.amount;
  }
  return nutrients.find((item) => names.test(item.name))?.amount ?? null;
}

/** USDA values are normally expressed per 100 g for Foundation/FNDDS foods. */
export function extractMacros(nutrients: UsdaNutrient[]): MacroNutrients {
  return {
    // 1008 is the conventional kcal value. Newer Foundation records may
    // instead provide Atwater-specific (2048) and general (2047) values;
    // prefer the more food-specific calculation when both are available.
    energyKcal: findNutrient(
      nutrients,
      [1008, 2048, 2047],
      /^energy(?: \(atwater (?:specific|general) factors\))?$/i,
    ),
    proteinG: findNutrient(nutrients, [1003], /^protein$/i),
    fatG: findNutrient(nutrients, [1004], /total lipid|total fat/i),
    carbohydrateG: findNutrient(
      nutrients,
      [1005],
      /carbohydrate, by difference|total carbohydrate/i,
    ),
    fiberG: findNutrient(nutrients, [1079], /fiber, total dietary/i),
    sugarG: findNutrient(nutrients, [2000], /sugars, total including nlea|total sugars/i),
    sodiumMg: findNutrient(nutrients, [1093], /^sodium/i),
  };
}

export function extractFoodsFromDownload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = record(value);
  for (const key of ["FoundationFoods", "SurveyFoods", "SRLegacyFoods", "BrandedFoods", "foods"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  throw new Error("Unsupported FoodData Central JSON download shape");
}
