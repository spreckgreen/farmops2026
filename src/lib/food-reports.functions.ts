import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAllReports, type ReportInputs } from "./food-reports";

export const getFoodReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [foods, people, entries, storage, plantings, harvests, garden] = await Promise.all([
      sb.from("food_plan_foods").select("id, name, category, oz_per_serving, price_per_pound, season").order("sort_order"),
      sb.from("food_plan_people").select("id, name").order("sort_order"),
      sb.from("food_plan_entries").select("food_id, person_id, day_of_week, quantity"),
      sb.from("food_storage_plan").select("name, category, food_type, pounds_per_year, target_months, price_per_pound, notes").order("sort_order"),
      sb.from("crop_plantings").select("id, crop, variety, status, planted_on, expected_harvest"),
      sb.from("crop_harvests").select("id, planting_id, harvested_on, quantity, unit, quality, notes"),
      sb.from("garden_plots").select("row_label, position, plant_name").order("row_label").order("position"),
    ]);
    for (const r of [foods, people, entries, storage, plantings, harvests, garden]) {
      if (r.error) throw new Error(r.error.message);
    }

    const inputs: ReportInputs = {
      foods: (foods.data ?? []) as ReportInputs["foods"],
      people: (people.data ?? []) as ReportInputs["people"],
      entries: (entries.data ?? []) as ReportInputs["entries"],
      storagePlan: (storage.data ?? []) as ReportInputs["storagePlan"],
      plantings: (plantings.data ?? []) as ReportInputs["plantings"],
      harvests: (harvests.data ?? []) as ReportInputs["harvests"],
      garden: (garden.data ?? []) as ReportInputs["garden"],
      generatedAt: new Date().toISOString(),
    };
    return { reports: buildAllReports(inputs) };
  });
