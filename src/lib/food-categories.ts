// Canonical food categories used by the Price History bulk editor.
// All other food views (Overview, Yield, Plan) should bucket by these same
// labels so categorization stays consistent across the app.
export const FOOD_CATEGORIES = [
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
] as const;

export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

// Map legacy/slug values and class fallbacks onto canonical buckets.
const ALIASES: Record<string, FoodCategory> = {
  "livestock-meat": "Animal protein",
  "livestock-eggs": "Eggs",
  "livestock-dairy": "Dairy",
  "livestock-fiber": "Fiber",
  "vegetables": "Vegetables",
  "veg": "Vegetables",
  "garden": "Vegetables",
  "orchard": "Orchard (fruit/nut)",
  "fruit": "Orchard (fruit/nut)",
  "nut": "Orchard (fruit/nut)",
  "crops": "Field crops",
  "field-crops": "Field crops",
  "grain": "Field crops",
  "grains": "Field crops",
  "meat": "Animal protein",
  "protein": "Animal protein",
  "animal": "Animal protein",
  "livestock": "Animal protein",
  "dairy": "Dairy",
  "eggs": "Eggs",
  "fiber": "Fiber",
  "beverage": "Beverages",
  "beverages": "Beverages",
  "pantry": "Pantry / staples",
  "staples": "Pantry / staples",
  "uncategorized": "Other",
  "other": "Other",
};

export function normalizeFoodCategory(
  raw: string | null | undefined,
  fallback: FoodCategory = "Other",
): FoodCategory {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if ((FOOD_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as FoodCategory;
  }
  const key = trimmed.toLowerCase().replace(/\s+/g, "-");
  return ALIASES[key] ?? fallback;
}

// Map an internal "class" (livestock/orchard/garden/crops) to a canonical
// category, used when a food has no explicit category set.
export function classFallbackCategory(cls: string | null | undefined): FoodCategory {
  switch (cls) {
    case "livestock":
      return "Animal protein";
    case "orchard":
      return "Orchard (fruit/nut)";
    case "garden":
      return "Vegetables";
    case "crops":
      return "Field crops";
    default:
      return "Other";
  }
}
