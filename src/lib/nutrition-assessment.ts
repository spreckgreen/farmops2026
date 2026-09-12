import type { MacroNutrients } from "./usda-fooddata";

export type NutritionTargets = MacroNutrients;

export const FDA_ADULT_DAILY_VALUES: NutritionTargets = {
  energyKcal: 2000,
  proteinG: 50,
  fatG: 78,
  carbohydrateG: 275,
  fiberG: 28,
  sugarG: null,
  sodiumMg: 2300,
};

export const NUTRITION_METRICS = [
  { key: "energyKcal", label: "Energy", unit: "kcal" },
  { key: "proteinG", label: "Protein", unit: "g" },
  { key: "fatG", label: "Fat", unit: "g" },
  { key: "carbohydrateG", label: "Carbohydrate", unit: "g" },
  { key: "fiberG", label: "Fiber", unit: "g" },
  { key: "sodiumMg", label: "Sodium", unit: "mg" },
] as const;

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

type Profile = {
  foodId: string;
  foodForm: string;
  macros: MacroNutrients;
};

export type DailyNutritionRow = {
  day: number;
  dayLabel: string;
  actual: MacroNutrients;
  percent: Record<(typeof NUTRITION_METRICS)[number]["key"], number | null>;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function emptyMacros(): MacroNutrients {
  return {
    energyKcal: 0,
    proteinG: 0,
    fatG: 0,
    carbohydrateG: 0,
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
  };
}

function preferredProfile(profiles: Profile[], preferredForm?: string | null): Profile | undefined {
  const explicit = preferredForm
    ? profiles.find((profile) => profile.foodForm.toLowerCase() === preferredForm.toLowerCase())
    : undefined;
  if (explicit) return explicit;
  return [...profiles].sort((a, b) => {
    const rank = (form: string) =>
      /^(as listed|raw|fresh)$/i.test(form.trim()) ? 0 : /cooked/i.test(form) ? 1 : 2;
    return rank(a.foodForm) - rank(b.foodForm);
  })[0];
}

/**
 * Planner quantities are servings. oz_per_serving supplies their weight; older
 * rows without a serving size retain the historical one-ounce-per-unit fallback.
 * USDA macro values are expressed per 100 g.
 */
export function buildDailyNutritionAssessment(input: {
  personId: string;
  foods: Food[];
  entries: Entry[];
  profiles: Profile[];
  targets?: NutritionTargets;
}): { rows: DailyNutritionRow[]; linkedFoodIds: Set<string>; unlinkedFoodIds: Set<string> } {
  const targets = input.targets ?? FDA_ADULT_DAILY_VALUES;
  const foods = new Map(input.foods.map((food) => [food.id, food]));
  const profilesByFood = new Map<string, Profile[]>();
  for (const profile of input.profiles) {
    profilesByFood.set(profile.foodId, [...(profilesByFood.get(profile.foodId) ?? []), profile]);
  }

  const selectedProfiles = new Map<string, Profile>();
  for (const [foodId, profiles] of profilesByFood) {
    const profile = preferredProfile(profiles, foods.get(foodId)?.nutrition_form);
    if (profile) selectedProfiles.set(foodId, profile);
  }

  const actuals = new Map<number, MacroNutrients>(
    DAY_LABELS.map((_, index) => [index + 1, emptyMacros()]),
  );
  const unlinkedFoodIds = new Set<string>();

  for (const entry of input.entries) {
    if (entry.person_id !== input.personId || entry.quantity <= 0) continue;
    const food = foods.get(entry.food_id);
    const profile = selectedProfiles.get(entry.food_id);
    if (!food || !profile) {
      unlinkedFoodIds.add(entry.food_id);
      continue;
    }
    const grams = entry.quantity * (food.oz_per_serving ?? 1) * 28.349523125;
    const actual = actuals.get(entry.day_of_week);
    if (!actual) continue;
    for (const metric of NUTRITION_METRICS) {
      const per100g = profile.macros[metric.key];
      if (per100g != null) actual[metric.key] = (actual[metric.key] ?? 0) + per100g * grams / 100;
    }
  }

  const rows = DAY_LABELS.map((dayLabel, index): DailyNutritionRow => {
    const day = index + 1;
    const actual = actuals.get(day) ?? emptyMacros();
    const percent = {} as DailyNutritionRow["percent"];
    for (const metric of NUTRITION_METRICS) {
      const target = targets[metric.key];
      percent[metric.key] =
        target == null || target <= 0 ? null : ((actual[metric.key] ?? 0) / target) * 100;
    }
    return { day, dayLabel, actual, percent };
  });

  return { rows, linkedFoodIds: new Set(selectedProfiles.keys()), unlinkedFoodIds };
}

type YieldProfile = {
  terms: string[];
  poundsPerSevenQuarts: number;
  dehydrateRatio: number;
};

const YIELD_PROFILES: YieldProfile[] = [
  { terms: ["tomato"], poundsPerSevenQuarts: 21, dehydrateRatio: 12 },
  { terms: ["green bean", "bean"], poundsPerSevenQuarts: 14, dehydrateRatio: 10 },
  { terms: ["corn"], poundsPerSevenQuarts: 20, dehydrateRatio: 6 },
  { terms: ["apple"], poundsPerSevenQuarts: 19, dehydrateRatio: 8 },
  { terms: ["pear", "peach"], poundsPerSevenQuarts: 17, dehydrateRatio: 8 },
  { terms: ["strawberry"], poundsPerSevenQuarts: 12, dehydrateRatio: 8 },
  { terms: ["berry", "blueberry"], poundsPerSevenQuarts: 12, dehydrateRatio: 6 },
  { terms: ["squash"], poundsPerSevenQuarts: 16, dehydrateRatio: 10 },
  { terms: ["zucchini"], poundsPerSevenQuarts: 16, dehydrateRatio: 12 },
  { terms: ["cucumber"], poundsPerSevenQuarts: 14, dehydrateRatio: 15 },
  { terms: ["pepper", "onion"], poundsPerSevenQuarts: 14, dehydrateRatio: 10 },
  { terms: ["carrot"], poundsPerSevenQuarts: 17, dehydrateRatio: 10 },
  { terms: ["potato"], poundsPerSevenQuarts: 20, dehydrateRatio: 6 },
  { terms: ["cabbage"], poundsPerSevenQuarts: 25, dehydrateRatio: 12 },
  { terms: ["herb"], poundsPerSevenQuarts: 8, dehydrateRatio: 8 },
];

export type PreservationConversions = {
  freshOunces: number;
  cannedQuarts: number;
  dehydratedOunces: number;
  freezeDriedOunces: number;
  isFoodSpecific: boolean;
};

/**
 * Planning estimates aligned with the Preservation Coach yield assumptions.
 * Freeze-dried weight uses FarmOps' existing 3:1 fresh/reconstituted factor.
 * Actual batch yield should replace these estimates when recorded.
 */
export function estimatePreservationConversions(
  foodName: string,
  freshOunces: number,
): PreservationConversions {
  const normalized = foodName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const profile = YIELD_PROFILES.find((candidate) =>
    candidate.terms.some((term) => normalized.includes(term)),
  );
  const selected = profile ?? { terms: [], poundsPerSevenQuarts: 18, dehydrateRatio: 10 };
  const pounds = freshOunces / 16;
  return {
    freshOunces,
    cannedQuarts: pounds / selected.poundsPerSevenQuarts * 7,
    dehydratedOunces: freshOunces / selected.dehydrateRatio,
    freezeDriedOunces: freshOunces / 3,
    isFoodSpecific: !!profile,
  };
}
