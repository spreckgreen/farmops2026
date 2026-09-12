import { describe, expect, it } from "vitest";
import {
  buildDailyNutritionAssessment,
  estimatePreservationConversions,
  FDA_ADULT_DAILY_VALUES,
} from "../src/lib/nutrition-assessment";

describe("planner nutrition assessment", () => {
  it("converts servings through ounces per serving and USDA per-100-g values", () => {
    const result = buildDailyNutritionAssessment({
      personId: "person-1",
      foods: [{ id: "food-1", name: "Test food", oz_per_serving: 4 }],
      entries: [{ person_id: "person-1", food_id: "food-1", day_of_week: 1, quantity: 2 }],
      profiles: [{
        foodId: "food-1",
        foodForm: "Raw",
        macros: {
          energyKcal: 100,
          proteinG: 10,
          fatG: 5,
          carbohydrateG: 20,
          fiberG: 4,
          sugarG: 3,
          sodiumMg: 50,
        },
      }],
      targets: FDA_ADULT_DAILY_VALUES,
    });

    expect(result.rows[0].actual.energyKcal).toBeCloseTo(226.796, 2);
    expect(result.rows[0].percent.proteinG).toBeCloseTo(45.359, 2);
    expect(result.linkedFoodIds.has("food-1")).toBe(true);
  });

  it("reports foods used by the person that do not have an approved USDA profile", () => {
    const result = buildDailyNutritionAssessment({
      personId: "person-1",
      foods: [{ id: "food-1", name: "Unknown", oz_per_serving: null }],
      entries: [{ person_id: "person-1", food_id: "food-1", day_of_week: 2, quantity: 1 }],
      profiles: [],
    });
    expect([...result.unlinkedFoodIds]).toEqual(["food-1"]);
  });
});

describe("preservation conversions", () => {
  it("uses food-specific canning and dehydration estimates", () => {
    const result = estimatePreservationConversions("Tomatoes", 21 * 16);
    expect(result.cannedQuarts).toBeCloseTo(7, 5);
    expect(result.dehydratedOunces).toBeCloseTo(28, 5);
    expect(result.freezeDriedOunces).toBeCloseTo(112, 5);
    expect(result.isFoodSpecific).toBe(true);
  });
});
