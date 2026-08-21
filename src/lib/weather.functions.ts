import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerEnv } from "@/lib/server-env.server";
import { describeError, truncateForLog } from "@/lib/error-message";

const STATION_ID = "119722"; // BosteadFarmHouse
// Greenfield, OH (fallback historical source: Open-Meteo Archive API).
const FALLBACK_LAT = 39.3531;
const FALLBACK_LON = -83.3827;


type DailyForecast = {
  day_start_local: number;
  conditions?: string;
  icon?: string;
  air_temp_high?: number;
  air_temp_low?: number;
  precip_probability?: number;
  precip_type?: string;
  sunrise?: number;
  sunset?: number;
  relative_humidity?: number;
  air_temp_feels_like?: number;
};

type CurrentConditions = {
  relative_humidity?: number;
  feels_like?: number;
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
  humidity: number | null;
  feels_like_high_f: number | null;
  feels_like_low_f: number | null;
  fetched_at: string;
};

async function fetchTempest(
  date: string,
): Promise<{ daily: DailyForecast; current: CurrentConditions | null } | null> {
  const token = await getServerEnv("TEMPEST_API_TOKEN");
  // Not configured is a normal state on installs without a Tempest station:
  // skip quietly instead of throwing on every daily-note render.
  if (!token) return null;

  const url = `https://swd.weatherflow.com/swd/rest/better_forecast?station_id=${STATION_ID}&units_temp=f&units_wind=mph&units_pressure=inhg&units_precip=in&units_distance=mi&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tempest API ${res.status}: ${truncateForLog(await res.text(), 200)}`);
  const json = (await res.json()) as {
    forecast?: { daily?: DailyForecast[] };
    current_conditions?: CurrentConditions;
  };
  const daily = json.forecast?.daily ?? [];
  const match = daily.find(
    (d) => d.day_start_local && new Date(d.day_start_local * 1000).toISOString().slice(0, 10) === date,
  );
  if (!match) return null;
  return { daily: match, current: json.current_conditions ?? null };
}

/** Shared helper — usable from other server functions that already have an authed supabase client. */
export async function fetchAndCacheForecast(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  opts: { refresh?: boolean } = {},
): Promise<WeatherRow | null> {
  if (!opts.refresh) {
    const { data: cached } = await supabase
      .from("weather_forecasts")
      .select("*")
      .eq("user_id", userId)
      .eq("station_id", STATION_ID)
      .eq("forecast_date", date)
      .maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      // Rows cached before humidity / feels-like existed are missing some or
      // all of the three: refresh those once instead of serving an incomplete
      // card forever (e.g. humidity: 71, feels 92 / 68).
      const missingExtras =
        cached.humidity == null ||
        cached.feels_like_high_f == null ||
        cached.feels_like_low_f == null;
      if (!missingExtras && (date !== today || ageMs < 60 * 60 * 1000)) return cached as WeatherRow;
    }
  }


  let hit: { daily: DailyForecast; current: CurrentConditions | null } | null = null;
  try {
    hit = await fetchTempest(date);
  } catch (e) {
    console.warn(`[weather] tempest fetch failed for ${date}: ${describeError(e)}`);
  }

  const forecast: Partial<DailyForecast> = hit?.daily ?? {};
  const today = new Date().toISOString().slice(0, 10);
  // Tempest's daily block has no humidity/feels-like; its current_conditions
  // block does (e.g. relative_humidity: 62, feels_like: 88), so it only
  // describes today.
  const current = date === today ? (hit?.current ?? null) : null;

  let humidity = current?.relative_humidity ?? null;
  let feelsHigh = forecast.air_temp_feels_like ?? current?.feels_like ?? null;
  let feelsLow: number | null = null;

  // Open-Meteo supplies daily humidity mean + apparent high/low, which Tempest's
  // daily block never returns (e.g. humidity: 71, feels 92 / 68).
  let om: Awaited<ReturnType<typeof fetchOpenMeteoRange>>[number] | undefined;
  if (humidity == null || feelsHigh == null || feelsLow == null) {
    try {
      om = (await fetchOpenMeteoRange(date, date)).find((d) => d.date === date);
    } catch (e) {
      console.warn(`[weather] open-meteo extras failed for ${date}: ${describeError(e)}`);
    }
    humidity = humidity ?? om?.humidity ?? null;
    feelsHigh = feelsHigh ?? om?.feelsHigh ?? null;
    feelsLow = feelsLow ?? om?.feelsLow ?? null;
  }

  // Nothing usable from either source — don't write an empty row.
  if (!hit && !om) return null;

  const row = {
    user_id: userId,
    station_id: STATION_ID,
    forecast_date: date,
    high_temp_f: forecast.air_temp_high ?? om?.high ?? null,
    low_temp_f: forecast.air_temp_low ?? om?.low ?? null,
    conditions: forecast.conditions ?? om?.conditions ?? null,
    icon: forecast.icon ?? null,
    precip_probability: forecast.precip_probability ?? om?.precipProb ?? null,
    precip_type: forecast.precip_type ?? (om?.precipSum != null && om.precipSum > 0 ? "rain" : null),
    sunrise: forecast.sunrise ? new Date(forecast.sunrise * 1000).toISOString() : null,
    sunset: forecast.sunset ? new Date(forecast.sunset * 1000).toISOString() : null,
    humidity,
    feels_like_high_f: feelsHigh,
    feels_like_low_f: feelsLow,
    raw: { ...forecast, current_conditions: current, open_meteo: om ?? null } as unknown as never,
    fetched_at: new Date().toISOString(),
  };


  const { data: saved, error } = await supabase
    .from("weather_forecasts")
    .upsert(row, { onConflict: "user_id,station_id,forecast_date" })
    .select()
    .single();
  if (error) {
    console.error(`[weather] upsert failed for ${date}: ${describeError(error)}`);
    return null;
  }
  return saved as WeatherRow;
}

export const getDailyForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), refresh: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return fetchAndCacheForecast(context.supabase, context.userId, data.date, { refresh: data.refresh });
  });

export function formatWeatherMarkdown(w: WeatherRow): string {
  const hi = w.high_temp_f != null ? `${Math.round(Number(w.high_temp_f))}°F` : "—";
  const lo = w.low_temp_f != null ? `${Math.round(Number(w.low_temp_f))}°F` : "—";
  const cond = w.conditions ?? "Unknown";
  const precip = w.precip_probability != null ? ` · ${Math.round(Number(w.precip_probability))}% precip` : "";
  const humidity = w.humidity != null ? ` · ${Math.round(Number(w.humidity))}% humidity` : "";
  const feels =
    w.feels_like_high_f != null
      ? ` · Feels like ${Math.round(Number(w.feels_like_high_f))}°F${
          w.feels_like_low_f != null ? ` / ${Math.round(Number(w.feels_like_low_f))}°F` : ""
        }`
      : "";
  return `## Weather · BosteadFarmHouse\n${cond} · High ${hi} / Low ${lo}${feels}${humidity}${precip}\n`;
}

// ---------------------------------------------------------------------------
// Historical backfill — Tempest first, Open-Meteo Archive as fallback for
// Greenfield, OH. Pulls daily highs/lows/precip for an arbitrary date range
// and upserts into weather_forecasts.
// ---------------------------------------------------------------------------

type OpenMeteoArchive = {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    weather_code?: (number | null)[];
    relative_humidity_2m_mean?: (number | null)[];
    apparent_temperature_max?: (number | null)[];
    apparent_temperature_min?: (number | null)[];
  };
};

// Minimal WMO weather code → label map (good enough for the report).
const WMO: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Heavy rain showers", 82: "Violent rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Severe thunderstorm w/ hail",
};

async function fetchOpenMeteoOne(
  base: string,
  start: string,
  end: string,
): Promise<Array<{
  date: string; high: number | null; low: number | null;
  precipProb: number | null; precipSum: number | null; conditions: string | null;
  humidity: number | null; feelsHigh: number | null; feelsLow: number | null;
}>> {
  const params = new URLSearchParams({
    latitude: String(FALLBACK_LAT),
    longitude: String(FALLBACK_LON),
    start_date: start,
    end_date: end,
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,relative_humidity_2m_mean,apparent_temperature_max,apparent_temperature_min",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: "America/New_York",
  });
  const res = await fetch(`${base}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${truncateForLog(await res.text(), 200)}`);
  const json = (await res.json()) as OpenMeteoArchive;
  const d = json.daily;
  if (!d?.time) return [];
  return d.time.map((date, idx) => ({
    date,
    high: d.temperature_2m_max?.[idx] ?? null,
    low: d.temperature_2m_min?.[idx] ?? null,
    precipSum: d.precipitation_sum?.[idx] ?? null,
    precipProb: d.precipitation_probability_max?.[idx] ?? null,
    humidity: d.relative_humidity_2m_mean?.[idx] ?? null,
    feelsHigh: d.apparent_temperature_max?.[idx] ?? null,
    feelsLow: d.apparent_temperature_min?.[idx] ?? null,
    conditions: (() => {
      const code = d.weather_code?.[idx];
      return code != null ? (WMO[code] ?? `Code ${code}`) : null;
    })(),
  }));
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchOpenMeteoRange(start: string, end: string): Promise<Array<{
  date: string; high: number | null; low: number | null;
  precipProb: number | null; precipSum: number | null; conditions: string | null;
  humidity: number | null; feelsHigh: number | null; feelsLow: number | null;
}>> {
  // Archive lags ~2 days; forecast covers ~today-2..today+16. Split the
  // range and skip anything beyond the forecast horizon (future seasons).
  const today = new Date().toISOString().slice(0, 10);
  const archiveCutoff = addDaysISO(today, -3);
  const forecastEndMax = addDaysISO(today, 15);

  const out: Array<{
    date: string; high: number | null; low: number | null;
    precipProb: number | null; precipSum: number | null; conditions: string | null;
    humidity: number | null; feelsHigh: number | null; feelsLow: number | null;
  }> = [];

  if (start <= archiveCutoff) {
    const aEnd = end < archiveCutoff ? end : archiveCutoff;
    try {
      out.push(...await fetchOpenMeteoOne(
        "https://archive-api.open-meteo.com/v1/archive", start, aEnd,
      ));
    } catch (e) {
      console.warn(`[weather] open-meteo archive failed (${start}..${aEnd}): ${describeError(e)}`);
    }
  }

  const fStart = start > archiveCutoff ? start : addDaysISO(archiveCutoff, 1);
  const fEnd = end < forecastEndMax ? end : forecastEndMax;
  if (fStart <= fEnd && fStart <= end) {
    try {
      out.push(...await fetchOpenMeteoOne(
        "https://api.open-meteo.com/v1/forecast", fStart, fEnd,
      ));
    } catch (e) {
      console.warn(`[weather] open-meteo forecast failed (${fStart}..${fEnd}): ${describeError(e)}`);
    }
  }

  return out;
}


export const backfillSeasonWeather = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      overwrite: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { startDate, endDate, overwrite } = data;
    if (endDate < startDate) throw new Error("endDate must be ≥ startDate");

    // Skip dates already cached unless overwrite=true.
    let existingDates = new Set<string>();
    if (!overwrite) {
      const { data: existing } = await context.supabase
        .from("weather_forecasts")
        .select("forecast_date")
        .eq("user_id", context.userId)
        .eq("station_id", STATION_ID)
        .gte("forecast_date", startDate)
        .lte("forecast_date", endDate);
      existingDates = new Set((existing ?? []).map((r) => r.forecast_date as string));
    }

    let source: "tempest" | "open-meteo" = "open-meteo";
    let days: Array<{ date: string; high: number | null; low: number | null;
      precipProb: number | null; precipSum: number | null; conditions: string | null;
      humidity: number | null; feelsHigh: number | null; feelsLow: number | null }> = [];

    // Try Tempest first for any portion that's within its ~10-day forecast window.
    // Tempest's better_forecast covers ~today + 10 days; for true history we use Open-Meteo.
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (endDate >= today) {
        const token = await getServerEnv("TEMPEST_API_TOKEN");
        if (token) {
          const url = `https://swd.weatherflow.com/swd/rest/better_forecast?station_id=${STATION_ID}&units_temp=f&units_wind=mph&units_pressure=inhg&units_precip=in&units_distance=mi&token=${token}`;
          const res = await fetch(url);
          if (res.ok) {
            const json = (await res.json()) as { forecast?: { daily?: DailyForecast[] } };
            const tempDays = (json.forecast?.daily ?? [])
              .map((d) => ({
                date: d.day_start_local ? new Date(d.day_start_local * 1000).toISOString().slice(0, 10) : "",
                high: d.air_temp_high ?? null,
                low: d.air_temp_low ?? null,
                precipProb: d.precip_probability ?? null,
                precipSum: null,
                conditions: d.conditions ?? null,
                humidity: d.relative_humidity ?? null,
                feelsHigh: d.air_temp_feels_like ?? null,
                feelsLow: null,
              }))
              .filter((d) => d.date >= startDate && d.date <= endDate);
            if (tempDays.length) {
              days = tempDays;
              source = "tempest";
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[weather] tempest backfill failed, falling back to Open-Meteo: ${describeError(e)}`);
    }

    // Cover the rest of the range with Open-Meteo.
    const haveDates = new Set(days.map((d) => d.date));
    const missingStart = startDate;
    const missingEnd = endDate;
    try {
      const omDays = await fetchOpenMeteoRange(missingStart, missingEnd);
      for (const d of omDays) {
        if (!haveDates.has(d.date)) days.push(d);
      }
    } catch (e) {
      console.error(`[weather] open-meteo backfill failed (${missingStart}..${missingEnd}): ${describeError(e)}`);
      if (days.length === 0) throw new Error(`Backfill failed: ${describeError(e)}`);
    }

    // Filter to range + dedup + skip cached.
    const seen = new Set<string>();
    const rows = days
      .filter((d) => d.date >= startDate && d.date <= endDate)
      .filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)))
      .filter((d) => overwrite || !existingDates.has(d.date))
      .map((d) => ({
        user_id: context.userId,
        station_id: STATION_ID,
        forecast_date: d.date,
        high_temp_f: d.high,
        low_temp_f: d.low,
        conditions: d.conditions,
        icon: null,
        precip_probability: d.precipProb,
        precip_type: (d.precipSum != null && d.precipSum > 0) ? "rain" : null,
        humidity: d.humidity,
        feels_like_high_f: d.feelsHigh,
        feels_like_low_f: d.feelsLow,
        sunrise: null,
        sunset: null,
        raw: { source, precip_sum_in: d.precipSum } as unknown as never,
        fetched_at: new Date().toISOString(),
      }));

    if (rows.length === 0) {
      return { inserted: 0, skipped: existingDates.size, source, range: { startDate, endDate } };
    }

    // Upsert in chunks of 200 to stay friendly to PostgREST.
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await context.supabase
        .from("weather_forecasts")
        .upsert(chunk, { onConflict: "user_id,station_id,forecast_date" });
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }
    return { inserted, skipped: existingDates.size, source, range: { startDate, endDate } };
  });


// ---------------------------------------------------------------------------
// One-time cache bust: rows written before humidity / feels-like existed have
// all three columns NULL. This refills them in bulk from Open-Meteo (Tempest's
// daily block never returns those fields) and is safe to re-run — it only
// touches rows that are still missing every extra.
// ---------------------------------------------------------------------------

export const refillWeatherExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        // Optional narrowing, e.g. { startDate: "2026-06-01", endDate: "2026-08-20" }.
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("weather_forecasts")
      .select("id, forecast_date")
      .eq("user_id", context.userId)
      .eq("station_id", STATION_ID)
      .is("humidity", null)
      .is("feels_like_high_f", null)
      .is("feels_like_low_f", null)
      .order("forecast_date");
    if (data.startDate) q = q.gte("forecast_date", data.startDate);
    if (data.endDate) q = q.lte("forecast_date", data.endDate);

    const { data: stale, error } = await q;
    if (error) throw new Error(error.message);
    const rows = stale ?? [];
    if (rows.length === 0) {
      return { candidates: 0, updated: 0, unavailable: 0, range: null as null | { start: string; end: string } };
    }

    const dates = rows.map((r) => r.forecast_date as string);
    const start = dates[0]!;
    const end = dates[dates.length - 1]!;

    let om: Awaited<ReturnType<typeof fetchOpenMeteoRange>> = [];
    try {
      om = await fetchOpenMeteoRange(start, end);
    } catch (e) {
      throw new Error(`Open-Meteo refill failed (${start}..${end}): ${describeError(e)}`);
    }
    const byDate = new Map(om.map((d) => [d.date, d]));

    let updated = 0;
    let unavailable = 0;
    for (const r of rows) {
      const hit = byDate.get(r.forecast_date as string);
      if (!hit || (hit.humidity == null && hit.feelsHigh == null && hit.feelsLow == null)) {
        unavailable += 1;
        continue;
      }
      const { error: upErr } = await context.supabase
        .from("weather_forecasts")
        .update({
          humidity: hit.humidity,
          feels_like_high_f: hit.feelsHigh,
          feels_like_low_f: hit.feelsLow,
          fetched_at: new Date().toISOString(),
        })
        .eq("id", r.id as string)
        .eq("user_id", context.userId);
      if (upErr) {
        console.warn(`[weather] refill update failed for ${r.forecast_date}: ${describeError(upErr)}`);
        unavailable += 1;
        continue;
      }
      updated += 1;
    }

    return { candidates: rows.length, updated, unavailable, range: { start, end } };
  });
