import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerEnv } from "@/lib/server-env.server";

const STATION_ID = "119722"; // BosteadFarmHouse

type DailyForecast = {
  day_start_local: number; // epoch seconds, local midnight
  conditions?: string;
  icon?: string;
  air_temp_high?: number;
  air_temp_low?: number;
  precip_probability?: number;
  precip_type?: string;
  sunrise?: number;
  sunset?: number;
};

export type WeatherRow = {
  station_id: string;
  forecast_date: string;
  high_temp_f: number | null;
  low_temp_f: number | null;
  conditions: string | null;
  icon: string | null;
  precip_probability: number | null;
  precip_type: string | null;
  sunrise: string | null;
  sunset: string | null;
  fetched_at: string;
};

async function fetchTempest(date: string): Promise<DailyForecast | null> {
  const token = await getServerEnv("TEMPEST_API_TOKEN");
  if (!token) throw new Error("TEMPEST_API_TOKEN is not configured");
  const url = `https://swd.weatherflow.com/swd/rest/better_forecast?station_id=${STATION_ID}&units_temp=f&units_wind=mph&units_pressure=inhg&units_precip=in&units_distance=mi&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tempest API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { forecast?: { daily?: DailyForecast[] } };
  const daily = json.forecast?.daily ?? [];
  // Match by date string in local TZ derived from day_start_local epoch.
  const match = daily.find((d) => {
    if (!d.day_start_local) return false;
    const iso = new Date(d.day_start_local * 1000).toISOString().slice(0, 10);
    return iso === date;
  });
  return match ?? null;
}

export const getDailyForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), refresh: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<WeatherRow | null> => {
    const { supabase, userId } = context;
    const { date, refresh } = data;

    if (!refresh) {
      const { data: cached } = await supabase
        .from("weather_forecasts")
        .select("*")
        .eq("user_id", userId)
        .eq("station_id", STATION_ID)
        .eq("forecast_date", date)
        .maybeSingle();
      // Re-fetch today's row if it's older than 1 hour; past dates are immutable.
      const today = new Date().toISOString().slice(0, 10);
      if (cached) {
        const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
        if (date !== today || ageMs < 60 * 60 * 1000) {
          return cached as WeatherRow;
        }
      }
    }

    let forecast: DailyForecast | null = null;
    try {
      forecast = await fetchTempest(date);
    } catch (e) {
      console.error("[weather] tempest fetch failed", e);
      return null;
    }
    if (!forecast) return null;

    const row = {
      user_id: userId,
      station_id: STATION_ID,
      forecast_date: date,
      high_temp_f: forecast.air_temp_high ?? null,
      low_temp_f: forecast.air_temp_low ?? null,
      conditions: forecast.conditions ?? null,
      icon: forecast.icon ?? null,
      precip_probability: forecast.precip_probability ?? null,
      precip_type: forecast.precip_type ?? null,
      sunrise: forecast.sunrise ? new Date(forecast.sunrise * 1000).toISOString() : null,
      sunset: forecast.sunset ? new Date(forecast.sunset * 1000).toISOString() : null,
      raw: forecast as unknown as never,
      fetched_at: new Date().toISOString(),
    };

    const { data: saved, error } = await supabase
      .from("weather_forecasts")
      .upsert(row, { onConflict: "user_id,station_id,forecast_date" })
      .select()
      .single();
    if (error) {
      console.error("[weather] upsert failed", error);
      return null;
    }
    return saved as WeatherRow;
  });

export function formatWeatherMarkdown(w: WeatherRow): string {
  const hi = w.high_temp_f != null ? `${Math.round(Number(w.high_temp_f))}°F` : "—";
  const lo = w.low_temp_f != null ? `${Math.round(Number(w.low_temp_f))}°F` : "—";
  const cond = w.conditions ?? "Unknown";
  const precip = w.precip_probability != null ? ` · ${Math.round(Number(w.precip_probability))}% precip` : "";
  return `## Weather · BosteadFarmHouse\n${cond} · High ${hi} / Low ${lo}${precip}\n`;
}
