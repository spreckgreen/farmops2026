import { describe, expect, it } from "vitest";
import {
  extractFoodsFromDownload,
  extractMacros,
  normalizeUsdaFood,
} from "../src/lib/usda-fooddata";

describe("USDA FoodData Central normalization", () => {
  it("normalizes Food Details nutrient objects", () => {
    const food = normalizeUsdaFood({
      fdcId: 123,
      description: "Tomatoes, red, ripe, raw",
      dataType: "Foundation",
      foodCategory: { description: "Vegetables and Vegetable Products" },
      foodNutrients: [
        { nutrient: { id: 1008, name: "Energy", unitName: "kcal" }, amount: 18 },
        { nutrient: { id: 1003, name: "Protein", unitName: "g" }, amount: 0.88 },
        { nutrient: { id: 1093, name: "Sodium, Na", unitName: "mg" }, amount: 5 },
      ],
    });

    expect(food.fdcId).toBe(123);
    expect(food.foodCategory).toBe("Vegetables and Vegetable Products");
    expect(extractMacros(food.nutrients)).toEqual({
      energyKcal: 18,
      proteinG: 0.88,
      fatG: null,
      carbohydrateG: null,
      fiberG: null,
      sugarG: null,
      sodiumMg: 5,
    });
  });

  it("normalizes abridged search nutrients", () => {
    const food = normalizeUsdaFood({
      fdcId: 456,
      description: "Beans",
      dataType: "Survey (FNDDS)",
      foodNutrients: [{ nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 8.7 }],
    });
    expect(food.nutrients[0]).toMatchObject({ id: 1003, amount: 8.7 });
  });

  it("accepts the named arrays in USDA JSON downloads", () => {
    expect(extractFoodsFromDownload({ FoundationFoods: [{ fdcId: 1 }] })).toHaveLength(1);
    expect(() => extractFoodsFromDownload({ nope: [] })).toThrow(/Unsupported/);
  });
});
