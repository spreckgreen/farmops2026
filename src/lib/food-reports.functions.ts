import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAllReports,
  type ReportInputs,
  LAST_SPRING_FROST_MMDD,
  FIRST_FALL_FROST_MMDD,
} from "./food-reports";

const inputSchema = z
  .object({
    seasonYear: z.number().int().min(1900).max(2200).optional(),
  })
  .optional();

function seasonRange(year: number): { start: string; end: string } {
  const [lsm, lsd] = LAST_SPRING_FROST_MMDD.split("-").map(Number);
  const [ffm, ffd] = FIRST_FALL_FROST_MMDD.split("-").map(Number);
  const start = new Date(Date.UTC(year, lsm - 1, lsd));
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(Date.UTC(year, ffm - 1, ffd));
  end.setUTCMonth(end.getUTCMonth() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export const getFoodReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const seasonYear = data?.seasonYear;

    let weatherQuery = sb
      .from("weather_forecasts")
      .select("forecast_date, high_temp_f, low_temp_f, conditions, precip_probability, precip_type")
      .order("forecast_date");
    if (seasonYear) {
      const { start, end } = seasonRange(seasonYear);
      weatherQuery = weatherQuery.gte("forecast_date", start).lte("forecast_date", end);
    }

    const [foods, people, entries, storage, plantings, harvests, garden, weather] = await Promise.all([
      sb.from("food_plan_foods").select("id, name, category, oz_per_serving, price_per_pound, season").order("sort_order"),
      sb.from("food_plan_people").select("id, name").order("sort_order"),
      sb.from("food_plan_entries").select("food_id, person_id, day_of_week, quantity"),
      sb.from("food_storage_plan").select("name, category, food_type, pounds_per_year, target_months, price_per_pound, notes").order("sort_order"),
      sb.from("crop_plantings").select("id, crop, variety, status, planted_on, expected_harvest"),
      sb.from("crop_harvests").select("id, planting_id, harvested_on, quantity, unit, quality, notes"),
      sb.from("garden_plots").select("row_label, position, plant_name").order("row_label").order("position"),
      weatherQuery,
    ]);
    for (const r of [foods, people, entries, storage, plantings, harvests, garden, weather]) {
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
      weather: (weather.data ?? []) as ReportInputs["weather"],
      seasonYear,
      generatedAt: new Date().toISOString(),
    };
    return { reports: buildAllReports(inputs) };
  });
