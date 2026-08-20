ALTER TABLE public.weather_forecasts
  ADD COLUMN IF NOT EXISTS humidity numeric,
  ADD COLUMN IF NOT EXISTS feels_like_high_f numeric,
  ADD COLUMN IF NOT EXISTS feels_like_low_f numeric;